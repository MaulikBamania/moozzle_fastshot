-- Live biometric engine: real embeddings in pgvector, 1:N / 1:1 search, scan log, enrolment duplicate block,
-- validation statistics from enrolled templates, and private muzzle capture storage.

create extension if not exists vector with schema extensions;

alter table public.biometric_templates
  add column if not exists embedding extensions.vector(256),
  add column if not exists model_name text not null default 'MOOZZLE-TextureHOG-v1',
  add column if not exists embedding_dim integer not null default 256,
  add column if not exists image_path text,
  add column if not exists frame_index integer not null default 0,
  add column if not exists quality_metrics jsonb not null default '{}'::jsonb;
create index if not exists biometric_templates_image_idx on public.biometric_templates (image_path);

alter table public.animals add column if not exists reference_image_path text;

create table if not exists public.biometric_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_role text not null default '',
  scan_type text not null check (scan_type in ('identify', 'verify', 'enrol_check')),
  captured_image_path text,
  quality_status text not null default '',
  quality_score numeric(4, 3),
  outcome text not null check (outcome in ('match', 'no_match', 'uncertain')),
  matched_moozzle_id text,
  claimed_moozzle_id text,
  similarity_score numeric(6, 4),
  processing_time_ms integer,
  templates_searched integer not null default 0,
  model_name text not null default 'MOOZZLE-TextureHOG-v1',
  created_at timestamptz not null default now()
);
create index if not exists biometric_scans_user_idx on public.biometric_scans (user_id, created_at desc);
alter table public.biometric_scans enable row level security;
revoke all on public.biometric_scans from anon;
grant select on public.biometric_scans to authenticated;
drop policy if exists "scans_select_own" on public.biometric_scans;
create policy "scans_select_own" on public.biometric_scans for select to authenticated
  using (user_id = auth.uid() or coalesce((select privileged from public.active_scope()), false));

insert into public.platform_settings (key, value, description, risk) values
  ('match_threshold', '0.85'::jsonb, '1:N similarity at or above which a scan is a Confirmed Match.', 'high'),
  ('review_threshold', '0.70'::jsonb, 'Similarity at or above which a scan is Uncertain (candidate review).', 'high'),
  ('verify_threshold', '0.88'::jsonb, '1:1 similarity required to mark a claimed MOOZZLE ID as Verified.', 'high')
on conflict (key) do nothing;
update public.platform_settings set value = '"MOOZZLE-TextureHOG-v1"'::jsonb where key = 'model_version' and value = '"moozzle-proto-v1.0"'::jsonb;

create or replace function public.setting_num(p_key text, p_default numeric) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from public.platform_settings where key = p_key), p_default);
$$;

-- Validates a client embedding: exactly 256 finite dimensions with a non-zero norm.
create or replace function public.to_embedding(p text) returns extensions.vector language plpgsql immutable set search_path = public, extensions as $$
declare
  v extensions.vector;
begin
  if p is null or length(p) < 10 then raise exception 'Missing biometric embedding.'; end if;
  v := p::extensions.vector;
  if extensions.vector_dims(v) <> 256 then raise exception 'Embedding must have 256 dimensions.'; end if;
  if extensions.vector_norm(v) < 0.5 then raise exception 'Embedding is not normalised.'; end if;
  return v;
end;
$$;

-- Ranked animals by similarity. For several query frames, each animal's score is the mean over frames of the
-- best template similarity, which damps a single lucky frame.
create or replace function public.biometric_candidates(p_queries extensions.vector[], p_limit integer default 5)
returns table (animal_id uuid, score double precision)
language sql stable security definer set search_path = public, extensions as $$
  with per_query as (
    select t.animal_id, q.ord, max(1 - (t.embedding <=> q.v)) as best
    from unnest(p_queries) with ordinality as q (v, ord)
    cross join public.biometric_templates t
    join public.animals a on a.id = t.animal_id
    where t.embedding is not null and a.status = 'active' and a.approval_status <> 'Rejected'
    group by t.animal_id, q.ord
  )
  select animal_id, avg(best)::double precision as score from per_query group by animal_id order by score desc limit p_limit;
$$;

create or replace function public.mask_moozzle_id(p text) returns text language sql immutable set search_path = public as $$
  select '•••• •••• ' || right(p, 4);
$$;

create or replace function public.candidate_json(p_animal uuid, p_score double precision) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a record;
  visible boolean := public.can_view_animal(p_animal);
begin
  select * into a from public.animals where id = p_animal;
  if visible then
    return jsonb_build_object('animal_id', a.id, 'in_scope', true, 'moozzle_id', a.moozzle_id, 'species', a.species, 'breed', a.breed,
      'sex', a.sex, 'age_years', a.age_years, 'farm_name', a.farm_name, 'village', a.village,
      'reference_image_path', a.reference_image_path, 'score', round(p_score::numeric, 4));
  end if;
  -- Out-of-scope animals are never described; only the fact that a registration exists.
  return jsonb_build_object('in_scope', false, 'moozzle_id', public.mask_moozzle_id(a.moozzle_id), 'species', a.species, 'score', round(p_score::numeric, 4));
end;
$$;

create or replace function public.capture_path_ok(p_path text) returns boolean language sql stable set search_path = public as $$
  select p_path is null or p_path = '' or split_part(p_path, '/', 1) = auth.uid()::text;
$$;

-- ---------- 1:N identification ----------
create or replace function public.identify_muzzle(p_embedding text, p_image_path text, p_quality jsonb, p_processing_ms integer)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
  q extensions.vector := public.to_embedding(p_embedding);
  t_match numeric := public.setting_num('match_threshold', 0.85);
  t_review numeric := public.setting_num('review_threshold', 0.70);
  searched integer;
  top record;
  v_outcome text;
  cands jsonb := '[]'::jsonb;
  c record;
  v_scan uuid;
  v_target text := '';
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  if public.perm('identify_animal') in ('No', 'Via API scope', 'De-identified', 'Technical only') then
    perform public.write_audit('biometric.identify', '', '1:N scan refused for role', 'denied');
    perform public.deny('identify_animal');
  end if;
  if not public.capture_path_ok(p_image_path) then perform public.deny('capture path'); end if;
  select count(*) into searched from public.biometric_templates t join public.animals a on a.id = t.animal_id
    where t.embedding is not null and a.status = 'active' and a.approval_status <> 'Rejected';
  for c in select * from public.biometric_candidates(array[q], 3) loop
    cands := cands || public.candidate_json(c.animal_id, c.score);
  end loop;
  select * into top from public.biometric_candidates(array[q], 1);
  if top.animal_id is null or top.score < t_review then v_outcome := 'no_match';
  elsif top.score >= t_match then v_outcome := 'match';
  else v_outcome := 'uncertain';
  end if;
  if v_outcome = 'match' and (cands -> 0 ->> 'in_scope')::boolean then v_target := cands -> 0 ->> 'moozzle_id'; end if;
  insert into public.biometric_scans (user_id, user_role, scan_type, captured_image_path, quality_status, quality_score, outcome,
    matched_moozzle_id, similarity_score, processing_time_ms, templates_searched)
  values (auth.uid(), s.role, 'identify', nullif(p_image_path, ''), coalesce(p_quality ->> 'status', ''),
    nullif(p_quality ->> 'score', '')::numeric, v_outcome, nullif(v_target, ''), round(coalesce(top.score, 0)::numeric, 4), p_processing_ms, searched)
  returning id into v_scan;
  perform public.write_audit('biometric.identify', v_target,
    '1:N ' || v_outcome || ' · top similarity ' || to_char(coalesce(top.score, 0), 'FM0.000') || ' across ' || searched || ' templates',
    case v_outcome when 'match' then 'success' when 'uncertain' then 'requested' else 'no_match' end);
  return jsonb_build_object('scan_id', v_scan, 'outcome', v_outcome, 'top_score', round(coalesce(top.score, 0)::numeric, 4),
    'match_threshold', t_match, 'review_threshold', t_review, 'templates_searched', searched,
    'candidates', case when v_outcome = 'no_match' then '[]'::jsonb else cands end);
end;
$$;

-- ---------- 1:1 verification ----------
create or replace function public.verify_muzzle(p_moozzle_id text, p_embedding text, p_image_path text, p_quality jsonb, p_processing_ms integer)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
  q extensions.vector := public.to_embedding(p_embedding);
  a record;
  t_verify numeric := public.setting_num('verify_threshold', 0.88);
  t_review numeric := public.setting_num('review_threshold', 0.70);
  v_score double precision;
  n integer;
  v_outcome text;
  v_scan uuid;
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  select * into a from public.animals where moozzle_id = regexp_replace(coalesce(p_moozzle_id, ''), '\s', '', 'g');
  if not found or not public.can_view_animal(a.id) then
    perform public.write_audit('biometric.verify', '', '1:1 verification for an unknown or out-of-scope ID', 'denied');
    raise exception 'No animal with this MOOZZLE ID is in your authorised records.';
  end if;
  if not public.capture_path_ok(p_image_path) then perform public.deny('capture path'); end if;
  select max(1 - (t.embedding <=> q)), count(*) into v_score, n from public.biometric_templates t where t.animal_id = a.id and t.embedding is not null;
  if n = 0 then
    raise exception 'MOOZZLE ID % has no live-engine biometric template yet. Re-enrol its muzzle images before 1:1 verification.', a.moozzle_id;
  end if;
  v_outcome := case when v_score >= t_verify then 'match' when v_score >= t_review then 'uncertain' else 'no_match' end;
  insert into public.biometric_scans (user_id, user_role, scan_type, captured_image_path, quality_status, quality_score, outcome,
    matched_moozzle_id, claimed_moozzle_id, similarity_score, processing_time_ms, templates_searched)
  values (auth.uid(), s.role, 'verify', nullif(p_image_path, ''), coalesce(p_quality ->> 'status', ''), nullif(p_quality ->> 'score', '')::numeric,
    v_outcome, case when v_outcome = 'match' then a.moozzle_id end, a.moozzle_id, round(v_score::numeric, 4), p_processing_ms, n)
  returning id into v_scan;
  perform public.write_audit('biometric.verify', a.moozzle_id, '1:1 ' || v_outcome || ' · similarity ' || to_char(v_score, 'FM0.000') || ' vs ' || n || ' templates',
    case v_outcome when 'match' then 'success' when 'uncertain' then 'requested' else 'no_match' end);
  return jsonb_build_object('scan_id', v_scan, 'outcome', v_outcome, 'score', round(v_score::numeric, 4), 'verify_threshold', t_verify,
    'review_threshold', t_review, 'templates_compared', n, 'animal', public.candidate_json(a.id, v_score));
end;
$$;

-- ---------- Validation statistics from enrolled templates (de-identified scores only) ----------
create or replace function public.biometric_validation(p_mode text default 'overall') returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s record;
  pairs jsonb;
  n_templates integer;
  n_animals integer;
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  if p_mode not in ('overall', 'cross_breed', 'cross_lighting') then raise exception 'Unknown validation mode.'; end if;
  select count(*), count(distinct animal_id) into n_templates, n_animals from public.biometric_templates where embedding is not null;
  with t as (
    select bt.id, bt.animal_id, bt.embedding, a.breed,
      case when coalesce((bt.quality_metrics ->> 'brightness')::numeric, 128) < 95 then 'low' else 'normal' end as light
    from public.biometric_templates bt join public.animals a on a.id = bt.animal_id
    where bt.embedding is not null
    order by bt.created_at desc limit 400
  ), p as (
    select (t1.animal_id = t2.animal_id) as genuine, 1 - (t1.embedding <=> t2.embedding) as score,
      case p_mode
        when 'cross_breed' then case when t1.breed = t2.breed then 'Same breed' else 'Different breed' end
        when 'cross_lighting' then case when t1.light = t2.light then case t1.light when 'low' then 'Both low light' else 'Both normal light' end else 'Mixed lighting' end
        else 'All pairs'
      end as grp
    from t t1 join t t2 on t1.id < t2.id
    limit 40000
  )
  select coalesce(jsonb_agg(jsonb_build_array(case when genuine then 1 else 0 end, round(score::numeric, 4), grp)), '[]'::jsonb) into pairs from p;
  return jsonb_build_object('mode', p_mode, 'templates', n_templates, 'animals', n_animals, 'pairs', pairs,
    'match_threshold', public.setting_num('match_threshold', 0.85), 'review_threshold', public.setting_num('review_threshold', 0.70),
    'verify_threshold', public.setting_num('verify_threshold', 0.88),
    'scans', (select jsonb_build_object('total', count(*), 'match', count(*) filter (where outcome = 'match'),
      'no_match', count(*) filter (where outcome = 'no_match'), 'uncertain', count(*) filter (where outcome = 'uncertain'),
      'avg_ms', round(avg(processing_time_ms))) from public.biometric_scans));
end;
$$;

-- ---------- Registration with server-enforced 1:N duplicate check ----------
create or replace function public.register_animal(p jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
  lvl text := public.perm('register_animal');
  v_id uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
  v_farm uuid := nullif(p ->> 'farm_id', '')::uuid;
  f_org uuid;
  f_name text;
  f_village text;
  f_state text;
  f_district text;
  v_org uuid;
  v_owner uuid;
  v_district text := trim(coalesce(p ->> 'district', ''));
  v_status text;
  v_dup uuid;
  v_mid text;
  v_owner_name text := trim(coalesce(p ->> 'owner_name', ''));
  existing record;
  emb_texts text[];
  embs extensions.vector[] := '{}';
  paths text[];
  scores numeric[];
  metrics jsonb := coalesce(p -> 'quality_metrics', '[]'::jsonb);
  t_match numeric := public.setting_num('match_threshold', 0.85);
  t_review numeric := public.setting_num('review_threshold', 0.70);
  top record;
  searched integer;
  cand jsonb;
  v_ref text;
  i integer;
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  select * into existing from public.animals where id = v_id;
  if found then
    if existing.user_id = auth.uid() then
      return jsonb_build_object('id', existing.id, 'moozzle_id', existing.moozzle_id, 'approval_status', existing.approval_status, 'duplicate', existing.duplicate_of is not null, 'existing', true, 'blocked', false);
    end if;
    perform public.deny('record id belongs to another record');
  end if;
  if lvl in ('No', 'De-identified', 'Via API scope', 'Technical only') then
    perform public.write_audit('animal.register', '', 'Registration refused for role', 'denied');
    perform public.deny('register_animal');
  end if;
  if s.role = 'Super Administrator' and not s.privileged then perform public.deny('privileged access required'); end if;
  if (p ->> 'species') not in ('cattle', 'buffalo') or (p ->> 'sex') not in ('female', 'male') then raise exception 'Choose species and sex.'; end if;
  if length(trim(coalesce(p ->> 'breed', ''))) = 0 then raise exception 'Choose a breed.'; end if;

  select coalesce(array_agg(x), '{}') into emb_texts from jsonb_array_elements_text(coalesce(p -> 'embeddings', '[]'::jsonb)) x;
  select coalesce(array_agg(x), '{}') into paths from jsonb_array_elements_text(coalesce(p -> 'image_paths', '[]'::jsonb)) x;
  select coalesce(array_agg(x::numeric), '{}') into scores from jsonb_array_elements_text(coalesce(p -> 'quality_scores', '[]'::jsonb)) x;
  if coalesce(array_length(emb_texts, 1), 0) < 3 or array_length(emb_texts, 1) > 5 then
    raise exception 'Enrolment needs 3 to 5 accepted muzzle images with biometric embeddings.';
  end if;
  for i in 1..array_length(emb_texts, 1) loop
    embs := embs || public.to_embedding(emb_texts[i]);
  end loop;
  for i in 1..coalesce(array_length(paths, 1), 0) loop
    if not public.capture_path_ok(paths[i]) then perform public.deny('capture path'); end if;
  end loop;

  -- 1:N duplicate search across every enrolled template, not only the caller's scope.
  select count(*) into searched from public.biometric_templates t join public.animals a on a.id = t.animal_id
    where t.embedding is not null and a.status = 'active' and a.approval_status <> 'Rejected';
  select * into top from public.biometric_candidates(embs, 1);
  if top.animal_id is not null and top.score >= t_match then
    cand := public.candidate_json(top.animal_id, top.score);
    insert into public.biometric_scans (user_id, user_role, scan_type, captured_image_path, quality_status, outcome, matched_moozzle_id, similarity_score, templates_searched)
    values (auth.uid(), s.role, 'enrol_check', nullif(paths[1], ''), 'GOOD IMAGE', 'match',
      case when (cand ->> 'in_scope')::boolean then cand ->> 'moozzle_id' end, round(top.score::numeric, 4), searched);
    perform public.write_audit('animal.register', case when (cand ->> 'in_scope')::boolean then cand ->> 'moozzle_id' else '' end,
      'Duplicate enrolment blocked · similarity ' || to_char(top.score, 'FM0.000'), 'denied', 'ANIMAL ALREADY REGISTERED', coalesce(p ->> 'source', 'moozzle-app'));
    return jsonb_build_object('blocked', true, 'duplicate', true, 'existing', false, 'match', cand, 'score', round(top.score::numeric, 4),
      'templates_searched', searched, 'match_threshold', t_match);
  end if;

  if v_farm is not null then
    select organisation_id, name, village, state, district into f_org, f_name, f_village, f_state, f_district from public.farms where id = v_farm;
    if not found then raise exception 'Unknown farm.'; end if;
    v_district := coalesce(nullif(v_district, ''), f_district);
  end if;

  if s.role in ('Veterinarian', 'AI Technician', 'Farm Manager', 'Field Worker') then
    if v_farm is not null and not (v_farm = any (s.farm_ids)) then perform public.deny('farm outside your assignment'); end if;
  elsif s.role = 'Organisation Administrator' then
    if v_farm is not null and f_org is distinct from s.organisation_id then perform public.deny('farm outside your organisation'); end if;
  elsif s.role in ('Government Officer', 'Livestock Inspector') then
    if not (v_district = any (s.districts)) then perform public.deny('district outside your jurisdiction'); end if;
  elsif s.role = 'Farmer' then
    v_farm := null;
    f_org := null;
    f_name := null;
    v_owner := auth.uid();
    if v_owner_name = '' then select full_name into v_owner_name from public.profiles where id = auth.uid(); end if;
  end if;
  v_org := coalesce(f_org, case when s.role = 'Farmer' then null else s.organisation_id end);

  if coalesce((p ->> 'save_as_draft')::boolean, false) then
    v_status := 'Draft';
  elsif lvl in ('Full', 'Scoped') then
    v_status := 'Approved';
  else
    v_status := 'Submitted';
  end if;

  -- Uncertain biometric similarity → manual review, never auto-merge.
  if top.animal_id is not null and top.score >= t_review then v_dup := top.animal_id; end if;
  if v_dup is not null and v_status <> 'Draft' then v_status := 'Pending Review'; end if;

  v_ref := nullif(paths[1], '');
  v_mid := public.next_moozzle_id(p ->> 'moozzle_id');
  insert into public.animals (id, user_id, moozzle_id, species, breed, sex, age_years, farm_name, village, district, state,
    biometric_status, status, captured_images_count, organisation_id, farm_id, owner_user_id, approval_status, duplicate_of, reference_image_path)
  values (v_id, auth.uid(), v_mid, p ->> 'species', trim(p ->> 'breed'), p ->> 'sex', (p ->> 'age_years')::int,
    coalesce(f_name, trim(coalesce(p ->> 'farm_name', ''))), coalesce(nullif(trim(coalesce(p ->> 'village', '')), ''), f_village, ''),
    v_district, coalesce(nullif(trim(coalesce(p ->> 'state', '')), ''), f_state, ''),
    case when coalesce((p ->> 'quality_score')::numeric, 0) >= 0.7 then 'enrolled' else 'pending_quality' end,
    'active', array_length(embs, 1), v_org, v_farm, v_owner, v_status, v_dup, v_ref);
  insert into public.animal_owners (animal_id, owner_name, owner_phone) values (v_id, v_owner_name, trim(coalesce(p ->> 'owner_phone', '')));
  for i in 1..array_length(embs, 1) loop
    insert into public.biometric_templates (user_id, animal_id, moozzle_id, quality_score, embedding_preview, model_version, embedding,
      model_name, embedding_dim, image_path, frame_index, quality_metrics)
    values (auth.uid(), v_id, v_mid, least(greatest(coalesce(scores[i], (p ->> 'quality_score')::numeric, 0), 0), 1),
      left(emb_texts[i], 60), coalesce((select value #>> '{}' from public.platform_settings where key = 'model_version'), 'MOOZZLE-TextureHOG-v1'),
      embs[i], 'MOOZZLE-TextureHOG-v1', 256, nullif(paths[i], ''), i, coalesce(metrics -> (i - 1), '{}'::jsonb));
  end loop;
  insert into public.biometric_scans (user_id, user_role, scan_type, captured_image_path, quality_status, outcome, similarity_score, templates_searched)
  values (auth.uid(), s.role, 'enrol_check', v_ref, 'GOOD IMAGE', case when v_dup is not null then 'uncertain' else 'no_match' end,
    round(coalesce(top.score, 0)::numeric, 4), searched);

  perform public.write_audit('animal.register', v_mid, 'Registered ' || (p ->> 'breed') || ' as ' || v_status || ' · ' || array_length(embs, 1)
    || ' templates · 1:N best ' || to_char(coalesce(top.score, 0), 'FM0.000') || case when v_dup is not null then ' (possible duplicate, manual review)' else '' end,
    'success', '', coalesce(p ->> 'source', 'moozzle-app'));
  if v_status in ('Submitted', 'Pending Review') then
    perform public.notify_scope(array['Organisation Administrator'], v_org, null, null, 'New registration awaiting approval',
      (p ->> 'breed') || ' · MOOZZLE ID ' || v_mid || case when v_dup is not null then ' · possible duplicate' else '' end, 'approval', '/approvals');
  end if;
  return jsonb_build_object('id', v_id, 'moozzle_id', v_mid, 'approval_status', v_status, 'duplicate', v_dup is not null, 'existing', false,
    'blocked', false, 'score', round(coalesce(top.score, 0)::numeric, 4), 'templates_searched', searched,
    'review_candidate', case when v_dup is not null then public.candidate_json(v_dup, top.score) end);
end;
$$;

-- Threshold keys share the high-risk change rule.
create or replace function public.update_setting(p_key text, p_value jsonb, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare
  s record;
  st record;
begin
  select * into s from public.active_scope();
  select * into st from public.platform_settings where key = p_key;
  if not found then raise exception 'Unknown setting.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Give a reason of at least 10 characters.'; end if;
  if p_key in ('biometric_threshold', 'model_version', 'match_threshold', 'review_threshold', 'verify_threshold') then
    if public.perm('change_threshold') <> 'Authorised' or not coalesce(s.privileged, false) then
      perform public.write_audit('admin.setting_change', '', 'Threshold/model change refused', 'denied');
      perform public.deny('change biometric threshold');
    end if;
    if p_key <> 'model_version' and ((p_value #>> '{}')::numeric < 0.5 or (p_value #>> '{}')::numeric > 0.99) then
      raise exception 'Threshold must be between 0.50 and 0.99 (validated range).';
    end if;
    if p_key = 'review_threshold' and (p_value #>> '{}')::numeric >= public.setting_num('match_threshold', 0.85) then
      raise exception 'Review threshold must stay below the match threshold.';
    end if;
    if p_key = 'match_threshold' and (p_value #>> '{}')::numeric <= public.setting_num('review_threshold', 0.70) then
      raise exception 'Match threshold must stay above the review threshold.';
    end if;
  elsif p_key = 'api_default_rate_limit' and s.role = 'API Administrator' then
    null;
  elsif public.perm('platform_settings') <> 'Full' or not coalesce(s.privileged, false) then
    perform public.deny('platform settings');
  end if;
  update public.platform_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform public.write_audit('admin.setting_change', '', p_key || ': ' || (st.value #>> '{}') || ' → ' || (p_value #>> '{}'), 'success', trim(p_reason));
end;
$$;

-- ---------- Private muzzle capture storage ----------
create or replace function public.can_view_capture(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select split_part(p_name, '/', 1) = auth.uid()::text
    or exists (select 1 from public.biometric_templates t where t.image_path = p_name and public.can_view_animal(t.animal_id))
    or exists (select 1 from public.animals a where a.reference_image_path = p_name and public.can_view_animal(a.id));
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('muzzle-captures', 'muzzle-captures', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "muzzle_insert_own" on storage.objects;
create policy "muzzle_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'muzzle-captures' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "muzzle_select_scoped" on storage.objects;
create policy "muzzle_select_scoped" on storage.objects for select to authenticated
  using (bucket_id = 'muzzle-captures' and public.can_view_capture(name));
drop policy if exists "muzzle_delete_own" on storage.objects;
create policy "muzzle_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'muzzle-captures' and (storage.foldername(name))[1] = auth.uid()::text);

revoke execute on function public.setting_num(text, numeric), public.biometric_candidates(extensions.vector[], integer),
  public.candidate_json(uuid, double precision), public.mask_moozzle_id(text), public.to_embedding(text), public.capture_path_ok(text)
  from public, anon, authenticated;
revoke execute on function public.identify_muzzle(text, text, jsonb, integer), public.verify_muzzle(text, text, text, jsonb, integer),
  public.biometric_validation(text), public.register_animal(jsonb), public.update_setting(text, jsonb, text), public.can_view_capture(text) from public, anon;
grant execute on function public.identify_muzzle(text, text, jsonb, integer), public.verify_muzzle(text, text, text, jsonb, integer),
  public.biometric_validation(text), public.register_animal(jsonb), public.update_setting(text, jsonb, text), public.can_view_capture(text) to authenticated;

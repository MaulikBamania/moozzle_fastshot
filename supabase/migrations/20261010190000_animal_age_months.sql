-- Approximate age gains a months component (0-11) alongside whole years.
-- Existing records keep their years and default to 0 months.
alter table public.animals add column if not exists age_months integer not null default 0;
alter table public.animals drop constraint if exists animals_age_months_range;
alter table public.animals add constraint animals_age_months_range check (age_months between 0 and 11);

create or replace function public.candidate_json(p_animal uuid, p_score double precision) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a record;
  visible boolean := public.can_view_animal(p_animal);
begin
  select * into a from public.animals where id = p_animal;
  if visible then
    return jsonb_build_object('animal_id', a.id, 'in_scope', true, 'moozzle_id', a.moozzle_id, 'species', a.species, 'breed', a.breed,
      'sex', a.sex, 'age_years', a.age_years, 'age_months', a.age_months, 'farm_name', a.farm_name, 'village', a.village,
      'reference_image_path', a.reference_image_path, 'score', round(p_score::numeric, 4));
  end if;
  -- Out-of-scope animals are never described; only the fact that a registration exists.
  return jsonb_build_object('in_scope', false, 'moozzle_id', public.mask_moozzle_id(a.moozzle_id), 'species', a.species, 'score', round(p_score::numeric, 4));
end;
$$;


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
  insert into public.animals (id, user_id, moozzle_id, species, breed, sex, age_years, age_months, farm_name, village, district, state,
    biometric_status, status, captured_images_count, organisation_id, farm_id, owner_user_id, approval_status, duplicate_of, reference_image_path)
  values (v_id, auth.uid(), v_mid, p ->> 'species', trim(p ->> 'breed'), p ->> 'sex', (p ->> 'age_years')::int,
    least(greatest(coalesce(nullif(p ->> 'age_months', '')::int, 0), 0), 11),
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


create or replace function public.review_request(p_id uuid, p_decision text, p_note text default '') returns void language plpgsql security definer set search_path = public as $$
declare
  q record;
  a public.animals%rowtype;
  s record;
  ok boolean := false;
  positive boolean;
begin
  select * into s from public.active_scope();
  select * into q from public.record_requests where id = p_id;
  if not found or s.role is null then raise exception 'Request not found.'; end if;
  if q.status <> 'Submitted' then raise exception 'This request has already been reviewed.'; end if;
  -- Independent approval: nobody approves their own request.
  if q.requested_by = auth.uid() then perform public.deny('cannot review your own request'); end if;
  select * into a from public.animals where id = q.animal_id;
  if not public.can_view_animal(a.id) then perform public.deny('animal outside your scope'); end if;
  positive := p_decision in ('Approved', 'Accepted', 'Completed');
  if q.kind = 'retire' then
    ok := public.can_retire_directly(a);
  elsif q.kind = 'transfer' then
    ok := public.perm('ownership_transfer') in ('Scoped', 'Authorised')
      and ((s.role = 'Super Administrator' and s.privileged) or (s.role = 'Organisation Administrator' and a.organisation_id = s.organisation_id)
        or (s.role in ('Livestock Inspector', 'Government Officer') and a.district = any (s.districts)));
  elsif q.kind = 'correction' then
    ok := (s.role = 'Super Administrator' and s.privileged) or (s.role = 'Organisation Administrator' and a.organisation_id = s.organisation_id);
  elsif q.kind = 'vet_help' then
    ok := s.role = 'Veterinarian';
  elsif q.kind = 'ai_service' then
    ok := s.role = 'AI Technician';
  end if;
  if not coalesce(ok, false) then
    perform public.write_audit('request.review', q.moozzle_id, 'Review of ' || q.kind || ' refused', 'denied');
    perform public.deny('review this request');
  end if;
  if q.kind in ('vet_help', 'ai_service') then
    if p_decision not in ('Accepted', 'Declined', 'Completed') then raise exception 'Use Accepted, Declined or Completed.'; end if;
  elsif p_decision not in ('Approved', 'Rejected') then raise exception 'Use Approved or Rejected.'; end if;

  if positive and q.kind = 'retire' then
    perform public.apply_retirement(a, coalesce(q.payload ->> 'reason', 'Approved retirement request'));
  elsif positive and q.kind = 'transfer' then
    update public.animal_owners set owner_name = trim(q.payload ->> 'new_owner_name'), owner_phone = trim(coalesce(q.payload ->> 'new_owner_phone', '')), updated_at = now() where animal_id = a.id;
    update public.animals set owner_user_id = (select id from public.profiles where lower(email) = lower(trim(coalesce(q.payload ->> 'new_owner_email', ''))) and email <> '' limit 1)
      where id = a.id;
    insert into public.service_records (user_id, animal_id, service_type, title, technician_name, details, performer_role)
    values (auth.uid(), a.id, 'traceability', 'Ownership Transfer', (select full_name from public.profiles where id = auth.uid()),
      jsonb_build_object('notes', 'Ownership transferred to ' || (q.payload ->> 'new_owner_name'), 'request', q.id::text), s.role);
  elsif positive and q.kind = 'correction' then
    update public.animals set
      breed = coalesce(nullif(trim(coalesce(q.payload ->> 'breed', '')), ''), breed),
      age_years = coalesce(nullif(q.payload ->> 'age_years', '')::int, age_years),
      age_months = case
        when nullif(q.payload ->> 'age_months', '') is not null then least(greatest((q.payload ->> 'age_months')::int, 0), 11)
        when nullif(q.payload ->> 'age_years', '') is not null then 0
        else age_months end,
      village = coalesce(nullif(trim(coalesce(q.payload ->> 'village', '')), ''), village),
      approval_status = case when approval_status = 'Retired' then approval_status else 'Corrected' end
    where id = a.id;
  end if;
  update public.record_requests set status = p_decision, reviewed_by = auth.uid(), reviewer_role = s.role,
    review_note = nullif(trim(coalesce(p_note, '')), ''), reviewed_at = now() where id = p_id;
  perform public.write_audit('request.review', q.moozzle_id, q.kind || ' ' || lower(p_decision), 'success', coalesce(p_note, ''));
  perform public.notify_user(q.requested_by, q.requester_role, 'Request ' || lower(p_decision),
    initcap(replace(q.kind, '_', ' ')) || ' · MOOZZLE ID ' || q.moozzle_id, 'approval', '/requests');
end;
$$;

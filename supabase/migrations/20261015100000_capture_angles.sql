-- Angle-guided enrolment: each biometric template records the capture angle it was shot at,
-- so certificates map frames to the Front / Left / Right view quadrants by tag instead of order.
alter table public.biometric_templates add column if not exists capture_angle text;
do $$ begin
  alter table public.biometric_templates add constraint biometric_templates_capture_angle_check
    check (capture_angle is null or capture_angle in ('front', 'left', 'right', 'additional'));
exception when duplicate_object then null; end $$;

create or replace function public.register_animal(p jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
  cfg public.biometric_configs := public.biometric_active_config();
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
  v_species text := p ->> 'species';
  v_sex text := p ->> 'sex';
  v_years integer;
  v_months integer;
  v_group text;
  v_prod text := upper(trim(coalesce(p ->> 'production_status', '')));
  v_preg text := upper(trim(coalesce(p ->> 'pregnancy_status', '')));
  v_dairy text := lower(trim(coalesce(p ->> 'dairy_society', '')));
  v_soc_name text := trim(coalesce(p ->> 'society_name', ''));
  v_soc_code text := trim(coalesce(p ->> 'society_code', ''));
  v_member text := trim(coalesce(p ->> 'member_code', ''));
  v_ack boolean := coalesce((p ->> 'duplicate_review_ack')::boolean, false);
  v_ack_note text := trim(coalesce(p ->> 'duplicate_review_note', ''));
  v_lat double precision;
  v_lng double precision;
  v_acc double precision;
  v_gps_at timestamptz;
  v_device_at timestamptz;
  v_offset integer;
  existing record;
  emb_texts text[];
  embs extensions.vector[] := '{}';
  paths text[];
  scores numeric[];
  metrics jsonb := coalesce(p -> 'quality_metrics', '[]'::jsonb);
  angles jsonb := coalesce(p -> 'capture_angles', '[]'::jsonb);
  v_angle text;
  top record;
  searched integer;
  cand jsonb;
  v_ref text;
  i integer;
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  -- Idempotent on the client-generated id: retries after a lost response return the first result.
  select * into existing from public.animals where id = v_id;
  if found then
    if existing.user_id = auth.uid() then
      return jsonb_build_object('id', existing.id, 'moozzle_id', existing.moozzle_id, 'approval_status', existing.approval_status, 'duplicate', existing.duplicate_of is not null, 'existing', true, 'blocked', false, 'review_required', false);
    end if;
    perform public.deny('record id belongs to another record');
  end if;
  if lvl in ('No', 'De-identified', 'Via API scope', 'Technical only') then
    perform public.write_audit('animal.register', '', 'Registration refused for role', 'denied');
    perform public.deny('register_animal');
  end if;
  if s.role = 'Super Administrator' and not s.privileged then perform public.deny('privileged access required'); end if;

  -- Demographics
  if v_species is null or v_species not in ('cattle', 'buffalo', 'crossbreed', 'bull', 'bullock') then raise exception 'Choose the bovine species (Cattle, Buffalo, Crossbred, Bull or Bullock).'; end if;
  if v_sex is null or v_sex not in ('female', 'male') then raise exception 'Choose the sex of the animal.'; end if;
  if v_species in ('bull', 'bullock') and v_sex <> 'male' then raise exception 'A bull or bullock is always male; set sex to Male.'; end if;
  if length(trim(coalesce(p ->> 'breed', ''))) = 0 then raise exception 'Choose a breed.'; end if;
  begin
    v_years := (p ->> 'age_years')::int;
    v_months := coalesce(nullif(p ->> 'age_months', '')::int, 0);
  exception when others then
    raise exception 'Enter a valid age in years and months.';
  end;
  if v_years is null or v_years < 0 or v_years > 25 or v_months < 0 or v_months > 11 then raise exception 'Enter a valid age (0–25 years, 0–11 months).'; end if;
  v_group := public.age_group_for(v_species, v_years, v_months);

  if v_dairy not in ('yes', 'no') then raise exception 'Answer “Are you giving milk in a dairy society?”.'; end if;
  if v_dairy = 'yes' then
    if v_soc_name = '' or v_soc_code = '' or v_member = '' then raise exception 'Society name, society code and member code are required for dairy society members.'; end if;
    if length(v_soc_name) > 120 or length(v_soc_code) > 40 or length(v_member) > 40 then raise exception 'Dairy society details are too long.'; end if;
  else
    v_soc_name := null; v_soc_code := null; v_member := null;
  end if;

  if v_prod not in ('DRY', 'MILK', 'NA') then raise exception 'Choose Status I (DRY, MILK or NA).'; end if;
  if v_prod <> 'NA' and not public.production_allowed(v_species, v_sex, v_group) then
    raise exception 'Status I must be NA for this animal: only adult female cattle, buffalo or crossbreeds can be MILK or DRY.';
  end if;
  if v_preg not in ('PREGNANT', 'NON-PREGNANT', 'NA') then raise exception 'Choose Status II (PREGNANT, NON-PREGNANT or NA).'; end if;
  if v_preg <> 'NA' and not public.pregnancy_allowed(v_species, v_sex, v_group) then
    raise exception 'Status II must be NA for males, bulls, bullocks and calves.';
  end if;

  -- Registration time and compulsory device GPS
  begin
    v_lat := (p ->> 'gps_latitude')::double precision;
    v_lng := (p ->> 'gps_longitude')::double precision;
    v_acc := nullif(p ->> 'gps_accuracy_m', '')::double precision;
    v_gps_at := (p ->> 'gps_captured_at')::timestamptz;
    v_device_at := (p ->> 'device_registered_at')::timestamptz;
    v_offset := nullif(p ->> 'device_utc_offset_minutes', '')::int;
  exception when others then
    raise exception 'GPS location and registration time are invalid. Capture GPS again.';
  end;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 or (v_lat = 0 and v_lng = 0) then
    raise exception 'Valid GPS latitude and longitude are required to register an animal.';
  end if;
  if coalesce((p ->> 'gps_mocked')::boolean, false) then raise exception 'A mock (simulated) GPS location was detected. Disable mock locations and capture GPS again.'; end if;
  if v_acc is not null and (v_acc < 0 or v_acc > 100000) then raise exception 'GPS accuracy is invalid. Capture GPS again.'; end if;
  if v_gps_at is null or v_gps_at > now() + interval '10 minutes' then raise exception 'The GPS capture time is missing or in the future. Check the phone clock and capture GPS again.'; end if;
  if v_device_at is null or v_device_at > now() + interval '10 minutes' then raise exception 'The registration time is missing or in the future. Check the phone clock.'; end if;
  if v_offset is not null and (v_offset < -840 or v_offset > 840) then v_offset := null; end if;

  select coalesce(array_agg(x), '{}') into emb_texts from jsonb_array_elements_text(coalesce(p -> 'embeddings', '[]'::jsonb)) x;
  select coalesce(array_agg(x), '{}') into paths from jsonb_array_elements_text(coalesce(p -> 'image_paths', '[]'::jsonb)) x;
  select coalesce(array_agg(x::numeric), '{}') into scores from jsonb_array_elements_text(coalesce(p -> 'quality_scores', '[]'::jsonb)) x;
  if coalesce(array_length(emb_texts, 1), 0) < 3 or array_length(emb_texts, 1) > 5 then
    raise exception 'Enrolment needs 3 to 5 accepted muzzle images with biometric embeddings.';
  end if;
  if coalesce(p ->> 'model', cfg.model_version) <> cfg.model_version then
    raise exception 'This app computes % templates but production requires %. Update the app before enrolling.', p ->> 'model', cfg.model_version;
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
  if top.animal_id is not null and top.score >= cfg.identify_accept then
    cand := public.candidate_json(top.animal_id, top.score);
    insert into public.biometric_scans (user_id, user_role, scan_type, captured_image_path, quality_status, outcome, matched_moozzle_id, similarity_score,
      templates_searched, frames, candidate_moozzle_ids, candidate_scores, config_version, model_version, model_name, decision_reason)
    values (auth.uid(), s.role, 'enrol_check', nullif(paths[1], ''), 'GOOD IMAGE', 'match',
      case when (cand ->> 'in_scope')::boolean then cand ->> 'moozzle_id' end, round(top.score::numeric, 4), searched, array_length(embs, 1),
      array[(select moozzle_id from public.animals where id = top.animal_id)], array[round(top.score::numeric, 4)],
      cfg.config_version, cfg.model_version, cfg.model_version, 'duplicate_blocked');
    perform public.write_audit('animal.register', case when (cand ->> 'in_scope')::boolean then cand ->> 'moozzle_id' else '' end,
      'Duplicate enrolment blocked · cfg v' || cfg.config_version || ' · similarity ' || to_char(top.score, 'FM0.000'), 'denied', 'ANIMAL ALREADY REGISTERED', coalesce(p ->> 'source', 'moozzle-app'));
    return jsonb_build_object('blocked', true, 'duplicate', true, 'existing', false, 'review_required', false, 'match', cand, 'score', round(top.score::numeric, 4),
      'templates_searched', searched, 'match_threshold', cfg.identify_accept, 'review_threshold', cfg.identify_review, 'config_version', cfg.config_version);
  end if;

  -- Possible duplicate: never issue an ID silently. The operator must submit it for duplicate review with a reason.
  if top.animal_id is not null and top.score >= cfg.identify_review then
    v_dup := top.animal_id;
    if not v_ack or length(v_ack_note) < 10 then
      cand := public.candidate_json(top.animal_id, top.score);
      insert into public.biometric_scans (user_id, user_role, scan_type, captured_image_path, quality_status, outcome, similarity_score,
        templates_searched, frames, candidate_moozzle_ids, candidate_scores, config_version, model_version, model_name, decision_reason)
      values (auth.uid(), s.role, 'enrol_check', nullif(paths[1], ''), 'GOOD IMAGE', 'uncertain', round(top.score::numeric, 4), searched, array_length(embs, 1),
        array[(select moozzle_id from public.animals where id = top.animal_id)], array[round(top.score::numeric, 4)],
        cfg.config_version, cfg.model_version, cfg.model_version, 'possible_duplicate_held');
      perform public.write_audit('animal.register', '', 'Possible duplicate held before ID issue · cfg v' || cfg.config_version || ' · similarity ' || to_char(top.score, 'FM0.000'),
        'requested', 'POSSIBLE DUPLICATE — REVIEW REQUIRED', coalesce(p ->> 'source', 'moozzle-app'));
      return jsonb_build_object('blocked', false, 'review_required', true, 'duplicate', true, 'existing', false, 'match', cand,
        'score', round(top.score::numeric, 4), 'templates_searched', searched, 'match_threshold', cfg.identify_accept,
        'review_threshold', cfg.identify_review, 'config_version', cfg.config_version);
    end if;
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

  if coalesce((p ->> 'save_as_draft')::boolean, false) and v_dup is null then
    v_status := 'Draft';
  elsif lvl in ('Full', 'Scoped') and v_dup is null then
    v_status := 'Approved';
  else
    v_status := 'Submitted';
  end if;
  -- A possible duplicate always goes to an authorised reviewer; it is never Approved or a private Draft.
  if v_dup is not null then v_status := 'Pending Review'; end if;

  v_ref := nullif(paths[1], '');
  v_mid := public.next_moozzle_id(p ->> 'moozzle_id');
  insert into public.animals (id, user_id, moozzle_id, species, breed, sex, age_years, age_months, farm_name, village, district, state,
    biometric_status, status, captured_images_count, organisation_id, farm_id, owner_user_id, approval_status, duplicate_of, reference_image_path,
    age_group, production_status, pregnancy_status, device_registered_at, device_utc_offset_minutes, review_note)
  values (v_id, auth.uid(), v_mid, v_species, trim(p ->> 'breed'), v_sex, v_years, v_months,
    coalesce(f_name, trim(coalesce(p ->> 'farm_name', ''))), coalesce(nullif(trim(coalesce(p ->> 'village', '')), ''), f_village, ''),
    v_district, coalesce(nullif(trim(coalesce(p ->> 'state', '')), ''), f_state, ''),
    case when coalesce((p ->> 'quality_score')::numeric, 0) >= 0.7 then 'enrolled' else 'pending_quality' end,
    'active', array_length(embs, 1), v_org, v_farm, v_owner, v_status, v_dup, v_ref,
    v_group, v_prod, v_preg, v_device_at, v_offset,
    case when v_dup is not null then left('Possible duplicate submitted for review: ' || v_ack_note, 300) end);
  insert into public.animal_owners (animal_id, owner_name, owner_phone, dairy_society_member, society_name, society_code, member_code,
    gps_latitude, gps_longitude, gps_accuracy_m, gps_captured_at)
  values (v_id, v_owner_name, trim(coalesce(p ->> 'owner_phone', '')), v_dairy = 'yes', v_soc_name, v_soc_code, v_member,
    v_lat, v_lng, v_acc, v_gps_at);
  for i in 1..array_length(embs, 1) loop
    -- Angle tag recorded at capture (front / left / right / additional); unknown values are stored as null.
    v_angle := angles ->> (i - 1);
    if v_angle is not null and v_angle not in ('front', 'left', 'right', 'additional') then v_angle := null; end if;
    insert into public.biometric_templates (user_id, animal_id, moozzle_id, quality_score, embedding_preview, model_version, embedding,
      model_name, embedding_dim, image_path, frame_index, quality_metrics, capture_angle)
    values (auth.uid(), v_id, v_mid, least(greatest(coalesce(scores[i], (p ->> 'quality_score')::numeric, 0), 0), 1),
      left(emb_texts[i], 60), cfg.model_version, embs[i], cfg.model_version, 256, nullif(paths[i], ''), i, coalesce(metrics -> (i - 1), '{}'::jsonb), v_angle);
  end loop;
  insert into public.biometric_scans (user_id, user_role, scan_type, captured_image_path, quality_status, outcome, similarity_score, templates_searched,
    frames, candidate_moozzle_ids, candidate_scores, config_version, model_version, model_name, decision_reason)
  values (auth.uid(), s.role, 'enrol_check', v_ref, 'GOOD IMAGE', case when v_dup is not null then 'uncertain' else 'no_match' end,
    round(coalesce(top.score, 0)::numeric, 4), searched, array_length(embs, 1),
    case when v_dup is not null then array[(select moozzle_id from public.animals where id = v_dup)] else '{}' end,
    case when v_dup is not null then array[round(top.score::numeric, 4)] else '{}' end,
    cfg.config_version, cfg.model_version, cfg.model_version, case when v_dup is not null then 'duplicate_review_submitted' else 'enrolled' end);

  perform public.write_audit('animal.register', v_mid, 'Registered ' || (p ->> 'breed') || ' ' || v_species || ' (' || v_group || ', Status I ' || v_prod
    || ', Status II ' || v_preg || ') as ' || v_status || ' · ' || array_length(embs, 1)
    || ' templates · cfg v' || cfg.config_version || ' · 1:N best ' || to_char(coalesce(top.score, 0), 'FM0.000') || ' · GPS ±' || coalesce(round(v_acc::numeric)::text, '?') || ' m'
    || case when v_dup is not null then ' (possible duplicate submitted for manual review)' else '' end,
    'success', case when v_dup is not null then left(v_ack_note, 300) else '' end, coalesce(p ->> 'source', 'moozzle-app'));
  if v_status in ('Submitted', 'Pending Review') then
    perform public.notify_scope(array['Organisation Administrator'], v_org, null, null,
      case when v_dup is not null then 'Possible duplicate awaiting review' else 'New registration awaiting approval' end,
      (p ->> 'breed') || ' · MOOZZLE ID ' || v_mid || case when v_dup is not null then ' · possible duplicate' else '' end, 'approval', '/approvals');
  end if;
  return jsonb_build_object('id', v_id, 'moozzle_id', v_mid, 'approval_status', v_status, 'duplicate', v_dup is not null, 'existing', false,
    'blocked', false, 'review_required', false, 'score', round(coalesce(top.score, 0)::numeric, 4), 'templates_searched', searched,
    'config_version', cfg.config_version,
    'review_candidate', case when v_dup is not null then public.candidate_json(v_dup, top.score) end);
end;
$$;

revoke all on function public.register_animal(jsonb) from public, anon;
grant execute on function public.register_animal(jsonb) to authenticated;

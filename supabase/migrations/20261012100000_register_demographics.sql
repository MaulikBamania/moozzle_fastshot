-- REGISTER ANIMAL demographics: four bovine species, dairy-society membership, derived age group,
-- production (Status I) and pregnancy (Status II) status, mandatory registration time + GPS.
-- Additive only: existing animals, MOOZZLE IDs and biometric templates are untouched; new columns are
-- nullable for legacy rows ("not recorded") and required by register_animal for every new registration.

-- ---------- Species ----------
alter table public.animals drop constraint if exists animals_species_check;
alter table public.animals add constraint animals_species_check check (species in ('cattle', 'buffalo', 'bullock', 'crossbreed'));

-- ---------- Demographic columns (animal) ----------
alter table public.animals add column if not exists age_group text;
alter table public.animals add column if not exists production_status text;
alter table public.animals add column if not exists pregnancy_status text;
alter table public.animals add column if not exists device_registered_at timestamptz;
alter table public.animals add column if not exists device_utc_offset_minutes integer;
alter table public.animals drop constraint if exists animals_age_group_check;
alter table public.animals add constraint animals_age_group_check check (age_group is null or age_group in ('CALF', 'YOUNG', 'ADULT'));
alter table public.animals drop constraint if exists animals_production_status_check;
alter table public.animals add constraint animals_production_status_check check (production_status is null or production_status in ('DRY', 'MILK', 'NA'));
alter table public.animals drop constraint if exists animals_pregnancy_status_check;
alter table public.animals add constraint animals_pregnancy_status_check check (pregnancy_status is null or pregnancy_status in ('PREGNANT', 'NON-PREGNANT', 'NA'));
alter table public.animals drop constraint if exists animals_device_offset_range;
alter table public.animals add constraint animals_device_offset_range check (device_utc_offset_minutes is null or device_utc_offset_minutes between -840 and 840);

-- ---------- Owner-level data (dairy society + precise GPS) ----------
-- Kept on animal_owners so the existing can_view_owner() policy protects society, member and location data.
alter table public.animal_owners add column if not exists dairy_society_member boolean;
alter table public.animal_owners add column if not exists society_name text;
alter table public.animal_owners add column if not exists society_code text;
alter table public.animal_owners add column if not exists member_code text;
alter table public.animal_owners add column if not exists gps_latitude double precision;
alter table public.animal_owners add column if not exists gps_longitude double precision;
alter table public.animal_owners add column if not exists gps_accuracy_m double precision;
alter table public.animal_owners add column if not exists gps_captured_at timestamptz;
alter table public.animal_owners drop constraint if exists animal_owners_gps_range;
alter table public.animal_owners add constraint animal_owners_gps_range check (
  (gps_latitude is null and gps_longitude is null)
  or (gps_latitude between -90 and 90 and gps_longitude between -180 and 180 and not (gps_latitude = 0 and gps_longitude = 0)));
alter table public.animal_owners drop constraint if exists animal_owners_society_complete;
alter table public.animal_owners add constraint animal_owners_society_complete check (
  dairy_society_member is distinct from true
  or (length(trim(coalesce(society_name, ''))) > 0 and length(trim(coalesce(society_code, ''))) > 0 and length(trim(coalesce(member_code, ''))) > 0));

-- ---------- Configurable age-group thresholds (per species, months) ----------
-- CALF: [0, young_from) · YOUNG: [young_from, adult_from) · ADULT: [adult_from, ∞).
-- Contiguous by construction, so ranges never overlap and cover every valid age.
insert into public.platform_settings (key, value, description, risk) values
  ('age_group_young_from_months_cattle', '12'::jsonb, 'Cattle: age in months at which CALF becomes YOUNG.', 'normal'),
  ('age_group_adult_from_months_cattle', '36'::jsonb, 'Cattle: age in months at which YOUNG becomes ADULT.', 'normal'),
  ('age_group_young_from_months_buffalo', '12'::jsonb, 'Buffalo: age in months at which CALF becomes YOUNG.', 'normal'),
  ('age_group_adult_from_months_buffalo', '36'::jsonb, 'Buffalo: age in months at which YOUNG becomes ADULT.', 'normal'),
  ('age_group_young_from_months_bullock', '12'::jsonb, 'Bullock: age in months at which CALF becomes YOUNG.', 'normal'),
  ('age_group_adult_from_months_bullock', '36'::jsonb, 'Bullock: age in months at which YOUNG becomes ADULT.', 'normal'),
  ('age_group_young_from_months_crossbreed', '12'::jsonb, 'Crossbreed: age in months at which CALF becomes YOUNG.', 'normal'),
  ('age_group_adult_from_months_crossbreed', '36'::jsonb, 'Crossbreed: age in months at which YOUNG becomes ADULT.', 'normal')
on conflict (key) do nothing;

create or replace function public.age_group_for(p_species text, p_years integer, p_months integer) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  total integer := greatest(coalesce(p_years, 0), 0) * 12 + least(greatest(coalesce(p_months, 0), 0), 11);
  young_from numeric := public.setting_num('age_group_young_from_months_' || coalesce(p_species, ''), null);
  adult_from numeric := public.setting_num('age_group_adult_from_months_' || coalesce(p_species, ''), null);
begin
  if young_from is null or adult_from is null or young_from < 1 or adult_from <= young_from then
    raise exception 'Age group thresholds for % are not configured. Contact your administrator.', coalesce(p_species, 'this species');
  end if;
  if total < young_from then return 'CALF'; end if;
  if total < adult_from then return 'YOUNG'; end if;
  return 'ADULT';
end;
$$;

-- Biological eligibility, shared by registration and the derivation trigger.
create or replace function public.production_allowed(p_species text, p_sex text, p_group text) returns boolean
language sql immutable set search_path = public as $$
  select p_species in ('cattle', 'buffalo', 'crossbreed') and p_sex = 'female' and p_group = 'ADULT';
$$;
create or replace function public.pregnancy_allowed(p_species text, p_sex text, p_group text) returns boolean
language sql immutable set search_path = public as $$
  select p_species in ('cattle', 'buffalo', 'crossbreed') and p_sex = 'female' and p_group in ('YOUNG', 'ADULT');
$$;

-- Age group is always server-derived; an age/species/sex change (e.g. an approved correction) re-derives it and
-- resets a status that is no longer biologically applicable to NA.
create or replace function public.animals_derive_demographics() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.age_group := public.age_group_for(new.species, new.age_years, new.age_months);
  if new.production_status is not null and new.production_status <> 'NA' and not public.production_allowed(new.species, new.sex, new.age_group) then
    new.production_status := 'NA';
  end if;
  if new.pregnancy_status is not null and new.pregnancy_status <> 'NA' and not public.pregnancy_allowed(new.species, new.sex, new.age_group) then
    new.pregnancy_status := 'NA';
  end if;
  return new;
end;
$$;
drop trigger if exists animals_derive_demographics on public.animals;
create trigger animals_derive_demographics before insert or update of species, sex, age_years, age_months, production_status, pregnancy_status
  on public.animals for each row execute function public.animals_derive_demographics();

-- Backfill the derived group for existing records (statuses stay null = "not recorded").
update public.animals set age_group = public.age_group_for(species, age_years, age_months) where age_group is null;

-- ---------- Audit trail for material demographic changes ----------
create or replace function public.audit_animal_demographics() returns trigger language plpgsql security definer set search_path = public as $$
declare
  changes text[] := '{}';
begin
  if new.species is distinct from old.species then changes := changes || ('species ' || old.species || '→' || new.species); end if;
  if new.breed is distinct from old.breed then changes := changes || ('breed ' || old.breed || '→' || new.breed); end if;
  if new.sex is distinct from old.sex then changes := changes || ('sex ' || old.sex || '→' || new.sex); end if;
  if new.age_years is distinct from old.age_years or new.age_months is distinct from old.age_months then
    changes := changes || ('age ' || old.age_years || 'y' || old.age_months || 'm→' || new.age_years || 'y' || new.age_months || 'm');
  end if;
  if new.age_group is distinct from old.age_group then changes := changes || ('age group ' || coalesce(old.age_group, '—') || '→' || coalesce(new.age_group, '—')); end if;
  if new.production_status is distinct from old.production_status then
    changes := changes || ('Status I ' || coalesce(old.production_status, '—') || '→' || coalesce(new.production_status, '—'));
  end if;
  if new.pregnancy_status is distinct from old.pregnancy_status then
    changes := changes || ('Status II ' || coalesce(old.pregnancy_status, '—') || '→' || coalesce(new.pregnancy_status, '—'));
  end if;
  if coalesce(array_length(changes, 1), 0) > 0 then
    perform public.write_audit('animal.demographics_change', new.moozzle_id, array_to_string(changes, ' · '), 'success', '', 'db-trigger');
  end if;
  return new;
end;
$$;
drop trigger if exists animals_audit_demographics on public.animals;
create trigger animals_audit_demographics after update on public.animals for each row execute function public.audit_animal_demographics();

create or replace function public.audit_owner_demographics() returns trigger language plpgsql security definer set search_path = public as $$
declare
  mid text;
begin
  if new.dairy_society_member is distinct from old.dairy_society_member or new.society_name is distinct from old.society_name
    or new.society_code is distinct from old.society_code or new.member_code is distinct from old.member_code
    or new.gps_latitude is distinct from old.gps_latitude or new.gps_longitude is distinct from old.gps_longitude then
    select moozzle_id into mid from public.animals where id = new.animal_id;
    -- Values are not copied into the audit text: society, member and location data stay owner-scoped.
    perform public.write_audit('animal.demographics_change', coalesce(mid, ''), 'Dairy society / GPS details changed', 'success', '', 'db-trigger');
  end if;
  return new;
end;
$$;
drop trigger if exists animal_owners_audit_demographics on public.animal_owners;
create trigger animal_owners_audit_demographics after update on public.animal_owners for each row execute function public.audit_owner_demographics();

-- ---------- Settings: validate age-group thresholds ----------
create or replace function public.update_setting(p_key text, p_value jsonb, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare
  s record;
  st record;
  v_species text;
  v_num numeric;
  v_young numeric;
  v_adult numeric;
begin
  select * into s from public.active_scope();
  select * into st from public.platform_settings where key = p_key;
  if not found then raise exception 'Unknown setting.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Give a reason of at least 10 characters.'; end if;
  if p_key in ('biometric_threshold', 'model_version') then
    if public.perm('change_threshold') <> 'Authorised' or not coalesce(s.privileged, false) then
      perform public.write_audit('admin.setting_change', '', 'Threshold/model change refused', 'denied');
      perform public.deny('change biometric threshold');
    end if;
    if p_key = 'biometric_threshold' and ((p_value #>> '{}')::numeric < 0.5 or (p_value #>> '{}')::numeric > 0.99) then
      raise exception 'Threshold must be between 0.50 and 0.99 (validated range).';
    end if;
  elsif p_key = 'api_default_rate_limit' and s.role = 'API Administrator' then
    null;
  elsif public.perm('platform_settings') <> 'Full' or not coalesce(s.privileged, false) then
    perform public.deny('platform settings');
  end if;
  if p_key like 'age_group_%_from_months_%' then
    if jsonb_typeof(p_value) <> 'number' then raise exception 'Enter a whole number of months.'; end if;
    v_num := (p_value #>> '{}')::numeric;
    if v_num <> trunc(v_num) or v_num < 1 or v_num > 300 then raise exception 'Age thresholds must be whole months between 1 and 300.'; end if;
    v_species := substring(p_key from 'age_group_(?:young|adult)_from_months_(.*)$');
    v_young := case when p_key like 'age_group_young_%' then v_num else public.setting_num('age_group_young_from_months_' || v_species, null) end;
    v_adult := case when p_key like 'age_group_adult_%' then v_num else public.setting_num('age_group_adult_from_months_' || v_species, null) end;
    if v_young is null or v_adult is null or v_young >= v_adult then
      raise exception 'The YOUNG threshold must be lower than the ADULT threshold so the age groups do not overlap.';
    end if;
  end if;
  update public.platform_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform public.write_audit('admin.setting_change', '', p_key || ': ' || (st.value #>> '{}') || ' → ' || (p_value #>> '{}'), 'success', trim(p_reason));
end;
$$;

-- ---------- Registration with server-side validation of every mandatory field ----------
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
  -- Idempotent on the client-generated id: retries after a lost response return the first result.
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

  -- Demographics
  if v_species is null or v_species not in ('cattle', 'buffalo', 'bullock', 'crossbreed') then raise exception 'Choose the bovine species (CATTLE, BUFFALO, BULLOCK or CROSSBREED).'; end if;
  if v_sex is null or v_sex not in ('female', 'male') then raise exception 'Choose the sex of the animal.'; end if;
  if v_species = 'bullock' and v_sex <> 'male' then raise exception 'A bullock is a male draught animal; set sex to Male.'; end if;
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
    raise exception 'Status II must be NA for males, bullocks and calves.';
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
    biometric_status, status, captured_images_count, organisation_id, farm_id, owner_user_id, approval_status, duplicate_of, reference_image_path,
    age_group, production_status, pregnancy_status, device_registered_at, device_utc_offset_minutes)
  values (v_id, auth.uid(), v_mid, v_species, trim(p ->> 'breed'), v_sex, v_years, v_months,
    coalesce(f_name, trim(coalesce(p ->> 'farm_name', ''))), coalesce(nullif(trim(coalesce(p ->> 'village', '')), ''), f_village, ''),
    v_district, coalesce(nullif(trim(coalesce(p ->> 'state', '')), ''), f_state, ''),
    case when coalesce((p ->> 'quality_score')::numeric, 0) >= 0.7 then 'enrolled' else 'pending_quality' end,
    'active', array_length(embs, 1), v_org, v_farm, v_owner, v_status, v_dup, v_ref,
    v_group, v_prod, v_preg, v_device_at, v_offset);
  insert into public.animal_owners (animal_id, owner_name, owner_phone, dairy_society_member, society_name, society_code, member_code,
    gps_latitude, gps_longitude, gps_accuracy_m, gps_captured_at)
  values (v_id, v_owner_name, trim(coalesce(p ->> 'owner_phone', '')), v_dairy = 'yes', v_soc_name, v_soc_code, v_member,
    v_lat, v_lng, v_acc, v_gps_at);
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

  perform public.write_audit('animal.register', v_mid, 'Registered ' || (p ->> 'breed') || ' ' || v_species || ' (' || v_group || ', Status I ' || v_prod
    || ', Status II ' || v_preg || ') as ' || v_status || ' · ' || array_length(embs, 1)
    || ' templates · 1:N best ' || to_char(coalesce(top.score, 0), 'FM0.000') || ' · GPS ±' || coalesce(round(v_acc::numeric)::text, '?') || ' m'
    || case when v_dup is not null then ' (possible duplicate, manual review)' else '' end,
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

revoke execute on function public.age_group_for(text, integer, integer), public.animals_derive_demographics(),
  public.audit_animal_demographics(), public.audit_owner_demographics() from public, anon, authenticated;

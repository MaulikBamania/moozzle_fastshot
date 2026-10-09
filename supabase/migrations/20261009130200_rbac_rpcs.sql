-- Checked server operations. Every write validates: authenticated user, active assigned role,
-- required permission level, organisation / farm / jurisdiction scope, record ownership and status.

create or replace function public.deny(what text) returns void language plpgsql set search_path = public as $$
begin
  raise exception 'permission_denied: %', what using errcode = '42501';
end;
$$;

create or replace function public.write_audit(p_action text, p_target text, p_details text, p_outcome text, p_reason text default '', p_source text default 'moozzle-app')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  s record;
  new_id uuid;
begin
  select * into s from public.active_scope();
  insert into public.audit_logs (user_id, user_role, organisation_id, action, target_moozzle_id, details, outcome, reason, source)
  values (auth.uid(), coalesce(s.role, ''), s.organisation_id, p_action, coalesce(p_target, ''), left(coalesce(p_details, ''), 500),
    p_outcome, left(coalesce(p_reason, ''), 300), left(coalesce(p_source, 'moozzle-app'), 60))
  returning id into new_id;
  return new_id;
end;
$$;

-- Client-reported events (login, scans, views, exports, denials). Identity fields are always server-derived.
create or replace function public.log_audit(p_action text, p_target text default '', p_details text default '', p_outcome text default 'success', p_reason text default '', p_source text default 'moozzle-app')
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then perform public.deny('audit'); end if;
  if p_action not in ('auth.login', 'auth.logout', 'biometric.identify', 'biometric.verify', 'biometric.capture', 'record.view',
    'record.view_sensitive', 'access.denied', 'export.records', 'export.report', 'sync.run', 'sync.conflict', 'sync.failed') then
    raise exception 'Unsupported audit action %', p_action;
  end if;
  if p_outcome not in ('success', 'denied', 'failed', 'no_match', 'requested') then raise exception 'Unsupported outcome'; end if;
  return public.write_audit(p_action, p_target, p_details, p_outcome, p_reason, p_source);
end;
$$;

-- Failed sign-in attempts (caller is anonymous). Only a masked identifier is stored.
create or replace function public.log_auth_failure(p_identifier text) returns void language plpgsql security definer set search_path = public as $$
declare
  masked text := regexp_replace(coalesce(p_identifier, ''), '^(.).*(@.*)$', '\1***\2');
begin
  insert into public.audit_logs (user_id, user_role, action, details, outcome, source)
  values (null, 'anonymous', 'auth.login_failed', left('Failed sign-in for ' || masked, 120), 'failed', 'moozzle-app');
end;
$$;

create or replace function public.notify_scope(p_roles text[], p_org uuid, p_farm uuid, p_district text, p_title text, p_message text, p_type text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, user_role, title, message, type, link)
  select distinct ur.user_id, ur.role, p_title, p_message, p_type, p_link
  from public.user_roles ur
  where ur.role = any (p_roles)
    and ur.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    and (ur.role = 'Super Administrator'
      or (p_org is not null and ur.organisation_id = p_org)
      or (p_farm is not null and p_farm = any (ur.farm_ids))
      or (p_district is not null and p_district = any (ur.districts)));
end;
$$;

create or replace function public.notify_user(p_user uuid, p_role text, p_title text, p_message text, p_type text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications (user_id, user_role, title, message, type, link) values (p_user, p_role, p_title, p_message, p_type, p_link);
end;
$$;

-- ---------- Role switching ----------
create or replace function public.set_active_role(p_role text) returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then perform public.deny('session'); end if;
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = p_role) then
    perform public.write_audit('auth.role_switch', '', 'Attempted unassigned role ' || coalesce(p_role, ''), 'denied');
    perform public.deny('role not assigned');
  end if;
  perform set_config('moozzle.rpc', 'on', true);
  -- Privileged access never carries over into another role.
  update public.profiles set active_role = p_role, privileged_until = null, privileged_reason = null where id = auth.uid();
  perform public.write_audit('auth.role_switch', '', 'Active role set to ' || p_role, 'success');
  return p_role;
end;
$$;

create or replace function public.start_privileged_access(p_reason text) returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  until_at timestamptz := now() + interval '30 minutes';
begin
  if public.app_role() <> 'Super Administrator' then perform public.deny('privileged access'); end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Give a justification of at least 10 characters.'; end if;
  perform set_config('moozzle.rpc', 'on', true);
  update public.profiles set privileged_until = until_at, privileged_reason = trim(p_reason) where id = auth.uid();
  perform public.write_audit('security.privileged_access_start', '', 'Identifiable/biometric data access for 30 minutes', 'success', trim(p_reason));
  return until_at;
end;
$$;

create or replace function public.end_privileged_access() returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then perform public.deny('session'); end if;
  perform set_config('moozzle.rpc', 'on', true);
  update public.profiles set privileged_until = null, privileged_reason = null where id = auth.uid();
  perform public.write_audit('security.privileged_access_end', '', 'Privileged access ended', 'success');
end;
$$;

-- ---------- MOOZZLE ID ----------
create or replace function public.next_moozzle_id(proposed text) returns text language plpgsql security definer set search_path = public as $$
declare
  candidate text := proposed;
begin
  for i in 1..20 loop
    if candidate ~ '^[1-9][0-9]{11}$' and not exists (select 1 from public.animals where moozzle_id = candidate) then
      return candidate;
    end if;
    candidate := (100000000000 + floor(random() * 899999999999))::bigint::text;
  end loop;
  raise exception 'A unique MOOZZLE ID could not be assigned.';
end;
$$;

-- ---------- Registration ----------
create or replace function public.register_animal(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
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
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  select * into existing from public.animals where id = v_id;
  if found then
    if existing.user_id = auth.uid() then
      return jsonb_build_object('id', existing.id, 'moozzle_id', existing.moozzle_id, 'approval_status', existing.approval_status, 'duplicate', existing.duplicate_of is not null, 'existing', true);
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
  if coalesce((p ->> 'captured_images_count')::int, 0) < 3 then raise exception 'Capture at least 3 muzzle images.'; end if;

  if v_farm is not null then
    select organisation_id, name, village, state, district into f_org, f_name, f_village, f_state, f_district from public.farms where id = v_farm;
    if not found then raise exception 'Unknown farm.'; end if;
    v_district := coalesce(nullif(v_district, ''), f_district);
  end if;

  -- Scope check by role
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

  -- Suspected duplicate: same farm/owner profile registered recently → manual review, never auto-merge.
  select a.id into v_dup from public.animals a left join public.animal_owners o on o.animal_id = a.id
  where a.status = 'active' and a.breed = p ->> 'breed' and a.sex = p ->> 'sex' and a.age_years = (p ->> 'age_years')::int
    and a.farm_id is not distinct from v_farm and lower(coalesce(o.owner_name, '')) = lower(v_owner_name) and v_owner_name <> ''
    and a.created_at > now() - interval '30 days'
  limit 1;
  if v_dup is not null and v_status <> 'Draft' then v_status := 'Pending Review'; end if;

  v_mid := public.next_moozzle_id(p ->> 'moozzle_id');
  insert into public.animals (id, user_id, moozzle_id, species, breed, sex, age_years, farm_name, village, district, state,
    biometric_status, status, captured_images_count, organisation_id, farm_id, owner_user_id, approval_status, duplicate_of)
  values (v_id, auth.uid(), v_mid, p ->> 'species', trim(p ->> 'breed'), p ->> 'sex', (p ->> 'age_years')::int,
    coalesce(f_name, trim(coalesce(p ->> 'farm_name', ''))), coalesce(nullif(trim(coalesce(p ->> 'village', '')), ''), f_village, ''),
    v_district, coalesce(nullif(trim(coalesce(p ->> 'state', '')), ''), f_state, ''),
    case when coalesce((p ->> 'quality_score')::numeric, 0) >= 0.7 then 'enrolled' else 'pending_quality' end,
    'active', (p ->> 'captured_images_count')::int, v_org, v_farm, v_owner, v_status, v_dup);
  insert into public.animal_owners (animal_id, owner_name, owner_phone) values (v_id, v_owner_name, trim(coalesce(p ->> 'owner_phone', '')));
  insert into public.biometric_templates (user_id, animal_id, moozzle_id, quality_score, embedding_preview, model_version)
  values (auth.uid(), v_id, v_mid, least(greatest(coalesce((p ->> 'quality_score')::numeric, 0), 0), 1), '',
    coalesce((select value #>> '{}' from public.platform_settings where key = 'model_version'), 'moozzle-proto-v1.0'));

  perform public.write_audit('animal.register', v_mid, 'Registered ' || (p ->> 'breed') || ' as ' || v_status || case when v_dup is not null then ' (suspected duplicate)' else '' end,
    'success', '', coalesce(p ->> 'source', 'moozzle-app'));
  if v_status in ('Submitted', 'Pending Review') then
    perform public.notify_scope(array['Organisation Administrator'], v_org, null, null, 'New registration awaiting approval',
      (p ->> 'breed') || ' · MOOZZLE ID ' || v_mid || case when v_dup is not null then ' · possible duplicate' else '' end, 'approval', '/approvals');
  end if;
  return jsonb_build_object('id', v_id, 'moozzle_id', v_mid, 'approval_status', v_status, 'duplicate', v_dup is not null, 'existing', false);
end;
$$;

create or replace function public.submit_animal(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  a record;
begin
  select * into a from public.animals where id = p_id;
  if not found or a.user_id <> auth.uid() then perform public.deny('not your draft'); end if;
  if a.approval_status <> 'Draft' then raise exception 'Only drafts can be submitted.'; end if;
  update public.animals set approval_status = 'Submitted' where id = p_id;
  perform public.write_audit('animal.submit', a.moozzle_id, 'Draft submitted for approval', 'success');
  perform public.notify_scope(array['Organisation Administrator'], a.organisation_id, null, null, 'New registration awaiting approval',
    a.breed || ' · MOOZZLE ID ' || a.moozzle_id, 'approval', '/approvals');
end;
$$;

create or replace function public.can_review_animal(a public.animals) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  s record;
begin
  select * into s from public.active_scope();
  if s.role is null or a.user_id = auth.uid() then return false; end if;
  return case s.role
    when 'Super Administrator' then s.privileged
    when 'Organisation Administrator' then a.organisation_id = s.organisation_id
    when 'Government Officer' then a.district = any (s.districts)
    else false end;
end;
$$;

create or replace function public.review_animal(p_id uuid, p_decision text, p_note text default '') returns void language plpgsql security definer set search_path = public as $$
declare
  a public.animals%rowtype;
begin
  select * into a from public.animals where id = p_id;
  if not found then raise exception 'Record not found.'; end if;
  if p_decision not in ('Approved', 'Rejected') then raise exception 'Decision must be Approved or Rejected.'; end if;
  if not public.can_review_animal(a) then
    perform public.write_audit('animal.review', a.moozzle_id, 'Review refused', 'denied');
    perform public.deny('review registration');
  end if;
  if a.approval_status not in ('Submitted', 'Pending Review') then raise exception 'This registration is not awaiting review.'; end if;
  update public.animals set approval_status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(coalesce(p_note, '')), '') where id = p_id;
  perform public.write_audit('animal.review', a.moozzle_id, 'Registration ' || lower(p_decision), 'success', coalesce(p_note, ''));
  perform public.notify_user(a.user_id, (select active_role from public.profiles where id = a.user_id), 'Registration ' || lower(p_decision),
    a.breed || ' · MOOZZLE ID ' || a.moozzle_id || coalesce(' · ' || nullif(trim(p_note), ''), ''), 'approval', '/animal/' || a.moozzle_id);
end;
$$;

-- ---------- Service records ----------
create or replace function public.add_service_record(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare
  s record;
  a record;
  v_id uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
  v_type text := p ->> 'service_type';
  v_title text := trim(coalesce(p ->> 'title', ''));
  v_corrects uuid := nullif(p ->> 'corrects_id', '')::uuid;
  orig record;
  allowed boolean;
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  if exists (select 1 from public.service_records where id = v_id) then
    if (select user_id from public.service_records where id = v_id) = auth.uid() then return v_id; end if;
    perform public.deny('record id in use');
  end if;
  select * into a from public.animals where id = (p ->> 'animal_id')::uuid;
  if not found or not public.can_view_animal(a.id) then
    perform public.write_audit('service.create', '', 'Service on out-of-scope animal refused', 'denied');
    perform public.deny('animal outside your scope');
  end if;
  if a.status = 'retired' then raise exception 'This animal is retired; new service records are closed.'; end if;
  if v_title = '' then raise exception 'Give the service a title.'; end if;
  allowed := case v_type
    when 'health' then s.role = 'Veterinarian' or (s.role = 'Super Administrator' and s.privileged)
      or (s.role = 'Farm Manager' and v_title in ('Vaccination', 'Deworming'))
    when 'ai' then s.role in ('AI Technician', 'Veterinarian') or (s.role = 'Super Administrator' and s.privileged)
    when 'insurance' then s.role = 'Insurance Officer'
    when 'traceability' then s.role in ('Livestock Inspector', 'Government Officer')
    when 'operations' then s.role = 'Farm Manager'
    else false end;
  if not allowed then
    perform public.write_audit('service.create', a.moozzle_id, 'Role may not add ' || coalesce(v_type, '?') || ' records', 'denied');
    perform public.deny('add ' || coalesce(v_type, 'unknown') || ' record');
  end if;
  if v_corrects is not null then
    select * into orig from public.service_records where id = v_corrects;
    if not found or orig.animal_id <> a.id or orig.service_type <> v_type then raise exception 'The record being corrected does not match.'; end if;
  end if;
  insert into public.service_records (id, user_id, animal_id, service_type, title, date, technician_name, details, performer_role, corrects_id)
  values (v_id, auth.uid(), a.id, v_type, v_title, coalesce(nullif(p ->> 'date', '')::date, current_date),
    trim(coalesce(p ->> 'technician_name', '')), coalesce(p -> 'details', '{}'::jsonb), s.role, v_corrects);
  perform public.write_audit(case when v_corrects is null then 'service.create' else 'service.correct' end, a.moozzle_id,
    v_type || ': ' || v_title, 'success', coalesce(p -> 'details' ->> 'correction_reason', ''), coalesce(p ->> 'source', 'moozzle-app'));
  return v_id;
end;
$$;

-- ---------- Retirement ----------
create or replace function public.can_retire_directly(a public.animals) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  s record;
  lvl text := public.perm('retire_animal');
begin
  select * into s from public.active_scope();
  if s.role is null or not public.can_view_animal(a.id) then return false; end if;
  if lvl = 'Authorised' then
    return (s.role = 'Super Administrator' and s.privileged) or (s.role <> 'Super Administrator' and a.district = any (s.districts));
  elsif lvl = 'Limited' then
    return a.organisation_id = s.organisation_id;
  end if;
  return false;
end;
$$;

create or replace function public.apply_retirement(a public.animals, p_reason text) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.animals set status = 'retired', biometric_status = 'retired', approval_status = 'Retired', retire_reason = p_reason, retired_at = now() where id = a.id;
  perform public.write_audit('animal.retire', a.moozzle_id, 'Animal retired', 'success', p_reason);
end;
$$;

create or replace function public.retire_animal(p_id uuid, p_reason text) returns text language plpgsql security definer set search_path = public as $$
declare
  a public.animals%rowtype;
  lvl text := public.perm('retire_animal');
begin
  select * into a from public.animals where id = p_id;
  if not found or not public.can_view_animal(p_id) then perform public.deny('animal outside your scope'); end if;
  if a.status = 'retired' then raise exception 'This animal is already retired.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for retirement.'; end if;
  if public.can_retire_directly(a) then
    perform public.apply_retirement(a, trim(p_reason));
    return 'retired';
  elsif lvl = 'Request only' then
    insert into public.record_requests (kind, animal_id, moozzle_id, requester_role, requester_name, payload)
    values ('retire', a.id, a.moozzle_id, public.app_role(), (select full_name from public.profiles where id = auth.uid()), jsonb_build_object('reason', trim(p_reason)));
    perform public.write_audit('animal.retire_request', a.moozzle_id, 'Retirement requested', 'requested', trim(p_reason));
    perform public.notify_scope(array['Organisation Administrator'], a.organisation_id, null, null, 'Retirement request',
      'MOOZZLE ID ' || a.moozzle_id || ' · ' || trim(p_reason), 'approval', '/approvals');
    return 'requested';
  end if;
  perform public.write_audit('animal.retire', a.moozzle_id, 'Retirement refused', 'denied');
  perform public.deny('retire animal');
end;
$$;

-- ---------- Requests ----------
create or replace function public.create_request(p_kind text, p_animal uuid, p_payload jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare
  a record;
  r text := public.app_role();
  v_id uuid;
begin
  if r is null then perform public.deny('no active role'); end if;
  select * into a from public.animals where id = p_animal;
  if not found or not public.can_view_animal(p_animal) then perform public.deny('animal outside your scope'); end if;
  if p_kind = 'transfer' then
    if public.perm('ownership_transfer') not in ('Own request', 'Limited', 'Scoped', 'Authorised') then perform public.deny('ownership transfer'); end if;
    if r = 'Farmer' and a.owner_user_id is distinct from auth.uid() then perform public.deny('not your animal'); end if;
    if length(trim(coalesce(p_payload ->> 'new_owner_name', ''))) < 2 then raise exception 'Enter the new owner name.'; end if;
  elsif p_kind in ('vet_help', 'ai_service') then
    if r not in ('Farmer', 'Farm Manager') then perform public.deny('service request'); end if;
  elsif p_kind = 'correction' then
    if length(trim(coalesce(p_payload ->> 'note', ''))) < 5 then raise exception 'Describe what needs correcting.'; end if;
  else
    raise exception 'Use retire_animal for retirement requests.';
  end if;
  insert into public.record_requests (kind, animal_id, moozzle_id, requester_role, requester_name, payload)
  values (p_kind, a.id, a.moozzle_id, r, (select full_name from public.profiles where id = auth.uid()), coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  perform public.write_audit('request.' || p_kind, a.moozzle_id, 'Request submitted', 'requested');
  if p_kind = 'transfer' then
    perform public.notify_scope(array['Livestock Inspector', 'Organisation Administrator'], a.organisation_id, null, a.district,
      'Ownership transfer pending', 'MOOZZLE ID ' || a.moozzle_id || ' → ' || (p_payload ->> 'new_owner_name'), 'approval', '/approvals');
  elsif p_kind = 'vet_help' then
    perform public.notify_scope(array['Veterinarian'], null, a.farm_id, null, 'Veterinary help requested',
      a.breed || ' · ' || a.moozzle_id || coalesce(' · ' || (p_payload ->> 'note'), ''), 'alert', '/approvals');
  elsif p_kind = 'ai_service' then
    perform public.notify_scope(array['AI Technician'], null, a.farm_id, null, 'AI service requested',
      a.breed || ' · ' || a.moozzle_id, 'reminder', '/approvals');
  else
    perform public.notify_scope(array['Organisation Administrator'], a.organisation_id, null, null, 'Correction requested',
      'MOOZZLE ID ' || a.moozzle_id, 'approval', '/approvals');
  end if;
  return v_id;
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

-- ---------- Insurance verification (never auto-approves a claim) ----------
create or replace function public.record_verification(p_policy uuid, p_outcome text, p_notes text, p_score numeric default null) returns void language plpgsql security definer set search_path = public as $$
declare
  s record;
  pol record;
  a record;
begin
  select * into s from public.active_scope();
  select * into pol from public.insurance_policies where id = p_policy;
  if not found or s.role is distinct from 'Insurance Officer' or pol.insurer_org_id is distinct from s.organisation_id then
    perform public.write_audit('biometric.verify', '', 'Verification refused', 'denied');
    perform public.deny('verify this policy');
  end if;
  if p_outcome not in ('Verified', 'Mismatch', 'Manual Review', 'Exception') then raise exception 'Unknown verification outcome.'; end if;
  select * into a from public.animals where id = pol.animal_id;
  update public.insurance_policies set verification_status = p_outcome, last_verified_at = now(), last_verified_by = auth.uid(),
    claim_status = case when p_outcome in ('Mismatch', 'Manual Review', 'Exception') and claim_status in ('Claim Submitted', 'Under Verification')
      then 'Referred for Manual Review' else claim_status end
  where id = p_policy;
  insert into public.service_records (user_id, animal_id, service_type, title, technician_name, details, performer_role)
  values (auth.uid(), a.id, 'insurance', 'Identity Verification', (select full_name from public.profiles where id = auth.uid()),
    jsonb_build_object('notes', coalesce(nullif(trim(p_notes), ''), p_outcome), 'policy', pol.policy_number, 'outcome', p_outcome,
      'score', coalesce(p_score::text, '')), s.role);
  perform public.write_audit('biometric.verify', a.moozzle_id, 'Policy ' || pol.policy_number || ': ' || p_outcome,
    case when p_outcome = 'Verified' then 'success' else 'failed' end, coalesce(p_notes, ''));
end;
$$;

-- ---------- User & role management ----------
create or replace function public.assign_role(p_user uuid, p_role text, p_org uuid, p_farms uuid[], p_districts text[]) returns void language plpgsql security definer set search_path = public as $$
declare
  s record;
  target_email text;
begin
  select * into s from public.active_scope();
  if s.role is null or public.perm('manage_users') not in ('Full', 'Scoped') then perform public.deny('manage users'); end if;
  if not public.valid_role(p_role) then raise exception 'Unknown role.'; end if;
  if p_user = auth.uid() then perform public.deny('cannot change your own roles'); end if;
  if s.role = 'Super Administrator' then
    if not s.privileged then perform public.deny('privileged access required'); end if;
  else
    -- Organisation admins assign operational roles inside their own organisation only.
    if p_role in ('Super Administrator', 'Organisation Administrator', 'Government Officer', 'API Administrator', 'Researcher', 'Insurance Officer', 'Livestock Inspector') then
      perform public.deny('role outside your authority');
    end if;
    if p_org is distinct from s.organisation_id then perform public.deny('organisation outside your scope'); end if;
    if exists (select 1 from unnest(coalesce(p_farms, '{}')) fid left join public.farms f on f.id = fid where f.organisation_id is distinct from s.organisation_id) then
      perform public.deny('farm outside your organisation');
    end if;
  end if;
  insert into public.user_roles (user_id, role, organisation_id, farm_ids, districts, assigned_by)
  values (p_user, p_role, p_org, coalesce(p_farms, '{}'), coalesce(p_districts, '{}'), auth.uid())
  on conflict (user_id, role) do update set organisation_id = excluded.organisation_id, farm_ids = excluded.farm_ids,
    districts = excluded.districts, assigned_by = excluded.assigned_by;
  select email into target_email from public.profiles where id = p_user;
  perform public.write_audit('admin.role_assign', '', 'Assigned ' || p_role || ' to ' || coalesce(target_email, p_user::text), 'success');
  perform public.notify_user(p_user, p_role, 'New workspace assigned', 'You can now work as ' || p_role || '.', 'security', '/profile');
end;
$$;

create or replace function public.revoke_role(p_user uuid, p_role text) returns void language plpgsql security definer set search_path = public as $$
declare
  s record;
  ur record;
begin
  select * into s from public.active_scope();
  if s.role is null or public.perm('manage_users') not in ('Full', 'Scoped') then perform public.deny('manage users'); end if;
  if p_user = auth.uid() then perform public.deny('cannot change your own roles'); end if;
  select * into ur from public.user_roles where user_id = p_user and role = p_role;
  if not found then raise exception 'Role not assigned.'; end if;
  if s.role = 'Super Administrator' then
    if not s.privileged then perform public.deny('privileged access required'); end if;
  elsif ur.organisation_id is distinct from s.organisation_id or p_role in ('Super Administrator', 'Organisation Administrator', 'Government Officer', 'API Administrator', 'Researcher', 'Insurance Officer', 'Livestock Inspector') then
    perform public.deny('role outside your authority');
  end if;
  if (select count(*) from public.user_roles where user_id = p_user) <= 1 then raise exception 'A user must keep at least one role.'; end if;
  delete from public.user_roles where id = ur.id;
  -- Revoked access takes effect immediately: move the user onto a remaining role.
  perform set_config('moozzle.rpc', 'on', true);
  update public.profiles set active_role = (select role from public.user_roles where user_id = p_user order by created_at limit 1), privileged_until = null
    where id = p_user and active_role = p_role;
  perform public.write_audit('admin.role_revoke', '', 'Revoked ' || p_role || ' from ' || coalesce((select email from public.profiles where id = p_user), ''), 'success');
end;
$$;

create or replace function public.set_permission(p_role text, p_permission text, p_level text, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare
  s record;
  old_level text;
begin
  select * into s from public.active_scope();
  if s.role is distinct from 'Super Administrator' or public.perm('platform_settings') <> 'Full' or not s.privileged then perform public.deny('change permissions'); end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Give a reason of at least 10 characters.'; end if;
  if p_role = 'Super Administrator' and p_permission in ('platform_settings', 'manage_users') then raise exception 'This change would lock out platform administration.'; end if;
  select level into old_level from public.role_permissions where role = p_role and permission = p_permission;
  if not found then raise exception 'Unknown role or permission.'; end if;
  update public.role_permissions set level = p_level, updated_at = now(), updated_by = auth.uid() where role = p_role and permission = p_permission;
  perform public.write_audit('admin.permission_change', '', p_role || ' · ' || p_permission || ': ' || old_level || ' → ' || p_level, 'success', trim(p_reason));
end;
$$;

create or replace function public.update_setting(p_key text, p_value jsonb, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare
  s record;
  st record;
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
  update public.platform_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform public.write_audit('admin.setting_change', '', p_key || ': ' || (st.value #>> '{}') || ' → ' || (p_value #>> '{}'), 'success', trim(p_reason));
end;
$$;

-- ---------- API credentials (secret returned once, only its hash is stored) ----------
create or replace function public.api_scopes_allowed() returns text[] language sql immutable set search_path = public as $$
  select array['animals:verify', 'animals:read:scoped', 'services:write:ai', 'services:write:health', 'sync:upload', 'reports:aggregate', 'webhooks:receive'];
$$;

create or replace function public.can_manage_api() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'API Administrator' or privileged from public.active_scope()), false);
$$;

create or replace function public.create_api_client(p_name text, p_org uuid, p_scopes text[], p_rate integer, p_webhook text) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  secret text := 'mzk_live_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_id uuid;
begin
  if not public.can_manage_api() then perform public.deny('manage API clients'); end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Name the client.'; end if;
  if coalesce(array_length(p_scopes, 1), 0) = 0 then raise exception 'Choose at least one scope.'; end if;
  if not (p_scopes <@ public.api_scopes_allowed()) then raise exception 'Unsupported scope requested; wildcard and full-database scopes are never granted.'; end if;
  if not exists (select 1 from public.organisations where id = p_org) then raise exception 'Choose the organisation this client is scoped to.'; end if;
  insert into public.api_clients (name, organisation_id, scopes, rate_limit_per_min, webhook_url, key_prefix, key_hash, created_by)
  values (trim(p_name), p_org, p_scopes, coalesce(p_rate, 120), trim(coalesce(p_webhook, '')), left(secret, 13),
    encode(extensions.digest(secret, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;
  perform public.write_audit('api.credential_create', '', 'Client ' || trim(p_name) || ' scopes ' || array_to_string(p_scopes, ','), 'success');
  return jsonb_build_object('id', v_id, 'secret', secret);
end;
$$;

create or replace function public.rotate_api_key(p_id uuid) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  secret text := 'mzk_live_' || encode(extensions.gen_random_bytes(24), 'hex');
  c record;
begin
  if not public.can_manage_api() then perform public.deny('manage API clients'); end if;
  select * into c from public.api_clients where id = p_id;
  if not found or c.status <> 'Active' then raise exception 'Active client not found.'; end if;
  update public.api_clients set key_prefix = left(secret, 13), key_hash = encode(extensions.digest(secret, 'sha256'), 'hex'), rotated_at = now() where id = p_id;
  perform public.write_audit('api.credential_rotate', '', 'Rotated key for ' || c.name, 'success');
  return jsonb_build_object('id', p_id, 'secret', secret);
end;
$$;

create or replace function public.update_api_client(p_id uuid, p_scopes text[], p_rate integer, p_status text) returns void language plpgsql security definer set search_path = public as $$
declare
  c record;
begin
  if not public.can_manage_api() then perform public.deny('manage API clients'); end if;
  select * into c from public.api_clients where id = p_id;
  if not found then raise exception 'Client not found.'; end if;
  if not (coalesce(p_scopes, c.scopes) <@ public.api_scopes_allowed()) then raise exception 'Unsupported scope requested.'; end if;
  if p_status not in ('Active', 'Revoked') then raise exception 'Unknown status.'; end if;
  update public.api_clients set scopes = coalesce(p_scopes, scopes), rate_limit_per_min = coalesce(p_rate, rate_limit_per_min), status = p_status where id = p_id;
  perform public.write_audit(case when p_status = 'Revoked' and c.status = 'Active' then 'api.credential_revoke' else 'api.client_update' end, '',
    c.name || ' · ' || array_to_string(coalesce(p_scopes, c.scopes), ',') || ' · ' || coalesce(p_rate, c.rate_limit_per_min) || '/min · ' || p_status, 'success');
end;
$$;

-- ---------- Aggregates (no identifiable data) ----------
create or replace function public.platform_overview() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r text := public.app_role();
begin
  if r is null or r not in ('Super Administrator', 'Researcher', 'API Administrator') then perform public.deny('platform overview'); end if;
  return jsonb_build_object(
    'animals', (select count(*) from public.animals where approval_status <> 'Draft'),
    'cattle', (select count(*) from public.animals where species = 'cattle' and approval_status <> 'Draft'),
    'buffalo', (select count(*) from public.animals where species = 'buffalo' and approval_status <> 'Draft'),
    'active', (select count(*) from public.animals where status = 'active' and approval_status <> 'Draft'),
    'organisations', (select count(*) from public.organisations),
    'farmers', (select count(distinct user_id) from public.user_roles where role = 'Farmer'),
    'field_workers', (select count(distinct user_id) from public.user_roles where role in ('Field Worker', 'AI Technician', 'Veterinarian')),
    'identifications', (select count(*) from public.audit_logs where action = 'biometric.identify'),
    'failed_identifications', (select count(*) from public.audit_logs where action = 'biometric.identify' and outcome <> 'success'),
    'pending_approvals', (select count(*) from public.animals where approval_status in ('Submitted', 'Pending Review')),
    'security_events', (select count(*) from public.audit_logs where outcome = 'denied' and created_at > now() - interval '7 days'),
    'failed_logins', (select count(*) from public.audit_logs where action = 'auth.login_failed' and created_at > now() - interval '7 days'),
    'api_requests', (select count(*) from public.api_request_logs),
    'api_failures', (select count(*) from public.api_request_logs where status_code >= 400),
    'breeds', (select coalesce(jsonb_object_agg(breed, n), '{}'::jsonb) from (select breed, count(*) n from public.animals where approval_status <> 'Draft' group by breed) b),
    'districts', (select coalesce(jsonb_object_agg(district, n), '{}'::jsonb) from (select district, count(*) n from public.animals where approval_status <> 'Draft' and district <> '' group by district) d),
    'quality', (select coalesce(jsonb_object_agg(bucket, n), '{}'::jsonb) from (
      select case when quality_score >= 0.9 then 'Excellent (≥0.90)' when quality_score >= 0.8 then 'Good (0.80–0.89)' when quality_score >= 0.7 then 'Fair (0.70–0.79)' else 'Poor (<0.70)' end bucket, count(*) n
      from public.biometric_templates group by 1) q)
  );
end;
$$;

-- De-identified research dataset: no MOOZZLE ID, owner, farm or village.
create or replace function public.research_dataset() returns table (subject text, species text, breed text, sex text, age_years integer, state text, quality_score numeric, captures integer, model_version text, enrolled_month text)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if public.app_role() is null or public.app_role() not in ('Researcher', 'Super Administrator') then perform public.deny('research dataset'); end if;
  return query
    select 'S-' || upper(left(encode(extensions.digest(a.id::text || 'moozzle-research', 'sha256'), 'hex'), 8)), a.species, a.breed, a.sex, a.age_years, a.state,
      t.quality_score::numeric, a.captured_images_count, t.model_version, to_char(a.created_at, 'YYYY-MM')
    from public.animals a join public.biometric_templates t on t.animal_id = a.id
    where a.approval_status <> 'Draft'
    order by a.created_at desc;
end;
$$;

-- ---------- Execute grants ----------
revoke execute on all functions in schema public from public, anon;
grant execute on function public.log_auth_failure(text) to anon, authenticated;
grant execute on function public.log_audit(text, text, text, text, text, text), public.set_active_role(text), public.start_privileged_access(text),
  public.end_privileged_access(), public.register_animal(jsonb), public.submit_animal(uuid), public.review_animal(uuid, text, text),
  public.add_service_record(jsonb), public.retire_animal(uuid, text), public.create_request(text, uuid, jsonb), public.review_request(uuid, text, text),
  public.record_verification(uuid, text, text, numeric), public.assign_role(uuid, text, uuid, uuid[], text[]), public.revoke_role(uuid, text),
  public.set_permission(text, text, text, text), public.update_setting(text, jsonb, text), public.create_api_client(text, uuid, text[], integer, text),
  public.rotate_api_key(uuid), public.update_api_client(uuid, text[], integer, text), public.platform_overview(), public.research_dataset(),
  public.api_scopes_allowed()
  to authenticated;
-- Internal helpers stay callable by RLS policies only.
grant execute on function public.active_scope(), public.app_role(), public.perm(text), public.animal_in_scope(uuid, uuid, uuid, text, uuid, uuid, text),
  public.can_view_animal(uuid), public.service_visible(text, text, uuid, uuid), public.can_view_owner(uuid), public.policy_visible(uuid, uuid),
  public.shares_scope_with(uuid), public.request_visible(text, uuid, uuid), public.audit_visible(uuid, uuid, text), public.valid_role(text)
  to authenticated;
revoke execute on function public.write_audit(text, text, text, text, text, text), public.notify_scope(text[], uuid, uuid, text, text, text, text, text),
  public.notify_user(uuid, text, text, text, text, text), public.apply_retirement(public.animals, text) from authenticated;
revoke execute on function public.handle_new_user() from authenticated;

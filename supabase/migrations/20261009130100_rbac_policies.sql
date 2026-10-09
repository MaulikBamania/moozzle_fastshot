-- Scope helpers and row-level security for every RBAC table. Deny by default.

-- The caller's active role, only if it is actually assigned to them.
create or replace function public.active_scope()
returns table (role text, organisation_id uuid, farm_ids uuid[], districts text[], privileged boolean)
language sql stable security definer set search_path = public as $$
  select ur.role, ur.organisation_id, ur.farm_ids, ur.districts,
    (ur.role = 'Super Administrator' and coalesce(p.privileged_until > now(), false))
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id and ur.role = p.active_role
  where p.id = auth.uid();
$$;

create or replace function public.app_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.active_scope();
$$;

create or replace function public.perm(p text) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select rp.level from public.role_permissions rp where rp.role = public.app_role() and rp.permission = p), 'No');
$$;

-- Is an animal row inside the caller's authorised scope?
create or replace function public.animal_in_scope(a_id uuid, a_org uuid, a_farm uuid, a_district text, a_owner uuid, a_creator uuid, a_approval text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  s record;
begin
  select * into s from public.active_scope();
  if s.role is null then return false; end if;
  -- Drafts stay with their author until submitted.
  if a_approval = 'Draft' then return a_creator = auth.uid(); end if;
  if s.role in ('Researcher', 'API Administrator') then return false; end if;
  if a_creator = auth.uid() then return true; end if;
  return case s.role
    when 'Super Administrator' then s.privileged
    when 'Organisation Administrator' then a_org is not null and a_org = s.organisation_id
    when 'Government Officer' then a_district = any (s.districts) and a_approval in ('Approved', 'Corrected', 'Retired')
    when 'Livestock Inspector' then a_district = any (s.districts) and a_approval in ('Approved', 'Corrected', 'Retired')
    when 'Veterinarian' then a_farm = any (s.farm_ids)
    when 'AI Technician' then a_farm = any (s.farm_ids)
    when 'Farm Manager' then a_farm = any (s.farm_ids)
    when 'Field Worker' then a_farm = any (s.farm_ids)
    when 'Farmer' then a_owner = auth.uid()
    when 'Insurance Officer' then exists (
      select 1 from public.insurance_policies ip where ip.animal_id = a_id and ip.insurer_org_id = s.organisation_id)
    else false
  end;
end;
$$;

create or replace function public.can_view_animal(target uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.animal_in_scope(a.id, a.organisation_id, a.farm_id, a.district, a.owner_user_id, a.user_id, a.approval_status)
    from public.animals a where a.id = target), false);
$$;

-- Limited health access sees preventive/reproductive entries, never clinical diagnoses or prescriptions.
create or replace function public.service_visible(s_type text, s_title text, s_animal uuid, s_author uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  r text := public.app_role();
  lvl text;
begin
  if r is null then return false; end if;
  if not public.can_view_animal(s_animal) then return false; end if;
  if s_author = auth.uid() then return true; end if;
  if s_type = 'health' then
    lvl := public.perm('health_records');
    return lvl in ('Full', 'Authorised', 'Scoped', 'Own')
      or (lvl = 'Limited' and s_title in ('Vaccination', 'Pregnancy Diagnosis', 'Calving', 'Deworming'));
  elsif s_type = 'ai' then
    lvl := public.perm('artificial_insemination');
    return lvl in ('Full', 'Authorised', 'Scoped', 'Own', 'Limited');
  elsif s_type = 'insurance' then
    lvl := public.perm('insurance_records');
    return lvl in ('Full', 'Authorised', 'Scoped', 'Own', 'Limited');
  elsif s_type = 'traceability' then
    return public.perm('view_animal_profile') in ('Full', 'Authorised', 'Scoped', 'Own', 'Limited');
  elsif s_type = 'operations' then
    return r in ('Farm Manager', 'Farmer', 'Organisation Administrator', 'Super Administrator');
  end if;
  return false;
end;
$$;

-- Owner personal data is narrower than animal identity data.
create or replace function public.can_view_owner(target uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.can_view_animal(target) and coalesce(public.app_role() in (
    'Super Administrator', 'Organisation Administrator', 'Veterinarian', 'AI Technician', 'Farmer', 'Farm Manager',
    'Livestock Inspector', 'Field Worker'), false);
$$;

create or replace function public.policy_visible(p_animal uuid, p_insurer uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  s record;
  lvl text := public.perm('insurance_records');
begin
  select * into s from public.active_scope();
  if s.role is null or lvl in ('No', 'De-identified', 'Via API scope') then return false; end if;
  if s.role = 'Insurance Officer' then return p_insurer = s.organisation_id; end if;
  return public.can_view_animal(p_animal);
end;
$$;

create or replace function public.shares_scope_with(other uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  s record;
  lvl text := public.perm('manage_users');
begin
  select * into s from public.active_scope();
  if s.role is null or lvl = 'No' then return false; end if;
  if s.role = 'Super Administrator' then return true; end if;
  return exists (select 1 from public.user_roles ur where ur.user_id = other and ur.organisation_id = s.organisation_id
    and (s.role <> 'Farm Manager' or ur.farm_ids && s.farm_ids));
end;
$$;

create or replace function public.request_visible(r_kind text, r_animal uuid, r_by uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  r text := public.app_role();
begin
  if r is null then return false; end if;
  if r_by = auth.uid() then return true; end if;
  if r_animal is null or not public.can_view_animal(r_animal) then return false; end if;
  return case r_kind
    when 'transfer' then r in ('Super Administrator', 'Organisation Administrator', 'Government Officer', 'Livestock Inspector')
    when 'retire' then r in ('Super Administrator', 'Organisation Administrator', 'Government Officer')
    when 'correction' then r in ('Super Administrator', 'Organisation Administrator')
    when 'vet_help' then r in ('Veterinarian', 'Organisation Administrator')
    when 'ai_service' then r in ('AI Technician', 'Organisation Administrator')
    else false end;
end;
$$;

create or replace function public.audit_visible(a_user uuid, a_org uuid, a_action text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  s record;
  lvl text := public.perm('view_audit_logs');
begin
  select * into s from public.active_scope();
  if s.role is null or lvl = 'No' then return false; end if;
  if lvl = 'Full' then return true; end if;
  if a_user = auth.uid() then return true; end if;
  if lvl = 'Scoped' then return a_org is not null and a_org = s.organisation_id; end if;
  if lvl = 'Technical only' then return a_action like 'api.%' or a_action like 'sync.%' or a_action like 'integration.%'; end if;
  return false;
end;
$$;

-- ---------- Signup: self-service accounts are always Farmers ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, active_role, phone, village, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), 'Farmer',
    coalesce(new.raw_user_meta_data ->> 'phone', ''), coalesce(new.raw_user_meta_data ->> 'village', ''), coalesce(new.email, ''))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'Farmer') on conflict do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Profiles: active_role / privilege are changed only through checked RPCs.
create or replace function public.guard_profile_update() returns trigger language plpgsql set search_path = public as $$
begin
  if current_setting('moozzle.rpc', true) = 'on' then return new; end if;
  if new.active_role is distinct from old.active_role or new.privileged_until is distinct from old.privileged_until
     or new.privileged_reason is distinct from old.privileged_reason or new.email is distinct from old.email then
    raise exception 'Role, privilege and email changes require an authorised request.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard_profile_update();

-- ---------- Drop prototype owner-only policies ----------
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "animals_select_own" on public.animals;
drop policy if exists "animals_insert_own" on public.animals;
drop policy if exists "animals_update_own" on public.animals;
drop policy if exists "animals_delete_own" on public.animals;
drop policy if exists "templates_select_own" on public.biometric_templates;
drop policy if exists "templates_insert_own" on public.biometric_templates;
drop policy if exists "templates_update_own" on public.biometric_templates;
drop policy if exists "templates_delete_own" on public.biometric_templates;
drop policy if exists "services_select_own" on public.service_records;
drop policy if exists "services_insert_own" on public.service_records;
drop policy if exists "services_update_own" on public.service_records;
drop policy if exists "services_delete_own" on public.service_records;
drop function if exists public.owns_animal(uuid);

alter table public.organisations enable row level security;
alter table public.farms enable row level security;
alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.animal_owners enable row level security;
alter table public.insurance_policies enable row level security;
alter table public.record_requests enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.platform_settings enable row level security;
alter table public.api_clients enable row level security;
alter table public.api_request_logs enable row level security;

-- Writes to protected tables go only through the checked RPCs (security definer).
revoke all on public.profiles, public.animals, public.biometric_templates, public.service_records, public.organisations,
  public.farms, public.user_roles, public.role_permissions, public.animal_owners, public.insurance_policies,
  public.record_requests, public.audit_logs, public.notifications, public.platform_settings, public.api_clients,
  public.api_request_logs from anon, authenticated;
grant select on public.profiles, public.animals, public.service_records, public.organisations, public.farms,
  public.user_roles, public.role_permissions, public.animal_owners, public.insurance_policies, public.record_requests,
  public.audit_logs, public.notifications, public.platform_settings, public.api_clients, public.api_request_logs,
  public.biometric_templates to authenticated;
grant update (full_name, phone, village, notification_prefs) on public.profiles to authenticated;
grant update (read) on public.notifications to authenticated;

create policy "profiles_select_scoped" on public.profiles for select to authenticated using (id = auth.uid() or public.shares_scope_with(id));
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "orgs_select" on public.organisations for select to authenticated using (true);
create policy "farms_select" on public.farms for select to authenticated using (true);
create policy "role_permissions_select" on public.role_permissions for select to authenticated using (true);
create policy "settings_select" on public.platform_settings for select to authenticated using (true);

create policy "user_roles_select" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.shares_scope_with(user_id));

create policy "animals_select_scoped" on public.animals for select to authenticated
  using (public.animal_in_scope(id, organisation_id, farm_id, district, owner_user_id, user_id, approval_status));
create policy "owners_select_scoped" on public.animal_owners for select to authenticated using (public.can_view_owner(animal_id));
-- Raw templates are never shown in ordinary screens; only an authorised privileged admin session.
create policy "templates_select_privileged" on public.biometric_templates for select to authenticated
  using (coalesce((select privileged from public.active_scope()), false));
create policy "services_select_scoped" on public.service_records for select to authenticated
  using (public.service_visible(service_type, title, animal_id, user_id));
create policy "policies_select_scoped" on public.insurance_policies for select to authenticated using (public.policy_visible(animal_id, insurer_org_id));
create policy "requests_select_scoped" on public.record_requests for select to authenticated using (public.request_visible(kind, animal_id, requested_by));
create policy "audit_select_scoped" on public.audit_logs for select to authenticated using (public.audit_visible(user_id, organisation_id, action));
create policy "notifications_select_own" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notifications_update_own" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "api_clients_select" on public.api_clients for select to authenticated
  using (public.app_role() = 'API Administrator' or coalesce((select privileged from public.active_scope()), false));
create policy "api_logs_select" on public.api_request_logs for select to authenticated
  using (public.app_role() = 'API Administrator' or coalesce((select privileged from public.active_scope()), false));

revoke execute on function public.active_scope(), public.app_role(), public.perm(text), public.animal_in_scope(uuid, uuid, uuid, text, uuid, uuid, text),
  public.can_view_animal(uuid), public.service_visible(text, text, uuid, uuid), public.can_view_owner(uuid),
  public.policy_visible(uuid, uuid), public.shares_scope_with(uuid), public.request_visible(text, uuid, uuid),
  public.audit_visible(uuid, uuid, text) from public, anon;
grant execute on function public.active_scope(), public.app_role(), public.perm(text), public.animal_in_scope(uuid, uuid, uuid, text, uuid, uuid, text),
  public.can_view_animal(uuid), public.service_visible(text, text, uuid, uuid), public.can_view_owner(uuid),
  public.policy_visible(uuid, uuid), public.shares_scope_with(uuid), public.request_visible(text, uuid, uuid),
  public.audit_visible(uuid, uuid, text) to authenticated;

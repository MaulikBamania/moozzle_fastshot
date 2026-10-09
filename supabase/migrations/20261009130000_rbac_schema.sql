-- MOOZZLE RBAC: 12 stakeholder roles, scoped assignments, configurable permission matrix,
-- separated owner data, policies, approvals, audit, notifications, platform settings and API clients.

-- ---------- Reference: organisations & farms ----------
create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  org_type text not null check (org_type in ('Platform', 'Dairy Cooperative', 'Breeding Organisation', 'Veterinary Organisation', 'Insurance Company', 'Government Department', 'Research Institution')),
  district text not null default '',
  state text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.farms (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations (id),
  name text not null,
  village text not null default '',
  district text not null default '',
  state text not null default '',
  created_at timestamptz not null default now(),
  unique (organisation_id, name)
);

-- ---------- Roles ----------
create or replace function public.valid_role(r text) returns boolean language sql immutable set search_path = public as $$
  select r in ('Super Administrator', 'Organisation Administrator', 'Government Officer', 'Veterinarian', 'AI Technician',
    'Farmer', 'Farm Manager', 'Insurance Officer', 'Livestock Inspector', 'Field Worker', 'Researcher', 'API Administrator');
$$;

alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = case role
  when 'Vet' then 'Veterinarian'
  when 'Field Officer' then 'Field Worker'
  else role end;
alter table public.profiles rename column role to active_role;
alter table public.profiles alter column active_role set default 'Farmer';
alter table public.profiles add constraint profiles_active_role_check check (public.valid_role(active_role));
alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles add column if not exists privileged_until timestamptz;
alter table public.profiles add column if not exists privileged_reason text;
alter table public.profiles add column if not exists notification_prefs jsonb not null default '{}'::jsonb;
update public.profiles p set email = coalesce(u.email, '') from auth.users u where u.id = p.id;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (public.valid_role(role)),
  organisation_id uuid references public.organisations (id),
  farm_ids uuid[] not null default '{}',
  districts text[] not null default '{}',
  assigned_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
create index if not exists user_roles_user_idx on public.user_roles (user_id);

insert into public.user_roles (user_id, role)
select id, active_role from public.profiles on conflict do nothing;

-- ---------- Permission matrix (configurable) ----------
create table if not exists public.role_permissions (
  role text not null check (public.valid_role(role)),
  permission text not null check (permission in ('platform_settings', 'manage_users', 'identify_animal', 'register_animal',
    'view_animal_profile', 'health_records', 'artificial_insemination', 'insurance_records', 'ownership_transfer',
    'view_reports', 'export_records', 'change_threshold', 'retire_animal', 'view_audit_logs')),
  level text not null check (level in ('Full', 'Authorised', 'Scoped', 'Own', 'Own request', 'Limited', 'Request only',
    'De-identified', 'Via API scope', 'Technical only', 'No')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  primary key (role, permission)
);

insert into public.role_permissions (role, permission, level)
select r.role, p.permission, p.levels[r.idx]
from (values
  (1, 'Super Administrator'), (2, 'Organisation Administrator'), (3, 'Government Officer'), (4, 'Veterinarian'),
  (5, 'AI Technician'), (6, 'Farmer'), (7, 'Farm Manager'), (8, 'Insurance Officer'), (9, 'Livestock Inspector'),
  (10, 'Field Worker'), (11, 'Researcher'), (12, 'API Administrator')
) as r(idx, role)
cross join (values
  ('platform_settings', array['Full','No','No','No','No','No','No','No','No','No','No','Limited']),
  ('manage_users', array['Full','Scoped','Limited','No','No','No','Limited','No','No','No','No','No']),
  ('identify_animal', array['Full','Scoped','Scoped','Scoped','Scoped','Own','Scoped','Scoped','Scoped','Scoped','Limited','Via API scope']),
  ('register_animal', array['Full','Scoped','Scoped','Limited','Limited','Own request','Scoped','No','Limited','Limited','No','Via API scope']),
  ('view_animal_profile', array['Authorised','Scoped','Scoped','Scoped','Limited','Own','Scoped','Limited','Scoped','Limited','De-identified','Via API scope']),
  ('health_records', array['Authorised','Limited','Scoped','Scoped','Limited','Own','Limited','No','Limited','No','De-identified','Via API scope']),
  ('artificial_insemination', array['Authorised','Scoped','Scoped','Scoped','Scoped','Own','Scoped','No','Limited','Limited','De-identified','Via API scope']),
  ('insurance_records', array['Authorised','Limited','Limited','No','No','Own','Limited','Scoped','No','No','De-identified','Via API scope']),
  ('ownership_transfer', array['Authorised','Scoped','Scoped','No','No','Own request','Limited','No','Scoped','No','No','Via API scope']),
  ('view_reports', array['Full','Scoped','Scoped','Own','Own','Own','Scoped','Scoped','Scoped','Own','Scoped','Technical only']),
  ('export_records', array['Authorised','Scoped','Limited','Limited','Limited','Own','Scoped','Scoped','Limited','Limited','De-identified','Via API scope']),
  ('change_threshold', array['Authorised','No','No','No','No','No','No','No','No','No','No','No']),
  ('retire_animal', array['Authorised','Limited','Authorised','Request only','Request only','Request only','Request only','No','Request only','No','No','No']),
  ('view_audit_logs', array['Full','Scoped','Scoped','Own','Own','Own','Own','Scoped','Scoped','Own','No','Technical only'])
) as p(permission, levels)
on conflict (role, permission) do nothing;

-- ---------- Animals: scope columns, lifecycle, owner separation ----------
alter table public.animals add column if not exists organisation_id uuid references public.organisations (id);
alter table public.animals add column if not exists farm_id uuid references public.farms (id);
alter table public.animals add column if not exists owner_user_id uuid references auth.users (id);
alter table public.animals add column if not exists approval_status text not null default 'Approved'
  check (approval_status in ('Draft', 'Submitted', 'Pending Review', 'Approved', 'Rejected', 'Corrected', 'Retired'));
alter table public.animals add column if not exists duplicate_of uuid references public.animals (id);
alter table public.animals add column if not exists reviewed_by uuid references auth.users (id);
alter table public.animals add column if not exists reviewed_at timestamptz;
alter table public.animals add column if not exists review_note text;
create index if not exists animals_org_idx on public.animals (organisation_id);
create index if not exists animals_farm_idx on public.animals (farm_id);
create index if not exists animals_owner_idx on public.animals (owner_user_id);
create index if not exists animals_district_idx on public.animals (district);

create table if not exists public.animal_owners (
  animal_id uuid primary key references public.animals (id) on delete cascade,
  owner_name text not null default '',
  owner_phone text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.animal_owners (animal_id, owner_name, owner_phone)
select id, owner_name, owner_phone from public.animals on conflict do nothing;
update public.animals set approval_status = 'Retired' where status = 'retired';
alter table public.animals drop column if exists owner_name;
alter table public.animals drop column if exists owner_phone;

-- Permanent identity: MOOZZLE ID and row ID never change; animals are retired, never deleted.
create or replace function public.protect_animal_identity() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Animal identities are permanent. Retire the animal instead.' using errcode = '42501';
  end if;
  if new.moozzle_id <> old.moozzle_id or new.id <> old.id then
    raise exception 'A MOOZZLE ID cannot be changed or reassigned.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists animals_protect_identity on public.animals;
create trigger animals_protect_identity before update or delete on public.animals
  for each row execute function public.protect_animal_identity();

-- ---------- Service records: signed, correction by amendment ----------
alter table public.service_records drop constraint if exists service_records_service_type_check;
alter table public.service_records add constraint service_records_service_type_check
  check (service_type in ('health', 'ai', 'insurance', 'traceability', 'operations'));
alter table public.service_records add column if not exists performer_role text not null default '';
alter table public.service_records add column if not exists corrects_id uuid references public.service_records (id);
alter table public.service_records add column if not exists signed_at timestamptz not null default now();

-- ---------- Insurance policies ----------
create table if not exists public.insurance_policies (
  id uuid primary key default gen_random_uuid(),
  animal_id uuid not null references public.animals (id),
  policy_number text not null unique,
  insurer_org_id uuid not null references public.organisations (id),
  holder_name text not null default '',
  coverage_amount integer not null default 0,
  start_date date not null default current_date,
  end_date date not null default (current_date + 365),
  claim_status text not null default 'None' check (claim_status in ('None', 'Claim Submitted', 'Under Verification', 'Referred for Manual Review', 'Settled', 'Rejected')),
  verification_status text not null default 'Pending' check (verification_status in ('Pending', 'Verified', 'Mismatch', 'Manual Review', 'Exception')),
  last_verified_at timestamptz,
  last_verified_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index if not exists policies_animal_idx on public.insurance_policies (animal_id);
create index if not exists policies_insurer_idx on public.insurance_policies (insurer_org_id);

-- ---------- Requests: transfers, retirements, corrections, service help ----------
create table if not exists public.record_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('transfer', 'retire', 'correction', 'vet_help', 'ai_service')),
  animal_id uuid references public.animals (id),
  moozzle_id text not null default '',
  requested_by uuid not null references auth.users (id) default auth.uid(),
  requester_role text not null,
  requester_name text not null default '',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'Submitted' check (status in ('Submitted', 'Approved', 'Rejected', 'Accepted', 'Declined', 'Completed')),
  reviewed_by uuid references auth.users (id),
  reviewer_role text,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists requests_animal_idx on public.record_requests (animal_id);
create index if not exists requests_requester_idx on public.record_requests (requested_by);

-- ---------- Audit ----------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_id text not null default ('EVT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  user_id uuid references auth.users (id) on delete set null,
  user_role text not null default '',
  organisation_id uuid references public.organisations (id),
  action text not null,
  target_moozzle_id text not null default '',
  details text not null default '',
  outcome text not null default 'success' check (outcome in ('success', 'denied', 'failed', 'no_match', 'requested')),
  reason text not null default '',
  source text not null default 'moozzle-app',
  created_at timestamptz not null default now()
);
create index if not exists audit_user_idx on public.audit_logs (user_id, created_at desc);
create index if not exists audit_org_idx on public.audit_logs (organisation_id, created_at desc);
create index if not exists audit_target_idx on public.audit_logs (target_moozzle_id);

-- ---------- Notifications ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  user_role text not null,
  title text not null,
  message text not null,
  type text not null default 'info' check (type in ('info', 'alert', 'approval', 'reminder', 'sync', 'security', 'integration')),
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------- Platform settings ----------
create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null,
  description text not null default '',
  risk text not null default 'normal' check (risk in ('normal', 'high')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
insert into public.platform_settings (key, value, description, risk) values
  ('biometric_threshold', '0.82'::jsonb, 'Minimum similarity score for a 1:N match to be accepted.', 'high'),
  ('model_version', '"moozzle-proto-v1.0"'::jsonb, 'Biometric model version used for new templates.', 'high'),
  ('data_retention_days', '2555'::jsonb, 'Days to keep audit and service records after an animal is retired.', 'high'),
  ('raw_image_retention_days', '90'::jsonb, 'Days to keep raw muzzle captures before only templates remain.', 'high'),
  ('require_registration_approval', 'true'::jsonb, 'Registrations by limited roles need reviewer approval.', 'normal'),
  ('api_default_rate_limit', '120'::jsonb, 'Default API requests per minute for new integration clients.', 'normal')
on conflict (key) do nothing;

-- ---------- API clients ----------
create table if not exists public.api_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organisation_id uuid not null references public.organisations (id),
  scopes text[] not null default '{}',
  rate_limit_per_min integer not null default 120 check (rate_limit_per_min between 1 and 5000),
  webhook_url text not null default '',
  status text not null default 'Active' check (status in ('Active', 'Revoked')),
  key_prefix text not null,
  key_hash text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create table if not exists public.api_request_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.api_clients (id) on delete cascade,
  endpoint text not null,
  method text not null default 'GET',
  status_code integer not null,
  latency_ms integer not null default 0,
  error text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists api_logs_client_idx on public.api_request_logs (client_id, created_at desc);

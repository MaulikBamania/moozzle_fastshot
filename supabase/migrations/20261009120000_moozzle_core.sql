-- MOOZZLE core schema: profiles, animals, biometric templates, service records.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'Field Officer'
    check (role in ('AI Technician', 'Vet', 'Farmer', 'Field Officer')),
  phone text not null default '',
  village text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.animals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  moozzle_id text not null unique check (moozzle_id ~ '^[0-9]{12}$'),
  species text not null check (species in ('cattle', 'buffalo')),
  breed text not null,
  sex text not null check (sex in ('female', 'male')),
  age_years integer not null check (age_years between 0 and 40),
  owner_name text not null default '',
  owner_phone text not null default '',
  farm_name text not null default '',
  village text not null default '',
  district text not null default '',
  state text not null default '',
  biometric_status text not null default 'enrolled'
    check (biometric_status in ('enrolled', 'pending_quality', 'retired')),
  status text not null default 'active' check (status in ('active', 'retired')),
  retire_reason text,
  retired_at timestamptz,
  captured_images_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists animals_user_id_idx on public.animals (user_id, created_at desc);

create table if not exists public.biometric_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  animal_id uuid not null references public.animals (id) on delete cascade,
  moozzle_id text not null,
  quality_score numeric(4, 3) not null check (quality_score between 0 and 1),
  embedding_preview text not null default '',
  model_version text not null,
  created_at timestamptz not null default now()
);
create index if not exists biometric_templates_animal_idx on public.biometric_templates (animal_id);
create index if not exists biometric_templates_user_idx on public.biometric_templates (user_id);

create table if not exists public.service_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  animal_id uuid not null references public.animals (id) on delete cascade,
  service_type text not null check (service_type in ('health', 'ai', 'insurance', 'traceability')),
  title text not null,
  date date not null default current_date,
  technician_name text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists service_records_animal_idx on public.service_records (animal_id, date desc);
create index if not exists service_records_user_idx on public.service_records (user_id);

-- Children must belong to an animal owned by the same user.
create or replace function public.owns_animal(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.animals a where a.id = target and a.user_id = auth.uid());
$$;
revoke all on function public.owns_animal(uuid) from public;
grant execute on function public.owns_animal(uuid) to authenticated;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists animals_touch on public.animals;
create trigger animals_touch before update on public.animals
  for each row execute function public.touch_updated_at();
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Profile row from signup metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  requested_role text := coalesce(new.raw_user_meta_data ->> 'role', 'Field Officer');
begin
  if requested_role not in ('AI Technician', 'Vet', 'Farmer', 'Field Officer') then
    requested_role := 'Field Officer';
  end if;
  insert into public.profiles (id, full_name, role, phone, village)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    requested_role,
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    coalesce(new.raw_user_meta_data ->> 'village', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.animals enable row level security;
alter table public.biometric_templates enable row level security;
alter table public.service_records enable row level security;

revoke all on public.profiles, public.animals, public.biometric_templates, public.service_records from anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.animals, public.biometric_templates, public.service_records to authenticated;

create policy "profiles_select_own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "animals_select_own" on public.animals for select to authenticated using (user_id = auth.uid());
create policy "animals_insert_own" on public.animals for insert to authenticated with check (user_id = auth.uid());
create policy "animals_update_own" on public.animals for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "animals_delete_own" on public.animals for delete to authenticated using (user_id = auth.uid());

create policy "templates_select_own" on public.biometric_templates for select to authenticated using (user_id = auth.uid());
create policy "templates_insert_own" on public.biometric_templates for insert to authenticated with check (user_id = auth.uid() and public.owns_animal(animal_id));
create policy "templates_update_own" on public.biometric_templates for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.owns_animal(animal_id));
create policy "templates_delete_own" on public.biometric_templates for delete to authenticated using (user_id = auth.uid());

create policy "services_select_own" on public.service_records for select to authenticated using (user_id = auth.uid());
create policy "services_insert_own" on public.service_records for insert to authenticated with check (user_id = auth.uid() and public.owns_animal(animal_id));
create policy "services_update_own" on public.service_records for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.owns_animal(animal_id));
create policy "services_delete_own" on public.service_records for delete to authenticated using (user_id = auth.uid());

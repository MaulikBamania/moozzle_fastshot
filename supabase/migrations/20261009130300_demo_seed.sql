-- Synthetic demo data only (no real people, animals or credentials).
-- Demo accounts demo.*@moozzle.com are created beforehand through the Auth Admin API.

insert into public.organisations (name, org_type, district, state) values
  ('MOOZZLE Platform', 'Platform', 'Ahmedabad', 'Gujarat'),
  ('Sabar Dairy Cooperative', 'Dairy Cooperative', 'Sabarkantha', 'Gujarat'),
  ('Dudhsagar Dairy Union', 'Dairy Cooperative', 'Mehsana', 'Gujarat'),
  ('Gujarat Animal Husbandry Department', 'Government Department', 'Gandhinagar', 'Gujarat'),
  ('Bharat Livestock Insurance', 'Insurance Company', 'Ahmedabad', 'Gujarat'),
  ('Anand Livestock Research Lab', 'Research Institution', 'Anand', 'Gujarat')
on conflict (name) do nothing;

insert into public.farms (organisation_id, name, village, district, state)
select o.id, f.name, f.village, f.district, 'Gujarat'
from (values
  ('Sabar Dairy Cooperative', 'Patel Dairy Farm', 'Himmatnagar', 'Sabarkantha'),
  ('Sabar Dairy Cooperative', 'Shree Krishna Gaushala', 'Idar', 'Sabarkantha'),
  ('Dudhsagar Dairy Union', 'Mehsana Buffalo Farm', 'Unjha', 'Mehsana')
) as f(org, name, village, district)
join public.organisations o on o.name = f.org
on conflict (organisation_id, name) do nothing;

-- Role assignments by email.
with u as (select id, email from auth.users where email like 'demo.%@moozzle.com'),
o as (select id, name from public.organisations),
fm as (select id, name from public.farms),
assignments(email, role, org, farms, districts) as (values
  ('demo.admin@moozzle.com', 'Super Administrator', 'MOOZZLE Platform', array[]::text[], array[]::text[]),
  ('demo.orgadmin@moozzle.com', 'Organisation Administrator', 'Sabar Dairy Cooperative', array[]::text[], array['Sabarkantha']),
  ('demo.government@moozzle.com', 'Government Officer', 'Gujarat Animal Husbandry Department', array[]::text[], array['Sabarkantha']),
  ('demo.vet@moozzle.com', 'Veterinarian', 'Sabar Dairy Cooperative', array['Patel Dairy Farm', 'Shree Krishna Gaushala'], array[]::text[]),
  ('demo.ai@moozzle.com', 'AI Technician', 'Sabar Dairy Cooperative', array['Patel Dairy Farm', 'Shree Krishna Gaushala'], array[]::text[]),
  ('demo.farmer@moozzle.com', 'Farmer', null, array[]::text[], array[]::text[]),
  ('demo.farmmanager@moozzle.com', 'Farm Manager', 'Sabar Dairy Cooperative', array['Patel Dairy Farm'], array[]::text[]),
  ('demo.insurance@moozzle.com', 'Insurance Officer', 'Bharat Livestock Insurance', array[]::text[], array[]::text[]),
  ('demo.inspector@moozzle.com', 'Livestock Inspector', 'Gujarat Animal Husbandry Department', array[]::text[], array['Sabarkantha', 'Mehsana']),
  ('demo.fieldworker@moozzle.com', 'Field Worker', 'Sabar Dairy Cooperative', array['Shree Krishna Gaushala'], array[]::text[]),
  ('demo.researcher@moozzle.com', 'Researcher', 'Anand Livestock Research Lab', array[]::text[], array[]::text[]),
  ('demo.apiadmin@moozzle.com', 'API Administrator', 'MOOZZLE Platform', array[]::text[], array[]::text[]),
  ('demo.multirole@moozzle.com', 'Veterinarian', 'Dudhsagar Dairy Union', array['Mehsana Buffalo Farm'], array[]::text[]),
  ('demo.multirole@moozzle.com', 'AI Technician', 'Dudhsagar Dairy Union', array['Mehsana Buffalo Farm'], array[]::text[]),
  ('demo.multirole@moozzle.com', 'Farm Manager', 'Dudhsagar Dairy Union', array['Mehsana Buffalo Farm'], array[]::text[])
)
insert into public.user_roles (user_id, role, organisation_id, farm_ids, districts)
select u.id, a.role, o.id,
  coalesce((select array_agg(fm.id) from fm where fm.name = any (a.farms)), '{}'), a.districts
from assignments a join u on u.email = a.email left join o on o.name = a.org
on conflict (user_id, role) do update set organisation_id = excluded.organisation_id, farm_ids = excluded.farm_ids, districts = excluded.districts;

-- Self-service Farmer default is removed where the demo account is not a farmer.
delete from public.user_roles ur using auth.users u
where ur.user_id = u.id and u.email like 'demo.%@moozzle.com' and u.email <> 'demo.farmer@moozzle.com' and ur.role = 'Farmer';

select set_config('moozzle.rpc', 'on', true);
update public.profiles p set active_role = (select ur.role from public.user_roles ur where ur.user_id = p.id order by ur.created_at, ur.role limit 1),
  email = u.email,
  phone = '+91 98' || lpad((abs(hashtext(u.email)) % 100000000)::text, 8, '0'),
  village = case u.email when 'demo.farmer@moozzle.com' then 'Himmatnagar' else village end
from auth.users u where u.id = p.id and u.email like 'demo.%@moozzle.com';
update public.profiles p set active_role = 'Veterinarian' from auth.users u where u.id = p.id and u.email = 'demo.multirole@moozzle.com';

-- Animals.
with creator as (select id from auth.users where email = 'demo.fieldworker@moozzle.com'),
vet as (select id from auth.users where email = 'demo.vet@moozzle.com'),
farmer as (select id from auth.users where email = 'demo.farmer@moozzle.com'),
data(mid, species, breed, sex, age, farm, owner, phone, own_farmer, approval, created_ago, quality, by_vet) as (values
  ('482731905614', 'cattle', 'Gir', 'female', 5, 'Patel Dairy Farm', 'Ramesh Patel', '+91 98250 41122', true, 'Approved', 210, 0.94, true),
  ('731905614482', 'buffalo', 'Murrah', 'female', 6, 'Patel Dairy Farm', 'Ramesh Patel', '+91 98250 41122', true, 'Approved', 160, 0.91, true),
  ('905614482731', 'cattle', 'Kankrej', 'male', 4, 'Patel Dairy Farm', 'Ramesh Patel', '+91 98250 41122', true, 'Approved', 95, 0.88, true),
  ('614482731905', 'cattle', 'Sahiwal', 'female', 3, 'Shree Krishna Gaushala', 'Gopal Thakor', '+91 99090 12345', false, 'Approved', 120, 0.9, false),
  ('263840175942', 'cattle', 'Gir', 'female', 7, 'Shree Krishna Gaushala', 'Gopal Thakor', '+91 99090 12345', false, 'Approved', 300, 0.86, false),
  ('358204719663', 'cattle', 'Tharparkar', 'female', 2, 'Shree Krishna Gaushala', 'Gopal Thakor', '+91 99090 12345', false, 'Submitted', 2, 0.83, false),
  ('517392846051', 'buffalo', 'Mehsana', 'female', 5, 'Mehsana Buffalo Farm', 'Ramesh Chaudhary', '+91 97240 55678', false, 'Approved', 180, 0.92, false),
  ('640918273554', 'buffalo', 'Jaffarabadi', 'male', 4, 'Mehsana Buffalo Farm', 'Ramesh Chaudhary', '+91 97240 55678', false, 'Approved', 75, 0.79, false),
  ('829105736248', 'buffalo', 'Surti', 'female', 3, 'Mehsana Buffalo Farm', 'Ramesh Chaudhary', '+91 97240 55678', false, 'Approved', 40, 0.85, false)
),
ins as (
  insert into public.animals (user_id, moozzle_id, species, breed, sex, age_years, farm_name, village, district, state, biometric_status,
    status, captured_images_count, organisation_id, farm_id, owner_user_id, approval_status, created_at)
  select case when d.by_vet then (select id from vet) else (select id from creator) end, d.mid, d.species, d.breed, d.sex, d.age,
    f.name, f.village, f.district, f.state, 'enrolled', 'active', 4, f.organisation_id, f.id,
    case when d.own_farmer then (select id from farmer) else null end, d.approval, now() - make_interval(days => d.created_ago)
  from data d join public.farms f on f.name = d.farm
  on conflict (moozzle_id) do nothing
  returning id, moozzle_id, user_id
)
select count(*) from ins;

insert into public.animal_owners (animal_id, owner_name, owner_phone)
select a.id, v.owner, v.phone from public.animals a join (values
  ('482731905614', 'Ramesh Patel', '+91 98250 41122'), ('731905614482', 'Ramesh Patel', '+91 98250 41122'),
  ('905614482731', 'Ramesh Patel', '+91 98250 41122'), ('614482731905', 'Gopal Thakor', '+91 99090 12345'),
  ('263840175942', 'Gopal Thakor', '+91 99090 12345'), ('358204719663', 'Gopal Thakor', '+91 99090 12345'),
  ('517392846051', 'Ramesh Chaudhary', '+91 97240 55678'), ('640918273554', 'Ramesh Chaudhary', '+91 97240 55678'),
  ('829105736248', 'Ramesh Chaudhary', '+91 97240 55678')
) as v(mid, owner, phone) on v.mid = a.moozzle_id
on conflict (animal_id) do nothing;

insert into public.biometric_templates (user_id, animal_id, moozzle_id, quality_score, embedding_preview, model_version)
select a.user_id, a.id, a.moozzle_id, q.quality, '', 'moozzle-proto-v1.0'
from public.animals a join (values
  ('482731905614', 0.94), ('731905614482', 0.91), ('905614482731', 0.88), ('614482731905', 0.90), ('263840175942', 0.86),
  ('358204719663', 0.83), ('517392846051', 0.92), ('640918273554', 0.79), ('829105736248', 0.85)
) as q(mid, quality) on q.mid = a.moozzle_id
where not exists (select 1 from public.biometric_templates t where t.animal_id = a.id);

-- Insurance policies (Bharat Livestock Insurance).
insert into public.insurance_policies (animal_id, policy_number, insurer_org_id, holder_name, coverage_amount, start_date, end_date, claim_status, verification_status)
select a.id, p.num, (select id from public.organisations where name = 'Bharat Livestock Insurance'), p.holder, p.amount,
  current_date - 120, current_date + 245, p.claim, p.verif
from public.animals a join (values
  ('482731905614', 'BLI-GJ-2026-004821', 'Ramesh Patel', 65000, 'Claim Submitted', 'Pending'),
  ('731905614482', 'BLI-GJ-2026-004822', 'Ramesh Patel', 80000, 'None', 'Verified'),
  ('517392846051', 'BLI-GJ-2026-005107', 'Ramesh Chaudhary', 75000, 'None', 'Pending')
) as p(mid, num, holder, amount, claim, verif) on p.mid = a.moozzle_id
on conflict (policy_number) do nothing;

-- Signed service records.
with v as (select id from auth.users where email = 'demo.vet@moozzle.com'),
t as (select id from auth.users where email = 'demo.ai@moozzle.com'),
i as (select id from auth.users where email = 'demo.inspector@moozzle.com'),
m as (select id from auth.users where email = 'demo.farmmanager@moozzle.com'),
rec(mid, who, role, name, stype, title, ago, details) as (values
  ('482731905614', 'vet', 'Veterinarian', 'Dr. Priya Sharma', 'health', 'Treatment', 12,
    '{"notes":"Mild mastitis in left hind quarter. Intramammary antibiotic for 3 days; milk withheld 5 days.","diagnosis":"Subclinical mastitis","prescription":"Cefquinome intramammary, 1 tube BID × 3 days","follow_up":"Recheck CMT in 7 days"}'::jsonb),
  ('482731905614', 'vet', 'Veterinarian', 'Dr. Priya Sharma', 'health', 'Vaccination', 40,
    '{"notes":"FMD booster administered.","vaccine":"FMD (bivalent)","next_due":"2027-04-01"}'::jsonb),
  ('482731905614', 'ai', 'AI Technician', 'Rajesh Solanki', 'ai', 'Artificial Insemination', 65,
    '{"notes":"Standing heat observed at 06:30.","bull":"Gir HB-1142","semen_batch":"SSC-GIR-24-0871","semen_station":"Sabarmati Semen Station","attempt":"1"}'::jsonb),
  ('482731905614', 'vet', 'Veterinarian', 'Dr. Priya Sharma', 'health', 'Pregnancy Diagnosis', 5,
    '{"notes":"Rectal palpation positive, ~60 days.","result":"Pregnant","expected_calving":"2027-05-20"}'::jsonb),
  ('731905614482', 'ai', 'AI Technician', 'Rajesh Solanki', 'ai', 'Artificial Insemination', 22,
    '{"notes":"Second attempt.","bull":"Murrah MU-221","semen_batch":"NDDB-MU-25-0410","semen_station":"Sabarmati Semen Station","attempt":"2"}'::jsonb),
  ('731905614482', 'vet', 'Veterinarian', 'Dr. Priya Sharma', 'health', 'Deworming', 30,
    '{"notes":"Albendazole oral dose.","next_due":"2027-01-15"}'::jsonb),
  ('482731905614', 'ins', 'Livestock Inspector', 'Imran Shaikh', 'traceability', 'Movement', 90,
    '{"notes":"Moved from Idar cattle fair to Patel Dairy Farm.","from":"Idar Cattle Fair","to":"Patel Dairy Farm, Himmatnagar"}'::jsonb),
  ('482731905614', 'mgr', 'Farm Manager', 'Bhavesh Chaudhary', 'operations', 'Milk Production', 1,
    '{"notes":"Morning 6.2 L · Evening 5.8 L","litres":"12.0"}'::jsonb),
  ('731905614482', 'mgr', 'Farm Manager', 'Bhavesh Chaudhary', 'operations', 'Feed and Nutrition', 2,
    '{"notes":"Green fodder 25 kg, concentrate 4 kg, mineral mix 50 g."}'::jsonb)
)
insert into public.service_records (user_id, animal_id, service_type, title, date, technician_name, details, performer_role, created_at, signed_at)
select case rec.who when 'vet' then (select id from v) when 'ai' then (select id from t) when 'ins' then (select id from i) else (select id from m) end,
  a.id, rec.stype, rec.title, current_date - rec.ago, rec.name, rec.details, rec.role, now() - make_interval(days => rec.ago), now() - make_interval(days => rec.ago)
from rec join public.animals a on a.moozzle_id = rec.mid
where not exists (select 1 from public.service_records s where s.animal_id = a.id and s.title = rec.title and s.date = current_date - rec.ago);

-- A pending ownership transfer requested by the farmer.
insert into public.record_requests (kind, animal_id, moozzle_id, requested_by, requester_role, requester_name, payload)
select 'transfer', a.id, a.moozzle_id, u.id, 'Farmer', 'Ramesh Patel',
  '{"new_owner_name":"Mahesh Patel","new_owner_phone":"+91 98980 22110","note":"Selling bull to cousin in Prantij"}'::jsonb
from public.animals a, auth.users u
where a.moozzle_id = '905614482731' and u.email = 'demo.farmer@moozzle.com'
  and not exists (select 1 from public.record_requests r where r.animal_id = a.id and r.kind = 'transfer');

-- Synthetic API client (hash of a random value that is never stored) and request logs.
insert into public.api_clients (name, organisation_id, scopes, rate_limit_per_min, webhook_url, key_prefix, key_hash, created_by)
select 'Sabar Dairy ERP Sync', o.id, array['animals:verify', 'sync:upload'], 240, 'https://erp.sabardairy.example/webhooks/moozzle',
  'mzk_live_3f9a', encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'), u.id
from public.organisations o, auth.users u
where o.name = 'Sabar Dairy Cooperative' and u.email = 'demo.apiadmin@moozzle.com'
  and not exists (select 1 from public.api_clients where name = 'Sabar Dairy ERP Sync');

insert into public.api_request_logs (client_id, endpoint, method, status_code, latency_ms, error, created_at)
select c.id, e.endpoint, e.method, e.code, e.latency, e.err, now() - make_interval(mins => e.ago)
from public.api_clients c cross join (values
  ('/v1/animals/verify', 'POST', 200, 182, '', 5), ('/v1/animals/verify', 'POST', 200, 165, '', 18),
  ('/v1/sync/upload', 'POST', 201, 410, '', 32), ('/v1/sync/upload', 'POST', 409, 120, 'Conflict: newer server record kept', 47),
  ('/v1/animals/verify', 'POST', 401, 15, 'Invalid or revoked credential', 63), ('/v1/sync/upload', 'POST', 201, 398, '', 90),
  ('/v1/animals/verify', 'POST', 429, 4, 'Rate limit exceeded (240/min)', 120), ('/v1/reports/aggregate', 'GET', 403, 9, 'Scope reports:aggregate not granted', 200)
) as e(endpoint, method, code, latency, err, ago)
where c.name = 'Sabar Dairy ERP Sync' and not exists (select 1 from public.api_request_logs l where l.client_id = c.id);

-- Role-specific notifications.
insert into public.notifications (user_id, user_role, title, message, type, link, created_at)
select u.id, n.role, n.title, n.message, n.type, n.link, now() - make_interval(hours => n.ago)
from (values
  ('demo.ai@moozzle.com', 'AI Technician', 'Follow-up visit due', 'Pregnancy check due for Murrah buffalo 7319 0561 4482 at Patel Dairy Farm.', 'reminder', '/animal/731905614482', 3),
  ('demo.vet@moozzle.com', 'Veterinarian', 'Assigned case requires attention', 'Gir cow 4827 3190 5614: mastitis recheck due this week.', 'alert', '/animal/482731905614', 2),
  ('demo.farmer@moozzle.com', 'Farmer', 'Vaccination due soon', 'Your Kankrej bull 9056 1448 2731 is due for HS vaccination.', 'reminder', '/animal/905614482731', 6),
  ('demo.farmmanager@moozzle.com', 'Farm Manager', 'Animal service scheduled', 'Veterinary visit scheduled tomorrow 09:00 for 2 animals.', 'info', '/(tabs)/records', 5),
  ('demo.insurance@moozzle.com', 'Insurance Officer', 'Identity verification pending', 'Claim on policy BLI-GJ-2026-004821 needs muzzle verification.', 'approval', '/verify', 1),
  ('demo.government@moozzle.com', 'Government Officer', 'Monthly report available', 'September coverage report for Sabarkantha is ready.', 'info', '/reports', 20),
  ('demo.orgadmin@moozzle.com', 'Organisation Administrator', 'New registration awaiting approval', 'Tharparkar heifer 3582 0471 9663 submitted by Sunita Vaghela.', 'approval', '/approvals', 4),
  ('demo.apiadmin@moozzle.com', 'API Administrator', 'Integration failure detected', 'Sabar Dairy ERP Sync: 1 authentication failure and 1 rate-limit event in the last 2 hours.', 'integration', '/api-clients', 1),
  ('demo.inspector@moozzle.com', 'Livestock Inspector', 'Ownership transfer pending', 'Kankrej bull 9056 1448 2731 → Mahesh Patel awaits your review.', 'approval', '/approvals', 8),
  ('demo.fieldworker@moozzle.com', 'Field Worker', 'Registration submitted', 'Tharparkar heifer 3582 0471 9663 is awaiting approval.', 'sync', '/(tabs)/records', 30),
  ('demo.researcher@moozzle.com', 'Researcher', 'Dataset refreshed', 'De-identified dataset now includes 9 enrolled animals.', 'info', '/research', 12),
  ('demo.admin@moozzle.com', 'Super Administrator', 'Security review', 'Weekly audit summary is ready. Review denied-access events.', 'security', '/audit', 9),
  ('demo.multirole@moozzle.com', 'Veterinarian', 'Assigned case requires attention', 'Jaffarabadi bull 6409 1827 3554 needs a lameness check.', 'alert', '/animal/640918273554', 2)
) as n(email, role, title, message, type, link, ago)
join auth.users u on u.email = n.email
where not exists (select 1 from public.notifications x where x.user_id = u.id and x.title = n.title);


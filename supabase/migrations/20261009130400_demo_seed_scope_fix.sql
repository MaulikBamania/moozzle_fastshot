-- Dudhsagar (Mehsana) animals are registered by the Dudhsagar multi-role staff account, keeping Sabar staff out of that scope.
update public.animals a set user_id = u.id
from auth.users u
where u.email = 'demo.multirole@moozzle.com' and a.moozzle_id in ('517392846051', '640918273554', '829105736248');
update public.biometric_templates t set user_id = a.user_id from public.animals a where a.id = t.animal_id;

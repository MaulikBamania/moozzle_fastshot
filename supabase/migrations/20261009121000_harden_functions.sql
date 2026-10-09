-- owns_animal only needs the caller's own visibility of animals.
create or replace function public.owns_animal(target uuid)
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.animals a where a.id = target and a.user_id = auth.uid());
$$;
revoke execute on function public.owns_animal(uuid) from anon;

-- Trigger-only function: nobody should call it over RPC.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

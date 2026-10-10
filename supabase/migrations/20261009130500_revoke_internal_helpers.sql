-- Internal helpers used only inside checked server functions are not callable over the API.
revoke execute on function public.next_moozzle_id(text), public.can_retire_directly(public.animals),
  public.can_review_animal(public.animals), public.can_manage_api(), public.deny(text) from public, anon, authenticated;

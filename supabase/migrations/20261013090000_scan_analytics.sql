-- Biometric scan analytics: verified ground-truth labels on live scans and a scoped scan log for FAR / FRR / EER reporting.
-- A label records whether the scanned animal really was the matched / claimed / enrolled animal (genuine) or not (impostor).
-- Combined with the engine's accept / reject decision this yields True Match, False Reject, False Accept or True Non-Match.

alter table public.biometric_scans
  add column if not exists ground_truth text check (ground_truth in ('genuine', 'impostor')),
  add column if not exists ground_truth_note text,
  add column if not exists labelled_by uuid references auth.users (id) on delete set null,
  add column if not exists labelled_at timestamptz;
create index if not exists biometric_scans_created_idx on public.biometric_scans (created_at desc);

-- Same visibility as the analytics log: own scans, the organisation's scans for an Organisation Administrator,
-- every scan for a Super Administrator with active privileged access.
create or replace function public.scan_in_analytics_scope(p_user uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  s record;
begin
  select * into s from public.active_scope();
  if s.role is null then return false; end if;
  if p_user = auth.uid() then return true; end if;
  if coalesce(s.privileged, false) then return true; end if;
  if s.role = 'Organisation Administrator' and s.organisation_id is not null then
    return exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.organisation_id = s.organisation_id);
  end if;
  return false;
end;
$$;

create or replace function public.species_bucket(p text) returns text language sql immutable set search_path = public as $$
  select case p when 'buffalo' then 'Buffalo' when 'crossbreed' then 'Crossbred' when 'cattle' then 'Cattle' when 'bull' then 'Cattle' when 'bullock' then 'Cattle' end;
$$;

-- Scan telemetry for the analytics screen. p_days = 0 returns every scan in scope (newest 2000).
create or replace function public.scan_analytics(p_days integer default 30) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s record;
  v_since timestamptz;
  v_rows jsonb;
  v_scope text;
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  if public.perm('view_reports') = 'No' then perform public.deny('view_reports'); end if;
  if p_days is null or p_days < 0 or p_days > 3650 then raise exception 'Choose a date range between 0 and 3650 days.'; end if;
  v_since := case when p_days = 0 then '-infinity'::timestamptz else date_trunc('day', now()) - make_interval(days => greatest(p_days - 1, 0)) end;
  v_scope := case when coalesce(s.privileged, false) then 'platform' when s.role = 'Organisation Administrator' then 'organisation' else 'own' end;

  with scoped as (
    select sc.* from public.biometric_scans sc
    where sc.created_at >= v_since and public.scan_in_analytics_scope(sc.user_id)
    order by sc.created_at desc limit 2000
  ), linked as (
    select sc.*,
      coalesce(sc.matched_moozzle_id, sc.claimed_moozzle_id, sc.candidate_moozzle_ids[1]) as linked_id
    from scoped sc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'created_at', l.created_at,
      'scan_type', l.scan_type,
      'outcome', l.outcome,
      'similarity', l.similarity_score,
      'quality_score', l.quality_score,
      'quality_status', l.quality_status,
      'processing_ms', l.processing_time_ms,
      'templates_searched', l.templates_searched,
      'frames', l.frames,
      'user_role', l.user_role,
      'own', l.user_id = auth.uid(),
      'moozzle_id', case when a.id is null then null when public.can_view_animal(a.id) then a.moozzle_id else public.mask_moozzle_id(a.moozzle_id) end,
      'animal_in_scope', a.id is not null and public.can_view_animal(a.id),
      'species', public.species_bucket(a.species),
      'ground_truth', l.ground_truth,
      'ground_truth_note', l.ground_truth_note,
      'labelled_at', l.labelled_at
    ) order by l.created_at desc), '[]'::jsonb) into v_rows
  from linked l left join public.animals a on a.moozzle_id = l.linked_id;

  return jsonb_build_object(
    'scope', v_scope,
    'since', case when p_days = 0 then null else v_since end,
    'match_threshold', public.setting_num('match_threshold', 0.85),
    'review_threshold', public.setting_num('review_threshold', 0.70),
    'verify_threshold', public.setting_num('verify_threshold', 0.88),
    'scans', v_rows);
end;
$$;

-- Records (or clears, with p_truth null) the verified ground truth of a scan the caller may see.
create or replace function public.label_scan_ground_truth(p_scan uuid, p_truth text, p_note text default '') returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sc record;
  v_label text;
begin
  if public.app_role() is null then perform public.deny('no active role'); end if;
  if p_truth is not null and p_truth not in ('genuine', 'impostor') then raise exception 'Ground truth must be genuine or impostor.'; end if;
  select * into sc from public.biometric_scans where id = p_scan;
  if not found or not public.scan_in_analytics_scope(sc.user_id) then perform public.deny('scan outside your scope'); end if;
  update public.biometric_scans
    set ground_truth = p_truth,
        ground_truth_note = case when p_truth is null then null else nullif(left(trim(coalesce(p_note, '')), 300), '') end,
        labelled_by = case when p_truth is null then null else auth.uid() end,
        labelled_at = case when p_truth is null then null else now() end
    where id = p_scan;
  v_label := case
    when p_truth is null then 'cleared'
    when p_truth = 'genuine' and sc.outcome = 'match' then 'True Match'
    when p_truth = 'genuine' then 'False Reject'
    when sc.outcome = 'match' then 'False Accept'
    else 'True Non-Match' end;
  perform public.write_audit('biometric.ground_truth', coalesce(sc.matched_moozzle_id, sc.claimed_moozzle_id, ''),
    'Scan ground truth ' || v_label || ' · ' || sc.scan_type || ' ' || sc.outcome || ' · similarity ' || to_char(coalesce(sc.similarity_score, 0), 'FM0.000'),
    'success', left(trim(coalesce(p_note, '')), 300));
  return jsonb_build_object('id', p_scan, 'ground_truth', p_truth, 'label', v_label, 'labelled_at', case when p_truth is null then null else now() end);
end;
$$;

revoke execute on function public.scan_in_analytics_scope(uuid), public.scan_analytics(integer), public.label_scan_ground_truth(uuid, text, text) from public, anon;
grant execute on function public.scan_analytics(integer), public.label_scan_ground_truth(uuid, text, text) to authenticated;
grant execute on function public.scan_in_analytics_scope(uuid) to authenticated;

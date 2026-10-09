-- Multi-frame 1:N identification (additional captures) and manual review requests for uncertain scans.

alter table public.biometric_scans
  add column if not exists frames integer not null default 1,
  add column if not exists review_status text not null default 'none' check (review_status in ('none', 'requested', 'resolved')),
  add column if not exists review_note text,
  add column if not exists candidate_moozzle_ids text[] not null default '{}';

drop function if exists public.identify_muzzle(text, text, jsonb, integer);

create or replace function public.identify_muzzle(p_embeddings text[], p_image_path text, p_quality jsonb, p_processing_ms integer)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
  qs extensions.vector[] := '{}';
  t_match numeric := public.setting_num('match_threshold', 0.85);
  t_review numeric := public.setting_num('review_threshold', 0.70);
  searched integer;
  top record;
  v_outcome text;
  cands jsonb := '[]'::jsonb;
  ids text[] := '{}';
  c record;
  v_scan uuid;
  v_target text := '';
  i integer;
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  if public.perm('identify_animal') in ('No', 'Via API scope', 'De-identified', 'Technical only') then
    perform public.write_audit('biometric.identify', '', '1:N scan refused for role', 'denied');
    perform public.deny('identify_animal');
  end if;
  if coalesce(array_length(p_embeddings, 1), 0) < 1 or array_length(p_embeddings, 1) > 5 then raise exception 'Send 1 to 5 muzzle embeddings.'; end if;
  for i in 1..array_length(p_embeddings, 1) loop qs := qs || public.to_embedding(p_embeddings[i]); end loop;
  if not public.capture_path_ok(p_image_path) then perform public.deny('capture path'); end if;
  select count(*) into searched from public.biometric_templates t join public.animals a on a.id = t.animal_id
    where t.embedding is not null and a.status = 'active' and a.approval_status <> 'Rejected';
  for c in select * from public.biometric_candidates(qs, 3) loop
    cands := cands || public.candidate_json(c.animal_id, c.score);
    ids := ids || (select moozzle_id from public.animals where id = c.animal_id);
  end loop;
  select * into top from public.biometric_candidates(qs, 1);
  if top.animal_id is null or top.score < t_review then v_outcome := 'no_match';
  elsif top.score >= t_match then v_outcome := 'match';
  else v_outcome := 'uncertain';
  end if;
  if v_outcome = 'match' and (cands -> 0 ->> 'in_scope')::boolean then v_target := cands -> 0 ->> 'moozzle_id'; end if;
  insert into public.biometric_scans (user_id, user_role, scan_type, captured_image_path, quality_status, quality_score, outcome,
    matched_moozzle_id, similarity_score, processing_time_ms, templates_searched, frames, candidate_moozzle_ids)
  values (auth.uid(), s.role, 'identify', nullif(p_image_path, ''), coalesce(p_quality ->> 'status', ''),
    nullif(p_quality ->> 'score', '')::numeric, v_outcome, nullif(v_target, ''), round(coalesce(top.score, 0)::numeric, 4), p_processing_ms, searched,
    array_length(qs, 1), case when v_outcome = 'no_match' then '{}' else ids end)
  returning id into v_scan;
  perform public.write_audit('biometric.identify', v_target,
    '1:N ' || v_outcome || ' · ' || array_length(qs, 1) || ' frame(s) · top similarity ' || to_char(coalesce(top.score, 0), 'FM0.000') || ' across ' || searched || ' templates',
    case v_outcome when 'match' then 'success' when 'uncertain' then 'requested' else 'no_match' end);
  return jsonb_build_object('scan_id', v_scan, 'outcome', v_outcome, 'top_score', round(coalesce(top.score, 0)::numeric, 4),
    'match_threshold', t_match, 'review_threshold', t_review, 'templates_searched', searched, 'frames', array_length(qs, 1),
    'candidates', case when v_outcome = 'no_match' then '[]'::jsonb else cands end);
end;
$$;

-- Sends an uncertain scan to reviewers who can see the candidate animals.
create or replace function public.request_scan_review(p_scan uuid, p_note text default '') returns void language plpgsql security definer set search_path = public as $$
declare
  sc record;
  a record;
  s record;
begin
  select * into s from public.active_scope();
  select * into sc from public.biometric_scans where id = p_scan;
  if not found or sc.user_id <> auth.uid() then perform public.deny('not your scan'); end if;
  if sc.outcome = 'match' then raise exception 'Confirmed matches do not need manual review.'; end if;
  if sc.review_status = 'requested' then return; end if;
  update public.biometric_scans set review_status = 'requested', review_note = left(trim(coalesce(p_note, '')), 300) where id = p_scan;
  for a in select * from public.animals where moozzle_id = any (sc.candidate_moozzle_ids) loop
    perform public.notify_scope(array['Organisation Administrator', 'Veterinarian', 'Livestock Inspector'], a.organisation_id, a.farm_id, a.district,
      'Biometric manual review requested', 'Uncertain muzzle scan (similarity ' || to_char(sc.similarity_score, 'FM0.000') || ') may be MOOZZLE ID ' || a.moozzle_id,
      'approval', '/animal/' || a.moozzle_id);
  end loop;
  if coalesce(array_length(sc.candidate_moozzle_ids, 1), 0) = 0 then
    perform public.notify_scope(array['Organisation Administrator'], s.organisation_id, null, null, 'Biometric manual review requested',
      'A muzzle scan with no candidate needs review.', 'approval', '/audit');
  end if;
  perform public.write_audit('biometric.identify', '', 'Manual review requested for ' || sc.outcome || ' scan · similarity ' || to_char(sc.similarity_score, 'FM0.000'),
    'requested', left(trim(coalesce(p_note, '')), 300));
end;
$$;

revoke execute on function public.identify_muzzle(text[], text, jsonb, integer), public.request_scan_review(uuid, text) from public, anon;
grant execute on function public.identify_muzzle(text[], text, jsonb, integer), public.request_scan_review(uuid, text) to authenticated;

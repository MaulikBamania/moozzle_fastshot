-- MOOZZLE biometric security upgrade
--  * Versioned, approval-gated threshold configuration with separate 1:1 verification and 1:N identification values.
--  * Immutable audit of every configuration change (old / new values, model version, config version, actor, reason).
--  * Scan log stamped with config version, model version, data tier (laboratory / field pilot / production),
--    capture device / condition and the full ranked candidate list, so 1:N FPIR / FNIR / rank-k rates can be measured.
--  * Acquisition failures (FTA), service outages and failures to enrol (FTE) kept in their own table — never mixed
--    with matching errors.
--  * Controlled test-protocol sessions (calibration / evaluation splits) for labelled genuine / impostor trials.
--  * Possible duplicates at enrolment are held back until the operator submits them for duplicate review.
--  * Manual review queue for REVIEW REQUIRED scans, visible only to authorised reviewers of the candidate animals.

-- ---------- Immutability helpers ----------
create or replace function public.forbid_mutation() returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Audit records are immutable (% on %).', tg_op, tg_table_name using errcode = '42501';
end;
$$;

-- Audit rows may only receive the ON DELETE SET NULL of their actor column (named in TG_ARGV[0]).
create or replace function public.audit_row_immutable() returns trigger language plpgsql set search_path = public as $$
declare
  col text := tg_argv[0];
begin
  if tg_op = 'DELETE' then
    raise exception 'Audit records are immutable.' using errcode = '42501';
  end if;
  if (to_jsonb(new) ->> col) is null and (to_jsonb(old) ->> col) is not null
     and (to_jsonb(new) - col) = (to_jsonb(old) - col) then
    return new;
  end if;
  raise exception 'Audit records are immutable.' using errcode = '42501';
end;
$$;
drop trigger if exists audit_logs_immutable on public.audit_logs;
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function public.audit_row_immutable('user_id');

-- Scans are written only through SECURITY DEFINER functions.
revoke insert, update, delete, truncate on public.biometric_scans from authenticated, anon;

-- ---------- Versioned biometric configuration ----------
create table if not exists public.biometric_configs (
  id uuid primary key default gen_random_uuid(),
  config_version integer not null unique,
  status text not null check (status in ('proposed', 'approved', 'production', 'rejected', 'retired')),
  model_version text not null,
  verify_accept numeric(4, 3) not null check (verify_accept between 0.5 and 0.99),
  verify_review numeric(4, 3) not null check (verify_review between 0.3 and 0.99),
  identify_accept numeric(4, 3) not null check (identify_accept between 0.5 and 0.99),
  identify_review numeric(4, 3) not null check (identify_review between 0.3 and 0.99),
  identify_margin numeric(4, 3) not null default 0.02 check (identify_margin between 0 and 0.2),
  candidate_list_k integer not null default 5 check (candidate_list_k between 1 and 20),
  validation_reference text not null default '',
  reason text not null,
  proposed_by uuid references auth.users (id) on delete set null,
  proposed_role text not null default '',
  proposed_at timestamptz not null default now(),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  approval_note text,
  promoted_by uuid references auth.users (id) on delete set null,
  promoted_at timestamptz,
  retired_at timestamptz,
  check (verify_review < verify_accept),
  check (identify_review < identify_accept)
);
create unique index if not exists biometric_configs_one_production on public.biometric_configs ((true)) where status = 'production';
alter table public.biometric_configs enable row level security;
revoke all on public.biometric_configs from anon, authenticated;

-- Threshold values of a configuration can never change after it is proposed; only its lifecycle status moves.
create or replace function public.biometric_config_values_frozen() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'Biometric configurations cannot be deleted.' using errcode = '42501'; end if;
  if (new.config_version, new.model_version, new.verify_accept, new.verify_review, new.identify_accept, new.identify_review,
      new.identify_margin, new.candidate_list_k, new.validation_reference, new.reason, new.proposed_at)
     is distinct from
     (old.config_version, old.model_version, old.verify_accept, old.verify_review, old.identify_accept, old.identify_review,
      old.identify_margin, old.candidate_list_k, old.validation_reference, old.reason, old.proposed_at)
     or (new.proposed_by is distinct from old.proposed_by and new.proposed_by is not null) then
    raise exception 'Configuration values are immutable; propose a new configuration version instead.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists biometric_configs_frozen on public.biometric_configs;
create trigger biometric_configs_frozen before update or delete on public.biometric_configs
  for each row execute function public.biometric_config_values_frozen();

create table if not exists public.biometric_config_audit (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references public.biometric_configs (id),
  config_version integer not null,
  action text not null check (action in ('seeded', 'proposed', 'approved', 'rejected', 'promoted', 'retired')),
  old_values jsonb,
  new_values jsonb not null,
  model_version text not null,
  actor_id uuid references auth.users (id) on delete set null,
  actor_role text not null default '',
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists biometric_config_audit_created_idx on public.biometric_config_audit (created_at desc);
alter table public.biometric_config_audit enable row level security;
revoke all on public.biometric_config_audit from anon, authenticated;
drop trigger if exists biometric_config_audit_immutable on public.biometric_config_audit;
create trigger biometric_config_audit_immutable before update or delete on public.biometric_config_audit
  for each row execute function public.audit_row_immutable('actor_id');

-- Version 1 = the thresholds already running in production (no behaviour change for 1:1; 1:N gains the margin rule).
insert into public.biometric_configs (config_version, status, model_version, verify_accept, verify_review, identify_accept, identify_review,
  identify_margin, candidate_list_k, validation_reference, reason, proposed_role, approved_at, approval_note, promoted_at)
select 1, 'production',
  coalesce((select value #>> '{}' from public.platform_settings where key = 'model_version'), 'MOOZZLE-TextureHOG-v1'),
  coalesce((select (value #>> '{}')::numeric from public.platform_settings where key = 'verify_threshold'), 0.88),
  coalesce((select (value #>> '{}')::numeric from public.platform_settings where key = 'review_threshold'), 0.70),
  coalesce((select (value #>> '{}')::numeric from public.platform_settings where key = 'match_threshold'), 0.85),
  coalesce((select (value #>> '{}')::numeric from public.platform_settings where key = 'review_threshold'), 0.70),
  0.02, 5, 'Pre-validation baseline (uncalibrated). Not a validated performance claim.',
  'Initial configuration carried over from platform settings at the security upgrade.', 'system', now(),
  'Baseline carried over; must be re-validated before any performance claim.', now()
where not exists (select 1 from public.biometric_configs);

insert into public.biometric_config_audit (config_id, config_version, action, old_values, new_values, model_version, actor_role, reason)
select c.id, c.config_version, 'seeded', null,
  jsonb_build_object('verify_accept', c.verify_accept, 'verify_review', c.verify_review, 'identify_accept', c.identify_accept,
    'identify_review', c.identify_review, 'identify_margin', c.identify_margin, 'candidate_list_k', c.candidate_list_k),
  c.model_version, 'system', c.reason
from public.biometric_configs c
where c.config_version = 1 and not exists (select 1 from public.biometric_config_audit a where a.config_id = c.id);

create or replace function public.biometric_active_config() returns public.biometric_configs language plpgsql stable security definer set search_path = public as $$
declare
  c public.biometric_configs;
begin
  select * into c from public.biometric_configs where status = 'production';
  if not found then raise exception 'No production biometric configuration is approved. Biometric matching is disabled.'; end if;
  return c;
end;
$$;

create or replace function public.config_json(c public.biometric_configs) returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('verify_accept', c.verify_accept, 'verify_review', c.verify_review, 'identify_accept', c.identify_accept,
    'identify_review', c.identify_review, 'identify_margin', c.identify_margin, 'candidate_list_k', c.candidate_list_k,
    'model_version', c.model_version);
$$;

-- Researchers (biometric research role) may propose; only a privileged Super Administrator may approve / promote.
create or replace function public.can_propose_biometric_config() returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  s record;
begin
  select * into s from public.active_scope();
  return s.role = 'Researcher' or (s.role = 'Super Administrator' and coalesce(s.privileged, false));
end;
$$;

create or replace function public.can_view_biometric_governance() returns boolean language sql stable security definer set search_path = public as $$
  select public.app_role() in ('Super Administrator', 'Researcher', 'Organisation Administrator', 'Government Officer');
$$;

create or replace function public.propose_biometric_config(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s record;
  cur public.biometric_configs;
  c public.biometric_configs;
  v_reason text := trim(coalesce(p ->> 'reason', ''));
  v_ref text := trim(coalesce(p ->> 'validation_reference', ''));
  v_model text := trim(coalesce(p ->> 'model_version', ''));
  v_next integer;
begin
  select * into s from public.active_scope();
  if not public.can_propose_biometric_config() then
    perform public.write_audit('biometric.config_propose', '', 'Threshold proposal refused for role', 'denied');
    perform public.deny('propose biometric thresholds');
  end if;
  if length(v_reason) < 15 then raise exception 'Give a reason of at least 15 characters.'; end if;
  if length(v_ref) < 5 then raise exception 'Reference the validation test report (protocol / session ID) that supports this configuration.'; end if;
  select * into cur from public.biometric_configs where status = 'production';
  if v_model = '' then v_model := coalesce(cur.model_version, 'MOOZZLE-TextureHOG-v1'); end if;
  if length(v_model) > 60 then raise exception 'Model version is too long.'; end if;
  select coalesce(max(config_version), 0) + 1 into v_next from public.biometric_configs;
  begin
    insert into public.biometric_configs (config_version, status, model_version, verify_accept, verify_review, identify_accept, identify_review,
      identify_margin, candidate_list_k, validation_reference, reason, proposed_by, proposed_role)
    values (v_next, 'proposed', v_model,
      (p ->> 'verify_accept')::numeric, (p ->> 'verify_review')::numeric,
      (p ->> 'identify_accept')::numeric, (p ->> 'identify_review')::numeric,
      coalesce(nullif(p ->> 'identify_margin', '')::numeric, 0.02), coalesce(nullif(p ->> 'candidate_list_k', '')::int, 5),
      left(v_ref, 300), left(v_reason, 500), auth.uid(), s.role)
    returning * into c;
  exception
    when check_violation then raise exception 'Thresholds must be within 0.50–0.99, each review threshold below its accept threshold, margin 0–0.20 and k 1–20.';
    when invalid_text_representation or numeric_value_out_of_range or not_null_violation then raise exception 'Enter all four thresholds as numbers.';
  end;
  insert into public.biometric_config_audit (config_id, config_version, action, old_values, new_values, model_version, actor_id, actor_role, reason)
  values (c.id, c.config_version, 'proposed', case when cur.id is not null then public.config_json(cur) end, public.config_json(c), c.model_version, auth.uid(), s.role, v_reason);
  perform public.write_audit('biometric.config_propose', '', 'Proposed biometric config v' || c.config_version || ' · 1:1 ' || c.verify_accept || '/' || c.verify_review
    || ' · 1:N ' || c.identify_accept || '/' || c.identify_review || ' · ' || c.model_version, 'requested', v_reason);
  perform public.notify_scope(array['Super Administrator'], null, null, null, 'Biometric configuration awaiting approval',
    'Config v' || c.config_version || ' proposed by ' || s.role || '. Testing evidence: ' || left(v_ref, 80), 'security', '/performance');
  return jsonb_build_object('id', c.id, 'config_version', c.config_version, 'status', c.status);
end;
$$;

create or replace function public.review_biometric_config(p_id uuid, p_decision text, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s record;
  c public.biometric_configs;
  v_note text := trim(coalesce(p_note, ''));
begin
  select * into s from public.active_scope();
  if not (s.role = 'Super Administrator' and coalesce(s.privileged, false)) then
    perform public.write_audit('biometric.config_review', '', 'Config approval refused for role', 'denied');
    perform public.deny('approve biometric configurations');
  end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Decision must be approve or reject.'; end if;
  if length(v_note) < 15 then raise exception 'Record the test evidence reviewed (at least 15 characters).'; end if;
  select * into c from public.biometric_configs where id = p_id for update;
  if not found then raise exception 'Unknown configuration.'; end if;
  if c.status <> 'proposed' then raise exception 'Only proposed configurations can be reviewed (this one is %).', c.status; end if;
  if c.proposed_by = auth.uid() then raise exception 'Separation of duties: a configuration must be approved by someone other than its proposer.'; end if;
  update public.biometric_configs set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
    approved_by = auth.uid(), approved_at = now(), approval_note = left(v_note, 500)
  where id = p_id returning * into c;
  insert into public.biometric_config_audit (config_id, config_version, action, old_values, new_values, model_version, actor_id, actor_role, reason)
  values (c.id, c.config_version, case when p_decision = 'approve' then 'approved' else 'rejected' end, null, public.config_json(c), c.model_version, auth.uid(), s.role, v_note);
  perform public.write_audit('biometric.config_review', '', 'Config v' || c.config_version || ' ' || c.status, 'success', v_note);
  if c.proposed_by is not null then
    perform public.notify_user(c.proposed_by, c.proposed_role, 'Biometric configuration ' || c.status, 'Config v' || c.config_version || ' was ' || c.status || '.', 'security', '/performance');
  end if;
  return jsonb_build_object('id', c.id, 'config_version', c.config_version, 'status', c.status);
end;
$$;

create or replace function public.promote_biometric_config(p_id uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s record;
  c public.biometric_configs;
  cur public.biometric_configs;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  select * into s from public.active_scope();
  if not (s.role = 'Super Administrator' and coalesce(s.privileged, false)) then
    perform public.write_audit('biometric.config_promote', '', 'Config promotion refused for role', 'denied');
    perform public.deny('promote biometric configurations');
  end if;
  if length(v_reason) < 15 then raise exception 'Give a promotion reason of at least 15 characters.'; end if;
  select * into c from public.biometric_configs where id = p_id for update;
  if not found then raise exception 'Unknown configuration.'; end if;
  if c.status <> 'approved' then raise exception 'Only an approved configuration can be promoted to production (this one is %).', c.status; end if;
  select * into cur from public.biometric_configs where status = 'production' for update;
  if cur.id is not null then
    update public.biometric_configs set status = 'retired', retired_at = now() where id = cur.id;
    insert into public.biometric_config_audit (config_id, config_version, action, old_values, new_values, model_version, actor_id, actor_role, reason)
    values (cur.id, cur.config_version, 'retired', null, public.config_json(cur), cur.model_version, auth.uid(), s.role, 'Superseded by v' || c.config_version || ': ' || v_reason);
  end if;
  update public.biometric_configs set status = 'production', promoted_by = auth.uid(), promoted_at = now() where id = p_id returning * into c;
  -- Mirror for legacy readers; these keys are no longer editable through update_setting.
  update public.platform_settings set value = to_jsonb(c.identify_accept), updated_at = now(), updated_by = auth.uid() where key = 'match_threshold';
  update public.platform_settings set value = to_jsonb(c.verify_accept), updated_at = now(), updated_by = auth.uid() where key = 'verify_threshold';
  update public.platform_settings set value = to_jsonb(c.identify_review), updated_at = now(), updated_by = auth.uid() where key = 'review_threshold';
  update public.platform_settings set value = to_jsonb(c.model_version), updated_at = now(), updated_by = auth.uid() where key = 'model_version';
  insert into public.biometric_config_audit (config_id, config_version, action, old_values, new_values, model_version, actor_id, actor_role, reason)
  values (c.id, c.config_version, 'promoted', case when cur.id is not null then public.config_json(cur) end, public.config_json(c), c.model_version, auth.uid(), s.role, v_reason);
  perform public.write_audit('biometric.config_promote', '', 'Config v' || c.config_version || ' promoted to production'
    || case when cur.id is not null then ' (replaces v' || cur.config_version || ')' else '' end, 'success', v_reason);
  return jsonb_build_object('id', c.id, 'config_version', c.config_version, 'status', c.status);
end;
$$;

create or replace function public.biometric_config_history() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_configs jsonb;
  v_audit jsonb;
begin
  if not public.can_view_biometric_governance() then perform public.deny('view biometric configuration history'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'config_version', c.config_version, 'status', c.status, 'model_version', c.model_version,
      'verify_accept', c.verify_accept, 'verify_review', c.verify_review, 'identify_accept', c.identify_accept, 'identify_review', c.identify_review,
      'identify_margin', c.identify_margin, 'candidate_list_k', c.candidate_list_k, 'validation_reference', c.validation_reference, 'reason', c.reason,
      'proposed_by_name', coalesce(pp.full_name, 'System'), 'proposed_role', c.proposed_role, 'proposed_at', c.proposed_at,
      'own_proposal', c.proposed_by = auth.uid(),
      'approved_by_name', pa.full_name, 'approved_at', c.approved_at, 'approval_note', c.approval_note,
      'promoted_at', c.promoted_at, 'retired_at', c.retired_at
    ) order by c.config_version desc), '[]'::jsonb) into v_configs
  from public.biometric_configs c
  left join public.profiles pp on pp.id = c.proposed_by
  left join public.profiles pa on pa.id = c.approved_by;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'config_version', a.config_version, 'action', a.action, 'old_values', a.old_values, 'new_values', a.new_values,
      'model_version', a.model_version, 'actor_name', coalesce(pr.full_name, 'System'), 'actor_id', a.actor_id, 'actor_role', a.actor_role,
      'reason', a.reason, 'created_at', a.created_at
    ) order by a.created_at desc), '[]'::jsonb) into v_audit
  from (select * from public.biometric_config_audit order by created_at desc limit 300) a
  left join public.profiles pr on pr.id = a.actor_id;
  return jsonb_build_object('configs', v_configs, 'audit', v_audit,
    'can_propose', public.can_propose_biometric_config(),
    'can_approve', exists (select 1 from public.active_scope() x where x.role = 'Super Administrator' and coalesce(x.privileged, false)));
end;
$$;

-- Thresholds and model version are now governed by the configuration workflow, not free-form settings.
create or replace function public.update_setting(p_key text, p_value jsonb, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare
  s record;
  st record;
  v_species text;
  v_num numeric;
  v_young numeric;
  v_adult numeric;
begin
  select * into s from public.active_scope();
  select * into st from public.platform_settings where key = p_key;
  if not found then raise exception 'Unknown setting.'; end if;
  if p_key in ('biometric_threshold', 'model_version', 'match_threshold', 'verify_threshold', 'review_threshold') then
    perform public.write_audit('admin.setting_change', '', 'Direct threshold/model edit refused: ' || p_key, 'denied');
    raise exception 'Biometric thresholds and model version are changed only through a proposed, tested and approved configuration version (Performance → Thresholds).';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Give a reason of at least 10 characters.'; end if;
  if p_key = 'api_default_rate_limit' and s.role = 'API Administrator' then
    null;
  elsif public.perm('platform_settings') <> 'Full' or not coalesce(s.privileged, false) then
    perform public.deny('platform settings');
  end if;
  if p_key like 'age_group_%_from_months_%' then
    if jsonb_typeof(p_value) <> 'number' then raise exception 'Enter a whole number of months.'; end if;
    v_num := (p_value #>> '{}')::numeric;
    if v_num <> trunc(v_num) or v_num < 1 or v_num > 300 then raise exception 'Age thresholds must be whole months between 1 and 300.'; end if;
    v_species := substring(p_key from 'age_group_(?:young|adult)_from_months_(.*)$');
    v_young := case when p_key like 'age_group_young_%' then v_num else public.setting_num('age_group_young_from_months_' || v_species, null) end;
    v_adult := case when p_key like 'age_group_adult_%' then v_num else public.setting_num('age_group_adult_from_months_' || v_species, null) end;
    if v_young is null or v_adult is null or v_young >= v_adult then
      raise exception 'The YOUNG threshold must be lower than the ADULT threshold so the age groups do not overlap.';
    end if;
  end if;
  update public.platform_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform public.write_audit('admin.setting_change', '', p_key || ': ' || (st.value #>> '{}') || ' → ' || (p_value #>> '{}'), 'success', trim(p_reason));
end;
$$;

-- ---------- Test protocol sessions (controlled, labelled trials) ----------
create table if not exists public.biometric_test_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  protocol_reference text not null,
  data_source text not null check (data_source in ('laboratory', 'field_pilot')),
  dataset_split text not null check (dataset_split in ('calibration', 'evaluation')),
  device_model text not null default '',
  capture_condition text not null default '',
  notes text not null default '',
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_role text not null default '',
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists biometric_test_sessions_one_open on public.biometric_test_sessions (created_by) where status = 'open';
alter table public.biometric_test_sessions enable row level security;
revoke all on public.biometric_test_sessions from anon, authenticated;

create or replace function public.can_run_test_protocol() returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  s record;
begin
  select * into s from public.active_scope();
  return s.role in ('Researcher', 'Organisation Administrator') or (s.role = 'Super Administrator' and coalesce(s.privileged, false));
end;
$$;

create or replace function public.open_test_session(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s record;
  v_row public.biometric_test_sessions;
begin
  select * into s from public.active_scope();
  if not public.can_run_test_protocol() then perform public.deny('run biometric test protocols'); end if;
  if length(trim(coalesce(p ->> 'name', ''))) < 3 then raise exception 'Name the test session.'; end if;
  if length(trim(coalesce(p ->> 'protocol_reference', ''))) < 3 then raise exception 'Reference the documented test protocol.'; end if;
  if exists (select 1 from public.biometric_test_sessions where created_by = auth.uid() and status = 'open') then
    raise exception 'Close your open test session before starting another.';
  end if;
  begin
    insert into public.biometric_test_sessions (name, protocol_reference, data_source, dataset_split, device_model, capture_condition, notes, created_role)
    values (left(trim(p ->> 'name'), 120), left(trim(p ->> 'protocol_reference'), 120), p ->> 'data_source', p ->> 'dataset_split',
      left(trim(coalesce(p ->> 'device_model', '')), 80), left(trim(coalesce(p ->> 'capture_condition', '')), 80), left(trim(coalesce(p ->> 'notes', '')), 300), s.role)
    returning * into v_row;
  exception when check_violation or not_null_violation then
    raise exception 'Choose the data tier (laboratory or field pilot) and dataset split (calibration or evaluation).';
  end;
  perform public.write_audit('biometric.test_session', '', 'Opened ' || v_row.data_source || ' ' || v_row.dataset_split || ' session “' || v_row.name || '” · protocol ' || v_row.protocol_reference, 'success');
  return to_jsonb(v_row);
end;
$$;

create or replace function public.close_test_session(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.biometric_test_sessions;
begin
  update public.biometric_test_sessions set status = 'closed', closed_at = now()
  where id = p_id and created_by = auth.uid() and status = 'open' returning * into v_row;
  if not found then raise exception 'No open test session of yours with this ID.'; end if;
  perform public.write_audit('biometric.test_session', '', 'Closed session “' || v_row.name || '”', 'success');
end;
$$;

create or replace function public.my_test_session() returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(t) from public.biometric_test_sessions t where t.created_by = auth.uid() and t.status = 'open' limit 1;
$$;

-- ---------- Scan log extensions ----------
alter table public.biometric_scans
  add column if not exists config_version integer,
  add column if not exists model_version text,
  add column if not exists data_source text not null default 'production',
  add column if not exists test_session_id uuid references public.biometric_test_sessions (id) on delete set null,
  add column if not exists candidate_scores numeric[] not null default '{}',
  add column if not exists device_model text not null default '',
  add column if not exists capture_condition text not null default '',
  add column if not exists decision_reason text not null default '',
  add column if not exists mated boolean,
  add column if not exists true_moozzle_id text,
  add column if not exists mate_rank integer,
  add column if not exists reviewed_by uuid references auth.users (id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_decision text,
  add column if not exists review_confirmed_moozzle_id text,
  add column if not exists review_resolution_note text;
do $$ begin
  alter table public.biometric_scans add constraint biometric_scans_data_source_check check (data_source in ('production', 'field_pilot', 'laboratory'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.biometric_scans add constraint biometric_scans_review_decision_check check (review_decision is null or review_decision in ('confirmed', 'rejected', 'inconclusive'));
exception when duplicate_object then null; end $$;
update public.biometric_scans set config_version = 1, model_version = coalesce(model_version, model_name) where config_version is null;
create index if not exists biometric_scans_review_idx on public.biometric_scans (review_status, created_at desc);

-- ---------- Acquisition failures (FTA), service outages and failures to enrol (FTE) ----------
create table if not exists public.biometric_acquisition_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_role text not null default '',
  operation text not null check (operation in ('identify', 'verify', 'enrol')),
  event_type text not null check (event_type in ('failure_to_acquire', 'service_unavailable', 'failure_to_enrol')),
  reason_code text not null default '',
  quality_status text not null default '',
  quality_score numeric(4, 3),
  frames_attempted integer not null default 1,
  frames_accepted integer not null default 0,
  device_model text not null default '',
  capture_condition text not null default '',
  model_version text,
  config_version integer,
  data_source text not null default 'production' check (data_source in ('production', 'field_pilot', 'laboratory')),
  test_session_id uuid references public.biometric_test_sessions (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists biometric_acq_created_idx on public.biometric_acquisition_events (created_at desc);
alter table public.biometric_acquisition_events enable row level security;
revoke all on public.biometric_acquisition_events from anon, authenticated;
drop trigger if exists biometric_acq_immutable on public.biometric_acquisition_events;
create trigger biometric_acq_immutable before update on public.biometric_acquisition_events
  for each row execute function public.forbid_mutation();
-- (deletes only happen through the user ON DELETE CASCADE)

create or replace function public.log_acquisition_event(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare
  s record;
  c public.biometric_configs;
  t public.biometric_test_sessions;
  v_id uuid;
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  select * into c from public.biometric_configs where status = 'production';
  select * into t from public.biometric_test_sessions where created_by = auth.uid() and status = 'open';
  begin
    insert into public.biometric_acquisition_events (user_role, operation, event_type, reason_code, quality_status, quality_score, frames_attempted, frames_accepted,
      device_model, capture_condition, model_version, config_version, data_source, test_session_id)
    values (s.role, p ->> 'operation', p ->> 'event_type', left(coalesce(p ->> 'reason_code', ''), 60), left(coalesce(p ->> 'quality_status', ''), 60),
      least(greatest(nullif(p ->> 'quality_score', '')::numeric, 0), 1), greatest(coalesce(nullif(p ->> 'frames_attempted', '')::int, 1), 0),
      greatest(coalesce(nullif(p ->> 'frames_accepted', '')::int, 0), 0), left(coalesce(p ->> 'device_model', ''), 60), left(coalesce(p ->> 'capture_condition', ''), 30),
      c.model_version, c.config_version, coalesce(t.data_source, 'production'), t.id)
    returning id into v_id;
  exception when check_violation or not_null_violation then
    raise exception 'Unknown acquisition event type or operation.';
  end;
  return v_id;
end;
$$;

-- Shared quality gate: a frame that failed the pre-check is never compared.
create or replace function public.require_good_capture(p_quality jsonb, c public.biometric_configs) returns void language plpgsql stable set search_path = public as $$
begin
  if coalesce(p_quality ->> 'status', '') not like 'GOOD IMAGE%' then
    raise exception 'IMAGE QUALITY INSUFFICIENT: the frame failed the quality pre-check and was not compared.';
  end if;
  if coalesce(p_quality ->> 'model', c.model_version) <> c.model_version then
    raise exception 'This app computes % templates but production requires %. Update the app before scanning.', p_quality ->> 'model', c.model_version;
  end if;
end;
$$;

create or replace function public.condition_of(p_quality jsonb) returns text language sql immutable set search_path = public as $$
  select left(coalesce(p_quality ->> 'condition', ''), 30);
$$;

-- ---------- 1:N identification ----------
create or replace function public.identify_muzzle(p_embeddings text[], p_image_path text, p_quality jsonb, p_processing_ms integer)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
  cfg public.biometric_configs := public.biometric_active_config();
  t public.biometric_test_sessions;
  qs extensions.vector[] := '{}';
  searched integer;
  gallery integer;
  v_outcome text;
  v_reason text;
  cands jsonb := '[]'::jsonb;
  ids text[] := '{}';
  scores numeric[] := '{}';
  c record;
  v_scan uuid;
  v_target text := '';
  v_top numeric := 0;
  v_second numeric := null;
  i integer;
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  if public.perm('identify_animal') in ('No', 'Via API scope', 'De-identified', 'Technical only') then
    perform public.write_audit('biometric.identify', '', '1:N scan refused for role', 'denied');
    perform public.deny('identify_animal');
  end if;
  perform public.require_good_capture(p_quality, cfg);
  if coalesce(array_length(p_embeddings, 1), 0) < 1 or array_length(p_embeddings, 1) > 5 then raise exception 'Send 1 to 5 muzzle embeddings.'; end if;
  for i in 1..array_length(p_embeddings, 1) loop qs := qs || public.to_embedding(p_embeddings[i]); end loop;
  if not public.capture_path_ok(p_image_path) then perform public.deny('capture path'); end if;
  select * into t from public.biometric_test_sessions where created_by = auth.uid() and status = 'open';
  select count(*), count(distinct t2.animal_id) into searched, gallery from public.biometric_templates t2 join public.animals a on a.id = t2.animal_id
    where t2.embedding is not null and a.status = 'active' and a.approval_status <> 'Rejected';
  for c in select * from public.biometric_candidates(qs, cfg.candidate_list_k) loop
    cands := cands || public.candidate_json(c.animal_id, c.score);
    ids := ids || (select moozzle_id from public.animals where id = c.animal_id);
    scores := scores || round(c.score::numeric, 4);
  end loop;
  if coalesce(array_length(scores, 1), 0) >= 1 then v_top := scores[1]; end if;
  if coalesce(array_length(scores, 1), 0) >= 2 then v_second := scores[2]; end if;

  -- Acceptance rules: top ≥ 1:N accept AND clear of the runner-up by the approved margin.
  if array_length(scores, 1) is null or v_top < cfg.identify_review then
    v_outcome := 'no_match'; v_reason := 'below_review_threshold';
  elsif v_top >= cfg.identify_accept and (v_second is null or v_top - v_second >= cfg.identify_margin) then
    v_outcome := 'match'; v_reason := 'accepted';
  elsif v_top >= cfg.identify_accept then
    v_outcome := 'uncertain'; v_reason := 'ambiguous_margin';
  else
    v_outcome := 'uncertain'; v_reason := 'between_thresholds';
  end if;
  if v_outcome = 'match' and (cands -> 0 ->> 'in_scope')::boolean then v_target := cands -> 0 ->> 'moozzle_id'; end if;

  insert into public.biometric_scans (user_id, user_role, scan_type, captured_image_path, quality_status, quality_score, outcome,
    matched_moozzle_id, similarity_score, processing_time_ms, templates_searched, frames, candidate_moozzle_ids, candidate_scores,
    config_version, model_version, model_name, data_source, test_session_id, device_model, capture_condition, decision_reason)
  values (auth.uid(), s.role, 'identify', nullif(p_image_path, ''), coalesce(p_quality ->> 'status', ''),
    nullif(p_quality ->> 'score', '')::numeric, v_outcome, nullif(v_target, ''), round(v_top, 4), p_processing_ms, searched,
    array_length(qs, 1), ids, scores, cfg.config_version, cfg.model_version, cfg.model_version, coalesce(t.data_source, 'production'), t.id,
    left(coalesce(p_quality ->> 'device', ''), 60), public.condition_of(p_quality), v_reason)
  returning id into v_scan;
  perform public.write_audit('biometric.identify', v_target,
    '1:N ' || v_outcome || ' (' || v_reason || ') · cfg v' || cfg.config_version || ' · ' || cfg.model_version || ' · ' || array_length(qs, 1)
    || ' frame(s) · top ' || to_char(v_top, 'FM0.000') || ' · gallery ' || gallery || ' animals / ' || searched || ' templates',
    case v_outcome when 'match' then 'success' when 'uncertain' then 'requested' else 'no_match' end);
  return jsonb_build_object('scan_id', v_scan, 'outcome', v_outcome, 'decision_reason', v_reason, 'top_score', round(v_top, 4),
    'second_score', v_second, 'match_threshold', cfg.identify_accept, 'review_threshold', cfg.identify_review, 'margin', cfg.identify_margin,
    'candidate_list_k', cfg.candidate_list_k, 'config_version', cfg.config_version, 'model_version', cfg.model_version,
    'templates_searched', searched, 'gallery_size', gallery, 'frames', array_length(qs, 1), 'data_source', coalesce(t.data_source, 'production'),
    'candidates', case when v_outcome = 'no_match' then '[]'::jsonb else cands end);
end;
$$;

-- ---------- 1:1 verification ----------
create or replace function public.verify_muzzle(p_moozzle_id text, p_embedding text, p_image_path text, p_quality jsonb, p_processing_ms integer)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
  cfg public.biometric_configs := public.biometric_active_config();
  t public.biometric_test_sessions;
  q extensions.vector;
  a record;
  v_score double precision;
  n integer;
  v_outcome text;
  v_reason text;
  v_scan uuid;
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  perform public.require_good_capture(p_quality, cfg);
  q := public.to_embedding(p_embedding);
  select * into a from public.animals where moozzle_id = regexp_replace(coalesce(p_moozzle_id, ''), '\s', '', 'g');
  if not found or not public.can_view_animal(a.id) then
    perform public.write_audit('biometric.verify', '', '1:1 verification for an unknown or out-of-scope ID', 'denied');
    raise exception 'No animal with this MOOZZLE ID is in your authorised records.';
  end if;
  if not public.capture_path_ok(p_image_path) then perform public.deny('capture path'); end if;
  select * into t from public.biometric_test_sessions where created_by = auth.uid() and status = 'open';
  select max(1 - (bt.embedding <=> q)), count(*) into v_score, n from public.biometric_templates bt where bt.animal_id = a.id and bt.embedding is not null;
  if n = 0 then
    raise exception 'MOOZZLE ID % has no live-engine biometric template yet. Re-enrol its muzzle images before 1:1 verification.', a.moozzle_id;
  end if;
  if v_score >= cfg.verify_accept then v_outcome := 'match'; v_reason := 'accepted';
  elsif v_score >= cfg.verify_review then v_outcome := 'uncertain'; v_reason := 'between_thresholds';
  else v_outcome := 'no_match'; v_reason := 'below_review_threshold';
  end if;
  insert into public.biometric_scans (user_id, user_role, scan_type, captured_image_path, quality_status, quality_score, outcome,
    matched_moozzle_id, claimed_moozzle_id, similarity_score, processing_time_ms, templates_searched, candidate_moozzle_ids, candidate_scores,
    config_version, model_version, model_name, data_source, test_session_id, device_model, capture_condition, decision_reason)
  values (auth.uid(), s.role, 'verify', nullif(p_image_path, ''), coalesce(p_quality ->> 'status', ''), nullif(p_quality ->> 'score', '')::numeric,
    v_outcome, case when v_outcome = 'match' then a.moozzle_id end, a.moozzle_id, round(v_score::numeric, 4), p_processing_ms, n,
    array[a.moozzle_id], array[round(v_score::numeric, 4)], cfg.config_version, cfg.model_version, cfg.model_version,
    coalesce(t.data_source, 'production'), t.id, left(coalesce(p_quality ->> 'device', ''), 60), public.condition_of(p_quality), v_reason)
  returning id into v_scan;
  perform public.write_audit('biometric.verify', a.moozzle_id, '1:1 ' || v_outcome || ' · cfg v' || cfg.config_version || ' · ' || cfg.model_version
    || ' · similarity ' || to_char(v_score, 'FM0.000') || ' vs ' || n || ' templates',
    case v_outcome when 'match' then 'success' when 'uncertain' then 'requested' else 'no_match' end);
  return jsonb_build_object('scan_id', v_scan, 'outcome', v_outcome, 'decision_reason', v_reason, 'score', round(v_score::numeric, 4),
    'verify_threshold', cfg.verify_accept, 'review_threshold', cfg.verify_review, 'config_version', cfg.config_version,
    'model_version', cfg.model_version, 'data_source', coalesce(t.data_source, 'production'), 'templates_compared', n,
    'animal', public.candidate_json(a.id, v_score));
end;
$$;

-- ---------- Manual review queue ----------
create or replace function public.can_review_scan_candidate(a public.animals) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  s record;
begin
  select * into s from public.active_scope();
  if s.role is null then return false; end if;
  if public.can_review_animal(a) then return true; end if;
  return s.role in ('Veterinarian', 'Livestock Inspector') and public.can_view_animal(a.id);
end;
$$;

create or replace function public.can_review_scan(p_scan uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.biometric_scans sc join public.animals a on a.moozzle_id = any (sc.candidate_moozzle_ids)
    where sc.id = p_scan and sc.user_id <> auth.uid() and sc.review_status in ('requested', 'resolved') and public.can_review_scan_candidate(a)
  );
$$;

-- Reviewers may open the probe capture of a scan they are authorised to review.
create or replace function public.can_view_capture(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select split_part(p_name, '/', 1) = auth.uid()::text
    or exists (select 1 from public.biometric_templates t where t.image_path = p_name and public.can_view_animal(t.animal_id))
    or exists (select 1 from public.animals a where a.reference_image_path = p_name and public.can_view_animal(a.id))
    or exists (select 1 from public.biometric_scans sc where sc.captured_image_path = p_name and public.can_review_scan(sc.id));
$$;

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
  if sc.review_status <> 'none' then return; end if;
  update public.biometric_scans set review_status = 'requested', review_note = left(trim(coalesce(p_note, '')), 300) where id = p_scan;
  for a in select * from public.animals where moozzle_id = any (sc.candidate_moozzle_ids) loop
    perform public.notify_scope(array['Organisation Administrator', 'Veterinarian', 'Livestock Inspector'], a.organisation_id, a.farm_id, a.district,
      'Biometric match review required', 'Possible match (similarity ' || to_char(sc.similarity_score, 'FM0.000') || ') awaiting reviewer decision.',
      'approval', '/approvals');
  end loop;
  if coalesce(array_length(sc.candidate_moozzle_ids, 1), 0) = 0 then
    perform public.notify_scope(array['Organisation Administrator'], s.organisation_id, null, null, 'Biometric review requested',
      'A muzzle scan with no candidate needs review.', 'approval', '/approvals');
  end if;
  perform public.write_audit('biometric.review_request', '', 'Review requested for ' || sc.scan_type || ' ' || sc.outcome || ' scan · cfg v'
    || coalesce(sc.config_version::text, '?') || ' · similarity ' || to_char(sc.similarity_score, 'FM0.000'), 'requested', left(trim(coalesce(p_note, '')), 300));
end;
$$;

create or replace function public.scan_review_queue() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_rows jsonb;
begin
  if public.app_role() is null then perform public.deny('no active role'); end if;
  select coalesce(jsonb_agg(row_json order by created_at desc), '[]'::jsonb) into v_rows from (
    select sc.created_at, jsonb_build_object(
      'id', sc.id, 'created_at', sc.created_at, 'scan_type', sc.scan_type, 'outcome', sc.outcome, 'decision_reason', sc.decision_reason,
      'similarity', sc.similarity_score, 'quality_score', sc.quality_score, 'frames', sc.frames, 'requester_role', sc.user_role,
      'config_version', sc.config_version, 'model_version', sc.model_version, 'data_source', sc.data_source,
      'probe_image_path', sc.captured_image_path, 'review_status', sc.review_status, 'review_note', sc.review_note,
      'review_decision', sc.review_decision, 'reviewed_at', sc.reviewed_at, 'review_resolution_note', sc.review_resolution_note,
      'review_confirmed_moozzle_id', sc.review_confirmed_moozzle_id,
      'candidates', (
        select coalesce(jsonb_agg(public.candidate_json(a.id, coalesce(sc.candidate_scores[x.ord], 0)) || jsonb_build_object('rank', x.ord,
          'can_decide', public.can_review_scan_candidate(a)) order by x.ord), '[]'::jsonb)
        from unnest(sc.candidate_moozzle_ids) with ordinality as x (mid, ord) join public.animals a on a.moozzle_id = x.mid
      )
    ) as row_json
    from public.biometric_scans sc
    where sc.review_status in ('requested', 'resolved') and public.can_review_scan(sc.id)
      and (sc.review_status = 'requested' or sc.reviewed_at > now() - interval '30 days')
    order by sc.created_at desc limit 100
  ) q;
  return v_rows;
end;
$$;

create or replace function public.resolve_scan_review(p_scan uuid, p_decision text, p_moozzle_id text, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s record;
  sc record;
  a public.animals;
  v_note text := trim(coalesce(p_note, ''));
  v_mid text := regexp_replace(coalesce(p_moozzle_id, ''), '\s', '', 'g');
begin
  select * into s from public.active_scope();
  if p_decision not in ('confirmed', 'rejected', 'inconclusive') then raise exception 'Decision must be confirmed, rejected or inconclusive.'; end if;
  if length(v_note) < 10 then raise exception 'Explain the decision (at least 10 characters).'; end if;
  select * into sc from public.biometric_scans where id = p_scan for update;
  if not found or not public.can_review_scan(p_scan) then
    perform public.write_audit('biometric.review_decision', '', 'Review decision refused (not an authorised reviewer)', 'denied');
    perform public.deny('review this scan');
  end if;
  if sc.review_status <> 'requested' then raise exception 'This review has already been resolved.'; end if;
  if p_decision = 'confirmed' then
    if not (v_mid = any (sc.candidate_moozzle_ids)) then raise exception 'Choose one of the scan''s candidates to confirm.'; end if;
    select * into a from public.animals where moozzle_id = v_mid;
    if not public.can_review_scan_candidate(a) then perform public.deny('confirm a candidate outside your review scope'); end if;
  end if;
  update public.biometric_scans set review_status = 'resolved', review_decision = p_decision, reviewed_by = auth.uid(), reviewed_at = now(),
    review_resolution_note = left(v_note, 300), review_confirmed_moozzle_id = case when p_decision = 'confirmed' then v_mid end
  where id = p_scan;
  perform public.notify_user(sc.user_id, sc.user_role, 'Biometric review ' || p_decision,
    case p_decision when 'confirmed' then 'A reviewer confirmed the animal identity for your scan.' when 'rejected' then 'A reviewer found no match for your scan. Recapture or use authorised enrolment.' else 'A reviewer could not decide; recapture the muzzle.' end,
    'approval', case when p_decision = 'confirmed' then '/animal/' || v_mid else '/(tabs)/identify' end);
  perform public.write_audit('biometric.review_decision', case when p_decision = 'confirmed' then v_mid else '' end,
    'Review ' || p_decision || ' · ' || sc.scan_type || ' scan · cfg v' || coalesce(sc.config_version::text, '?') || ' · similarity ' || to_char(sc.similarity_score, 'FM0.000'),
    'success', left(v_note, 300));
  return jsonb_build_object('id', p_scan, 'review_decision', p_decision);
end;
$$;

-- ---------- Ground-truth labelling (controlled trials) ----------
-- Only test-protocol owners and research / administration roles label. Field users cannot label their own scans.
create or replace function public.can_label_scan(p_scan uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  s record;
  sc public.biometric_scans;
begin
  select * into s from public.active_scope();
  if s.role is null then return false; end if;
  select * into sc from public.biometric_scans where id = p_scan;
  if not found then return false; end if;
  if sc.test_session_id is not null and exists (select 1 from public.biometric_test_sessions t where t.id = sc.test_session_id and t.created_by = auth.uid()) then
    return true;
  end if;
  if s.role = 'Super Administrator' and coalesce(s.privileged, false) then return true; end if;
  if s.role = 'Researcher' then return true; end if;
  return s.role = 'Organisation Administrator' and public.scan_in_analytics_scope(sc.user_id);
end;
$$;

create or replace function public.label_scan_ground_truth(p_scan uuid, p_truth text, p_note text default '') returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sc public.biometric_scans;
  v_label text;
begin
  if public.app_role() is null then perform public.deny('no active role'); end if;
  if p_truth is not null and p_truth not in ('genuine', 'impostor') then raise exception 'Ground truth must be genuine or impostor.'; end if;
  select * into sc from public.biometric_scans where id = p_scan;
  if not found or not public.can_label_scan(p_scan) then perform public.deny('label this scan'); end if;
  if sc.scan_type = 'identify' and p_truth is not null then
    raise exception 'Label 1:N searches as mated / non-mated with the true MOOZZLE ID.';
  end if;
  update public.biometric_scans
    set ground_truth = p_truth,
        ground_truth_note = case when p_truth is null then null else nullif(left(trim(coalesce(p_note, '')), 300), '') end,
        labelled_by = case when p_truth is null then null else auth.uid() end,
        labelled_at = case when p_truth is null then null else now() end,
        mated = case when p_truth is null then null else mated end,
        true_moozzle_id = case when p_truth is null then null else true_moozzle_id end,
        mate_rank = case when p_truth is null then null else mate_rank end
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

-- 1:N label: was the searched animal enrolled (mated search) and, if so, which MOOZZLE ID is the true mate?
create or replace function public.label_identification_truth(p_scan uuid, p_mated boolean, p_true_moozzle_id text, p_note text default '') returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sc public.biometric_scans;
  v_mid text := nullif(regexp_replace(coalesce(p_true_moozzle_id, ''), '\s', '', 'g'), '');
  v_rank integer;
  v_truth text;
begin
  if public.app_role() is null then perform public.deny('no active role'); end if;
  select * into sc from public.biometric_scans where id = p_scan;
  if not found or not public.can_label_scan(p_scan) then perform public.deny('label this scan'); end if;
  if sc.scan_type <> 'identify' then raise exception 'Only 1:N searches take a mated / non-mated label.'; end if;
  if p_mated is null then
    update public.biometric_scans set mated = null, true_moozzle_id = null, mate_rank = null, ground_truth = null, ground_truth_note = null,
      labelled_by = null, labelled_at = null where id = p_scan;
    perform public.write_audit('biometric.ground_truth', '', '1:N label cleared', 'success');
    return jsonb_build_object('id', p_scan, 'mated', null);
  end if;
  if p_mated then
    if v_mid is null or v_mid !~ '^\d{12}$' then raise exception 'Enter the true 12-digit MOOZZLE ID of the searched animal.'; end if;
    if not exists (select 1 from public.animals where moozzle_id = v_mid) then raise exception 'That MOOZZLE ID is not enrolled, so the search was non-mated.'; end if;
    select x.ord into v_rank from unnest(sc.candidate_moozzle_ids) with ordinality as x (mid, ord) where x.mid = v_mid;
  else
    v_mid := null;
  end if;
  -- Legacy genuine/impostor: genuine only when the top candidate really was the searched animal.
  v_truth := case when p_mated and v_rank = 1 then 'genuine' else 'impostor' end;
  update public.biometric_scans set mated = p_mated, true_moozzle_id = v_mid, mate_rank = v_rank, ground_truth = v_truth,
    ground_truth_note = nullif(left(trim(coalesce(p_note, '')), 300), ''), labelled_by = auth.uid(), labelled_at = now()
  where id = p_scan;
  perform public.write_audit('biometric.ground_truth', coalesce(v_mid, ''), '1:N label ' || case when p_mated then 'mated, true mate rank ' || coalesce(v_rank::text, 'not in list') else 'non-mated' end
    || ' · outcome ' || sc.outcome || ' · top ' || to_char(coalesce(sc.similarity_score, 0), 'FM0.000'), 'success', left(trim(coalesce(p_note, '')), 300));
  return jsonb_build_object('id', p_scan, 'mated', p_mated, 'mate_rank', v_rank);
end;
$$;

-- Researchers see the full scan log de-identified (no MOOZZLE IDs) for performance evaluation.
create or replace function public.scan_in_analytics_scope(p_user uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  s record;
begin
  select * into s from public.active_scope();
  if s.role is null then return false; end if;
  if p_user = auth.uid() then return true; end if;
  if coalesce(s.privileged, false) or s.role = 'Researcher' then return true; end if;
  if s.role = 'Organisation Administrator' and s.organisation_id is not null then
    return exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.organisation_id = s.organisation_id);
  end if;
  return false;
end;
$$;

create or replace function public.scan_analytics(p_days integer default 30) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s record;
  cfg public.biometric_configs := public.biometric_active_config();
  v_since timestamptz;
  v_rows jsonb;
  v_events jsonb;
  v_sessions jsonb;
  v_scope text;
  v_deid boolean;
  v_gallery integer;
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  if not public.can_view_biometric_governance() then perform public.deny('view biometric performance'); end if;
  if p_days is null or p_days < 0 or p_days > 3650 then raise exception 'Choose a date range between 0 and 3650 days.'; end if;
  v_since := case when p_days = 0 then '-infinity'::timestamptz else date_trunc('day', now()) - make_interval(days => greatest(p_days - 1, 0)) end;
  v_scope := case when coalesce(s.privileged, false) or s.role = 'Researcher' then 'platform' when s.role = 'Organisation Administrator' then 'organisation' else 'own' end;
  v_deid := s.role = 'Researcher';

  with scoped as (
    select sc.* from public.biometric_scans sc
    where sc.created_at >= v_since and public.scan_in_analytics_scope(sc.user_id)
    order by sc.created_at desc limit 5000
  ), linked as (
    select sc.*, coalesce(sc.true_moozzle_id, sc.matched_moozzle_id, sc.claimed_moozzle_id, sc.candidate_moozzle_ids[1]) as linked_id from scoped sc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'created_at', l.created_at, 'scan_type', l.scan_type, 'outcome', l.outcome, 'decision_reason', l.decision_reason,
      'similarity', l.similarity_score, 'quality_score', l.quality_score, 'quality_status', l.quality_status,
      'processing_ms', l.processing_time_ms, 'templates_searched', l.templates_searched, 'frames', l.frames, 'user_role', l.user_role,
      'own', l.user_id = auth.uid(),
      'moozzle_id', case when a.id is null or v_deid then null when public.can_view_animal(a.id) then a.moozzle_id else public.mask_moozzle_id(a.moozzle_id) end,
      'animal_in_scope', a.id is not null and not v_deid and public.can_view_animal(a.id),
      'species', public.species_bucket(a.species), 'species_code', a.species, 'breed', a.breed, 'age_group', a.age_group,
      'ground_truth', l.ground_truth, 'ground_truth_note', case when v_deid then null else l.ground_truth_note end, 'labelled_at', l.labelled_at,
      'mated', l.mated, 'mate_rank', l.mate_rank, 'candidate_scores', to_jsonb(l.candidate_scores),
      'config_version', l.config_version, 'model_version', coalesce(l.model_version, l.model_name), 'data_source', l.data_source,
      'test_session_id', l.test_session_id, 'device_model', l.device_model, 'capture_condition', l.capture_condition,
      'review_status', l.review_status, 'review_decision', l.review_decision,
      'can_label', public.can_label_scan(l.id)
    ) order by l.created_at desc), '[]'::jsonb) into v_rows
  from linked l left join public.animals a on a.moozzle_id = l.linked_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'created_at', e.created_at, 'operation', e.operation, 'event_type', e.event_type, 'reason_code', e.reason_code,
      'quality_status', e.quality_status, 'quality_score', e.quality_score, 'frames_attempted', e.frames_attempted, 'frames_accepted', e.frames_accepted,
      'device_model', e.device_model, 'capture_condition', e.capture_condition, 'model_version', e.model_version, 'config_version', e.config_version,
      'data_source', e.data_source, 'test_session_id', e.test_session_id
    ) order by e.created_at desc), '[]'::jsonb) into v_events
  from (select * from public.biometric_acquisition_events ev where ev.created_at >= v_since and public.scan_in_analytics_scope(ev.user_id)
        order by ev.created_at desc limit 5000) e;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'protocol_reference', t.protocol_reference, 'data_source', t.data_source, 'dataset_split', t.dataset_split,
      'device_model', t.device_model, 'capture_condition', t.capture_condition, 'status', t.status, 'opened_at', t.opened_at, 'closed_at', t.closed_at,
      'own', t.created_by = auth.uid(), 'created_role', t.created_role,
      'subjects', case when v_deid then '[]'::jsonb else (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from public.biometric_scans sc,
        lateral (select coalesce(sc.true_moozzle_id, sc.claimed_moozzle_id) as x) y where sc.test_session_id = t.id and x is not null) end,
      'subject_count', (select count(distinct coalesce(sc.true_moozzle_id, sc.claimed_moozzle_id)) from public.biometric_scans sc where sc.test_session_id = t.id),
      'subject_overlap', (select count(distinct coalesce(sc.true_moozzle_id, sc.claimed_moozzle_id)) from public.biometric_scans sc
        where sc.test_session_id = t.id and coalesce(sc.true_moozzle_id, sc.claimed_moozzle_id) in (
          select coalesce(o.true_moozzle_id, o.claimed_moozzle_id) from public.biometric_scans o join public.biometric_test_sessions ot on ot.id = o.test_session_id
          where ot.dataset_split <> t.dataset_split))
    ) order by t.opened_at desc), '[]'::jsonb) into v_sessions
  from public.biometric_test_sessions t
  where t.created_by = auth.uid() or public.scan_in_analytics_scope(t.created_by);

  select count(distinct bt.animal_id) into v_gallery from public.biometric_templates bt join public.animals a on a.id = bt.animal_id
    where bt.embedding is not null and a.status = 'active' and a.approval_status <> 'Rejected';

  return jsonb_build_object(
    'scope', v_scope, 'deidentified', v_deid,
    'since', case when p_days = 0 then null else v_since end,
    'config', public.config_json(cfg) || jsonb_build_object('config_version', cfg.config_version),
    'match_threshold', cfg.identify_accept, 'review_threshold', cfg.identify_review, 'verify_threshold', cfg.verify_accept,
    'verify_review_threshold', cfg.verify_review,
    'gallery_size', v_gallery,
    'scans', v_rows, 'acquisition_events', v_events, 'test_sessions', v_sessions);
end;
$$;

-- Calibration pairs from enrolled templates read the production configuration.
create or replace function public.biometric_validation(p_mode text default 'overall') returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s record;
  cfg public.biometric_configs := public.biometric_active_config();
  pairs jsonb;
  n_templates integer;
  n_animals integer;
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  if p_mode not in ('overall', 'cross_breed', 'cross_lighting') then raise exception 'Unknown validation mode.'; end if;
  select count(*), count(distinct animal_id) into n_templates, n_animals from public.biometric_templates where embedding is not null;
  with t as (
    select bt.id, bt.animal_id, bt.embedding, a.breed,
      case when coalesce((bt.quality_metrics ->> 'brightness')::numeric, 128) < 95 then 'low' else 'normal' end as light
    from public.biometric_templates bt join public.animals a on a.id = bt.animal_id
    where bt.embedding is not null
    order by bt.created_at desc limit 400
  ), p as (
    select (t1.animal_id = t2.animal_id) as genuine, 1 - (t1.embedding <=> t2.embedding) as score,
      case p_mode
        when 'cross_breed' then case when t1.breed = t2.breed then 'Same breed' else 'Different breed' end
        when 'cross_lighting' then case when t1.light = t2.light then case t1.light when 'low' then 'Both low light' else 'Both normal light' end else 'Mixed lighting' end
        else 'All pairs'
      end as grp
    from t t1 join t t2 on t1.id < t2.id
    limit 40000
  )
  select coalesce(jsonb_agg(jsonb_build_array(case when genuine then 1 else 0 end, round(score::numeric, 4), grp)), '[]'::jsonb) into pairs from p;
  return jsonb_build_object('mode', p_mode, 'templates', n_templates, 'animals', n_animals, 'pairs', pairs,
    'match_threshold', cfg.identify_accept, 'review_threshold', cfg.identify_review, 'verify_threshold', cfg.verify_accept,
    'verify_review_threshold', cfg.verify_review, 'config_version', cfg.config_version,
    'scans', (select jsonb_build_object('total', count(*), 'match', count(*) filter (where outcome = 'match'),
      'no_match', count(*) filter (where outcome = 'no_match'), 'uncertain', count(*) filter (where outcome = 'uncertain'),
      'avg_ms', round(avg(processing_time_ms))) from public.biometric_scans));
end;
$$;

-- ---------- Enrolment: possible duplicates are held for an explicit duplicate-review submission ----------
create or replace function public.register_animal(p jsonb) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
  cfg public.biometric_configs := public.biometric_active_config();
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
  v_species text := p ->> 'species';
  v_sex text := p ->> 'sex';
  v_years integer;
  v_months integer;
  v_group text;
  v_prod text := upper(trim(coalesce(p ->> 'production_status', '')));
  v_preg text := upper(trim(coalesce(p ->> 'pregnancy_status', '')));
  v_dairy text := lower(trim(coalesce(p ->> 'dairy_society', '')));
  v_soc_name text := trim(coalesce(p ->> 'society_name', ''));
  v_soc_code text := trim(coalesce(p ->> 'society_code', ''));
  v_member text := trim(coalesce(p ->> 'member_code', ''));
  v_ack boolean := coalesce((p ->> 'duplicate_review_ack')::boolean, false);
  v_ack_note text := trim(coalesce(p ->> 'duplicate_review_note', ''));
  v_lat double precision;
  v_lng double precision;
  v_acc double precision;
  v_gps_at timestamptz;
  v_device_at timestamptz;
  v_offset integer;
  existing record;
  emb_texts text[];
  embs extensions.vector[] := '{}';
  paths text[];
  scores numeric[];
  metrics jsonb := coalesce(p -> 'quality_metrics', '[]'::jsonb);
  top record;
  searched integer;
  cand jsonb;
  v_ref text;
  i integer;
begin
  select * into s from public.active_scope();
  if s.role is null then perform public.deny('no active role'); end if;
  -- Idempotent on the client-generated id: retries after a lost response return the first result.
  select * into existing from public.animals where id = v_id;
  if found then
    if existing.user_id = auth.uid() then
      return jsonb_build_object('id', existing.id, 'moozzle_id', existing.moozzle_id, 'approval_status', existing.approval_status, 'duplicate', existing.duplicate_of is not null, 'existing', true, 'blocked', false, 'review_required', false);
    end if;
    perform public.deny('record id belongs to another record');
  end if;
  if lvl in ('No', 'De-identified', 'Via API scope', 'Technical only') then
    perform public.write_audit('animal.register', '', 'Registration refused for role', 'denied');
    perform public.deny('register_animal');
  end if;
  if s.role = 'Super Administrator' and not s.privileged then perform public.deny('privileged access required'); end if;

  -- Demographics
  if v_species is null or v_species not in ('cattle', 'buffalo', 'crossbreed', 'bull', 'bullock') then raise exception 'Choose the bovine species (Cattle, Buffalo, Crossbred, Bull or Bullock).'; end if;
  if v_sex is null or v_sex not in ('female', 'male') then raise exception 'Choose the sex of the animal.'; end if;
  if v_species in ('bull', 'bullock') and v_sex <> 'male' then raise exception 'A bull or bullock is always male; set sex to Male.'; end if;
  if length(trim(coalesce(p ->> 'breed', ''))) = 0 then raise exception 'Choose a breed.'; end if;
  begin
    v_years := (p ->> 'age_years')::int;
    v_months := coalesce(nullif(p ->> 'age_months', '')::int, 0);
  exception when others then
    raise exception 'Enter a valid age in years and months.';
  end;
  if v_years is null or v_years < 0 or v_years > 25 or v_months < 0 or v_months > 11 then raise exception 'Enter a valid age (0–25 years, 0–11 months).'; end if;
  v_group := public.age_group_for(v_species, v_years, v_months);

  if v_dairy not in ('yes', 'no') then raise exception 'Answer “Are you giving milk in a dairy society?”.'; end if;
  if v_dairy = 'yes' then
    if v_soc_name = '' or v_soc_code = '' or v_member = '' then raise exception 'Society name, society code and member code are required for dairy society members.'; end if;
    if length(v_soc_name) > 120 or length(v_soc_code) > 40 or length(v_member) > 40 then raise exception 'Dairy society details are too long.'; end if;
  else
    v_soc_name := null; v_soc_code := null; v_member := null;
  end if;

  if v_prod not in ('DRY', 'MILK', 'NA') then raise exception 'Choose Status I (DRY, MILK or NA).'; end if;
  if v_prod <> 'NA' and not public.production_allowed(v_species, v_sex, v_group) then
    raise exception 'Status I must be NA for this animal: only adult female cattle, buffalo or crossbreeds can be MILK or DRY.';
  end if;
  if v_preg not in ('PREGNANT', 'NON-PREGNANT', 'NA') then raise exception 'Choose Status II (PREGNANT, NON-PREGNANT or NA).'; end if;
  if v_preg <> 'NA' and not public.pregnancy_allowed(v_species, v_sex, v_group) then
    raise exception 'Status II must be NA for males, bulls, bullocks and calves.';
  end if;

  -- Registration time and compulsory device GPS
  begin
    v_lat := (p ->> 'gps_latitude')::double precision;
    v_lng := (p ->> 'gps_longitude')::double precision;
    v_acc := nullif(p ->> 'gps_accuracy_m', '')::double precision;
    v_gps_at := (p ->> 'gps_captured_at')::timestamptz;
    v_device_at := (p ->> 'device_registered_at')::timestamptz;
    v_offset := nullif(p ->> 'device_utc_offset_minutes', '')::int;
  exception when others then
    raise exception 'GPS location and registration time are invalid. Capture GPS again.';
  end;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 or (v_lat = 0 and v_lng = 0) then
    raise exception 'Valid GPS latitude and longitude are required to register an animal.';
  end if;
  if coalesce((p ->> 'gps_mocked')::boolean, false) then raise exception 'A mock (simulated) GPS location was detected. Disable mock locations and capture GPS again.'; end if;
  if v_acc is not null and (v_acc < 0 or v_acc > 100000) then raise exception 'GPS accuracy is invalid. Capture GPS again.'; end if;
  if v_gps_at is null or v_gps_at > now() + interval '10 minutes' then raise exception 'The GPS capture time is missing or in the future. Check the phone clock and capture GPS again.'; end if;
  if v_device_at is null or v_device_at > now() + interval '10 minutes' then raise exception 'The registration time is missing or in the future. Check the phone clock.'; end if;
  if v_offset is not null and (v_offset < -840 or v_offset > 840) then v_offset := null; end if;

  select coalesce(array_agg(x), '{}') into emb_texts from jsonb_array_elements_text(coalesce(p -> 'embeddings', '[]'::jsonb)) x;
  select coalesce(array_agg(x), '{}') into paths from jsonb_array_elements_text(coalesce(p -> 'image_paths', '[]'::jsonb)) x;
  select coalesce(array_agg(x::numeric), '{}') into scores from jsonb_array_elements_text(coalesce(p -> 'quality_scores', '[]'::jsonb)) x;
  if coalesce(array_length(emb_texts, 1), 0) < 3 or array_length(emb_texts, 1) > 5 then
    raise exception 'Enrolment needs 3 to 5 accepted muzzle images with biometric embeddings.';
  end if;
  if coalesce(p ->> 'model', cfg.model_version) <> cfg.model_version then
    raise exception 'This app computes % templates but production requires %. Update the app before enrolling.', p ->> 'model', cfg.model_version;
  end if;
  for i in 1..array_length(emb_texts, 1) loop
    embs := embs || public.to_embedding(emb_texts[i]);
  end loop;
  for i in 1..coalesce(array_length(paths, 1), 0) loop
    if not public.capture_path_ok(paths[i]) then perform public.deny('capture path'); end if;
  end loop;

  -- 1:N duplicate search across every enrolled template, not only the caller's scope.
  select count(*) into searched from public.biometric_templates t join public.animals a on a.id = t.animal_id
    where t.embedding is not null and a.status = 'active' and a.approval_status <> 'Rejected';
  select * into top from public.biometric_candidates(embs, 1);
  if top.animal_id is not null and top.score >= cfg.identify_accept then
    cand := public.candidate_json(top.animal_id, top.score);
    insert into public.biometric_scans (user_id, user_role, scan_type, captured_image_path, quality_status, outcome, matched_moozzle_id, similarity_score,
      templates_searched, frames, candidate_moozzle_ids, candidate_scores, config_version, model_version, model_name, decision_reason)
    values (auth.uid(), s.role, 'enrol_check', nullif(paths[1], ''), 'GOOD IMAGE', 'match',
      case when (cand ->> 'in_scope')::boolean then cand ->> 'moozzle_id' end, round(top.score::numeric, 4), searched, array_length(embs, 1),
      array[(select moozzle_id from public.animals where id = top.animal_id)], array[round(top.score::numeric, 4)],
      cfg.config_version, cfg.model_version, cfg.model_version, 'duplicate_blocked');
    perform public.write_audit('animal.register', case when (cand ->> 'in_scope')::boolean then cand ->> 'moozzle_id' else '' end,
      'Duplicate enrolment blocked · cfg v' || cfg.config_version || ' · similarity ' || to_char(top.score, 'FM0.000'), 'denied', 'ANIMAL ALREADY REGISTERED', coalesce(p ->> 'source', 'moozzle-app'));
    return jsonb_build_object('blocked', true, 'duplicate', true, 'existing', false, 'review_required', false, 'match', cand, 'score', round(top.score::numeric, 4),
      'templates_searched', searched, 'match_threshold', cfg.identify_accept, 'review_threshold', cfg.identify_review, 'config_version', cfg.config_version);
  end if;

  -- Possible duplicate: never issue an ID silently. The operator must submit it for duplicate review with a reason.
  if top.animal_id is not null and top.score >= cfg.identify_review then
    v_dup := top.animal_id;
    if not v_ack or length(v_ack_note) < 10 then
      cand := public.candidate_json(top.animal_id, top.score);
      insert into public.biometric_scans (user_id, user_role, scan_type, captured_image_path, quality_status, outcome, similarity_score,
        templates_searched, frames, candidate_moozzle_ids, candidate_scores, config_version, model_version, model_name, decision_reason)
      values (auth.uid(), s.role, 'enrol_check', nullif(paths[1], ''), 'GOOD IMAGE', 'uncertain', round(top.score::numeric, 4), searched, array_length(embs, 1),
        array[(select moozzle_id from public.animals where id = top.animal_id)], array[round(top.score::numeric, 4)],
        cfg.config_version, cfg.model_version, cfg.model_version, 'possible_duplicate_held');
      perform public.write_audit('animal.register', '', 'Possible duplicate held before ID issue · cfg v' || cfg.config_version || ' · similarity ' || to_char(top.score, 'FM0.000'),
        'requested', 'POSSIBLE DUPLICATE — REVIEW REQUIRED', coalesce(p ->> 'source', 'moozzle-app'));
      return jsonb_build_object('blocked', false, 'review_required', true, 'duplicate', true, 'existing', false, 'match', cand,
        'score', round(top.score::numeric, 4), 'templates_searched', searched, 'match_threshold', cfg.identify_accept,
        'review_threshold', cfg.identify_review, 'config_version', cfg.config_version);
    end if;
  end if;

  if v_farm is not null then
    select organisation_id, name, village, state, district into f_org, f_name, f_village, f_state, f_district from public.farms where id = v_farm;
    if not found then raise exception 'Unknown farm.'; end if;
    v_district := coalesce(nullif(v_district, ''), f_district);
  end if;

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

  if coalesce((p ->> 'save_as_draft')::boolean, false) and v_dup is null then
    v_status := 'Draft';
  elsif lvl in ('Full', 'Scoped') and v_dup is null then
    v_status := 'Approved';
  else
    v_status := 'Submitted';
  end if;
  -- A possible duplicate always goes to an authorised reviewer; it is never Approved or a private Draft.
  if v_dup is not null then v_status := 'Pending Review'; end if;

  v_ref := nullif(paths[1], '');
  v_mid := public.next_moozzle_id(p ->> 'moozzle_id');
  insert into public.animals (id, user_id, moozzle_id, species, breed, sex, age_years, age_months, farm_name, village, district, state,
    biometric_status, status, captured_images_count, organisation_id, farm_id, owner_user_id, approval_status, duplicate_of, reference_image_path,
    age_group, production_status, pregnancy_status, device_registered_at, device_utc_offset_minutes, review_note)
  values (v_id, auth.uid(), v_mid, v_species, trim(p ->> 'breed'), v_sex, v_years, v_months,
    coalesce(f_name, trim(coalesce(p ->> 'farm_name', ''))), coalesce(nullif(trim(coalesce(p ->> 'village', '')), ''), f_village, ''),
    v_district, coalesce(nullif(trim(coalesce(p ->> 'state', '')), ''), f_state, ''),
    case when coalesce((p ->> 'quality_score')::numeric, 0) >= 0.7 then 'enrolled' else 'pending_quality' end,
    'active', array_length(embs, 1), v_org, v_farm, v_owner, v_status, v_dup, v_ref,
    v_group, v_prod, v_preg, v_device_at, v_offset,
    case when v_dup is not null then left('Possible duplicate submitted for review: ' || v_ack_note, 300) end);
  insert into public.animal_owners (animal_id, owner_name, owner_phone, dairy_society_member, society_name, society_code, member_code,
    gps_latitude, gps_longitude, gps_accuracy_m, gps_captured_at)
  values (v_id, v_owner_name, trim(coalesce(p ->> 'owner_phone', '')), v_dairy = 'yes', v_soc_name, v_soc_code, v_member,
    v_lat, v_lng, v_acc, v_gps_at);
  for i in 1..array_length(embs, 1) loop
    insert into public.biometric_templates (user_id, animal_id, moozzle_id, quality_score, embedding_preview, model_version, embedding,
      model_name, embedding_dim, image_path, frame_index, quality_metrics)
    values (auth.uid(), v_id, v_mid, least(greatest(coalesce(scores[i], (p ->> 'quality_score')::numeric, 0), 0), 1),
      left(emb_texts[i], 60), cfg.model_version, embs[i], cfg.model_version, 256, nullif(paths[i], ''), i, coalesce(metrics -> (i - 1), '{}'::jsonb));
  end loop;
  insert into public.biometric_scans (user_id, user_role, scan_type, captured_image_path, quality_status, outcome, similarity_score, templates_searched,
    frames, candidate_moozzle_ids, candidate_scores, config_version, model_version, model_name, decision_reason)
  values (auth.uid(), s.role, 'enrol_check', v_ref, 'GOOD IMAGE', case when v_dup is not null then 'uncertain' else 'no_match' end,
    round(coalesce(top.score, 0)::numeric, 4), searched, array_length(embs, 1),
    case when v_dup is not null then array[(select moozzle_id from public.animals where id = v_dup)] else '{}' end,
    case when v_dup is not null then array[round(top.score::numeric, 4)] else '{}' end,
    cfg.config_version, cfg.model_version, cfg.model_version, case when v_dup is not null then 'duplicate_review_submitted' else 'enrolled' end);

  perform public.write_audit('animal.register', v_mid, 'Registered ' || (p ->> 'breed') || ' ' || v_species || ' (' || v_group || ', Status I ' || v_prod
    || ', Status II ' || v_preg || ') as ' || v_status || ' · ' || array_length(embs, 1)
    || ' templates · cfg v' || cfg.config_version || ' · 1:N best ' || to_char(coalesce(top.score, 0), 'FM0.000') || ' · GPS ±' || coalesce(round(v_acc::numeric)::text, '?') || ' m'
    || case when v_dup is not null then ' (possible duplicate submitted for manual review)' else '' end,
    'success', case when v_dup is not null then left(v_ack_note, 300) else '' end, coalesce(p ->> 'source', 'moozzle-app'));
  if v_status in ('Submitted', 'Pending Review') then
    perform public.notify_scope(array['Organisation Administrator'], v_org, null, null,
      case when v_dup is not null then 'Possible duplicate awaiting review' else 'New registration awaiting approval' end,
      (p ->> 'breed') || ' · MOOZZLE ID ' || v_mid || case when v_dup is not null then ' · possible duplicate' else '' end, 'approval', '/approvals');
  end if;
  return jsonb_build_object('id', v_id, 'moozzle_id', v_mid, 'approval_status', v_status, 'duplicate', v_dup is not null, 'existing', false,
    'blocked', false, 'review_required', false, 'score', round(coalesce(top.score, 0)::numeric, 4), 'templates_searched', searched,
    'config_version', cfg.config_version,
    'review_candidate', case when v_dup is not null then public.candidate_json(v_dup, top.score) end);
end;
$$;

-- ---------- Grants ----------
revoke all on function public.biometric_active_config() from public, anon;
revoke all on function public.config_json(public.biometric_configs) from public, anon;
revoke all on function public.require_good_capture(jsonb, public.biometric_configs) from public, anon, authenticated;
revoke all on function public.can_review_scan_candidate(public.animals) from public, anon, authenticated;
revoke all on function public.can_label_scan(uuid) from public, anon, authenticated;
revoke all on function public.forbid_mutation() from public, anon, authenticated;
revoke all on function public.audit_row_immutable() from public, anon, authenticated;
revoke all on function public.biometric_config_values_frozen() from public, anon, authenticated;
revoke all on function public.can_review_scan(uuid) from public, anon;
revoke all on function public.can_propose_biometric_config() from public, anon;
revoke all on function public.can_view_biometric_governance() from public, anon;
revoke all on function public.can_run_test_protocol() from public, anon;
grant execute on function public.propose_biometric_config(jsonb), public.review_biometric_config(uuid, text, text),
  public.promote_biometric_config(uuid, text), public.biometric_config_history(), public.open_test_session(jsonb),
  public.close_test_session(uuid), public.my_test_session(), public.log_acquisition_event(jsonb), public.scan_review_queue(),
  public.resolve_scan_review(uuid, text, text, text), public.label_identification_truth(uuid, boolean, text, text),
  public.label_scan_ground_truth(uuid, text, text), public.scan_analytics(integer), public.identify_muzzle(text[], text, jsonb, integer),
  public.verify_muzzle(text, text, text, jsonb, integer), public.register_animal(jsonb), public.request_scan_review(uuid, text),
  public.biometric_validation(text), public.update_setting(text, jsonb, text) to authenticated;
revoke all on function public.propose_biometric_config(jsonb), public.review_biometric_config(uuid, text, text),
  public.promote_biometric_config(uuid, text), public.biometric_config_history(), public.open_test_session(jsonb),
  public.close_test_session(uuid), public.my_test_session(), public.log_acquisition_event(jsonb), public.scan_review_queue(),
  public.resolve_scan_review(uuid, text, text, text), public.label_identification_truth(uuid, boolean, text, text) from anon;

-- Researchers (biometric research) may propose thresholds (approval stays with a privileged Super Administrator).
update public.role_permissions set level = 'Limited', updated_at = now() where role = 'Researcher' and permission = 'change_threshold';

-- Grants: functions inherit EXECUTE from PUBLIC, so revoke from PUBLIC and grant only to signed-in users.
revoke all on function public.propose_biometric_config(jsonb), public.review_biometric_config(uuid, text, text),
  public.promote_biometric_config(uuid, text), public.biometric_config_history(), public.open_test_session(jsonb),
  public.close_test_session(uuid), public.my_test_session(), public.log_acquisition_event(jsonb), public.scan_review_queue(),
  public.resolve_scan_review(uuid, text, text, text), public.label_identification_truth(uuid, boolean, text, text) from public, anon;
grant execute on function public.propose_biometric_config(jsonb), public.review_biometric_config(uuid, text, text),
  public.promote_biometric_config(uuid, text), public.biometric_config_history(), public.open_test_session(jsonb),
  public.close_test_session(uuid), public.my_test_session(), public.log_acquisition_event(jsonb), public.scan_review_queue(),
  public.resolve_scan_review(uuid, text, text, text), public.label_identification_truth(uuid, boolean, text, text) to authenticated;
-- Internal helpers are only called from SECURITY DEFINER functions and policies.
revoke all on function public.biometric_active_config(), public.can_review_scan(uuid), public.can_propose_biometric_config(),
  public.can_view_biometric_governance(), public.can_run_test_protocol() from public, anon, authenticated;

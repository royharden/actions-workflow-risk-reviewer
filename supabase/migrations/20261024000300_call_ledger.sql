-- Applies after 000100 creates runs with UNIQUE(id, owner), kind, cap_usd, and 000200 policies.
-- M5 may create user_budgets first: use exactly this shape and IF NOT EXISTS in both migrations.
-- Runtime environment cannot change a SQL literal. Default is $1/UTC day; reviewed service-only
-- user_budgets rows may lower it. Non-1 EXPLAIN_DEFAULT_DAILY_USD refuses at the handler until activation.
create table if not exists public.user_budgets (
  owner uuid primary key references auth.users(id),
  daily_usd numeric(12,6) not null default 1.00 check (daily_usd > 0 and daily_usd <= 1.00)
);
alter table public.user_budgets enable row level security;
drop policy if exists user_budgets_select_own on public.user_budgets;
create policy user_budgets_select_own on public.user_budgets for select to authenticated using (owner = auth.uid());
revoke all on public.user_budgets from public, anon, authenticated;
grant select on public.user_budgets to authenticated;
-- Budget administration is privileged deployment work, never a browser operation.
grant select, insert, update on public.user_budgets to service_role;

create table public.call_ledger (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id),
  run_id uuid not null,
  created_at timestamptz not null default now(),
  idempotency_key text not null check (length(idempotency_key) between 16 and 128),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  model text not null check (length(model) between 1 and 200),
  reserve_usd numeric(12,6) not null check (reserve_usd > 0 and reserve_usd <= 1.00),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens between 0 and 600),
  cost_usd numeric(12,6) check (cost_usd >= 0 and cost_usd <= reserve_usd),
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'failed', 'uncertain')),
  unique(owner, idempotency_key),
  foreign key(run_id, owner) references public.runs(id, owner),
  check ((status = 'reserved' and input_tokens is null and output_tokens is null and cost_usd is null)
    or (status <> 'reserved' and input_tokens is not null and output_tokens is not null and cost_usd is not null))
);
-- No workflow, prompt, quote, explanation, model response, or provider error body is stored.
-- Price verification is a handler gate; the fixed six-argument reserve RPC does not persist its date.
create index call_ledger_owner_day on public.call_ledger(owner, created_at);
create index call_ledger_run on public.call_ledger(run_id);
alter table public.call_ledger enable row level security;
create policy call_ledger_select_own on public.call_ledger for select to authenticated using (owner = auth.uid());
revoke all on public.call_ledger from public, anon, authenticated, service_role;
grant select on public.call_ledger to authenticated, service_role;

create or replace function public.reserve_call(
  p_owner uuid, p_run_id uuid, p_idempotency_key text, p_request_digest text, p_model text, p_reserve_usd numeric
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  prior public.call_ledger%rowtype;
  run_row public.runs%rowtype;
  daily_limit numeric;
  daily_charge numeric;
  run_charge numeric;
  ledger_id uuid;
  day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  if p_owner is null or p_run_id is null or p_idempotency_key is null or length(p_idempotency_key) not between 16 and 128
    or p_request_digest is null or p_request_digest !~ '^[0-9a-f]{64}$' or p_model is null or length(p_model) not between 1 and 200
    or p_reserve_usd is null or not (p_reserve_usd > 0 and p_reserve_usd <= 1.00)
    or p_reserve_usd <> round(p_reserve_usd, 6) then
    raise exception 'Invalid reservation';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_owner::text));
  -- Repeat exact-row ownership/kind checks here, even though the handler already checked them.
  select * into run_row from public.runs where id = p_run_id and owner = p_owner;
  if not found or run_row.kind not in ('review', 'eval')
    or (run_row.kind = 'eval' and (run_row.cap_usd is null or not (run_row.cap_usd > 0 and run_row.cap_usd <= 1.00))) then
    return jsonb_build_object('result', 'forbidden_run');
  end if;
  -- Idempotency precedes budget. A changed key payload or run/model is always a conflict.
  select * into prior from public.call_ledger where owner = p_owner and idempotency_key = p_idempotency_key;
  if found then
    if prior.request_digest <> p_request_digest or prior.run_id <> p_run_id or prior.model <> p_model then
      return jsonb_build_object('result', 'conflict');
    elsif prior.status = 'reserved' then return jsonb_build_object('result', 'in_progress');
    elsif prior.status in ('uncertain', 'failed') then return jsonb_build_object('result', 'no_retry');
    else return jsonb_build_object('result', 'unavailable'); -- settled replay has no retained response
    end if;
  end if;
  select daily_usd into daily_limit from public.user_budgets where owner = p_owner;
  daily_limit := coalesce(daily_limit, 1.00);
  select coalesce(sum(case when status = 'settled' then cost_usd else reserve_usd end), 0)
    into daily_charge from public.call_ledger where owner = p_owner
      and created_at >= day_start and created_at < day_start + interval '1 day';
  select coalesce(sum(case when status = 'settled' then cost_usd else reserve_usd end), 0)
    into run_charge from public.call_ledger where run_id = p_run_id and owner = p_owner;
  if daily_charge + p_reserve_usd > daily_limit
    or (run_row.cap_usd is not null and run_charge + p_reserve_usd > run_row.cap_usd) then
    return jsonb_build_object('result', 'over_budget');
  end if;
  insert into public.call_ledger(owner, run_id, idempotency_key, request_digest, model, reserve_usd)
    values(p_owner, p_run_id, p_idempotency_key, p_request_digest, p_model, p_reserve_usd) returning id into ledger_id;
  return jsonb_build_object('result', 'reserved', 'ledger_id', ledger_id);
end;
$$;

create or replace function public.settle_call(
  p_id uuid, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric, p_status text
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ledger_owner uuid;
  reserved public.call_ledger%rowtype;
begin
  if p_status is null or p_status not in ('settled', 'failed', 'uncertain') or p_input_tokens is null or p_input_tokens < 0
    or p_output_tokens is null or p_output_tokens not between 0 and 600 or p_cost_usd is null
    or not (p_cost_usd >= 0 and p_cost_usd <= 1.00) or p_cost_usd <> round(p_cost_usd, 6) then
    raise exception 'Invalid settlement';
  end if;
  select owner into ledger_owner from public.call_ledger where id = p_id;
  if not found then raise exception 'Unknown reservation'; end if;
  -- Same lock as reserve avoids races in the effective-charge snapshot.
  perform pg_advisory_xact_lock(hashtext(ledger_owner::text));
  select * into reserved from public.call_ledger where id = p_id for update;
  if reserved.status <> 'reserved' then raise exception 'Reservation already terminal'; end if;
  if p_cost_usd > reserved.reserve_usd then raise exception 'Settlement exceeds reserve'; end if;
  update public.call_ledger set status = p_status, input_tokens = p_input_tokens,
    output_tokens = p_output_tokens, cost_usd = p_cost_usd where id = p_id;
  -- Failed/uncertain keep their reserve as effective charge; only settled rows use cost_usd.
  return true;
end;
$$;

revoke execute on function public.reserve_call(uuid, uuid, text, text, text, numeric) from public, anon, authenticated;
revoke execute on function public.settle_call(uuid, integer, integer, numeric, text) from public, anon, authenticated;
grant execute on function public.reserve_call(uuid, uuid, text, text, text, numeric) to service_role;
grant execute on function public.settle_call(uuid, integer, integer, numeric, text) to service_role;

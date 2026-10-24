alter table public.runs enable row level security;
alter table public.findings enable row level security;
alter table public.rulings enable row level security;

-- Remove grants attached by database defaults as well as explicit broad grants. A service
-- role bypasses RLS, so table privileges must also keep snapshots and events append-only.
revoke all on public.runs, public.findings, public.rulings from public, anon, authenticated, service_role;
revoke all on sequence public.rulings_id_seq from public, anon, authenticated, service_role;
grant select, insert on public.runs, public.findings, public.rulings to authenticated, service_role;
grant usage on sequence public.rulings_id_seq to authenticated, service_role;

create policy runs_read_own on public.runs for select to authenticated using (owner = auth.uid());
create policy runs_insert_own on public.runs for insert to authenticated with check (owner = auth.uid());
create policy findings_read_own on public.findings for select to authenticated using (owner = auth.uid());
create policy findings_insert_own on public.findings for insert to authenticated with check (
  owner = auth.uid() and exists (
    select 1 from public.runs r where r.id = findings.run_id and r.owner = auth.uid()
  )
);
create policy rulings_read_own on public.rulings for select to authenticated using (owner = auth.uid());
create policy rulings_insert_own on public.rulings for insert to authenticated with check (
  owner = auth.uid() and exists (
    select 1 from public.findings f
    where f.run_id = rulings.run_id and f.id = rulings.finding_id and f.owner = auth.uid()
      and f.file_hash = rulings.file_hash and f.fingerprint = rulings.fingerprint
      and f.rule_version = rulings.rule_version
  )
);
-- Deliberately no UPDATE, DELETE or TRUNCATE grants: snapshots and ruling events are append-only.

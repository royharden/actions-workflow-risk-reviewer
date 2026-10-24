-- Fresh Bolt Database target only. Inspect migration history before applying to an existing target.
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id),
  kind text not null default 'review' check (kind in ('review', 'eval')),
  cap_usd numeric(12,6),
  created_at timestamptz not null default now(),
  app_version text not null,
  rule_versions jsonb not null,
  file_hashes text[] not null,
  unique (id, owner),
  check (cap_usd is null or (cap_usd > 0 and cap_usd <= 1)),
  check (kind <> 'eval' or cap_usd is not null)
);

create table public.findings (
  run_id uuid not null,
  id text not null,
  owner uuid not null default auth.uid(),
  fingerprint text not null,
  rule text not null,
  rule_version text not null,
  severity text not null check (severity in ('critical','high','medium','low')),
  file_hash text not null,
  payload jsonb not null,
  primary key (run_id, id),
  unique (run_id, id, owner),
  foreign key (run_id, owner) references public.runs(id, owner)
);

create table public.rulings (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  owner uuid not null default auth.uid(),
  run_id uuid not null,
  finding_id text not null,
  file_hash text not null,
  fingerprint text not null,
  rule_version text not null,
  decision text not null check (decision in ('confirm','false_positive','accept_fix','reject_fix')),
  patch_digest text,
  reason text,
  created_at timestamptz not null default now(),
  foreign key (run_id, finding_id, owner) references public.findings(run_id, id, owner),
  check ((decision in ('accept_fix','reject_fix')) = (patch_digest is not null)),
  check (patch_digest is null or patch_digest ~ '^[0-9a-f]{64}$')
);

create index findings_owner_run on public.findings(owner, run_id);
create index rulings_owner_time on public.rulings(owner, created_at, id);

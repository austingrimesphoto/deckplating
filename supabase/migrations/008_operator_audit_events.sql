create table if not exists operator_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references organizations(id) on delete set null,
  actor text not null default 'central_operator',
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table operator_audit_events enable row level security;

create index if not exists idx_operator_audit_events_org_time
  on operator_audit_events(organization_id, created_at desc);

create index if not exists idx_operator_audit_events_action_time
  on operator_audit_events(action, created_at desc);

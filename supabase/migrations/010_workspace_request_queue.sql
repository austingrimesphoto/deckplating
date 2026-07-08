create table if not exists workspace_requests (
  id uuid primary key default gen_random_uuid(),
  installation_or_command text not null,
  preferred_workspace_slug text null,
  lead_name text not null,
  lead_role text not null,
  official_contact_email text not null,
  rmt_size integer not null,
  expected_pilot_start_date date not null,
  short_use_case text not null,
  safe_use_boundaries_confirmed boolean not null default false,
  no_sensitive_data_acknowledged boolean not null default false,
  status text not null default 'pending',
  operator_note text null,
  organization_id uuid null references organizations(id),
  setup_code_id uuid null references organization_setup_codes(id),
  approved_at timestamptz null,
  rejected_at timestamptz null,
  operator_notified_at timestamptz null,
  requestor_notified_at timestamptz null,
  operator_notification_status text null,
  requestor_notification_status text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('pending', 'approved', 'rejected')),
  check (rmt_size > 0 and rmt_size < 1000)
);

alter table workspace_requests enable row level security;

drop trigger if exists workspace_requests_set_updated_at on workspace_requests;
create trigger workspace_requests_set_updated_at
before update on workspace_requests
for each row execute function set_updated_at();

create index if not exists idx_workspace_requests_status_created
  on workspace_requests(status, created_at desc);

create index if not exists idx_workspace_requests_email_created
  on workspace_requests(lower(official_contact_email), created_at desc);

create index if not exists idx_workspace_requests_org
  on workspace_requests(organization_id)
  where organization_id is not null;

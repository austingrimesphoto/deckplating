create table if not exists organization_admin_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  passphrase_hash text not null,
  active boolean not null default true,
  last_used_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table organization_admin_credentials enable row level security;

drop trigger if exists organization_admin_credentials_set_updated_at on organization_admin_credentials;
create trigger organization_admin_credentials_set_updated_at
before update on organization_admin_credentials
for each row execute function set_updated_at();

create unique index if not exists idx_org_admin_credentials_org_unique
  on organization_admin_credentials(organization_id);

create index if not exists idx_org_admin_credentials_active
  on organization_admin_credentials(organization_id, active);

create table if not exists organization_setup_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  code_hash text not null unique,
  label text,
  purpose text not null default 'workspace_setup',
  active boolean not null default true,
  expires_at timestamptz null,
  used_at timestamptz null,
  used_by_label text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (purpose in ('workspace_setup', 'pilot_setup'))
);

alter table organization_setup_codes enable row level security;

drop trigger if exists organization_setup_codes_set_updated_at on organization_setup_codes;
create trigger organization_setup_codes_set_updated_at
before update on organization_setup_codes
for each row execute function set_updated_at();

create index if not exists idx_org_setup_codes_org_active
  on organization_setup_codes(organization_id, active);

create index if not exists idx_org_setup_codes_unused
  on organization_setup_codes(organization_id, expires_at)
  where active is true and used_at is null;

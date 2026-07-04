create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table organizations enable row level security;

drop trigger if exists organizations_set_updated_at on organizations;
create trigger organizations_set_updated_at
before update on organizations
for each row execute function set_updated_at();

insert into organizations (id, slug, name, active)
values (
  '00000000-0000-4000-8000-000000000001',
  'default',
  coalesce(nullif(current_setting('app.installation_name', true), ''), 'Default Organization'),
  true
)
on conflict (slug) do nothing;

alter table areas
  add column if not exists organization_id uuid not null default '00000000-0000-4000-8000-000000000001' references organizations(id);

alter table team_members
  add column if not exists organization_id uuid not null default '00000000-0000-4000-8000-000000000001' references organizations(id);

alter table devices
  add column if not exists organization_id uuid not null default '00000000-0000-4000-8000-000000000001' references organizations(id);

alter table locations
  add column if not exists organization_id uuid not null default '00000000-0000-4000-8000-000000000001' references organizations(id);

alter table units
  add column if not exists organization_id uuid not null default '00000000-0000-4000-8000-000000000001' references organizations(id);

alter table checkins
  add column if not exists organization_id uuid not null default '00000000-0000-4000-8000-000000000001' references organizations(id);

alter table checkin_batches
  add column if not exists organization_id uuid not null default '00000000-0000-4000-8000-000000000001' references organizations(id);

alter table app_settings
  add column if not exists organization_id uuid not null default '00000000-0000-4000-8000-000000000001' references organizations(id);

update areas set organization_id = '00000000-0000-4000-8000-000000000001' where organization_id is null;
update team_members set organization_id = '00000000-0000-4000-8000-000000000001' where organization_id is null;
update devices set organization_id = '00000000-0000-4000-8000-000000000001' where organization_id is null;
update locations set organization_id = '00000000-0000-4000-8000-000000000001' where organization_id is null;
update units set organization_id = '00000000-0000-4000-8000-000000000001' where organization_id is null;
update checkins set organization_id = '00000000-0000-4000-8000-000000000001' where organization_id is null;
update checkin_batches set organization_id = '00000000-0000-4000-8000-000000000001' where organization_id is null;
update app_settings set organization_id = '00000000-0000-4000-8000-000000000001' where organization_id is null;

alter table areas drop constraint if exists areas_name_key;
alter table units drop constraint if exists units_name_key;
alter table devices drop constraint if exists devices_device_token_hash_key;
alter table checkin_batches drop constraint if exists checkin_batches_client_batch_id_key;

create unique index if not exists idx_areas_org_name_unique
  on areas(organization_id, name);

create unique index if not exists idx_units_org_name_unique
  on units(organization_id, name);

create unique index if not exists idx_devices_org_token_unique
  on devices(organization_id, device_token_hash);

create unique index if not exists idx_checkin_batches_org_client_unique
  on checkin_batches(organization_id, client_batch_id);

create unique index if not exists idx_app_settings_org_key_unique
  on app_settings(organization_id, key);

create index if not exists idx_locations_org_area_id on locations(organization_id, area_id);
create index if not exists idx_units_org_location_id on units(organization_id, location_id);
create index if not exists idx_checkins_org_unit_time on checkins(organization_id, unit_id, checked_in_at desc);
create index if not exists idx_checkins_org_member_time on checkins(organization_id, team_member_id, checked_in_at desc);
create index if not exists idx_checkins_org_active_time on checkins(organization_id, checked_in_at desc) where voided_at is null;
create index if not exists idx_checkin_batches_org_location_time on checkin_batches(organization_id, location_id, occurred_at desc);

insert into app_settings (organization_id, key, value)
values ('00000000-0000-4000-8000-000000000001', 'gamification_tone', 'professional')
on conflict (organization_id, key) do nothing;

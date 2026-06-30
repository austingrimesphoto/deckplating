create extension if not exists pgcrypto;

create table if not exists areas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0
);

create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text,
  active boolean not null default true,
  pin_hash text,
  created_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references team_members(id),
  device_token_hash text not null unique,
  device_label text,
  active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references areas(id),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_meters integer not null default 120,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references locations(id),
  name text not null unique,
  unit_type text not null check (unit_type in ('department', 'tenant')),
  visit_interval_days integer not null default 30,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists checkins (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id),
  location_id uuid references locations(id),
  team_member_id uuid not null references team_members(id),
  device_id uuid references devices(id),
  checked_in_at timestamptz not null default now(),
  geofence_verified boolean not null default false,
  distance_meters integer,
  score_awarded integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_areas_sort_order on areas(sort_order);
create index if not exists idx_locations_area_id on locations(area_id);
create index if not exists idx_units_location_id on units(location_id);
create index if not exists idx_units_type_active on units(unit_type, active);
create index if not exists idx_checkins_unit_time on checkins(unit_id, checked_in_at desc);
create index if not exists idx_checkins_member_time on checkins(team_member_id, checked_in_at desc);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists locations_set_updated_at on locations;
create trigger locations_set_updated_at
before update on locations
for each row execute function set_updated_at();

drop trigger if exists units_set_updated_at on units;
create trigger units_set_updated_at
before update on units
for each row execute function set_updated_at();

alter table areas enable row level security;
alter table team_members enable row level security;
alter table devices enable row level security;
alter table locations enable row level security;
alter table units enable row level security;
alter table checkins enable row level security;

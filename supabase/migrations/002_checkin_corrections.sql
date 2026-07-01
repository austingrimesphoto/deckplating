alter table checkins
  add column if not exists voided_at timestamptz null,
  add column if not exists voided_by_team_member_id uuid null references team_members(id),
  add column if not exists void_reason text null,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by_team_member_id uuid null references team_members(id);

create index if not exists idx_checkins_active_unit_time
  on checkins(unit_id, checked_in_at desc)
  where voided_at is null;

drop trigger if exists checkins_set_updated_at on checkins;
create trigger checkins_set_updated_at
before update on checkins
for each row execute function set_updated_at();

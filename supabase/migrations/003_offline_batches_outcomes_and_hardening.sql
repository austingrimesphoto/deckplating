create table if not exists checkin_batches (
  id uuid primary key default gen_random_uuid(),
  client_batch_id uuid not null unique,
  location_id uuid null references locations(id),
  team_member_id uuid not null references team_members(id),
  device_id uuid not null references devices(id),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  confidential_care_provided boolean null,
  referral_provided boolean null,
  outcomes_recorded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_team_member_id uuid null references team_members(id)
);

alter table checkin_batches enable row level security;

drop trigger if exists checkin_batches_set_updated_at on checkin_batches;
create trigger checkin_batches_set_updated_at
before update on checkin_batches
for each row execute function set_updated_at();

alter table checkins
  add column if not exists batch_id uuid null references checkin_batches(id);

create index if not exists idx_checkins_batch_id on checkins(batch_id);

create unique index if not exists idx_checkins_unique_batch_unit
  on checkins(batch_id, unit_id)
  where batch_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'checkin_batches_confidential_care_true_or_null'
      and conrelid = 'checkin_batches'::regclass
  ) then
    alter table checkin_batches
      add constraint checkin_batches_confidential_care_true_or_null
      check (confidential_care_provided is null or confidential_care_provided is true)
      not valid;

    alter table checkin_batches validate constraint checkin_batches_confidential_care_true_or_null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'checkin_batches_referral_true_or_null'
      and conrelid = 'checkin_batches'::regclass
  ) then
    alter table checkin_batches
      add constraint checkin_batches_referral_true_or_null
      check (referral_provided is null or referral_provided is true)
      not valid;

    alter table checkin_batches validate constraint checkin_batches_referral_true_or_null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'checkins_void_reason_allowed'
      and conrelid = 'checkins'::regclass
  ) then
    alter table checkins
      add constraint checkins_void_reason_allowed
      check (
        void_reason is null
        or void_reason in (
          'immediate_undo',
          'accidental',
          'wrong_unit',
          'duplicate',
          'incorrect_datetime',
          'incorrect_member'
        )
      )
      not valid;

    alter table checkins validate constraint checkins_void_reason_allowed;
  end if;
end $$;

create or replace function prevent_duplicate_daily_location_checkin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit_day date := (new.occurred_at at time zone 'UTC')::date;
begin
  if new.location_id is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'deckplating:daily-location:' || new.organization_id::text || ':' || new.team_member_id::text || ':' ||
      new.location_id::text || ':' || v_visit_day::text,
      0
    )
  );

  if exists (
    select 1
    from public.checkin_batches as prior_batch
    join public.checkins as prior_checkin
      on prior_checkin.batch_id = prior_batch.id
      and prior_checkin.organization_id = prior_batch.organization_id
    where prior_batch.organization_id = new.organization_id
      and prior_batch.team_member_id = new.team_member_id
      and prior_batch.location_id = new.location_id
      and (prior_batch.occurred_at at time zone 'UTC')::date = v_visit_day
      and prior_checkin.voided_at is null
  ) then
    raise exception 'checkin_duplicate_daily' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists checkin_batches_prevent_duplicate_daily_location on checkin_batches;
create trigger checkin_batches_prevent_duplicate_daily_location
before insert on checkin_batches
for each row execute function prevent_duplicate_daily_location_checkin();

create or replace function prevent_duplicate_daily_unmapped_checkin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visit_day date := (new.checked_in_at at time zone 'UTC')::date;
begin
  if new.location_id is not null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'deckplating:daily-unmapped:' || new.organization_id::text || ':' || new.team_member_id::text || ':' ||
      new.unit_id::text || ':' || v_visit_day::text,
      0
    )
  );

  if exists (
    select 1
    from public.checkins as prior_checkin
    where prior_checkin.organization_id = new.organization_id
      and prior_checkin.team_member_id = new.team_member_id
      and prior_checkin.unit_id = new.unit_id
      and prior_checkin.location_id is null
      and (prior_checkin.checked_in_at at time zone 'UTC')::date = v_visit_day
      and prior_checkin.voided_at is null
  ) then
    raise exception 'checkin_duplicate_daily' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists checkins_prevent_duplicate_daily_unmapped on checkins;
create trigger checkins_prevent_duplicate_daily_unmapped
before insert on checkins
for each row execute function prevent_duplicate_daily_unmapped_checkin();

revoke all on function prevent_duplicate_daily_location_checkin() from public, anon, authenticated;
revoke all on function prevent_duplicate_daily_unmapped_checkin() from public, anon, authenticated;

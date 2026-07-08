create index if not exists idx_checkins_org_time_all
  on checkins(organization_id, checked_in_at desc);

create index if not exists idx_checkins_org_location_time
  on checkins(organization_id, location_id, checked_in_at desc);

create index if not exists idx_checkins_org_batch_time
  on checkins(organization_id, batch_id, checked_in_at desc)
  where batch_id is not null;

create index if not exists idx_checkins_org_voided_time
  on checkins(organization_id, voided_at, checked_in_at desc);

create index if not exists idx_checkin_batches_org_team_time
  on checkin_batches(organization_id, team_member_id, occurred_at desc);

create index if not exists idx_operator_audit_events_time
  on operator_audit_events(created_at desc);

create index if not exists idx_locations_org_name_lower
  on locations(organization_id, lower(name));

create index if not exists idx_units_org_name_lower
  on units(organization_id, lower(name));

create index if not exists idx_team_members_org_name_lower
  on team_members(organization_id, lower(name));

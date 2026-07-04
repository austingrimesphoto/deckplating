insert into areas (name, sort_order) values
  ('Ex: Truman Annex or 62 Area', 1)
on conflict (organization_id, name) do update set sort_order = excluded.sort_order;

insert into team_members (name, role, active) values
  ('Ex: Chaplain or RP1 Smith', 'RMT member', true)
on conflict do nothing;

insert into units (name, unit_type, visit_interval_days, active) values
  ('Ex: VFC-111 or 1st CEB', 'department', 30, true)
on conflict (organization_id, name) do update set
  unit_type = excluded.unit_type,
  visit_interval_days = excluded.visit_interval_days,
  active = excluded.active;

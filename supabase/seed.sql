insert into areas (name, sort_order) values
  ('Truman Annex', 1),
  ('Boca Chica', 2),
  ('Trumbo Point', 3),
  ('Sigsbee', 4),
  ('Medical', 5)
on conflict (name) do update set sort_order = excluded.sort_order;

insert into team_members (name, role, active) values
  ('Chaplain', 'chapel team', true),
  ('Religious Program Specialist', 'chapel team', true),
  ('Volunteer', 'chapel team', true)
on conflict do nothing;

insert into units (name, unit_type, visit_interval_days, active) values
  ('Admin', 'department', 30, true),
  ('Air Ops', 'department', 30, true),
  ('Security', 'department', 30, true),
  ('Emergency Management', 'department', 30, true),
  ('Environmental', 'department', 30, true),
  ('Fire', 'department', 30, true),
  ('FFSC', 'department', 30, true),
  ('Fuels', 'department', 30, true),
  ('Housing', 'department', 30, true),
  ('IT', 'department', 30, true),
  ('Training', 'department', 30, true),
  ('N9', 'department', 30, true),
  ('MER', 'department', 30, true),
  ('Navy Inn', 'department', 30, true),
  ('Public Affairs', 'department', 30, true),
  ('Public Works', 'department', 30, true),
  ('Safety', 'department', 30, true),
  ('SAPR', 'department', 30, true),
  ('SJA', 'department', 30, true),
  ('SFUWO', 'tenant', 30, true),
  ('ATMO', 'tenant', 30, true),
  ('ASD', 'tenant', 30, true),
  ('Balfour Beatty', 'tenant', 30, true),
  ('Coast Guard Sector', 'tenant', 30, true),
  ('IG', 'tenant', 30, true),
  ('Commissary', 'tenant', 30, true),
  ('EODTEU', 'tenant', 30, true),
  ('FLC', 'tenant', 30, true),
  ('FRC-SE', 'tenant', 30, true),
  ('Fleet Weather Center Norfolk', 'tenant', 30, true),
  ('ID Card Lab', 'tenant', 30, true),
  ('JIATF-S', 'tenant', 30, true),
  ('Branch Health Clinic', 'tenant', 30, true),
  ('NCIS', 'tenant', 30, true),
  ('NAVFAC', 'tenant', 30, true),
  ('Naval Research Lab', 'tenant', 30, true),
  ('Fleet Logistics Center', 'tenant', 30, true),
  ('Det KW', 'tenant', 30, true),
  ('NEX', 'tenant', 30, true),
  ('Sigsbee Charter', 'tenant', 30, true),
  ('Station SAR', 'tenant', 30, true),
  ('TCTS', 'tenant', 30, true),
  ('VFA-106', 'tenant', 30, true),
  ('VFC-111', 'tenant', 30, true)
on conflict (name) do update set
  unit_type = excluded.unit_type,
  visit_interval_days = excluded.visit_interval_days,
  active = excluded.active;

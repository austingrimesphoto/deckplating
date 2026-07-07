do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'app_settings_pkey'
      and conrelid = 'app_settings'::regclass
  ) then
    alter table app_settings drop constraint app_settings_pkey;
  end if;
end $$;

create unique index if not exists idx_app_settings_org_key_unique
  on app_settings(organization_id, key);

insert into app_settings (organization_id, key, value)
values ('00000000-0000-4000-8000-000000000001', 'gamification_tone', 'professional')
on conflict (organization_id, key) do nothing;

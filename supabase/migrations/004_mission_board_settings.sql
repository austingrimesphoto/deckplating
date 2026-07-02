create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

drop trigger if exists app_settings_set_updated_at on app_settings;
create trigger app_settings_set_updated_at
before update on app_settings
for each row execute function set_updated_at();

insert into app_settings (key, value)
values ('gamification_tone', 'professional')
on conflict (key) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_settings_gamification_tone_allowed'
      and conrelid = 'app_settings'::regclass
  ) then
    alter table app_settings
      add constraint app_settings_gamification_tone_allowed
      check (
        key <> 'gamification_tone'
        or value in ('professional', 'friendly', 'banter')
      )
      not valid;

    alter table app_settings validate constraint app_settings_gamification_tone_allowed;
  end if;
end $$;

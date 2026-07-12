-- Return only aggregate credential format/key counts. Stored hashes and
-- credential owners never cross this service-role-only function boundary.

create or replace function get_credential_rotation_inventory()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with credentials as (
    select 'team_member_pin'::text as credential_type, member.pin_hash as stored_hash
    from public.team_members member
    union all
    select 'organization_admin'::text, credential.passphrase_hash
    from public.organization_admin_credentials credential
  ), classified as (
    select
      credential_type,
      case
        when stored_hash is null or stored_hash = '' then 'none'
        when stored_hash like 'scrypt-v4$%'
          and cardinality(string_to_array(stored_hash, '$')) = 4 then 'scrypt-v4-keyed'
        when stored_hash like 'scrypt-v4$%' then 'scrypt-v4-unkeyed'
        when stored_hash like 'scrypt-v3$%' then 'scrypt-v3'
        when stored_hash like 'scrypt-v2$%' then 'scrypt-v2'
        when stored_hash like 'scrypt-v1$%' then 'scrypt-v1'
        when stored_hash like 'scrypt-%$%' then 'unknown-versioned'
        else 'legacy-unversioned'
      end as format,
      case
        when stored_hash like 'scrypt-v4$%'
          and cardinality(string_to_array(stored_hash, '$')) = 4
          then split_part(stored_hash, '$', 2)
        else null
      end as key_id
    from credentials
  ), counts as (
    select credential_type, format, key_id, count(*)::integer as count
    from classified
    group by credential_type, format, key_id
  )
  select jsonb_build_object(
    'total', (select count(*) from credentials),
    'counts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'credentialType', credential_type,
          'format', format,
          'keyId', key_id,
          'count', count
        ) order by credential_type, format, key_id nulls first
      )
      from counts
    ), '[]'::jsonb)
  );
$$;

revoke all on function get_credential_rotation_inventory() from public, anon, authenticated;
grant execute on function get_credential_rotation_inventory() to service_role;

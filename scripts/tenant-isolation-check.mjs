import fs from 'node:fs';

const files = {
  api: fs.readFileSync(new URL('../netlify/functions/api.ts', import.meta.url), 'utf8'),
  credentialCodec: fs.readFileSync(new URL('../netlify/functions/lib/credential-codec.ts', import.meta.url), 'utf8'),
  app: fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  offline: fs.readFileSync(new URL('../src/offline.ts', import.meta.url), 'utf8'),
  migration005: fs.readFileSync(new URL('../supabase/migrations/005_multi_site_foundation.sql', import.meta.url), 'utf8'),
  migration007: fs.readFileSync(new URL('../supabase/migrations/007_app_settings_workspace_key.sql', import.meta.url), 'utf8'),
  migration008: fs.readFileSync(new URL('../supabase/migrations/008_operator_audit_events.sql', import.meta.url), 'utf8'),
  migration010: fs.readFileSync(new URL('../supabase/migrations/010_workspace_request_queue.sql', import.meta.url), 'utf8'),
  migration011: fs.readFileSync(new URL('../supabase/migrations/011_security_reliability_hardening.sql', import.meta.url), 'utf8'),
  migration013: fs.readFileSync(new URL('../supabase/migrations/013_large_workspace_reads.sql', import.meta.url), 'utf8'),
  notifications: fs.readFileSync(new URL('../src/lib/notifications.ts', import.meta.url), 'utf8'),
};

const checks = [];

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  if (startIndex === -1) return '';
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : -1;
  return source.slice(startIndex, endIndex === -1 ? source.length : endIndex);
}

function check(name, passed, detail) {
  checks.push({ name, passed, detail });
}

function has(source, pattern) {
  return pattern instanceof RegExp ? pattern.test(source) : source.includes(pattern);
}

const api = files.api;
const credentialCodec = files.credentialCodec;
const userToken = section(api, 'async function requireUser', 'async function getCoverage');
const adminToken = section(api, 'async function requireAdmin', 'async function tryOrganizationAdminLogin');
const checkinRoute = section(api, "if (method === 'POST' && path === '/checkins')", "if (method === 'POST' && path === '/checkins/undo')");
const undoRoute = section(api, "if (method === 'POST' && path === '/checkins/undo')", 'const indicatorMatch');
const indicatorRoute = section(api, 'const indicatorMatch', "if (method === 'GET' && path === '/dashboard')");
const operatorRoutes = section(api, "if (method === 'GET' && path === '/operator/organizations')", "if (method === 'GET' && path === '/workspaces/resolve')");
const workspaceRequestPublic = section(api, "if (method === 'POST' && path === '/workspace-requests')", "if (method === 'GET' && path === '/installations/search')");
const operatorWorkspaceRequests = section(api, "if (method === 'GET' && path === '/operator/workspace-requests')", "if (method === 'GET' && path === '/operator/audit-events')");
const operatorWorkspaceRejection = section(api, 'const operatorRequestRejectMatch', "if (method === 'GET' && path === '/operator/audit-events')");
const operatorAuthentication = section(api, 'const createOperatorToken', 'async function recordOperatorAudit');
const operatorOrganizations = section(api, "if (method === 'GET' && path === '/operator/organizations')", "if (method === 'POST' && path === '/operator/organizations')");
const operatorAdminSession = section(api, 'const operatorAdminSessionMatch', 'const operatorSetupCodeMatch');
const operatorExport = section(api, 'const operatorExportMatch', 'const operatorSetupCodeMatch');
const operatorSetupCodeCreate = section(api, 'const operatorSetupCodeMatch', 'const operatorCodeRevokeMatch');
const operatorSetupCodeRevoke = section(api, 'const operatorCodeRevokeMatch', 'const operatorOrganizationStatusMatch');
const operatorStatusRoute = section(api, 'const operatorOrganizationStatusMatch', 'const operatorAdminRecoveryMatch');
const operatorAdminRecovery = section(api, 'const operatorAdminRecoveryMatch', "if (method === 'GET' && path === '/workspaces/resolve')");
const operatorDeleteRoute = section(api, 'const operatorDeleteOrganizationMatch', "if (method === 'GET' && path === '/workspaces/resolve')");
const setupActivation = section(api, "if (method === 'POST' && path === '/workspaces/activate')", "if (method === 'POST' && path === '/admin/login')");
const adminLoginRoute = section(api, "if (method === 'POST' && path === '/admin/login')", 'const adminContext = path.startsWith');
const adminPassphraseRotation = section(api, "if (method === 'POST' && path === '/admin/organization-admin/passphrase')", "if (method === 'GET' && path === '/admin/settings')");
const adminRoutes = section(api, "const adminContext = path.startsWith('/admin/')", 'return json(404');
const adminCorrection = section(api, 'const adminCheckinMatch', "if (method === 'POST' && path === '/admin/locations')");
const adminLocations = section(api, "if (method === 'POST' && path === '/admin/locations')", "if (method === 'POST' && path === '/admin/units')");
const adminUnits = section(api, "if (method === 'POST' && path === '/admin/units')", "if (method === 'POST' && path === '/admin/team-members')");
const adminMemberReset = section(api, 'const memberResetPinMatch', 'return json(404');
const registerDevice = section(api, 'async function registerDevice', 'async function route');
const changePin = section(api, "if (method === 'POST' && path === '/device/change-pin')", "if (method === 'POST' && path === '/device/change-identity')");
const changeIdentity = section(api, "if (method === 'POST' && path === '/device/change-identity')", "if (method === 'GET' && path === '/nearby-locations')");

check(
  'PIN hashes include organization context with legacy upgrade path',
  has(api, 'pinCredentialContext') &&
    has(api, "`pin:${organizationId ?? 'single-org'}:${teamMemberId}`") &&
    has(registerDevice, 'verifyCredentialHash(') &&
    has(registerDevice, 'legacyPinHash(body.teamMemberId, body.pin)') &&
    has(registerDevice, 'createCredentialHash(pinCredentialContext(') &&
    has(registerDevice, 'scoped(update, organizationId)') &&
    has(credentialCodec, "rawDedicated: 'scrypt-v2'") &&
    has(credentialCodec, "sessionDerived: 'scrypt-v3'") &&
    has(credentialCodec, "dedicated: 'scrypt-v4'") &&
    has(credentialCodec, "deriveCredentialPepper(adminSessionSecret, 'session-root-v1')") &&
    has(credentialCodec, 'verificationPepper = credentialPepper') &&
    has(credentialCodec, 'verificationPepper = sessionDerivedCredentialPepper') &&
    has(credentialCodec, 'verificationPepper = dedicatedCredentialPepper') &&
    has(api, 'configuredCredentialPepper && Buffer.byteLength(configuredCredentialPepper'),
);
check('Signed user sessions derive organization scope server-side', has(userToken, 'parsed.organizationId') && has(userToken, 'scoped(baseQuery, organizationId)') && has(userToken, 'member.organization_id !== organizationId'));
check(
  'User and operator token kinds cannot be interpreted as admin sessions',
  has(adminToken, '!parsed.authMethod') &&
    has(adminToken, "['organization', 'environment', 'superuser']") &&
    has(adminToken, "parsed.kind !== 'admin'") &&
    has(userToken, "parsed.kind !== 'user'") &&
    has(api, "parsed.kind !== 'operator'"),
);
check(
  'Central operator passphrase rotation invalidates previously issued operator tokens',
  has(operatorAuthentication, 'credentialVersion: operatorCredentialVersion()') &&
    has(operatorAuthentication, "constantTimeEqual(parsed.credentialVersion ?? '', operatorCredentialVersion())") &&
    has(api, "'operator-login-global'") &&
    has(api, "'central-operator', false"),
);
check(
  'User and admin sessions are invalidated when workspace status changes',
  has(api, 'organizationSessionState') &&
    has(api, 'organizationUpdatedAt') &&
    has(userToken, 'organizationState.updated_at !== (parsed.organizationUpdatedAt ?? null)') &&
    has(api, 'adminCredentialUpdatedAt') &&
    has(api, "organizationState.updated_at !== (parsed.organizationUpdatedAt ?? null)")
);
check('Bootstrap/dashboard/leaderboard use token organization scope', has(api, "path === '/bootstrap'") && has(api, 'getCoverage(user.organizationId)') && has(api, "path === '/dashboard'") && has(api, "path === '/leaderboard'") && has(section(api, "path === '/leaderboard'", "if (method === 'POST' && path === '/workspaces/activate')"), 'user.organizationId'));
check('Mission Board month, week, and active-day calculations use the requesting device time zone', has(api, 'const timeZone = parseTimeZone(params.timeZone)') && has(api, 'zonedMidnight(calendarMonthStart, timeZone)') && has(api, 'p_time_zone: timeZone') && has(files.migration013, 'checked_in_at at time zone p_time_zone') && has(files.app, "params.set('timeZone', timeZone)"));
check(
  'Check-in creation validates units and commits idempotency, scoring, and inserts transactionally',
  has(checkinRoute, 'scoped(unitsQuery, user.organizationId)') &&
    has(checkinRoute, "supabase.rpc('create_checkin_batch'") &&
    has(checkinRoute, 'p_request_fingerprint: requestFingerprint') &&
    has(files.migration011, 'checkin_batches_request_fingerprint_valid') &&
    has(files.migration011, 'create or replace function create_checkin_batch') &&
    has(files.migration011, 'checkin_batch_conflict'),
);
check('Nearby discovery and check-in verification share the same bounded GPS accuracy tolerance', has(api, 'const accuracyTolerance = Math.min(suppliedAccuracy, 300)') && has(api, 'location.radius_meters + accuracyTolerance') && has(checkinRoute, 'accuracyMeters: body.manual ? null : accuracyTolerance'));
check('Units assigned to inactive locations fall back to the unmapped manual workflow', has(api, 'location_id: location?.id ?? null') && has(checkinRoute, 'unit.locations?.active ? unit.location_id : null') && has(checkinRoute, 'const location = unit?.locations?.active ? unit.locations : null'));
check(
  'Check-in scoring is workspace scoped and serialized per unit',
  has(files.migration011, "'deckplating:unit:' || p_organization_id::text") &&
    has(files.migration011, 'pg_advisory_xact_lock') &&
    has(files.migration011, 'checkin.organization_id = p_organization_id') &&
    has(files.migration011, "interval '14 days'") &&
    has(files.migration011, 'insert into public.checkins'),
);
check('Mission Board totals and first visits aggregate in the database instead of loading full history', has(api, "supabase.rpc('get_leaderboard_period'") && has(files.migration013, 'create or replace function get_leaderboard_period') && has(files.migration013, 'group by checkin.unit_id'));
check('Check-in batch idempotency is organization-unique in schema', has(files.migration005, 'drop constraint if exists checkin_batches_client_batch_id_key') && has(files.migration005, 'on checkin_batches(organization_id, client_batch_id)'));
check(
  'Database foreign keys enforce tenant-consistent relationships',
  has(files.migration011, 'devices_team_member_organization_fkey') &&
    has(files.migration011, 'checkins_unit_organization_fkey') &&
    has(files.migration011, 'checkins_batch_organization_fkey') &&
    has(files.migration011, 'workspace_requests_setup_code_organization_fkey') &&
    has(files.migration011, 'validate constraint checkins_unit_organization_fkey') &&
    has(files.migration011, 'drop constraint checkins_unit_id_fkey') &&
    has(files.migration011, 'rename constraint checkins_unit_organization_fkey to checkins_unit_id_fkey') &&
    has(api, 'team_members!checkins_team_member_id_fkey'),
);
check('App settings are unique by workspace instead of globally by key', has(files.migration007, 'drop constraint app_settings_pkey') && has(files.migration007, 'on app_settings(organization_id, key)'));
check('Indicator updates cannot cross organizations or devices', has(indicatorRoute, 'scoped(batchQuery, user.organizationId)') && has(indicatorRoute, 'batch.team_member_id !== user.teamMemberId') && has(indicatorRoute, 'batch.device_id !== user.deviceId') && has(indicatorRoute, 'scoped(indicatorQuery, user.organizationId)'));
check('Immediate undo is scoped to user and organization', has(undoRoute, 'scoped(ownedQuery, user.organizationId)') && has(undoRoute, 'eq(\'team_member_id\', user.teamMemberId)') && has(undoRoute, 'scoped(undoQuery, user.organizationId)'));
check('Immediate undo reconciles an uploaded offline visit by its owned client batch ID', has(undoRoute, 'clientBatchId') && has(undoRoute, "from('checkin_batches')") && has(undoRoute, "from('checkins')") && has(undoRoute, 'Uploaded visit not found.'));
check(
  'Device registration is workspace scoped and serialized against administrator PIN resets',
  has(registerDevice, 'resolveOrganizationId(body.organizationId)') &&
    has(registerDevice, 'scoped(memberQuery, organizationId)') &&
    has(registerDevice, "supabase.rpc('register_member_device'") &&
    has(registerDevice, 'p_expected_pin_hash: member.pin_hash ?? null') &&
    has(files.migration011, 'create or replace function register_member_device') &&
    has(section(files.migration011, 'create or replace function register_member_device', 'create or replace function change_member_pin'), 'for update') &&
    has(files.migration011, 'v_member.pin_hash is distinct from p_expected_pin_hash'),
);
check('Identity change reuses authenticated organization only', has(changeIdentity, 'requireUser(event)') && has(changeIdentity, 'scoped(currentQuery, user.organizationId)') && has(changeIdentity, 'organizationId: user.organizationId'));
check(
  'Authentication attempts use a persistent server-side rate limiter',
  has(api, "supabase.rpc('consume_api_rate_limit'") &&
    has(api, "'device-register-member'") &&
    has(api, "'device-register-member-daily'") &&
    has(api, 'body.teamMemberId.toLowerCase()') &&
    has(api, "'admin-login-workspace'") &&
    has(api, "const address = includeClientAddress ? clientAddress(event) : 'all-clients'") &&
    has(api, "'operator-login'") &&
    has(files.migration011, 'create table if not exists api_rate_limits') &&
    has(files.migration011, 'security definer') &&
    has(files.migration011, 'revoke all on function consume_api_rate_limit'),
);
check('Public installation lookups are cached and globally limited to the upstream service policy', has(api, 'installationSearchCache.get(normalized)') && has(api, "'nominatim-search-global', 1, 1") && has(api, "'user-agent': 'Deckplating/0.1 (+https://deckplating.netlify.app)'"));
check('Opaque local-file CORS is restricted to the read-only installation lookup route', has(api, "origin === 'null' && normalizePath(event) === '/installations/search'") && has(files.api, 'allowedCorsOrigins.has(origin) || localWizardSearch'));
check('API CORS responses use an explicit origin allowlist instead of a wildcard', has(api, "allowedCorsOrigins.has(origin)") && has(api, "delete headers['access-control-allow-origin']") && !has(api, "'access-control-allow-origin': '*'"));
check('Unexpected server and database errors are logged by request ID and sanitized for clients', has(api, "error: 'An internal server error occurred.', requestId") && has(api, "console.error('Unhandled API error.'") && !has(api, /return json\(500, \{ error: [^}]*\.message/));
check('Workspace resolution returns typed client errors without exposing database faults', has(api, "new RequestValidationError(404, 'Workspace not found or inactive.')") && has(api, 'if (error instanceof RequestValidationError) return json(error.statusCode') && !has(section(api, "path === '/workspaces/resolve'", "path === '/team-members'"), 'errorMessage(error)'));
check(
  'Sign-out revokes the authenticated device inside its workspace',
  has(api, "path === '/device/logout'") &&
    has(api, ".eq('id', user.deviceId)") &&
    has(api, 'scoped(deviceUpdate, user.organizationId)') &&
    has(files.app, "api('/api/device/logout'"),
);
check('Admin routes require signed admin context and use its organization scope', has(adminRoutes, 'await requireAdmin(event)') && has(adminRoutes, 'adminContext!.organizationId'));
check('Managed hosts fail closed when organization schema checks error', has(api, 'managedHostEnabled') && has(api, 'if (managedHostEnabled || !isMissingRelationError(error)) throw error'));
check('Managed host disables environment admin fallback for workspace admin login', has(api, 'if (managedHostEnabled && organizationId) return null'));
check('Admin correction validates all referenced member/unit IDs inside organization', has(adminCorrection, 'validateTeamMemberReferences') && has(adminCorrection, 'scoped(unitQuery, organizationId)') && has(adminCorrection, 'scoped(checkinUpdateQuery, organizationId)'));
check('Admin correction gates visit flags and updates only through the scoped check-in batch', has(api, 'const ministryIndicatorsEnabled') && has(adminCorrection, 'if (!ministryIndicatorsEnabled)') && has(adminCorrection, "from('checkin_batches')") && has(adminCorrection, 'scoped(batchUpdate, organizationId)'));
check('Admin location mutations validate area and assigned units inside organization', has(adminLocations, 'validateLocationReferences') && has(adminLocations, 'validateUnitAssignment') && has(adminLocations, 'scoped(locationUpdate, organizationId)') && has(adminLocations, 'scoped(unitUpdate, organizationId)'));
check('Admin unit mutations validate referenced locations inside organization', has(adminUnits, 'validateUnitReferences') && has(adminUnits, 'scoped(unitUpdate, organizationId)'));
check(
  'Operator routes require central operator token and omit stored hashes',
  has(api, "path.startsWith('/operator/')") &&
    has(api, 'await requireOperator(event)') &&
    !has(operatorOrganizations, 'code_hash') &&
    !has(operatorOrganizations, 'passphrase_hash') &&
    !has(operatorSetupCodeCreate, '.select(\'code_hash') &&
    !has(operatorSetupCodeCreate, 'passphrase_hash') &&
    !has(operatorSetupCodeRevoke, '.select(\'code_hash') &&
    !has(operatorSetupCodeRevoke, 'passphrase_hash') &&
    !has(operatorStatusRoute, 'passphrase_hash') &&
    !has(operatorAdminRecovery, '.select(\'passphrase_hash') &&
    !has(operatorDeleteRoute, 'passphrase_hash'),
);
check(
  'Workspace request approval is transactional, operator-gated, audited, and omits setup-code hashes from results',
  has(files.migration010, 'create table if not exists workspace_requests') &&
    has(workspaceRequestPublic, "from('workspace_requests').insert") &&
    has(api, 'safe_use_boundaries_confirmed') &&
    has(operatorWorkspaceRequests, 'const operatorRequestApproveMatch = path.match') &&
    has(operatorWorkspaceRequests, '/operator\\/workspace-requests') &&
    has(operatorWorkspaceRequests, "supabase.rpc('approve_workspace_request'") &&
    has(operatorWorkspaceRequests, 'workspace_request_approved') &&
    has(operatorWorkspaceRequests, 'notifyRequestorOfApproval') &&
    has(files.migration011, "to_jsonb(v_setup_code) - 'code_hash'") &&
    has(files.migration011, 'for update') &&
    !has(operatorWorkspaceRequests, 'passphrase_hash')
);
check(
  'Workspace request rejection serializes against approval and transitions only pending requests',
  has(operatorWorkspaceRejection, "supabase.rpc('reject_workspace_request'") &&
    has(operatorWorkspaceRejection, 'workspace_request_not_pending') &&
    has(files.migration011, 'create or replace function reject_workspace_request') &&
    has(files.migration011, "if v_request.status <> 'pending'") &&
    has(section(files.migration011, 'create or replace function reject_workspace_request', 'create or replace function activate_deckplating_workspace'), 'for update'),
);
check('Workspace approval notifications default to disabled and return copyable text', has(files.notifications, "mode === 'disabled'") && has(files.notifications, "status: 'skipped: notifications disabled'") && has(files.notifications, 'text: message.text'));
check('Workspace approval mailto mode generates a prefilled message without sending', has(files.notifications, "mode === 'mailto'") && has(files.notifications, 'mailtoUrl') && has(files.notifications, 'URLSearchParams'));
check(
  'Notifications expose only implemented delivery modes and providers fail closed without configuration',
    has(files.notifications, "['disabled', 'mailto', 'provider']") &&
    !has(files.notifications, "mode === 'smtp'") &&
    !has(files.notifications, "'graph'") &&
    has(files.notifications, 'provider notification environment not configured') &&
    has(api, "if (normalizedNotificationMode !== 'provider')") &&
    has(api, "'skipped: notifications disabled'"),
);
check('Notification audit metadata excludes setup-code plaintext', has(operatorWorkspaceRequests, 'workspace_approval_notification_prepared') && has(operatorWorkspaceRequests, 'recipientEmail: requestorNotification.recipientEmail') && has(operatorWorkspaceRequests, 'status: requestorNotification.status') && !has(section(operatorWorkspaceRequests, 'workspace_approval_notification_prepared', 'await supabase'), 'setup.code'));
check(
  'Operator superuser admin sessions are scoped and audited',
  has(operatorAdminSession, "path.match(/^\\/operator\\/organizations\\/([^/]+)\\/admin-session$/)") &&
    has(operatorAdminSession, 'recordOperatorAudit') &&
    has(operatorAdminSession, 'superuser_admin_session_started') &&
    has(operatorAdminSession, "authMethod: 'superuser'") &&
    has(operatorAdminSession, 'createAdminToken({ organizationId, authMethod:') &&
    has(files.migration008, 'operator_audit_events')
);
check(
  'Operator safe export is scoped, audited, and excludes stored secrets',
  has(operatorExport, "path.match(/^\\/operator\\/organizations\\/([^/]+)\\/export$/)") &&
    has(operatorExport, "tryRecordOperatorAudit(organizationId, 'workspace_safe_export_downloaded'") &&
    has(operatorExport, "format: 'deckplating-safe-operator-export-v1'") &&
    !has(operatorExport, 'passphrase_hash') &&
    !has(operatorExport, 'pin_hash') &&
    !has(operatorExport, 'device_token_hash') &&
    !has(operatorExport, 'code_hash') &&
    !has(operatorExport, "from('devices')") &&
    !has(operatorExport, 'device_id')
);
check(
  'Operator workspace lifecycle controls update only intended workspace state',
  has(operatorStatusRoute, "path.match(/^\\/operator\\/organizations\\/([^/]+)\\/status$/)") &&
    has(operatorStatusRoute, ".update({ active: body.active })") &&
    has(operatorStatusRoute, ".eq('id', organizationId)")
);
check(
  'Operator admin recovery rotates only the selected workspace admin hash',
  has(operatorAdminRecovery, "path.match(/^\\/operator\\/organizations\\/([^/]+)\\/admin-passphrase$/)") &&
    has(operatorAdminRecovery, 'createCredentialHash(organizationAdminCredentialContext(organizationId), body.passphrase)') &&
    has(operatorAdminRecovery, "onConflict: 'organization_id'")
);
check(
  'Operator delete uses one transaction for the selected workspace and its owned data',
  has(operatorDeleteRoute, "path.match(/^\\/operator\\/organizations\\/([^/]+)\\/delete$/)") &&
    has(operatorDeleteRoute, "confirmSlug must match the workspace slug") &&
    has(operatorDeleteRoute, "supabase.rpc('delete_deckplating_organization'") &&
    has(files.migration011, 'create or replace function delete_deckplating_organization') &&
    has(files.migration011, 'delete from public.workspace_requests') &&
    has(files.migration011, 'delete from public.organization_setup_codes') &&
    has(files.migration011, 'delete from public.organization_admin_credentials')
);
check(
  'Setup-code activation rejects invalid codes and commits setup state in one transaction',
  has(api, 'async function verifySetupCode') &&
    has(api, ".eq('code_hash', hash)") &&
    has(api, ".eq('active', true)") &&
    has(api, 'data.used_at') &&
    has(api, 'data.expires_at && data.expires_at < now') &&
    has(setupActivation, "supabase.rpc('activate_deckplating_workspace'") &&
    has(files.migration011, 'create or replace function activate_deckplating_workspace') &&
    has(files.migration011, 'for update of setup_code, organization') &&
    has(files.migration011, "insert into public.app_settings") &&
    has(files.migration011, 'insert into public.organization_admin_credentials') &&
    has(files.migration011, 'admin_credential_updated_at timestamptz') &&
    has(setupActivation, 'adminCredentialUpdatedAt: activation.admin_credential_updated_at'),
);
check(
  'Organization administrator login and rotation preserve the exact verified credential version',
  has(api, ".eq('passphrase_hash', data.passphrase_hash)") &&
    has(api, 'credentialUpdatedAt = upgraded.updated_at') &&
    has(adminLoginRoute, 'organizationStateAtLogin?.updated_at') &&
    has(adminPassphraseRotation, ".eq('updated_at', adminContext!.adminCredentialUpdatedAt)") &&
    has(adminPassphraseRotation, 'administrator credential changed'),
);
check(
  'Managed roster claims and PIN resets use administrator-issued PINs and revoke same-workspace devices',
  has(api, "path.match(/^\\/admin\\/team-members\\/([^/]+)\\/reset-pin$/)") &&
    has(registerDevice, '!member.pin_hash && managedHostEnabled') &&
    has(api, 'const temporaryPin = managedHostEnabled ? createTemporaryPin() : null') &&
    has(api, 'const replacementPinHash = await createCredentialHash') &&
    has(api, "supabase.rpc('reset_member_pin'") &&
    has(files.migration011, 'create or replace function reset_member_pin') &&
    has(files.migration011, 'where organization_id = p_organization_id') &&
    has(files.migration011, 'and team_member_id = p_team_member_id')
);
check('Team member deactivation and reactivation both revoke prior workspace devices transactionally', has(api, "supabase.rpc('set_team_member_active'") && has(files.migration011, 'create or replace function set_team_member_active') && has(files.migration011, 'set active = false') && has(files.migration011, 'team_member_id = p_team_member_id'));
check(
  'Self-service PIN changes verify the active device and update only the signed-in workspace member',
  has(changePin, 'await requireUser(event)') &&
    has(changePin, 'verifyDevice(user.teamMemberId, deviceToken, user.organizationId)') &&
    has(changePin, 'currentDevice.id !== user.deviceId') &&
    has(changePin, 'verifyCredentialHash(') &&
    has(changePin, "supabase.rpc('change_member_pin'") &&
    has(changePin, 'p_expected_pin_hash: member.pin_hash') &&
    has(files.migration011, 'create or replace function change_member_pin') &&
    has(section(files.migration011, 'create or replace function change_member_pin', 'create or replace function reset_member_pin'), 'for update') &&
    has(files.migration011, 'v_member.pin_hash is distinct from p_expected_pin_hash') &&
    has(files.migration011, 'id = p_current_device_id') &&
    has(files.migration011, 'organization_id = p_organization_id') &&
    has(files.migration011, 'team_member_id = p_team_member_id') &&
    has(files.migration011, 'id <> p_current_device_id')
);
check('Offline pending batches are partitioned by organization', has(files.offline, 'getPendingBatches(teamMemberId?: string, organizationId?: string | null)') && has(files.offline, '(batch.organizationId ?? null) !== (organizationId ?? null)') && has(files.app, 'getPendingBatches(currentIdentity.teamMemberId, currentIdentity.organizationId ?? null)') && has(files.app, 'countBlockingPendingBatches(currentIdentity.teamMemberId, currentIdentity.organizationId ?? null)'));
check('Legacy offline batches migrate to the default workspace and synced tombstones are purged', has(files.offline, "openDB<DeckplateOfflineDb>('deckplate-coverage-offline', 3") && has(files.offline, 'organizationId: legacyDefaultOrganizationId') && has(files.offline, "batch.syncStatus === 'synced'") && has(files.offline, 'cursor.delete()'));
check('Failed offline visits remain recoverable without blocking later batches', has(files.app, 'deterministicClientFailure') && has(files.app, 'deterministicFailures += 1') && has(files.app, 'discardFailedBatch') && has(files.app, 'Saved visits need attention'));
check('Queued confirmations are promoted after automatic sync and reconcile undo by batch ID', has(files.app, 'batchSyncedEvent') && has(files.app, 'new CustomEvent<BatchSyncedDetail>') && has(files.app, 'getPendingBatch(confirmation.clientBatchId)') && has(files.app, '{ clientBatchId: confirmation.clientBatchId }'));
check('Identity and map changes cannot retain stale administrator state or overwrite form fields', has(files.app, "removeSessionValue('deckplate.admin');\n    setShowAdminSetup(false);\n    setIdentity(nextIdentity)") && has(files.app, 'onChangeRef.current') && has(files.app, 'setLocationForm((current) => ({'));

const failed = checks.filter((candidate) => !candidate.passed);
for (const candidate of checks) {
  const prefix = candidate.passed ? 'PASS' : 'FAIL';
  console.log(`${prefix} ${candidate.name}${candidate.detail ? ` - ${candidate.detail}` : ''}`);
}

if (failed.length) {
  console.error(`\n${failed.length} tenant-isolation check(s) failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} tenant-isolation checks passed.`);

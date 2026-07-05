import fs from 'node:fs';

const files = {
  api: fs.readFileSync('netlify/functions/api.ts', 'utf8'),
  app: fs.readFileSync('src/App.tsx', 'utf8'),
  offline: fs.readFileSync('src/offline.ts', 'utf8'),
  migration005: fs.readFileSync('supabase/migrations/005_multi_site_foundation.sql', 'utf8'),
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
const userToken = section(api, 'async function requireUser', 'async function getCoverage');
const checkinRoute = section(api, "if (method === 'POST' && path === '/checkins')", "if (method === 'POST' && path === '/checkins/undo')");
const undoRoute = section(api, "if (method === 'POST' && path === '/checkins/undo')", 'const indicatorMatch');
const indicatorRoute = section(api, 'const indicatorMatch', "if (method === 'GET' && path === '/dashboard')");
const operatorRoutes = section(api, "if (method === 'GET' && path === '/operator/organizations')", "if (method === 'GET' && path === '/workspaces/resolve')");
const operatorOrganizations = section(api, "if (method === 'GET' && path === '/operator/organizations')", "if (method === 'POST' && path === '/operator/organizations')");
const operatorSetupCodeCreate = section(api, 'const operatorSetupCodeMatch', 'const operatorCodeRevokeMatch');
const operatorSetupCodeRevoke = section(api, 'const operatorCodeRevokeMatch', 'const operatorOrganizationStatusMatch');
const operatorStatusRoute = section(api, 'const operatorOrganizationStatusMatch', 'const operatorAdminRecoveryMatch');
const operatorAdminRecovery = section(api, 'const operatorAdminRecoveryMatch', "if (method === 'GET' && path === '/workspaces/resolve')");
const setupActivation = section(api, "if (method === 'POST' && path === '/workspaces/activate')", "if (method === 'POST' && path === '/admin/login')");
const adminRoutes = section(api, "const adminContext = path.startsWith('/admin/')", 'return json(404');
const adminCorrection = section(api, 'const adminCheckinMatch', "if (method === 'POST' && path === '/admin/locations')");
const adminLocations = section(api, "if (method === 'POST' && path === '/admin/locations')", "if (method === 'POST' && path === '/admin/units')");
const adminUnits = section(api, "if (method === 'POST' && path === '/admin/units')", "if (method === 'POST' && path === '/admin/team-members')");
const adminMemberReset = section(api, 'const memberResetPinMatch', 'return json(404');
const registerDevice = section(api, 'async function registerDevice', 'async function route');
const changeIdentity = section(api, "if (method === 'POST' && path === '/device/change-identity')", "if (method === 'GET' && path === '/nearby-locations')");

check('PIN hashes include organization context with legacy upgrade path', has(api, /const pinHash = .*organizationId/s) && has(api, 'legacyPinHash') && has(registerDevice, "member.pin_hash === oldPinHash"));
check('Signed user sessions derive organization scope server-side', has(userToken, 'parsed.organizationId') && has(userToken, 'scoped(baseQuery, organizationId)') && has(userToken, 'member.organization_id !== organizationId'));
check(
  'User and admin sessions are invalidated when workspace status changes',
  has(api, 'organizationSessionState') &&
    has(api, 'organizationUpdatedAt') &&
    has(userToken, 'organizationState.updated_at !== (parsed.organizationUpdatedAt ?? null)') &&
    has(api, 'adminCredentialUpdatedAt') &&
    has(api, "organizationState.updated_at !== (parsed.organizationUpdatedAt ?? null)")
);
check('Bootstrap/dashboard/leaderboard use token organization scope', has(api, "path === '/bootstrap'") && has(api, 'getCoverage(user.organizationId)') && has(api, "path === '/dashboard'") && has(api, "path === '/leaderboard'") && has(section(api, "path === '/leaderboard'", "if (method === 'POST' && path === '/workspaces/activate')"), 'user.organizationId'));
check('Check-in creation validates units and idempotency inside organization', has(checkinRoute, 'scoped(unitsQuery, user.organizationId)') && has(checkinRoute, 'scoped(batchLookupQuery, user.organizationId)') && has(checkinRoute, 'withOrganization({') && has(checkinRoute, 'scoped(existingQuery, user.organizationId)') && has(checkinRoute, 'scoped(retryQuery, user.organizationId)'));
check('Check-in scoring history stays organization scoped', has(checkinRoute, 'scoped(recentQuery, user.organizationId)') && has(checkinRoute, 'scoped(priorQuery, user.organizationId)'));
check('Check-in batch idempotency is organization-unique in schema', has(files.migration005, 'drop constraint if exists checkin_batches_client_batch_id_key') && has(files.migration005, 'on checkin_batches(organization_id, client_batch_id)'));
check('Indicator updates cannot cross organizations or devices', has(indicatorRoute, 'scoped(batchQuery, user.organizationId)') && has(indicatorRoute, 'batch.team_member_id !== user.teamMemberId') && has(indicatorRoute, 'batch.device_id !== user.deviceId') && has(indicatorRoute, 'scoped(indicatorQuery, user.organizationId)'));
check('Immediate undo is scoped to user and organization', has(undoRoute, 'scoped(ownedQuery, user.organizationId)') && has(undoRoute, 'eq(\'team_member_id\', user.teamMemberId)') && has(undoRoute, 'scoped(undoQuery, user.organizationId)'));
check('Device registration only targets the selected active workspace', has(registerDevice, 'resolveOrganizationId(body.organizationId)') && has(registerDevice, 'scoped(memberQuery, organizationId)') && has(registerDevice, "onConflict: organizationId ? 'organization_id,device_token_hash' : 'device_token_hash'"));
check('Identity change reuses authenticated organization only', has(changeIdentity, 'requireUser(event)') && has(changeIdentity, 'scoped(currentQuery, user.organizationId)') && has(changeIdentity, 'organizationId: user.organizationId'));
check('Admin routes require signed admin context and use its organization scope', has(adminRoutes, 'await requireAdmin(event)') && has(adminRoutes, 'adminContext!.organizationId'));
check('Admin correction validates all referenced member/unit IDs inside organization', has(adminCorrection, 'validateTeamMemberReferences') && has(adminCorrection, 'scoped(unitQuery, organizationId)') && has(adminCorrection, 'scoped(checkinUpdateQuery, organizationId)'));
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
    !has(operatorAdminRecovery, '.select(\'passphrase_hash'),
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
    has(operatorAdminRecovery, 'organizationAdminHash(organizationId, body.passphrase)') &&
    has(operatorAdminRecovery, "onConflict: 'organization_id'")
);
check('Setup-code activation rejects invalid/expired/used/revoked codes', has(api, 'async function verifySetupCode') && has(api, ".eq('code_hash', hash)") && has(api, ".eq('active', true)") && has(api, 'data.used_at') && has(api, 'data.expires_at && data.expires_at < now') && has(setupActivation, 'markSetupCodeUsed'));
check(
  'Local admin PIN reset clears the member PIN and revokes only same-workspace devices',
  has(api, "path.match(/^\\/admin\\/team-members\\/([^/]+)\\/reset-pin$/)") &&
    has(api, 'pin_hash: null') &&
    has(api, 'active: false') &&
    has(api, "eq('team_member_id', memberId)") &&
    has(api, 'scoped(deviceUpdate, organizationId)')
);
check('Offline pending batches are partitioned by organization', has(files.offline, 'getPendingBatches(teamMemberId?: string, organizationId?: string | null)') && has(files.offline, '(batch.organizationId ?? null) !== (organizationId ?? null)') && has(files.app, 'getPendingBatches(currentIdentity.teamMemberId, currentIdentity.organizationId ?? null)') && has(files.app, 'countBlockingPendingBatches(currentIdentity.teamMemberId, currentIdentity.organizationId ?? null)'));

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

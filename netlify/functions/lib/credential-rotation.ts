export type CredentialInventoryCount = {
  credentialType: 'team_member_pin' | 'organization_admin';
  format: string;
  keyId: string | null;
  count: number;
};

export const credentialRotationBlockerCount = (
  counts: CredentialInventoryCount[],
  target: 'admin-session-secret' | 'credential-pepper',
  retiringKeyId: string | null = null,
) => counts
  .filter((row) => target === 'admin-session-secret'
    ? row.format === 'scrypt-v3'
    : row.format === 'scrypt-v2' ||
      row.format === 'scrypt-v4-unkeyed' ||
      (row.format === 'scrypt-v4-keyed' && Boolean(retiringKeyId) && row.keyId === retiringKeyId))
  .reduce((total, row) => total + (Number(row.count) || 0), 0);

export const validCredentialRotationOverride = (override: unknown) => {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return false;
  const value = override as { reviewed?: unknown; planReference?: unknown };
  return value.reviewed === true &&
    typeof value.planReference === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:/# -]{7,119}$/.test(value.planReference.trim());
};

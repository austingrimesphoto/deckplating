import crypto from 'node:crypto';

export const credentialHashPrefixes = {
  legacy: 'scrypt-v1',
  rawDedicated: 'scrypt-v2',
  sessionDerived: 'scrypt-v3',
  dedicated: 'scrypt-v4',
} as const;

type CredentialCodecOptions = {
  adminSessionSecret?: string;
  credentialPepper?: string;
  previousCredentialPepper?: string;
  randomBytes?: (size: number) => Buffer;
};

export type CredentialVerification = {
  verified: boolean;
  needsUpgrade: boolean;
  keySource: 'current' | 'previous' | 'session' | 'legacy' | null;
};

const deriveCredentialPepper = (root: string, label: string) =>
  root ? crypto.createHmac('sha256', root).update(`deckplating:${label}:credential-pepper`).digest('hex') : '';

const credentialPepperKeyId = (root: string) =>
  root ? crypto.createHash('sha256').update(`deckplating:credential-pepper-key-id\0${root}`).digest('hex').slice(0, 12) : '';

const deriveCredentialKey = (context: string, secret: string, salt: Buffer, pepper = '') =>
  new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      `${context}\0${secret}${pepper ? `\0${pepper}` : ''}`,
      salt,
      32,
      { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    );
  });

export function createCredentialCodec({
  adminSessionSecret = '',
  credentialPepper = '',
  previousCredentialPepper = '',
  randomBytes = crypto.randomBytes,
}: CredentialCodecOptions = {}) {
  const sessionDerivedCredentialPepper = deriveCredentialPepper(adminSessionSecret, 'session-root-v1');
  const dedicatedCredentialPepper = deriveCredentialPepper(credentialPepper, 'dedicated-v1');
  const previousDedicatedCredentialPepper =
    previousCredentialPepper && previousCredentialPepper !== credentialPepper
      ? deriveCredentialPepper(previousCredentialPepper, 'dedicated-v1')
      : '';
  const activeKeyId = credentialPepperKeyId(credentialPepper);
  const previousKeyId = previousDedicatedCredentialPepper ? credentialPepperKeyId(previousCredentialPepper) : '';
  const activePrefix = credentialPepper
    ? credentialHashPrefixes.dedicated
    : adminSessionSecret
      ? credentialHashPrefixes.sessionDerived
      : credentialHashPrefixes.legacy;
  const activePepper = credentialPepper ? dedicatedCredentialPepper : sessionDerivedCredentialPepper;

  const isVersionedCredentialHash = (value: string) =>
    value.startsWith(`${credentialHashPrefixes.legacy}$`) ||
    value.startsWith(`${credentialHashPrefixes.rawDedicated}$`) ||
    value.startsWith(`${credentialHashPrefixes.sessionDerived}$`) ||
    value.startsWith(`${credentialHashPrefixes.dedicated}$`);

  const isCurrentCredentialHash = (value: string) =>
    activePrefix === credentialHashPrefixes.dedicated
      ? value.startsWith(`${credentialHashPrefixes.dedicated}$${activeKeyId}$`)
      : value.startsWith(`${activePrefix}$`);

  const createCredentialHash = async (context: string, secret: string) => {
    const salt = randomBytes(16);
    const derivedKey = await deriveCredentialKey(context, secret, salt, activePepper);
    return activePrefix === credentialHashPrefixes.dedicated
      ? `${activePrefix}$${activeKeyId}$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`
      : `${activePrefix}$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
  };

  const verifyCredentialHashDetailed = async (
    storedHash: string,
    context: string,
    secret: string,
    legacyHashes: string[] = [],
  ): Promise<CredentialVerification> => {
    if (!isVersionedCredentialHash(storedHash)) {
      const verified = legacyHashes.some((candidate) => constantTimeEqual(storedHash, candidate));
      return { verified, needsUpgrade: verified, keySource: verified ? 'legacy' : null };
    }

    const parts = storedHash.split('$');
    const prefix = parts[0];
    const keyedDedicated = prefix === credentialHashPrefixes.dedicated && parts.length === 4;
    const keyId = keyedDedicated ? parts[1] : '';
    const encodedSalt = keyedDedicated ? parts[2] : parts[1];
    const encodedHash = keyedDedicated ? parts[3] : parts[2];
    if (
      (prefix !== credentialHashPrefixes.legacy &&
        prefix !== credentialHashPrefixes.rawDedicated &&
        prefix !== credentialHashPrefixes.sessionDerived &&
        prefix !== credentialHashPrefixes.dedicated) ||
      !encodedSalt ||
      !encodedHash ||
      (!keyedDedicated && parts.length !== 3) ||
      (keyedDedicated && !keyId)
    ) return { verified: false, needsUpgrade: false, keySource: null };
    if (prefix === credentialHashPrefixes.rawDedicated && !credentialPepper && !previousCredentialPepper) {
      return { verified: false, needsUpgrade: false, keySource: null };
    }
    if (prefix === credentialHashPrefixes.sessionDerived && !sessionDerivedCredentialPepper) {
      return { verified: false, needsUpgrade: false, keySource: null };
    }
    if (prefix === credentialHashPrefixes.dedicated && !dedicatedCredentialPepper && !previousDedicatedCredentialPepper) {
      return { verified: false, needsUpgrade: false, keySource: null };
    }

    let salt: Buffer;
    let expected: Buffer;
    try {
      salt = Buffer.from(encodedSalt, 'base64url');
      expected = Buffer.from(encodedHash, 'base64url');
    } catch {
      return { verified: false, needsUpgrade: false, keySource: null };
    }
    if (salt.length !== 16 || expected.length !== 32) {
      return { verified: false, needsUpgrade: false, keySource: null };
    }

    const candidates: Array<{ pepper: string; keySource: CredentialVerification['keySource']; needsUpgrade: boolean }> = [];
    if (prefix === credentialHashPrefixes.legacy) {
      candidates.push({ pepper: '', keySource: 'legacy', needsUpgrade: activePrefix !== prefix });
    } else if (prefix === credentialHashPrefixes.sessionDerived) {
      candidates.push({ pepper: sessionDerivedCredentialPepper, keySource: 'session', needsUpgrade: activePrefix !== prefix });
    } else if (prefix === credentialHashPrefixes.rawDedicated) {
      if (credentialPepper) candidates.push({ pepper: credentialPepper, keySource: 'current', needsUpgrade: true });
      if (previousCredentialPepper && previousCredentialPepper !== credentialPepper) {
        candidates.push({ pepper: previousCredentialPepper, keySource: 'previous', needsUpgrade: true });
      }
    } else if (keyedDedicated) {
      if (keyId === activeKeyId && dedicatedCredentialPepper) {
        candidates.push({ pepper: dedicatedCredentialPepper, keySource: 'current', needsUpgrade: false });
      } else if (keyId === previousKeyId && previousDedicatedCredentialPepper) {
        candidates.push({ pepper: previousDedicatedCredentialPepper, keySource: 'previous', needsUpgrade: true });
      }
    } else {
      if (dedicatedCredentialPepper) {
        candidates.push({ pepper: dedicatedCredentialPepper, keySource: 'current', needsUpgrade: true });
      }
      if (previousDedicatedCredentialPepper) {
        candidates.push({ pepper: previousDedicatedCredentialPepper, keySource: 'previous', needsUpgrade: true });
      }
    }

    for (const candidate of candidates) {
      const actual = await deriveCredentialKey(context, secret, salt, candidate.pepper);
      if (crypto.timingSafeEqual(actual, expected)) {
        return { verified: true, needsUpgrade: candidate.needsUpgrade, keySource: candidate.keySource };
      }
    }
    return { verified: false, needsUpgrade: false, keySource: null };
  };

  const verifyCredentialHash = async (
    storedHash: string,
    context: string,
    secret: string,
    legacyHashes: string[] = [],
  ) => (await verifyCredentialHashDetailed(storedHash, context, secret, legacyHashes)).verified;

  return {
    activePrefix,
    activeKeyId: activeKeyId || null,
    previousKeyId: previousKeyId || null,
    createCredentialHash,
    isCurrentCredentialHash,
    isVersionedCredentialHash,
    verifyCredentialHash,
    verifyCredentialHashDetailed,
  };
}

const constantTimeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

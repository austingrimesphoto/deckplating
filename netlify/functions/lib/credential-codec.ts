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
  randomBytes?: (size: number) => Buffer;
};

const deriveCredentialPepper = (root: string, label: string) =>
  root ? crypto.createHmac('sha256', root).update(`deckplating:${label}:credential-pepper`).digest('hex') : '';

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
  randomBytes = crypto.randomBytes,
}: CredentialCodecOptions = {}) {
  const sessionDerivedCredentialPepper = deriveCredentialPepper(adminSessionSecret, 'session-root-v1');
  const dedicatedCredentialPepper = deriveCredentialPepper(credentialPepper, 'dedicated-v1');
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

  const isCurrentCredentialHash = (value: string) => value.startsWith(`${activePrefix}$`);

  const createCredentialHash = async (context: string, secret: string) => {
    const salt = randomBytes(16);
    const derivedKey = await deriveCredentialKey(context, secret, salt, activePepper);
    return `${activePrefix}$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
  };

  const verifyCredentialHash = async (
    storedHash: string,
    context: string,
    secret: string,
    legacyHashes: string[] = [],
  ) => {
    if (!isVersionedCredentialHash(storedHash)) {
      return legacyHashes.some((candidate) => constantTimeEqual(storedHash, candidate));
    }

    const [prefix, encodedSalt, encodedHash, extra] = storedHash.split('$');
    if (
      (prefix !== credentialHashPrefixes.legacy &&
        prefix !== credentialHashPrefixes.rawDedicated &&
        prefix !== credentialHashPrefixes.sessionDerived &&
        prefix !== credentialHashPrefixes.dedicated) ||
      !encodedSalt ||
      !encodedHash ||
      extra
    ) return false;
    if (prefix === credentialHashPrefixes.rawDedicated && !credentialPepper) return false;
    if (prefix === credentialHashPrefixes.sessionDerived && !sessionDerivedCredentialPepper) return false;
    if (prefix === credentialHashPrefixes.dedicated && !dedicatedCredentialPepper) return false;

    let salt: Buffer;
    let expected: Buffer;
    try {
      salt = Buffer.from(encodedSalt, 'base64url');
      expected = Buffer.from(encodedHash, 'base64url');
    } catch {
      return false;
    }
    if (salt.length !== 16 || expected.length !== 32) return false;

    let verificationPepper = '';
    if (prefix === credentialHashPrefixes.rawDedicated) verificationPepper = credentialPepper;
    if (prefix === credentialHashPrefixes.sessionDerived) verificationPepper = sessionDerivedCredentialPepper;
    if (prefix === credentialHashPrefixes.dedicated) verificationPepper = dedicatedCredentialPepper;
    const actual = await deriveCredentialKey(context, secret, salt, verificationPepper);
    return crypto.timingSafeEqual(actual, expected);
  };

  return {
    activePrefix,
    createCredentialHash,
    isCurrentCredentialHash,
    isVersionedCredentialHash,
    verifyCredentialHash,
  };
}

const constantTimeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

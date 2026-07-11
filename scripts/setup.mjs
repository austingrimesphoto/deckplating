import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { buildEnvFile, validateCoordinate, validateHttpUrl } from './lib/setup-env.mjs';

const interactive = Boolean(input.isTTY && output.isTTY);
let rl = createInterface({ input, output });
let inputLines = interactive ? null : rl[Symbol.asyncIterator]();

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function ask(label, fallback = '') {
  const suffix = fallback ? ` [${fallback}]` : '';
  if (!rl) throw new Error('The standard-input prompt is closed.');
  let value;
  if (interactive) {
    value = await rl.question(`${label}${suffix}: `);
  } else {
    output.write(`${label}${suffix}: `);
    const next = await inputLines.next();
    output.write('\n');
    if (next.done) throw new Error('Input ended before setup was complete.');
    value = next.value;
  }
  return value.trim() || fallback;
}

function closePrompt() {
  rl?.close();
  rl = null;
  inputLines = null;
}

async function askSecret(label) {
  if (!interactive || typeof input.setRawMode !== 'function') return ask(label);

  return new Promise((resolve, reject) => {
    emitKeypressEvents(input);
    const wasRaw = Boolean(input.isRaw);
    let value = '';

    const finish = (error) => {
      input.off('keypress', onKeypress);
      input.setRawMode(wasRaw);
      if (!wasRaw) input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(value.trim());
    };

    const onKeypress = (characters, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        finish(new Error('Setup cancelled.'));
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish();
        return;
      }
      if (key.name === 'backspace') {
        if (value) {
          value = value.slice(0, -1);
          output.write('\b \b');
        }
        return;
      }
      if (!characters || key.ctrl || key.meta) return;
      value += characters;
      output.write('*'.repeat(Array.from(characters).length));
    };

    output.write(`${label}: `);
    input.setRawMode(true);
    input.on('keypress', onKeypress);
    input.resume();
  });
}

async function main() {
  console.log('\nDeckplate Coverage setup helper\n');
  console.log('Paste values from Supabase and choose an admin passphrase.');
  console.log('This writes a local .env file for testing. Use the same values in Netlify.\n');

  try {
    await fs.access('.env');
    const overwrite = (await ask('.env already exists. Overwrite it? Type YES to continue')).toUpperCase();
    if (overwrite !== 'YES') {
      console.log('\nStopped. Existing .env was not changed.');
      return;
    }
    console.log('');
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }

  const supabaseUrl = await ask('Supabase Project URL');
  const installationName = await ask('Installation or unit name', 'Naval Air Station Key West');
  const mapDefaultLatitude = await ask('Default map latitude', '24.57');
  const mapDefaultLongitude = await ask('Default map longitude', '-81.78');
  const mapTileUrl = await ask('Map tile/style URL (optional)');

  validateHttpUrl(supabaseUrl, 'Supabase Project URL');
  validateCoordinate(mapDefaultLatitude, 'Default map latitude', -90, 90);
  validateCoordinate(mapDefaultLongitude, 'Default map longitude', -180, 180);
  validateHttpUrl(mapTileUrl, 'Map tile/style URL', { optional: true });

  if (interactive) closePrompt();
  const serviceRoleKey = await askSecret('Supabase service_role key');
  const adminPassphrase = await askSecret('Admin passphrase (at least 12 characters)');
  const adminPassphraseConfirmation = await askSecret('Confirm admin passphrase');
  const mapTileKey = mapTileUrl ? await askSecret('Map tile key (optional)') : '';

  if (!serviceRoleKey) throw new Error('Supabase service_role key is required.');
  if (adminPassphrase.length < 12) throw new Error('Admin passphrase must contain at least 12 characters.');
  if (adminPassphrase !== adminPassphraseConfirmation) throw new Error('Admin passphrases did not match.');

  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const credentialPepper = crypto.randomBytes(32).toString('hex');

  const env = buildEnvFile({
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    ADMIN_PASSPHRASE_HASH: sha256(adminPassphrase),
    ADMIN_SESSION_SECRET: sessionSecret,
    CREDENTIAL_PEPPER: credentialPepper,
    MAP_TILE_URL: mapTileUrl,
    MAP_TILE_KEY: mapTileKey,
    MAP_DEFAULT_LATITUDE: mapDefaultLatitude,
    MAP_DEFAULT_LONGITUDE: mapDefaultLongitude,
    INSTALLATION_NAME: installationName,
  });

  await fs.writeFile('.env', env, { encoding: 'utf8', flag: 'w', mode: 0o600 });
  await fs.chmod('.env', 0o600);

  console.log('\nDone. Created .env with owner-only file permissions.');
  console.log('The secret values were not printed. Import the reviewed .env values into Netlify when you deploy.');
}

main()
  .catch((error) => {
    console.error(`\nSetup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    closePrompt();
  });

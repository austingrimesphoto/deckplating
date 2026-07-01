import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = createInterface({ input, output });

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function ask(label, fallback = '') {
  const suffix = fallback ? ` [${fallback}]` : '';
  const value = await rl.question(`${label}${suffix}: `);
  return value.trim() || fallback;
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
  } catch {
    // No existing .env file.
  }

  const supabaseUrl = await ask('Supabase Project URL');
  const serviceRoleKey = await ask('Supabase service_role key');
  const adminPassphrase = await ask('Admin passphrase');
  const installationName = await ask('Installation or unit name', 'Naval Air Station Key West');
  const mapDefaultLatitude = await ask('Default map latitude', '24.57');
  const mapDefaultLongitude = await ask('Default map longitude', '-81.78');
  const mapTileUrl = await ask('Map tile/style URL (optional)');
  const mapTileKey = mapTileUrl ? await ask('Map tile key (optional)') : '';
  const sessionSecret = crypto.randomBytes(32).toString('hex');

  const env = [
    `SUPABASE_URL=${supabaseUrl}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`,
    `ADMIN_PASSPHRASE_HASH=${sha256(adminPassphrase)}`,
    `ADMIN_SESSION_SECRET=${sessionSecret}`,
    `MAP_TILE_URL=${mapTileUrl}`,
    `MAP_TILE_KEY=${mapTileKey}`,
    `MAP_DEFAULT_LATITUDE=${mapDefaultLatitude}`,
    `MAP_DEFAULT_LONGITUDE=${mapDefaultLongitude}`,
    `INSTALLATION_NAME=${installationName}`,
    '',
  ].join('\n');

  await fs.writeFile('.env', env, { encoding: 'utf8', flag: 'w' });

  console.log('\nDone. Created .env.');
  console.log('\nCopy these same values into Netlify environment variables when you deploy:');
  console.log(env);
}

main()
  .catch((error) => {
    console.error(`\nSetup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
  });

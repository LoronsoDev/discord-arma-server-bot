const SteamUser = require('steam-user');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const TOKEN_FILE = path.join(__dirname, 'steam_refresh_token.txt');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  if (fs.existsSync(TOKEN_FILE)) {
    const overwrite = await ask('steam_refresh_token.txt already exists. Overwrite? (y/n): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      rl.close();
      return;
    }
  }

  const username = await ask('Steam username: ');
  const password = await ask('Steam password: ');

  console.log('\nLogging in to Steam...');

  const client = new SteamUser({
    dataDirectory: path.join(__dirname, 'steam_data'),
  });

  client.on('steamGuard', async (domain, callback) => {
    const code = await ask(`Steam Guard code${domain ? ` (email: ${domain})` : ' (authenticator)'}: `);
    callback(code);
  });

  client.on('refreshToken', (token) => {
    fs.writeFileSync(TOKEN_FILE, token);
    console.log(`\nRefresh token saved to ${TOKEN_FILE}`);
    console.log('Valid for ~200 days. The bot will auto-renew it.');
    console.log('\nYou can now start the bot with: docker compose up -d --build');
    client.logOff();
    rl.close();
  });

  client.on('loggedOn', () => {
    console.log(`Logged in as ${client.steamID.getSteamID64()}`);
    console.log('Waiting for refresh token...');
  });

  client.on('error', (err) => {
    console.error('Steam error:', err.message);
    rl.close();
  });

  client.logOn({ accountName: username, password: password });
}

main();

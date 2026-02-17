const https = require('https');
const SteamUser = require('steam-user');
const fs = require('fs');
const path = require('path');

const APP_ID = 1874880; // Arma Reforger
const BOHEMIA_GAME_IP = '104.18.26.129';
const BOHEMIA_ID_IP = '104.18.27.129';
const TOKEN_FILE = path.join(__dirname, 'steam_refresh_token.txt');

let steamClient = null;
let accessToken = null;
let accessTokenExp = 0;

// --- Steam Connection ---

function init() {
  return new Promise((resolve, reject) => {
    const refreshToken = process.env.STEAM_REFRESH_TOKEN
      || (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8').trim() : null);

    if (!refreshToken) {
      return reject(new Error('No STEAM_REFRESH_TOKEN in .env or steam_refresh_token.txt'));
    }

    steamClient = new SteamUser({
      dataDirectory: path.join(__dirname, 'steam_data'),
      autoRelogin: true,
    });

    steamClient.on('refreshToken', (token) => {
      fs.writeFileSync(TOKEN_FILE, token);
      console.log('[Bohemia] New refresh token saved');
    });

    steamClient.on('error', (err) => {
      console.error('[Bohemia] Steam error:', err.message);
    });

    steamClient.on('disconnected', (eresult, msg) => {
      console.warn(`[Bohemia] Steam disconnected: ${msg} (${eresult})`);
    });

    steamClient.on('loggedOn', () => {
      console.log(`[Bohemia] Steam logged in as ${steamClient.steamID.getSteamID64()}`);
      resolve();
    });

    steamClient.logOn({ refreshToken });
  });
}

// --- Bohemia Auth ---

function createTicket() {
  return new Promise((resolve, reject) => {
    steamClient.createAuthSessionTicket(APP_ID, (err, ticket) => {
      if (err) return reject(err);
      const buf = Buffer.isBuffer(ticket) ? ticket : (ticket.sessionTicket || ticket.ticket);
      resolve(buf.toString('base64'));
    });
  });
}

function bohemiaRequest(hostname, realIP, reqPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: realIP,
      path: reqPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Host': hostname,
        'User-Agent': 'Arma Reforger/1.6.0.119 (Client; Windows)',
      },
      servername: hostname,
    }, (res) => {
      let resp = '';
      res.on('data', chunk => resp += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Bohemia API ${res.statusCode}: ${resp.substring(0, 200)}`));
        }
        resolve(JSON.parse(resp));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  // Renew 5 minutes before expiry
  if (accessToken && accessTokenExp > now + 300) {
    return accessToken;
  }

  console.log('[Bohemia] Getting new access token...');
  const ticketBase64 = await createTicket();

  const auth = await bohemiaRequest(
    'api-ar-id.bistudio.com',
    BOHEMIA_ID_IP,
    '/game-identity/api/v1.1/identities/reforger/auth?include=profile',
    {
      platform: 'steam',
      token: ticketBase64,
      platformOpts: { appId: String(APP_ID) },
    }
  );

  accessToken = auth.accessToken;
  accessTokenExp = auth.accessTokenExp;
  console.log(`[Bohemia] Access token obtained, expires ${new Date(accessTokenExp * 1000).toISOString()}`);
  return accessToken;
}

// --- Server Query ---

async function queryServer(hostAddress) {
  const token = await getAccessToken();

  const result = await bohemiaRequest(
    'api-ar-game.bistudio.com',
    BOHEMIA_GAME_IP,
    '/game-api/api/v1.0/lobby/rooms/search',
    {
      accessToken: token,
      clientVersion: '1.6.0',
      platformId: 'ReforgerSteam',
      gameClientType: 'PLATFORM_PC',
      order: 'PlayerCount',
      ascendent: false,
      from: 0,
      limit: 1,
      directJoinCode: '',
      hostAddress: hostAddress,
      scenarioId: '',
      text: '',
      lightweight: true,
      includePing: 0,
      gameClientFilter: 'AnyCompatible',
    }
  );

  if (!result.rooms || result.rooms.length === 0) {
    throw new Error(`Server ${hostAddress} not found`);
  }

  return result.rooms[0];
}

module.exports = { init, queryServer };

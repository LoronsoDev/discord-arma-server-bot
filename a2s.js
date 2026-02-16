const dgram = require('node:dgram');

const A2S_INFO_REQUEST = Buffer.from([
  0xFF, 0xFF, 0xFF, 0xFF, // Header
  0x54, // 'T' - A2S_INFO
  ...Buffer.from('Source Engine Query\0'),
]);

function queryServerInfo(ip, port, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Query timed out'));
    }, timeout);

    socket.on('message', (msg) => {
      clearTimeout(timer);
      socket.close();
      try {
        resolve(parseA2SInfo(msg));
      } catch (err) {
        reject(err);
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.send(A2S_INFO_REQUEST, port, ip);
  });
}

function parseA2SInfo(buf) {
  let offset = 4; // skip 0xFFFFFFFF header

  // Check if it's a challenge response
  if (buf[offset] === 0x41) {
    // Challenge response - would need to resend with challenge number
    // For now, extract the challenge
    return { challenge: buf.readInt32LE(offset + 1) };
  }

  const header = buf[offset++]; // Should be 0x49 ('I')

  const protocol = buf[offset++];

  // Read null-terminated strings
  const readString = () => {
    const start = offset;
    while (buf[offset] !== 0x00 && offset < buf.length) offset++;
    const str = buf.toString('utf8', start, offset);
    offset++; // skip null terminator
    return str;
  };

  const name = readString();
  const map = readString();
  const folder = readString();
  const game = readString();

  const steamAppId = buf.readUInt16LE(offset);
  offset += 2;

  const players = buf[offset++];
  const maxPlayers = buf[offset++];
  const bots = buf[offset++];

  const serverType = String.fromCharCode(buf[offset++]); // 'd' = dedicated, 'l' = listen, 'p' = proxy
  const environment = String.fromCharCode(buf[offset++]); // 'l' = Linux, 'w' = Windows, 'm'/'o' = Mac
  const visibility = buf[offset++]; // 0 = public, 1 = private
  const vac = buf[offset++]; // 0 = unsecured, 1 = secured

  const version = readString();

  // Extra Data Flag (EDF)
  let port = null;
  let steamId = null;
  let keywords = null;
  let gameId = null;

  if (offset < buf.length) {
    const edf = buf[offset++];

    if (edf & 0x80) {
      port = buf.readUInt16LE(offset);
      offset += 2;
    }
    if (edf & 0x10) {
      // steamID is 64-bit, read as two 32-bit
      steamId = buf.readBigUInt64LE(offset).toString();
      offset += 8;
    }
    if (edf & 0x40) {
      // Spectator port + name
      offset += 2; // spectator port
      readString(); // spectator name
    }
    if (edf & 0x20) {
      keywords = readString();
    }
    if (edf & 0x01) {
      gameId = buf.readBigUInt64LE(offset).toString();
      offset += 8;
    }
  }

  return {
    name,
    map,
    folder,
    game,
    steamAppId,
    players,
    maxPlayers,
    bots,
    serverType,
    environment,
    visibility,
    vac,
    version,
    port,
    keywords,
    gameId,
  };
}

function queryWithChallenge(ip, port, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Query timed out'));
    }, timeout);

    let attempt = 0;

    socket.on('message', (msg) => {
      const responseType = msg[4];

      // Challenge response (0x41 = 'A')
      if (responseType === 0x41 && attempt === 0) {
        attempt++;
        const challenge = msg.slice(5, 9);
        const challengeRequest = Buffer.concat([
          A2S_INFO_REQUEST,
          challenge,
        ]);
        socket.send(challengeRequest, port, ip);
        return;
      }

      // Info response (0x49 = 'I')
      clearTimeout(timer);
      socket.close();
      try {
        resolve(parseA2SInfo(msg));
      } catch (err) {
        reject(err);
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.send(A2S_INFO_REQUEST, port, ip);
  });
}

const A2S_PLAYER_REQUEST = Buffer.from([
  0xFF, 0xFF, 0xFF, 0xFF,
  0x55, // 'U' - A2S_PLAYER
  0xFF, 0xFF, 0xFF, 0xFF, // Initial challenge
]);

function queryPlayers(ip, port, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Player query timed out'));
    }, timeout);

    let attempt = 0;

    socket.on('message', (msg) => {
      const responseType = msg[4];

      if (responseType === 0x41 && attempt === 0) {
        attempt++;
        const challenge = msg.slice(5, 9);
        const req = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0x55, ...challenge]);
        socket.send(req, port, ip);
        return;
      }

      // Player response (0x44 = 'D')
      clearTimeout(timer);
      socket.close();
      try {
        resolve(parseA2SPlayer(msg));
      } catch (err) {
        reject(err);
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.send(A2S_PLAYER_REQUEST, port, ip);
  });
}

function parseA2SPlayer(buf) {
  let offset = 5; // skip header + 0x44
  const playerCount = buf[offset++];
  const players = [];

  for (let i = 0; i < playerCount && offset < buf.length; i++) {
    offset++; // index
    const start = offset;
    while (buf[offset] !== 0x00 && offset < buf.length) offset++;
    const name = buf.toString('utf8', start, offset);
    offset++; // null terminator
    // skip score (4 bytes) and duration (4 bytes)
    offset += 8;
    if (name) players.push(name);
  }

  return players;
}

module.exports = { queryServerInfo, queryWithChallenge, queryPlayers };

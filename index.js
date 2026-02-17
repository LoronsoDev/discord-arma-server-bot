require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const bohemia = require('./bohemia');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const UPDATE_INTERVAL = 60_000;
const SERVERS_FILE = path.join(__dirname, 'servers.json');

// --- Persistence helpers ---

function loadServers() {
  if (!fs.existsSync(SERVERS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveServers(data) {
  fs.writeFileSync(SERVERS_FILE, JSON.stringify(data, null, 2));
}

const serversData = loadServers();

// --- Embed builders ---

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function buildPlayerBar(players, maxPlayers) {
  const total = 10;
  const filled = Math.round((players / maxPlayers) * total);
  const ratio = players / maxPlayers;
  const filledEmoji = ratio > 0.8 ? '🟪' : ratio > 0.4 ? '🟦' : '⬜';
  return filledEmoji.repeat(filled) + '⬛'.repeat(total - filled);
}

function buildEmbed(name, room, srv) {
  const players = room.playerCount;
  const maxPlayers = room.playerCountLimit;
  const color = 0x57F287; // verde = online
  const statusIcon = players >= maxPlayers ? '🔴' : '🟢';
  const statusText = players >= maxPlayers ? 'Lleno' : 'Online';

  const uptime = srv.onlineSince ? formatUptime(Date.now() - srv.onlineSince) : 'N/A';

  const lines = [
    `${statusIcon} **${statusText}**` + (srv.battlemetrics ? `\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003\u2003🔧 [Ver mods cargados](${srv.battlemetrics})` : ''),
    '',
    `👥 **Jugadores:** ${players} / ${maxPlayers}`,
    buildPlayerBar(players, maxPlayers),
    '',
    `🗺️ **Mapa:** ${room.scenarioName || 'Desconocido'}\u2003\u2003\u2003🕐 **Uptime:** ${uptime}`,
  ];

  // Queue info
  if (room.joinQueue && room.joinQueue.size > 0) {
    const q = room.joinQueue;
    const waitText = q.positionAvgWaitTime ? ` (~${q.positionAvgWaitTime}s por posicion)` : '';
    lines.push(`⏳ **Cola:** ${q.size}/${q.maxSize}${waitText}`);
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(room.name || name)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${name} · Actualizado - ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} · Arma Reforger v${room.gameVersion || '?'}` });
}

function buildOfflineEmbed(name) {
  return new EmbedBuilder()
    .setColor(0x2C2F33)
    .setTitle(name)
    .setDescription('⚫ **Servidor offline o no responde**\n\n' + '⬛'.repeat(10))
    .setFooter({ text: `${name} · Actualizado` })
    .setTimestamp();
}

// --- Update loop ---

async function updateAllServers(client) {
  for (const [guildId, guildData] of Object.entries(serversData)) {
    const channel = client.channels.cache.get(guildData.channel_id);
    if (!channel) continue;

    for (const [name, srv] of Object.entries(guildData.servers)) {
      let embed;
      try {
        const hostAddress = `${srv.ip}:${srv.gamePort}`;
        const room = await bohemia.queryServer(hostAddress);
        if (!srv.onlineSince) {
          srv.onlineSince = Date.now();
          saveServers(serversData);
        }
        embed = buildEmbed(name, room, srv);
        console.log(`[${new Date().toLocaleTimeString()}] ${guildId}/${name}: ${room.playerCount}/${room.playerCountLimit}`);
      } catch (err) {
        if (srv.onlineSince) {
          srv.onlineSince = null;
          saveServers(serversData);
        }
        embed = buildOfflineEmbed(name);
        console.error(`[${new Date().toLocaleTimeString()}] ${guildId}/${name}: ${err.message}`);
      }

      try {
        if (srv.messageId) {
          const msg = await channel.messages.fetch(srv.messageId).catch(() => null);
          if (msg) {
            await msg.edit({ embeds: [embed] });
          } else {
            const newMsg = await channel.send({ embeds: [embed] });
            srv.messageId = newMsg.id;
            saveServers(serversData);
          }
        } else {
          const newMsg = await channel.send({ embeds: [embed] });
          srv.messageId = newMsg.id;
          saveServers(serversData);
        }
      } catch (err) {
        console.error(`Error actualizando embed ${name}:`, err.message);
        srv.messageId = null;
        saveServers(serversData);
      }
    }
  }
}

// --- Client setup ---

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// --- Slash command handling ---

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Admin-only check
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Solo administradores pueden usar este comando.', ephemeral: true });
  }

  const guildId = interaction.guildId;

  if (interaction.commandName === 'add') {
    await interaction.deferReply({ flags: 64 });

    const name = interaction.options.getString('nombre');
    const ipRaw = interaction.options.getString('ip');
    const battlemetrics = interaction.options.getString('battlemetrics');

    const parts = ipRaw.split(':');
    if (parts.length !== 2 || !parts[1] || isNaN(parts[1])) {
      return interaction.editReply({ content: 'Formato incorrecto. Usa `IP:Puerto`, ej: `78.40.111.176:20744`' });
    }
    const ip = parts[0];
    const port = parseInt(parts[1], 10);

    if (!serversData[guildId]) {
      serversData[guildId] = {
        channel_id: interaction.channelId,
        servers: {},
      };
    }

    if (serversData[guildId].servers[name]) {
      return interaction.editReply({ content: `El servidor **${name}** ya existe. Usa \`/remove\` primero si quieres re-agregarlo.` });
    }

    serversData[guildId].servers[name] = {
      ip,
      gamePort: port,
      messageId: null,
      battlemetrics: battlemetrics || null,
      onlineSince: null,
    };
    serversData[guildId].channel_id = interaction.channelId;
    saveServers(serversData);

    // Send initial embed right away
    const srv = serversData[guildId].servers[name];
    let embed;
    try {
      const hostAddress = `${ip}:${port}`;
      const room = await bohemia.queryServer(hostAddress);
      srv.onlineSince = Date.now();
      saveServers(serversData);
      embed = buildEmbed(name, room, srv);
    } catch {
      embed = buildOfflineEmbed(name);
    }

    try {
      const msg = await interaction.channel.send({ embeds: [embed] });
      serversData[guildId].servers[name].messageId = msg.id;
      saveServers(serversData);
    } catch (err) {
      return interaction.editReply({ content: `Error enviando el embed: ${err.message}. Verifica los permisos del bot en este canal.` });
    }

    return interaction.editReply({ content: `Servidor **${name}** (\`${ip}:${port}\`) a\u00F1adido al monitoreo.` });
  }

  if (interaction.commandName === 'remove') {
    const name = interaction.options.getString('nombre');

    if (!serversData[guildId] || !serversData[guildId].servers[name]) {
      return interaction.reply({ content: `No se encontr\u00F3 el servidor **${name}**.`, ephemeral: true });
    }

    const srv = serversData[guildId].servers[name];
    if (srv.messageId) {
      try {
        const channel = client.channels.cache.get(serversData[guildId].channel_id);
        if (channel) {
          const msg = await channel.messages.fetch(srv.messageId).catch(() => null);
          if (msg) await msg.delete();
        }
      } catch { /* ignore */ }
    }

    delete serversData[guildId].servers[name];
    if (Object.keys(serversData[guildId].servers).length === 0) {
      delete serversData[guildId];
    }
    saveServers(serversData);

    return interaction.reply({ content: `Servidor **${name}** eliminado del monitoreo.`, ephemeral: true });
  }

  if (interaction.commandName === 'list') {
    if (!serversData[guildId] || Object.keys(serversData[guildId].servers).length === 0) {
      return interaction.reply({ content: 'No hay servidores configurados. Usa `/add` para a\u00F1adir uno.', ephemeral: true });
    }

    const lines = Object.entries(serversData[guildId].servers).map(
      ([name, srv]) => `\u2022 **${name}** \u2014 \`${srv.ip}:${srv.gamePort}\``
    );

    return interaction.reply({ content: `**Servidores monitoreados:**\n${lines.join('\n')}`, ephemeral: true });
  }
});

// --- Bot ready ---

client.once('ready', () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  updateAllServers(client);
  setInterval(() => updateAllServers(client), UPDATE_INTERVAL);
});

client.on('error', (err) => console.error('Client error:', err.message));

// --- Startup ---

(async () => {
  try {
    await bohemia.init();
    await client.login(DISCORD_TOKEN);
  } catch (err) {
    console.error('Fatal startup error:', err.message);
    process.exit(1);
  }
})();

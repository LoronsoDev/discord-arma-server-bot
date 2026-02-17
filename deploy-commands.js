require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Añade un servidor Arma Reforger al monitoreo')
    .addStringOption(opt =>
      opt.setName('nombre').setDescription('Nombre identificador del servidor').setRequired(true))
    .addStringOption(opt =>
      opt.setName('ip').setDescription('IP del servidor').setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('puerto').setDescription('Puerto del juego (game port, no el A2S)').setRequired(true))
    .addStringOption(opt =>
      opt.setName('battlemetrics').setDescription('URL de Battlemetrics (opcional, para ver mods)').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Quita un servidor del monitoreo')
    .addStringOption(opt =>
      opt.setName('nombre').setDescription('Nombre del servidor a quitar').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('list')
    .setDescription('Lista los servidores monitoreados')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registrando slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands.map(c => c.toJSON()) },
    );
    console.log('Slash commands registrados correctamente.');
  } catch (err) {
    console.error('Error registrando commands:', err);
  }
})();

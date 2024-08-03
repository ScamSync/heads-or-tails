require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, REST, Routes, PermissionsBitField } = require('discord.js');
const axios = require('axios');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
    ],
});

const token = process.env.BOT_TOKEN;
const clientId = process.env.CLIENT_ID;
const githubToken = process.env.GITHUB_TOKEN;
const repoOwner = process.env.REPO_OWNER;
const repoName = process.env.REPO_NAME;
const logFilePath = 'eliminator.json'; // Path to the log file in the repository

const PREFIX = "ss."; // Prefix remains ss.
const COINS = {};
let activeGame = null;

const HEADS_IMAGE = 'https://i.imgur.com/YlhD9uH.png';
const TAILS_IMAGE = 'https://i.imgur.com/xT8wTZP.png';
const SPIN_GIF = 'https://media1.tenor.com/m/r518LowSyIEAAAAC/coin-flip.gif';
const COIN_EMOJI = '🪙'; // Unicode for coin emoji

let gameCount = 0;
let serverCount = 0;
let sha;

async function loadLog() {
    try {
        const { data } = await axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/${logFilePath}`, {
            headers: {
                Authorization: `Bearer ${githubToken}`
            }
        });
        sha = data.sha;
        const content = Buffer.from(data.content, 'base64').toString();
        const log = JSON.parse(content);
        gameCount = log.gameCount;
        serverCount = log.serverCount;
        console.log('Log loaded from GitHub:', log);
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.log('Log file not found, creating a new one!');
            const log = { gameCount: 0, serverCount: 0 };
            await saveLog(log);
        } else {
            throw error;
        }
    }
}

async function saveLog(log) {
    try {
        const content = Buffer.from(JSON.stringify(log, null, 2)).toString('base64');
        const { data } = await axios.put(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/${logFilePath}`, {
            message: 'Update log',
            content: content,
            sha: sha
        }, {
            headers: {
                Authorization: `Bearer ${githubToken}`
            }
        });
        sha = data.content.sha;
        console.log('Log updated on GitHub');
    } catch (error) {
        console.error('Error updating log on GitHub:', error);
    }
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    await loadLog();
    serverCount = client.guilds.cache.size;
    await saveLog({ gameCount, serverCount });

    // Register slash commands globally
    const commands = [
        {
            name: 'headsortails',
            description: 'Start a new heads or tails game with an optional multiplier',
            options: [
                {
                    name: 'multiplier',
                    type: 4, // INTEGER type
                    description: 'Multiplier of the game',
                    required: false,
                }
            ],
        },
        {
            name: 'htbet',
            description: 'Place a bet on heads or tails',
            options: [
                {
                    name: 'choice',
                    type: 3, // STRING type
                    description: 'Your choice: heads or tails',
                    required: true,
                    choices: [
                        { name: 'Heads', value: 'heads' },
                        { name: 'Tails', value: 'tails' },
                    ],
                },
                {
                    name: 'amount',
                    type: 4, // INTEGER type
                    description: 'Amount to bet',
                    required: true,
                }
            ],
        },
        {
            name: 'htcoins',
            description: 'Check your coin balance',
        },
        {
            name: 'hthelp',
            description: 'Get help information for using Heads or Tails bot',
        },
    ];

    const rest = new REST({ version: '10' }).setToken(token);

    (async () => {
        try {
            console.log('Started refreshing application (/) commands.');

            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands },
            );

            console.log('Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error(error);
        }
    })();
});

client.on('guildCreate', async () => {
    serverCount = client.guilds.cache.size;
    await saveLog({ gameCount, serverCount });
});

client.on('guildDelete', async () => {
    serverCount = client.guilds.cache.size;
    await saveLog({ gameCount, serverCount });
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (!COINS[message.author.id]) {
        COINS[message.author.id] = 1;
    }

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'headsortails' && message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        console.log('Command ss.headsortails triggered');
        if (activeGame) {
            message.reply("A game is already in progress.");
            return;
        }

        const multiplier = args[0] ? Math.min(Math.max(parseInt(args[0]), 2), 100) : 2;
        activeGame = { multiplier, bets: {}, users: [] };

        const embed = new EmbedBuilder()
            .setTitle('Coin Flip Game Started!')
            .setDescription(`React with the coin emoji to join!\nMultiplier: x${multiplier}\nType \`ss.htbet heads/tails amount\` to place your bets.`)
            .setImage(SPIN_GIF);

        const gameMessage = await message.channel.send({ embeds: [embed] });

        // Add coin emoji reaction to the game announcement message
        await gameMessage.react(COIN_EMOJI);

        setTimeout(() => {
            message.channel.send('45 seconds left to place your bets!');
        }, 15000);

        setTimeout(() => {
            message.channel.send('Game is now locked! You have 30 seconds to finalize your bets.');
            activeGame.locked = true;
        }, 45000);

        setTimeout(async () => {
            await finalizeGame(message);
        }, 75000);

    } else if (command === 'htbet') {
        console.log('Command ss.htbet triggered');
        if (!activeGame || activeGame.locked) {
            message.reply("No active game or game is locked.");
            return;
        }

        const choice = args[0];
        const bet = parseInt(args[1]);

        if (!choice || !bet || (choice !== 'heads' && choice !== 'tails')) {
            message.reply("Usage: ss.htbet <heads/tails> <amount>");
            return;
        }

        if (COINS[message.author.id] < bet) {
            message.reply("You don't have enough coins to place this bet.");
            return;
        }

        if (!activeGame.bets[message.author.id]) {
            activeGame.bets[message.author.id] = { choice, amount: bet };
            activeGame.users.push(message.author.id);
        } else {
            activeGame.bets[message.author.id].choice = choice;
            activeGame.bets[message.author.id].amount = bet;
        }

        message.reply(`Bet placed: ${choice} with ${bet} coins.`);
    } else if (command === 'htcoins') {
        console.log('Command ss.htcoins triggered');
        message.reply(`You have ${COINS[message.author.id]} coins.`);
    } else if (command === 'hthelp') {
        console.log('Command ss.hthelp triggered');
        const helpEmbed = new EmbedBuilder()
            .setTitle('Heads or Tails Bot Commands')
            .setDescription('List of commands for the Heads or Tails bot')
            .addFields(
                { name: 'ss.headsortails [multiplier]', value: 'Start a new heads or tails game with an optional multiplier.' },
                { name: 'ss.htbet <heads/tails> <amount>', value: 'Place a bet on heads or tails.' },
                { name: 'ss.htcoins', value: 'Check your coin balance.' },
                { name: 'ss.hthelp', value: 'Display this help message.' },
            );
        message.channel.send({ embeds: [helpEmbed] });
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'headsortails') {
        if (activeGame) {
            await interaction.reply("A game is already in progress.");
            return;
        }

        const multiplier = options.getInteger('multiplier') || 2;
        activeGame = { multiplier, bets: {}, users: [] };

        const embed = new EmbedBuilder()
            .setTitle('Coin Flip Game Started!')
            .setDescription(`React with the coin emoji to join!\nMultiplier: x${multiplier}\nType \`/htbet heads/tails amount\` to place your bets.`)
            .setImage(SPIN_GIF);

        const gameMessage = await interaction.reply({ embeds: [embed], fetchReply: true });

        // Add coin emoji reaction to the game announcement message
        await gameMessage.react(COIN_EMOJI);

        setTimeout(() => {
            interaction.channel.send('45 seconds left to place your bets!');
        }, 15000);

        setTimeout(() => {
            interaction.channel.send('Game is now locked! You have 30 seconds to finalize your bets.');
            activeGame.locked = true;
        }, 45000);

        setTimeout(async () => {
            await finalizeGame(interaction);
        }, 75000);

    } else if (commandName === 'htbet') {
        if (!activeGame || activeGame.locked) {
            await interaction.reply("No active game or game is locked.");
            return;
        }

        const choice = options.getString('choice');
        const bet = options.getInteger('amount');

        if (!choice || !bet || (choice !== 'heads' && choice !== 'tails')) {
            await interaction.reply("Usage: /htbet <heads/tails> <amount>");
            return;
        }

        if (COINS[interaction.user.id] < bet) {
            await interaction.reply("You don't have enough coins to place this bet.");
            return;
        }

        if (!activeGame.bets[interaction.user.id]) {
            activeGame.bets[interaction.user.id] = { choice, amount: bet };
            activeGame.users.push(interaction.user.id);
        } else {
            activeGame.bets[interaction.user.id].choice = choice;
            activeGame.bets[interaction.user.id].amount = bet;
        }

        await interaction.reply(`Bet placed: ${choice} with ${bet} coins.`);
    } else if (commandName === 'htcoins') {
        await interaction.reply(`You have ${COINS[interaction.user.id]} coins.`);
    } else if (commandName === 'hthelp') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('Heads or Tails Bot Commands')
            .setDescription('List of commands for the Heads or Tails bot')
            .addFields(
                { name: 'ss.headsortails [multiplier]', value: 'Start a new heads or tails game with an optional multiplier.' },
                { name: 'ss.htbet <heads/tails> <amount>', value: 'Place a bet on heads or tails.' },
                { name: 'ss.htcoins', value: 'Check your coin balance.' },
                { name: 'ss.hthelp', value: 'Display this help message.' },
            );
        await interaction.reply({ embeds: [helpEmbed] });
    }
});

async function finalizeGame(messageOrInteraction) {
    console.log('Finalizing game');
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const resultImage = result === 'heads' ? HEADS_IMAGE : TAILS_IMAGE;
    const winners = [];

    for (const userId in activeGame.bets) {
        const bet = activeGame.bets[userId];
        if (bet.choice === result) {
            COINS[userId] += bet.amount * (activeGame.multiplier - 1);
            winners.push(`<@${userId}> won ${bet.amount * activeGame.multiplier} coins!`);
        } else {
            COINS[userId] -= bet.amount;
        }
    }

    const resultEmbed = new EmbedBuilder()
        .setTitle(`The coin landed on ${result}`)
        .setImage(resultImage);

    await messageOrInteraction.channel.send({ embeds: [resultEmbed] });

    if (winners.length > 0) {
        messageOrInteraction.channel.send(`Congratulations to the winners:\n${winners.join('\n')}`);
    } else {
        messageOrInteraction.channel.send('No winners this time.');
    }

    activeGame = null;
    gameCount++;
    await saveLog({ gameCount, serverCount });
}

client.login(token).catch(console.error);

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    EmbedBuilder,
    AuditLogEvent,
    MessageFlags,
    ChannelType
} = require("discord.js");

const express = require("express");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

app.get("/", (req, res) => {
    res.send("USM Defenses is online.");
});

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = "1552882368677683280";

// This is a USER ID, NOT a role ID.
const GLOBAL_BAN_IMMUNE_USER_ID = "1481161020721463327";

if (!TOKEN) {
    console.error("❌ DISCORD_TOKEN is missing from your hosting environment variables.");
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildInvites
    ]
});

// ============================================================
// DATABASE
// ============================================================

const DB_FILE = "./database.json";

const defaultDatabase = {
    globalBans: {},
    warnings: {},
    robloxLinks: {},
    duty: {},
    invites: {},
    inviteLinks: {},
    serviceRecords: {},
    leaveOfAbsence: {},
    reports: {},
    reportCounter: 0,
    guildSettings: {},
    audit: []
};

let database = { ...defaultDatabase };

try {
    if (fs.existsSync(DB_FILE)) {
        const loaded = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        database = {
            ...defaultDatabase,
            ...loaded
        };
    }

    console.log("💾 Database loaded.");
} catch (error) {
    console.error("❌ Database load error:", error);
}

function saveDatabase() {
    try {
        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(database, null, 2)
        );
    } catch (error) {
        console.error("❌ Database save error:", error);
    }
}

// ============================================================
// HELPERS
// ============================================================

function ensureGuildData(guildId) {
    if (!database.guildSettings[guildId]) {
        database.guildSettings[guildId] = {
            staffRoleId: null,
            lockdown: false,
            spamEnabled: false,
            raidEnabled: false
        };
    }

    if (!database.warnings[guildId]) {
        database.warnings[guildId] = {};
    }

    if (!database.robloxLinks[guildId]) {
        database.robloxLinks[guildId] = {};
    }

    if (!database.duty[guildId]) {
        database.duty[guildId] = {};
    }

    if (!database.invites[guildId]) {
        database.invites[guildId] = {};
    }

    if (!database.inviteLinks[guildId]) {
        database.inviteLinks[guildId] = {};
    }

    if (!database.serviceRecords[guildId]) {
        database.serviceRecords[guildId] = {};
    }

    if (!database.leaveOfAbsence[guildId]) {
        database.leaveOfAbsence[guildId] = {};
    }

    if (!database.reports[guildId]) {
        database.reports[guildId] = {};
    }
}

function getSettings(guildId) {
    ensureGuildData(guildId);
    return database.guildSettings[guildId];
}

function isStaff(interaction) {
    if (!interaction.guild) return false;

    if (
        interaction.memberPermissions &&
        interaction.memberPermissions.has(PermissionFlagsBits.Administrator)
    ) {
        return true;
    }

    const settings = getSettings(interaction.guild.id);

    if (
        settings.staffRoleId &&
        interaction.member &&
        interaction.member.roles &&
        interaction.member.roles.cache.has(settings.staffRoleId)
    ) {
        return true;
    }

    return false;
}

function staffOnly(interaction) {
    if (!isStaff(interaction)) {
        interaction.reply({
            content: "❌ You do not have permission to use this command.",
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return false;
    }

    return true;
}

function addAudit(guildId, action, moderatorId, targetId = null, details = "") {
    database.audit.push({
        guildId,
        action,
        moderatorId,
        targetId,
        details,
        timestamp: Date.now()
    });

    if (database.audit.length > 5000) {
        database.audit.splice(0, database.audit.length - 5000);
    }

    saveDatabase();
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];

    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (seconds || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(" ");
}

async function getOrCreateRole(guild, name, color = null) {
    let role = guild.roles.cache.find(r => r.name === name);

    if (role) return role;

    try {
        role = await guild.roles.create({
            name,
            color: color || undefined,
            reason: "USM Defenses automatic role setup"
        });

        return role;
    } catch (error) {
        console.error(`❌ Could not create role "${name}" in ${guild.name}:`, error.message);
        return null;
    }
}

// ============================================================
// SERVER LOGGING
// ============================================================

const LOG_CHANNEL_NAME = "bot-logs";

function truncateLog(text, max = 1000) {
    if (text === null || text === undefined || text === "") return "(none)";
    text = String(text);
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

async function getOrCreateLogChannel(guild) {
    try {
        let channel = guild.channels.cache.find(
            c => c.type === ChannelType.GuildText && c.name === LOG_CHANNEL_NAME
        );

        if (channel) return channel;

        const settings = getSettings(guild.id);

        const overwrites = [
            {
                id: guild.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: client.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            }
        ];

        if (settings.staffRoleId) {
            overwrites.push({
                id: settings.staffRoleId,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            });
        }

        channel = await guild.channels.create({
            name: LOG_CHANNEL_NAME,
            type: ChannelType.GuildText,
            permissionOverwrites: overwrites,
            reason: "USM Defenses automatic server logging channel"
        });

        console.log(`📋 Created #${LOG_CHANNEL_NAME} in ${guild.name}`);
        return channel;
    } catch (error) {
        console.error(`❌ Could not create/find #${LOG_CHANNEL_NAME} in ${guild.name}:`, error.message);
        return null;
    }
}

async function logEvent(guild, title, description, color = null) {
    try {
        const channel = await getOrCreateLogChannel(guild);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(truncateLog(description, 4000))
            .setTimestamp();

        if (color) embed.setColor(color);

        await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error(`❌ Log error in ${guild.name}:`, error.message);
    }
}

async function findAuditExecutor(guild, type, targetId) {
    try {
        const logs = await guild.fetchAuditLogs({ limit: 10, type });
        const entry = logs.entries.find(entry => {
            if (targetId && entry.target?.id !== targetId) return false;
            return Date.now() - entry.createdTimestamp < 15000;
        });
        return entry?.executor || null;
    } catch {
        return null;
    }
}

async function setupLogging(guild) {
    ensureGuildData(guild.id);
    await getOrCreateLogChannel(guild);
}

// ============================================================
// AUTOMATIC ROLES
// ============================================================

const automaticRoles = [
    "On Duty",
    "Off Duty",
    "Commended",
    "Distinguished Service Medal",
    "Meritorious Service Medal",
    "Superior Service Medal",
    "Defense Service Medal",
    "Good Conduct Medal",
    "Marksmanship Medal",
    "Humanitarian Service Medal",
    "Outstanding Achievement Medal",
    "Service Excellence Medal",
    "Bronze Achievement Medal",
    "Silver Achievement Medal",
    "Gold Achievement Medal"
];

async function setupRoles(guild) {
    ensureGuildData(guild.id);

    for (const roleName of automaticRoles) {
        await getOrCreateRole(guild, roleName);
    }
}

// ============================================================
// INVITE TRACKING
// ============================================================

const inviteCache = new Map();

async function cacheInvites(guild) {
    try {
        const invites = await guild.invites.fetch();

        const data = new Map();

        for (const invite of invites.values()) {
            data.set(invite.code, {
                uses: invite.uses || 0,
                inviterId: invite.inviter?.id || null
            });
        }

        inviteCache.set(guild.id, data);
    } catch (error) {
        console.log(
            `⚠️ Could not cache invites for ${guild.name}: ${error.message}`
        );
    }
}

async function trackInviteJoin(member) {
    const guild = member.guild;

    try {
        const before = inviteCache.get(guild.id) || new Map();
        const invites = await guild.invites.fetch();

        let usedInvite = null;

        for (const invite of invites.values()) {
            const oldInvite = before.get(invite.code);

            const oldUses = oldInvite ? oldInvite.uses : 0;
            const newUses = invite.uses || 0;

            if (newUses > oldUses) {
                usedInvite = invite;
                break;
            }
        }

        const newCache = new Map();

        for (const invite of invites.values()) {
            newCache.set(invite.code, {
                uses: invite.uses || 0,
                inviterId: invite.inviter?.id || null
            });
        }

        inviteCache.set(guild.id, newCache);

        if (!usedInvite || !usedInvite.inviter) return;

        ensureGuildData(guild.id);

        const inviterId = usedInvite.inviter.id;

        if (!database.invites[guild.id][inviterId]) {
            database.invites[guild.id][inviterId] = {
                joins: 0,
                members: [],
                linksCreated: 0
            };
        }

        database.invites[guild.id][inviterId].joins++;

        if (
            !database.invites[guild.id][inviterId].members.includes(member.id)
        ) {
            database.invites[guild.id][inviterId].members.push(member.id);
        }

        saveDatabase();

        console.log(
            `📨 ${member.user.tag} joined ${guild.name} using ${usedInvite.code}`
        );
    } catch (error) {
        console.error("Invite tracking error:", error);
    }
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [

    // 1
    new SlashCommandBuilder()
        .setName("security")
        .setDescription("Open the server security panel."),

    // 2
    new SlashCommandBuilder()
        .setName("globalban")
        .setDescription("Globally ban a user from USM Defense servers.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("User to globally ban")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("reason")
                .setDescription("Reason")
                .setRequired(false)
        ),

    // 3
    new SlashCommandBuilder()
        .setName("globalunban")
        .setDescription("Remove a global ban.")
        .addStringOption(option =>
            option
                .setName("userid")
                .setDescription("Discord user ID")
                .setRequired(true)
        ),

    // 4
    new SlashCommandBuilder()
        .setName("globalbanlist")
        .setDescription("View the global ban list."),

    // 5
    new SlashCommandBuilder()
        .setName("warn")
        .setDescription("Warn a member.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("reason")
                .setDescription("Reason")
                .setRequired(true)
        ),

    // 6
    new SlashCommandBuilder()
        .setName("warnings")
        .setDescription("View a member's warnings.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(true)
        ),

    // 7
    new SlashCommandBuilder()
        .setName("linkroblox")
        .setDescription("Start Roblox account verification.")
        .addStringOption(option =>
            option
                .setName("username")
                .setDescription("Roblox username")
                .setRequired(true)
        ),

    // 8
    new SlashCommandBuilder()
        .setName("verifyroblox")
        .setDescription("Verify your Roblox account.")
        .addStringOption(option =>
            option
                .setName("code")
                .setDescription("Verification code")
                .setRequired(true)
        ),

    // 9
    new SlashCommandBuilder()
        .setName("invite")
        .setDescription("Get the bot invite link."),

    // 10
    new SlashCommandBuilder()
        .setName("inviteserver")
        .setDescription("Create a tracked server invite.")
        .addIntegerOption(option =>
            option
                .setName("maxuses")
                .setDescription("Maximum uses")
                .setMinValue(0)
                .setRequired(false)
        ),

    // 11
    new SlashCommandBuilder()
        .setName("invites")
        .setDescription("View someone's invite statistics.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("User")
                .setRequired(false)
        ),

    // 12
    new SlashCommandBuilder()
        .setName("inviteleaderboard")
        .setDescription("View the invite leaderboard."),

    // 13
    new SlashCommandBuilder()
        .setName("commend")
        .setDescription("Commend a member.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(true)
        ),

    // 14
    new SlashCommandBuilder()
        .setName("commendations")
        .setDescription("View a member's commendations.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(true)
        ),

    // 15
    new SlashCommandBuilder()
        .setName("duty")
        .setDescription("Toggle your on-duty status."),

    // 16
    new SlashCommandBuilder()
        .setName("dutytime")
        .setDescription("View duty time.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("User")
                .setRequired(false)
        ),

    // 17
    new SlashCommandBuilder()
        .setName("timeleaderboard")
        .setDescription("View the duty-time leaderboard."),

    // 18
    new SlashCommandBuilder()
        .setName("promote")
        .setDescription("Promote a member in their service record.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("rank")
                .setDescription("New rank")
                .setRequired(true)
        ),

    // 19
    new SlashCommandBuilder()
        .setName("demote")
        .setDescription("Demote a member in their service record.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("rank")
                .setDescription("New rank")
                .setRequired(true)
        ),

    // 20
    new SlashCommandBuilder()
        .setName("service-record")
        .setDescription("View a member's service record.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(false)
        ),

    // 21
    new SlashCommandBuilder()
        .setName("roster")
        .setDescription("View the server roster."),

    // 22
    new SlashCommandBuilder()
        .setName("loa")
        .setDescription("Place a member on or remove them from LOA.")
        .addSubcommand(sub =>
            sub
                .setName("start")
                .setDescription("Start LOA")
                .addUserOption(option =>
                    option
                        .setName("user")
                        .setDescription("Member")
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName("reason")
                        .setDescription("Reason")
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName("end")
                .setDescription("End LOA")
                .addUserOption(option =>
                    option
                        .setName("user")
                        .setDescription("Member")
                        .setRequired(true)
                )
        ),

    // 23
    new SlashCommandBuilder()
        .setName("report")
        .setDescription("Submit a report.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("User being reported")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("reason")
                .setDescription("Report reason")
                .setRequired(true)
        ),

    // 24
    new SlashCommandBuilder()
        .setName("report-list")
        .setDescription("View open reports."),

    // 25
    new SlashCommandBuilder()
        .setName("ticket")
        .setDescription("Create a private support ticket."),

    // 26
    new SlashCommandBuilder()
        .setName("audit")
        .setDescription("View recent bot audit records."),

    // 27
    new SlashCommandBuilder()
        .setName("roblox")
        .setDescription("View a member's linked Roblox account.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Discord user")
                .setRequired(false)
        ),

    // 28
    new SlashCommandBuilder()
        .setName("dutylist")
        .setDescription("View members currently on duty."),

    // 29
    new SlashCommandBuilder()
        .setName("setstaffrole")
        .setDescription("Set the staff role for this server.")
        .addRoleOption(option =>
            option
                .setName("role")
                .setDescription("Staff role")
                .setRequired(true)
        ),

    // 30
    new SlashCommandBuilder()
        .setName("security-status")
        .setDescription("View the current security status."),

    // 31
    new SlashCommandBuilder()
        .setName("clearwarnings")
        .setDescription("Clear a member's warnings.")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Member")
                .setRequired(true)
        ),

    // 32
    new SlashCommandBuilder()
        .setName("close-report")
        .setDescription("Close a report.")
        .addIntegerOption(option =>
            option
                .setName("id")
                .setDescription("Report ID")
                .setRequired(true)
        )
].map(command => command);

// ============================================================
// COMMAND CLEANUP + REGISTRATION
// ============================================================

async function clearOldGuildCommands() {
    console.log("🧹 Removing old server-specific slash commands...");

    const rest = new REST({
        version: "10"
    }).setToken(TOKEN);

    for (const guild of client.guilds.cache.values()) {
        try {
            await rest.put(
                Routes.applicationGuildCommands(
                    CLIENT_ID,
                    guild.id
                ),
                {
                    body: []
                }
            );

            console.log(
                `🗑️ Removed old server commands from ${guild.name}`
            );
        } catch (error) {
            console.error(
                `❌ Could not clear ${guild.name}:`,
                error.message
            );
        }
    }

    console.log("✅ Old server-specific commands cleared.");
}

async function registerCommands() {
    console.log("📡 Registering global slash commands...");

    const rest = new REST({
        version: "10"
    }).setToken(TOKEN);

    await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        {
            body: commands.map(command => command.toJSON())
        }
    );

    console.log(
        `✅ Global commands registered: ${commands.length}`
    );
}

// ============================================================
// INTERACTION HANDLER
// ============================================================

client.on("interactionCreate", async interaction => {

    if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isStringSelectMenu()) {
        return;
    }

    try {

        // ====================================================
        // SECURITY BUTTONS
        // ====================================================

        if (interaction.isButton()) {

            if (!staffOnly(interaction)) return;

            const settings = getSettings(interaction.guild.id);

            if (interaction.customId === "security_lockdown") {
                settings.lockdown = !settings.lockdown;

                addAudit(
                    interaction.guild.id,
                    settings.lockdown ? "Enabled lockdown" : "Disabled lockdown",
                    interaction.user.id
                );

                await interaction.reply({
                    content: settings.lockdown
                        ? "🔒 Server lockdown enabled."
                        : "🔓 Server lockdown disabled.",
                    flags: MessageFlags.Ephemeral
                });

                saveDatabase();
                return;
            }

            if (interaction.customId === "security_spam") {
                settings.spamEnabled = !settings.spamEnabled;

                addAudit(
                    interaction.guild.id,
                    settings.spamEnabled
                        ? "Enabled anti-spam"
                        : "Disabled anti-spam",
                    interaction.user.id
                );

                await interaction.reply({
                    content: settings.spamEnabled
                        ? "🛡️ Anti-spam enabled."
                        : "🛡️ Anti-spam disabled.",
                    flags: MessageFlags.Ephemeral
                });

                saveDatabase();
                return;
            }

            if (interaction.customId === "security_raid") {
                settings.raidEnabled = !settings.raidEnabled;

                addAudit(
                    interaction.guild.id,
                    settings.raidEnabled
                        ? "Enabled anti-raid"
                        : "Disabled anti-raid",
                    interaction.user.id
                );

                await interaction.reply({
                    content: settings.raidEnabled
                        ? "🚨 Anti-raid mode enabled."
                        : "🚨 Anti-raid mode disabled.",
                    flags: MessageFlags.Ephemeral
                });

                saveDatabase();
                return;
            }

            return;
        }

        // ====================================================
        // COMMANDS
        // ====================================================

        const command = interaction.commandName;

        // ---------------- SECURITY ----------------

        if (command === "security") {

            if (!staffOnly(interaction)) return;

            const settings = getSettings(interaction.guild.id);

            const embed = new EmbedBuilder()
                .setTitle("🛡️ USM Defenses Security")
                .setDescription("Server security controls.")
                .addFields(
                    {
                        name: "🔒 Lockdown",
                        value: settings.lockdown ? "Enabled" : "Disabled",
                        inline: true
                    },
                    {
                        name: "🛡️ Anti-Spam",
                        value: settings.spamEnabled ? "Enabled" : "Disabled",
                        inline: true
                    },
                    {
                        name: "🚨 Anti-Raid",
                        value: settings.raidEnabled ? "Enabled" : "Disabled",
                        inline: true
                    }
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("security_lockdown")
                    .setLabel("Lockdown")
                    .setStyle(ButtonStyle.Danger),

                new ButtonBuilder()
                    .setCustomId("security_spam")
                    .setLabel("Anti-Spam")
                    .setStyle(ButtonStyle.Primary),

                new ButtonBuilder()
                    .setCustomId("security_raid")
                    .setLabel("Anti-Raid")
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.reply({
                embeds: [embed],
                components: [row]
            });

            return;
        }

        // ---------------- SECURITY STATUS ----------------

        if (command === "security-status") {

            if (!staffOnly(interaction)) return;

            const settings = getSettings(interaction.guild.id);

            await interaction.reply({
                content:
                    `🛡️ **Security Status**\n\n` +
                    `🔒 Lockdown: **${settings.lockdown ? "ON" : "OFF"}**\n` +
                    `🛡️ Anti-Spam: **${settings.spamEnabled ? "ON" : "OFF"}**\n` +
                    `🚨 Anti-Raid: **${settings.raidEnabled ? "ON" : "OFF"}**`,
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ---------------- GLOBAL BAN ----------------

        if (command === "globalban") {

            if (!staffOnly(interaction)) return;

            const user = interaction.options.getUser("user");
            const reason =
                interaction.options.getString("reason") ||
                "No reason provided.";

            if (user.id === GLOBAL_BAN_IMMUNE_USER_ID) {
                await interaction.reply({
                    content: "❌ That user is immune from global bans.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            database.globalBans[user.id] = {
                username: user.tag,
                reason,
                bannedBy: interaction.user.id,
                timestamp: Date.now()
            };

            saveDatabase();

            let bannedCount = 0;

            for (const guild of client.guilds.cache.values()) {
                try {
                    const member = await guild.members.fetch(user.id);

                    if (member) {
                        await member.ban({
                            reason: `USM Global Ban: ${reason}`
                        });

                        bannedCount++;
                    }
                } catch {
                    // User isn't in server or bot lacks permission.
                }
            }

            addAudit(
                interaction.guild.id,
                "Global ban",
                interaction.user.id,
                user.id,
                reason
            );

            await interaction.reply({
                content:
                    `🔨 **${user.tag}** has been globally banned.\n` +
                    `Servers affected: **${bannedCount}**\n` +
                    `Reason: ${reason}`
            });

            return;
        }

        // ---------------- GLOBAL UNBAN ----------------

        if (command === "globalunban") {

            if (!staffOnly(interaction)) return;

            const userId = interaction.options.getString("userid");

            if (!database.globalBans[userId]) {
                await interaction.reply({
                    content: "❌ That user is not globally banned.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            delete database.globalBans[userId];

            saveDatabase();

            addAudit(
                interaction.guild.id,
                "Global unban",
                interaction.user.id,
                userId
            );

            await interaction.reply({
                content: `✅ Global ban removed from **${userId}**.`
            });

            return;
        }

        // ---------------- GLOBAL BAN LIST ----------------

        if (command === "globalbanlist") {

            if (!staffOnly(interaction)) return;

            const bans = Object.entries(database.globalBans);

            if (bans.length === 0) {
                await interaction.reply({
                    content: "There are no global bans.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const text = bans
                .slice(-50)
                .map(([id, data], index) =>
                    `**${index + 1}.** <@${id}> — ${data.reason}`
                )
                .join("\n");

            await interaction.reply({
                content: `🔨 **Global Ban List**\n\n${text}`,
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ---------------- WARN ----------------

        if (command === "warn") {

            if (!staffOnly(interaction)) return;

            const user = interaction.options.getUser("user");
            const reason = interaction.options.getString("reason");

            ensureGuildData(interaction.guild.id);

            if (!database.warnings[interaction.guild.id][user.id]) {
                database.warnings[interaction.guild.id][user.id] = [];
            }

            database.warnings[interaction.guild.id][user.id].push({
                reason,
                moderator: interaction.user.id,
                timestamp: Date.now()
            });

            saveDatabase();

            addAudit(
                interaction.guild.id,
                "Warning issued",
                interaction.user.id,
                user.id,
                reason
            );

            await interaction.reply({
                content:
                    `⚠️ **${user.tag}** has been warned.\n` +
                    `Reason: ${reason}`
            });

            return;
        }

        // ---------------- WARNINGS ----------------

        if (command === "warnings") {

            const user =
                interaction.options.getUser("user") ||
                interaction.user;

            ensureGuildData(interaction.guild.id);

            const warnings =
                database.warnings[interaction.guild.id][user.id] || [];

            if (warnings.length === 0) {
                await interaction.reply({
                    content: `✅ ${user.tag} has no warnings.`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const text = warnings
                .map((warning, index) =>
                    `**${index + 1}.** ${warning.reason} — <@${warning.moderator}>`
                )
                .join("\n");

            await interaction.reply({
                content: `⚠️ **Warnings for ${user.tag}**\n\n${text}`,
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ---------------- CLEAR WARNINGS ----------------

        if (command === "clearwarnings") {

            if (!staffOnly(interaction)) return;

            const user = interaction.options.getUser("user");

            ensureGuildData(interaction.guild.id);

            delete database.warnings[interaction.guild.id][user.id];

            saveDatabase();

            addAudit(
                interaction.guild.id,
                "Warnings cleared",
                interaction.user.id,
                user.id
            );

            await interaction.reply({
                content: `✅ Warnings cleared for **${user.tag}**.`
            });

            return;
        }

        // ---------------- ROBLOX LINK ----------------

        if (command === "linkroblox") {

            const username =
                interaction.options.getString("username");

            const code =
                crypto.randomBytes(4).toString("hex").toUpperCase();

            ensureGuildData(interaction.guild.id);

            database.robloxLinks[interaction.guild.id][interaction.user.id] = {
                username,
                code,
                verified: false,
                createdAt: Date.now()
            };

            saveDatabase();

            await interaction.reply({
                content:
                    `🔗 **Roblox Verification**\n\n` +
                    `Roblox username: **${username}**\n` +
                    `Verification code: **${code}**\n\n` +
                    `Put this code in your Roblox profile/bio, then run:\n` +
                    `\`/verifyroblox code:${code}\`\n\n` +
                    `⚠️ The bot cannot automatically read your Roblox profile, so staff should confirm the code.`,
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ---------------- VERIFY ROBLOX ----------------

        if (command === "verifyroblox") {

            const code =
                interaction.options.getString("code");

            ensureGuildData(interaction.guild.id);

            const record =
                database.robloxLinks[interaction.guild.id][interaction.user.id];

            if (!record) {
                await interaction.reply({
                    content: "❌ You do not have a pending Roblox verification.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            if (record.code !== code.toUpperCase()) {
                await interaction.reply({
                    content: "❌ Incorrect verification code.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            record.verified = true;

            saveDatabase();

            await interaction.reply({
                content:
                    `✅ Verification recorded for Roblox account **${record.username}**.\n` +
                    `A staff member may confirm your profile code.`,
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ---------------- ROBLOX INFO ----------------

        if (command === "roblox") {

            const user =
                interaction.options.getUser("user") ||
                interaction.user;

            ensureGuildData(interaction.guild.id);

            const record =
                database.robloxLinks[interaction.guild.id][user.id];

            if (!record) {
                await interaction.reply({
                    content: `❌ ${user.tag} has no linked Roblox account.`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            await interaction.reply({
                content:
                    `🎮 **Roblox Information**\n\n` +
                    `Discord: ${user.tag}\n` +
                    `Roblox: **${record.username}**\n` +
                    `Verified: **${record.verified ? "Yes" : "Pending"}**`,
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ---------------- INVITE ----------------

        if (command === "invite") {

            await interaction.reply({
                content:
                    `🔗 **USM Defenses Invite**\n\n` +
                    `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&integration_type=0&scope=bot+applications.commands`
            });

            return;
        }

        // ---------------- CREATE INVITE ----------------

        if (command === "inviteserver") {

            if (!interaction.guild) return;

            const maxUses =
                interaction.options.getInteger("maxuses") ?? 0;

            try {
                const invite = await interaction.channel.createInvite({
                    maxUses,
                    reason: `Created by ${interaction.user.tag}`
                });

                ensureGuildData(interaction.guild.id);

                if (!database.inviteLinks[interaction.guild.id]) {
                    database.inviteLinks[interaction.guild.id] = {};
                }

                database.inviteLinks[interaction.guild.id][invite.code] = {
                    inviterId: interaction.user.id,
                    createdAt: Date.now()
                };

                if (!database.invites[interaction.guild.id][interaction.user.id]) {
                    database.invites[interaction.guild.id][interaction.user.id] = {
                        joins: 0,
                        members: [],
                        linksCreated: 0
                    };
                }

                database.invites[interaction.guild.id][interaction.user.id].linksCreated++;

                saveDatabase();

                await interaction.reply({
                    content:
                        `🔗 **Invite Created**\n\n` +
                        `${invite.url}\n\n` +
                        `Uses: **${maxUses === 0 ? "Unlimited" : maxUses}**`
                });

            } catch (error) {
                await interaction.reply({
                    content:
                        `❌ I couldn't create an invite. Make sure I have **Create Invite** permission.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            return;
        }

        // ---------------- INVITES ----------------

        if (command === "invites") {

            const user =
                interaction.options.getUser("user") ||
                interaction.user;

            ensureGuildData(interaction.guild.id);

            const stats =
                database.invites[interaction.guild.id][user.id] || {
                    joins: 0,
                    members: [],
                    linksCreated: 0
                };

            await interaction.reply({
                content:
                    `📨 **Invite Stats — ${user.tag}**\n\n` +
                    `Joins: **${stats.joins}**\n` +
                    `Unique members: **${stats.members.length}**
\n` +
                    `Invite links created: **${stats.linksCreated}**`,
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ---------------- INVITE LEADERBOARD ----------------

        if (command === "inviteleaderboard") {

            ensureGuildData(interaction.guild.id);

            const entries =
                Object.entries(database.invites[interaction.guild.id])
                    .sort((a, b) => b[1].joins - a[1].joins)
                    .slice(0, 10);

            if (entries.length === 0) {
                await interaction.reply("No invite data yet.");
                return;
            }

            const text = entries
                .map(
                    ([userId, data], index) =>
                        `**${index + 1}.** <@${userId}> — **${data.joins} joins**`
                )
                .join("\n");

            await interaction.reply(
                `📊 **Invite Leaderboard**\n\n${text}`
            );

            return;
        }

        // ---------------- COMMEND ----------------

        if (command === "commend") {

            if (!staffOnly(interaction)) return;

            const user =
                interaction.options.getUser("user");

            await interaction.reply({
                content:
                    `🏅 Select a commendation for **${user.tag}**.`,
                components: [
                    new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId(`commend_${user.id}`)
                            .setPlaceholder("Select commendation")
                            .addOptions(
                                automaticRoles
                                    .filter(role => role !== "On Duty" && role !== "Off Duty")
                                    .map(role => ({
                                        label: role,
                                        value: role
                                    }))
                            )
                    )
                ]
            });

            return;
        }

        // ---------------- COMMENDATION MENU ----------------

        if (interaction.isStringSelectMenu()) {

            if (!interaction.customId.startsWith("commend_")) {
                return;
            }

            if (!staffOnly(interaction)) return;

            const userId =
                interaction.customId.replace("commend_", "");

            const roleName =
                interaction.values[0];

            const member =
                await interaction.guild.members.fetch(userId).catch(() => null);

            if (!member) {
                await interaction.reply({
                    content: "❌ Member not found.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const role =
                await getOrCreateRole(interaction.guild, roleName);

            if (!role) {
                await interaction.reply({
                    content: "❌ I couldn't create/find that role.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            await member.roles.add(role);

            if (!database.serviceRecords[interaction.guild.id][userId]) {
                database.serviceRecords[interaction.guild.id][userId] = {
                    rank: "Unassigned",
                    history: []
                };
            }

            database.serviceRecords[interaction.guild.id][userId].history.push({
                type: "commendation",
                value: roleName,
                by: interaction.user.id,
                timestamp: Date.now()
            });

            saveDatabase();

            addAudit(
                interaction.guild.id,
                "Commendation",
                interaction.user.id,
                userId,
                roleName
            );

            await interaction.update({
                content: `🏅 **${roleName}** awarded to <@${userId}>.`,
                components: []
            });

            return;
        }

        // ---------------- COMMENDATIONS ----------------

        if (command === "commendations") {

            const user =
                interaction.options.getUser("user");

            ensureGuildData(interaction.guild.id);

            const record =
                database.serviceRecords[interaction.guild.id][user.id];

            const commendations =
                record?.history?.filter(
                    entry => entry.type === "commendation"
                ) || [];

            if (commendations.length === 0) {
                await interaction.reply({
                    content: `No commendations recorded for ${user.tag}.`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const text = commendations
                .slice(-20)
                .map(
                    entry =>
                        `🏅 **${entry.value}** — <@${entry.by}>`
                )
                .join("\n");

            await interaction.reply({
                content:
                    `🏅 **Commendations — ${user.tag}**\n\n${text}`,
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ---------------- DUTY ----------------

        if (command === "duty") {

            ensureGuildData(interaction.guild.id);

            const data =
                database.duty[interaction.guild.id][interaction.user.id];

            const onDutyRole =
                await getOrCreateRole(interaction.guild, "On Duty");

            const offDutyRole =
                await getOrCreateRole(interaction.guild, "Off Duty");

            if (!data || !data.onDuty) {

                database.duty[interaction.guild.id][interaction.user.id] = {
                    onDuty: true,
                    startedAt: Date.now(),
                    totalMs: data?.totalMs || 0
                };

                if (onDutyRole) {
                    await interaction.member.roles.add(onDutyRole).catch(() => {});
                }

                if (offDutyRole) {
                    await interaction.member.roles.remove(offDutyRole).catch(() => {});
                }

                saveDatabase();

                await interaction.reply({
                    content: "🟢 You are now **ON DUTY**."
                });

            } else {

                const elapsed =
                    Date.now() - data.startedAt;

                data.totalMs += elapsed;
                data.onDuty = false;
                data.startedAt = null;

                if (offDutyRole) {
                    await interaction.member.roles.add(offDutyRole).catch(() => {});
                }

                if (onDutyRole) {
                    await interaction.member.roles.remove(onDutyRole).catch(() => {});
                }

                saveDatabase();

                await interaction.reply({
                    content:
                        `🔴 You are now **OFF DUTY**.\n` +
                        `Session: **${formatDuration(elapsed)}**`
                });
            }

            return;
        }

        // ---------------- DUTY TIME ----------------

        if (command === "dutytime") {

            const user =
                interaction.options.getUser("user") ||
                interaction.user;

            ensureGuildData(interaction.guild.id);

            const data =
                database.duty[interaction.guild.id][user.id];

            if (!data) {
                await interaction.reply({
                    content: `${user.tag} has no recorded duty time.`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            let total = data.totalMs || 0;

            if (data.onDuty && data.startedAt) {
                total += Date.now() - data.startedAt;
            }

            await interaction.reply({
                content:
                    `⏱️ **Duty Time — ${user.tag}**\n\n` +
                    `Total: **${formatDuration(total)}**\n` +
                    `Status: **${data.onDuty ? "ON DUTY" : "OFF DUTY"}**`,
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ---------------- DUTY LEADERBOARD ----------------

        if (command === "timeleaderboard") {

            ensureGuildData(interaction.guild.id);

            const entries =
                Object.entries(database.duty[interaction.guild.id])
                    .map(([userId, data]) => {

                        let total = data.totalMs || 0;

                        if (data.onDuty && data.startedAt) {
                            total += Date.now() - data.startedAt;
                        }

                        return {
                            userId,
                            total
                        };
                    })
                    .sort((a, b) => b.total - a.total)
                    .slice(0, 10);

            if (entries.length === 0) {
                await interaction.reply("No duty records yet.");
                return;
            }

            const text = entries
                .map(
                    (entry, index) =>
                        `**${index + 1}.** <@${entry.userId}> — **${formatDuration(entry.total)}**`
                )
                .join("\n");

            await interaction.reply(
                `⏱️ **Duty Time Leaderboard**\n\n${text}`
            );

            return;
        }

        // ---------------- DUTY LIST ----------------

        if (command === "dutylist") {

            ensureGuildData(interaction.guild.id);

            const users =
                Object.entries(database.duty[interaction.guild.id])
                    .filter(([_, data]) => data.onDuty);

            if (users.length === 0) {
                await interaction.reply("🟢 Nobody is currently on duty.");
                return;
            }

            const text = users
                .map(([userId]) => `🟢 <@${userId}>`)
                .join("\n");

            await interaction.reply(
                `🟢 **Currently On Duty**\n\n${text}`
            );

            return;
        }

        // ---------------- PROMOTE ----------------

        if (command === "promote") {

            if (!staffOnly(interaction)) return;

            const user =
                interaction.options.getUser("user");

            const rank =
                interaction.options.getString("rank");

            ensureGuildData(interaction.guild.id);

            if (!database.serviceRecords[interaction.guild.id][user.id]) {
                database.serviceRecords[interaction.guild.id][user.id] = {
                    rank: "Unassigned",
                    history: []
                };
            }

            const record =
                database.serviceRecords[interaction.guild.id][user.id];

            const oldRank = record.rank;

            record.rank = rank;

            record.history.push({
                type: "promotion",
                from: oldRank,
                to: rank,
                by: interaction.user.id,
                timestamp: Date.now()
            });

            saveDatabase();

            addAudit(
                interaction.guild.id,
                "Promotion",
                interaction.user.id,
                user.id,
                `${oldRank} → ${rank}`
            );

            await interaction.reply(
                `⬆️ **${user.tag}** promoted from **${oldRank}** to **${rank}**.`
            );

            return;
        }

        // ---------------- DEMOTE ----------------

        if (command === "demote") {

            if (!staffOnly(interaction)) return;

            const user =
                interaction.options.getUser("user");

            const rank =
                interaction.options.getString("rank");

            ensureGuildData(interaction.guild.id);

            if (!database.serviceRecords[interaction.guild.id][user.id]) {
                database.serviceRecords[interaction.guild.id][user.id] = {
                    rank: "Unassigned",
                    history: []
                };
            }

            const record =
                database.serviceRecords[interaction.guild.id][user.id];

            const oldRank = record.rank;

            record.rank = rank;

            record.history.push({
                type: "demotion",
                from: oldRank,
                to: rank,
                by: interaction.user.id,
                timestamp: Date.now()
            });

            saveDatabase();

            addAudit(
                interaction.guild.id,
                "Demotion",
                interaction.user.id,
                user.id,
                `${oldRank} → ${rank}`
            );

            await interaction.reply(
                `⬇️ **${user.tag}** changed from **${oldRank}** to **${rank}**.`
            );

            return;
        }

        // ---------------- SERVICE RECORD ----------------

        if (command === "service-record") {

            const user =
                interaction.options.getUser("user") ||
                interaction.user;

            ensureGuildData(interaction.guild.id);

            const record =
                database.serviceRecords[interaction.guild.id][user.id];

            if (!record) {
                await interaction.reply({
                    content: `No service record exists for ${user.tag}.`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const history =
                record.history
                    .slice(-10)
                    .map(entry => {

                        if (entry.type === "promotion") {
                            return `⬆️ Promotion: **${entry.from} → ${entry.to}**`;
                        }

                        if (entry.type === "demotion") {
                            return `⬇️ Demotion: **${entry.from} → ${entry.to}**`;
                        }

                        if (entry.type === "commendation") {
                            return `🏅 ${entry.value}`;
                        }

                        return entry.type;
                    })
                    .join("\n");

            await interaction.reply({
                content:
                    `📋 **Service Record — ${user.tag}**\n\n` +
                    `Current Rank: **${record.rank}**\n\n` +
                    `**Recent History**\n${history || "None"}`,
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ---------------- ROSTER ----------------

        if (command === "roster") {

            ensureGuildData(interaction.guild.id);

            const records =
                database.serviceRecords[interaction.guild.id];

            const entries =
                Object.entries(records);

            if (entries.length === 0) {
                await interaction.reply("The roster is currently empty.");
                return;
            }

            const text = entries
                .slice(0, 50)
                .map(
                    ([userId, record]) =>
                        `<@${userId}> — **${record.rank}**`
                )
                .join("\n");

            await interaction.reply(
                `📋 **USM Roster**\n\n${text}`
            );

            return;
        }

        // ---------------- LOA ----------------

        if (command === "loa") {

            if (!staffOnly(interaction)) return;

            const subcommand =
                interaction.options.getSubcommand();

            const user =
                interaction.options.getUser("user");

            ensureGuildData(interaction.guild.id);

            if (subcommand === "start") {

                const reason =
                    interaction.options.getString("reason");

                database.leaveOfAbsence[interaction.guild.id][user.id] = {
                    reason,
                    startedBy: interaction.user.id,
                    startedAt: Date.now()
                };

                saveDatabase();

                addAudit(
                    interaction.guild.id,
                    "LOA started",
                    interaction.user.id,
                    user.id,
                    reason
                );

                await interaction.reply(
                    `📝 <@${user.id}> has been placed on LOA.\nReason: ${reason}`
                );

            } else {

                if (!database.leaveOfAbsence[interaction.guild.id][user.id]) {
                    await interaction.reply({
                        content: "❌ That user is not currently on LOA.",
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                delete database.leaveOfAbsence[interaction.guild.id][user.id];

                saveDatabase();

                addAudit(
                    interaction.guild.id,
                    "LOA ended",
                    interaction.user.id,
                    user.id
                );

                await interaction.reply(
                    `✅ <@${user.id}> has been removed from LOA.`
                );
            }

            return;
        }

        // ---------------- REPORT ----------------

        if (command === "report") {

            const user =
                interaction.options.getUser("user");

            const reason =
                interaction.options.getString("reason");

            ensureGuildData(interaction.guild.id);

            database.reportCounter++;

            const id = database.reportCounter;

            database.reports[interaction.guild.id][id] = {
                id,
                reporterId: interaction.user.id,
                targetId: user.id,
                reason,
                status: "open",
                createdAt: Date.now()
            };

            saveDatabase();

            await interaction.reply({
                content:
                    `🚨 Report **#${id}** submitted successfully.\n` +
                    `Staff will review it.`,
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ---------------- REPORT LIST ----------------

        if (command === "report-list") {

            if (!staffOnly(interaction)) return;

            ensureGuildData(interaction.guild.id);

            const reports =
                Object.values(database.reports[interaction.guild.id])
                    .filter(report => report.status === "open")
                    .slice(-25);

            if (reports.length === 0) {
                await interaction.reply({
                    content: "There are no open reports.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const text = reports
                .map(
                    report =>
                        `**#${report.id}** — <@${report.targetId}> — ${report.reason} — reported by <@${report.reporterId}>`
                )
                .join("\n");

            await interaction.reply({
                content: `🚨 **Open Reports**\n\n${text}`,
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ---------------- CLOSE REPORT ----------------

        if (command === "close-report") {

            if (!staffOnly(interaction)) return;

            const id =
                interaction.options.getInteger("id");

            ensureGuildData(interaction.guild.id);

            const report =
                database.reports[interaction.guild.id][id];

            if (!report) {
                await interaction.reply({
                    content: "❌ Report not found.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            report.status = "closed";
            report.closedBy = interaction.user.id;
            report.closedAt = Date.now();

            saveDatabase();

            addAudit(
                interaction.guild.id,
                "Report closed",
                interaction.user.id,
                report.targetId,
                `Report #${id}`
            );

            await interaction.reply(
                `✅ Report **#${id}** has been closed.`
            );

            return;
        }

        // ---------------- TICKET ----------------

        if (command === "ticket") {

            const existing =
                interaction.guild.channels.cache.find(
                    channel =>
                        channel.type === ChannelType.GuildText &&
                        channel.topic === `USM ticket for ${interaction.user.id}`
                );

            if (existing) {
                await interaction.reply({
                    content: `❌ You already have a ticket: ${existing}`,
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const settings =
                getSettings(interaction.guild.id);

            const overwrites = [
                {
                    id: interaction.guild.roles.everyone.id,
                    deny: ["ViewChannel"]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        "ViewChannel",
                        "SendMessages",
                        "ReadMessageHistory"
                    ]
                }
            ];

            if (settings.staffRoleId) {
                overwrites.push({
                    id: settings.staffRoleId,
                    allow: [
                        "ViewChannel",
                        "SendMessages",
                        "ReadMessageHistory"
                    ]
                });
            }

            const channel =
                await interaction.guild.channels.create({
                    name: `ticket-${interaction.user.username}`.toLowerCase().slice(0, 90),
                    type: ChannelType.GuildText,
                    topic: `USM ticket for ${interaction.user.id}`,
                    permissionOverwrites: overwrites
                });

            await channel.send(
                `🎫 **USM Defenses Ticket**\n\n` +
                `Created by ${interaction.user}.\n` +
                `Staff will assist you shortly.`
            );

            await interaction.reply({
                content: `🎫 Ticket created: ${channel}`,
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ---------------- AUDIT ----------------

        if (command === "audit") {

            if (!staffOnly(interaction)) return;

            const logs =
                database.audit
                    .filter(log => log.guildId === interaction.guild.id)
                    .slice(-20)
                    .reverse();

            if (logs.length === 0) {
                await interaction.reply({
                    content: "No audit records yet.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const text = logs
                .map(
                    log =>
                        `**${log.action}** — <@${log.moderatorId}> ${log.targetId ? `→ <@${log.targetId}>` : ""}${log.details ? ` — ${log.details}` : ""}`
                )
                .join("\n");

            await interaction.reply({
                content: `📜 **Audit Log**\n\n${text}`,
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        // ---------------- SET STAFF ROLE ----------------

        if (command === "setstaffrole") {

            if (
                !interaction.memberPermissions?.has(
                    PermissionFlagsBits.Administrator
                )
            ) {
                await interaction.reply({
                    content: "❌ Only server administrators can set the staff role.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const role =
                interaction.options.getRole("role");

            const settings =
                getSettings(interaction.guild.id);

            settings.staffRoleId = role.id;

            saveDatabase();

            addAudit(
                interaction.guild.id,
                "Staff role changed",
                interaction.user.id,
                null,
                role.name
            );

            await interaction.reply(
                `✅ Staff role set to ${role}.`
            );

            return;
        }

    } catch (error) {
        console.error("❌ Interaction error:", error);

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: "❌ Something went wrong while processing that command.",
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await interaction.reply({
                    content: "❌ Something went wrong while processing that command.",
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch {}
    }
});

// ============================================================
// GLOBAL BAN CHECK ON JOIN
// ============================================================

client.on("guildMemberAdd", async member => {

    try {
        if (database.globalBans[member.id]) {

            if (member.id === GLOBAL_BAN_IMMUNE_USER_ID) {
                return;
            }

            const ban =
                database.globalBans[member.id];

            await member.ban({
                reason:
                    `USM Global Ban: ${ban.reason}`
            });

            console.log(
                `🔨 Globally banned ${member.user.tag} from ${member.guild.name}`
            );

            return;
        }

        await trackInviteJoin(member);

    } catch (error) {
        console.error("Guild member join error:", error);
    }
});

// ============================================================
// ANTI-SPAM
// ============================================================

const messageTracker = new Map();

client.on("messageCreate", async message => {

    if (!message.guild || message.author.bot) return;

    const settings = getSettings(message.guild.id);

    if (!settings.spamEnabled) return;

    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const messages = messageTracker.get(key) || [];

    messages.push(now);

    const recent = messages.filter(time => now - time < 5000);
    messageTracker.set(key, recent);

    if (recent.length >= 8) {
        try {
            await message.member.timeout(
                60000,
                "USM Defenses anti-spam"
            );

            await message.channel.send(
                `🛡️ ${message.author} has been temporarily timed out for spam.`
            );
        } catch {}
    }
});

// ============================================================
// SERVER EVENT LOGGING
// ============================================================

client.on("messageUpdate", async (oldMessage, newMessage) => {
    if (!newMessage.guild || newMessage.author?.bot) return;

    try {
        if (oldMessage.partial) await oldMessage.fetch();
        if (newMessage.partial) await newMessage.fetch();
    } catch {}

    const oldContent = oldMessage.content || "(content unavailable)";
    const newContent = newMessage.content || "(content unavailable)";

    if (oldContent === newContent) return;

    await logEvent(
        newMessage.guild,
        "✏️ Message Edited",
        `**User:** ${newMessage.author?.tag || newMessage.author?.username || "Unknown"} (${newMessage.author?.id || "unknown"})\n**Channel:** ${newMessage.channel}\n**Before:** ${truncateLog(oldContent)}\n**After:** ${truncateLog(newContent)}`
    );
});

client.on("messageDelete", async message => {
    if (!message.guild || message.author?.bot) return;

    await logEvent(
        message.guild,
        "🗑️ Message Deleted",
        `**User:** ${message.author?.tag || "Unknown"} (${message.author?.id || "unknown"})\n**Channel:** ${message.channel}\n**Content:** ${truncateLog(message.content || "Content unavailable")}`
    );
});

client.on("roleCreate", async role => {
    const executor = await findAuditExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
    await logEvent(
        role.guild,
        "🆕 Role Created",
        `**Role:** ${role} (${role.id})\n**Name:** ${role.name}\n**Created by:** ${executor ? `${executor.tag} (${executor.id})` : "Unknown"}`
    );
});

client.on("roleDelete", async role => {
    const executor = await findAuditExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
    await logEvent(
        role.guild,
        "🗑️ Role Deleted",
        `**Role:** ${role.name} (${role.id})\n**Deleted by:** ${executor ? `${executor.tag} (${executor.id})` : "Unknown"}`
    );
});

client.on("roleUpdate", async (oldRole, newRole) => {
    const changes = [];

    if (oldRole.name !== newRole.name) {
        changes.push(`**Name:** ${oldRole.name} → ${newRole.name}`);
    }
    if (oldRole.color !== newRole.color) {
        changes.push(`**Color:** ${oldRole.hexColor} → ${newRole.hexColor}`);
    }
    if (oldRole.hoist !== newRole.hoist) {
        changes.push(`**Hoisted:** ${oldRole.hoist} → ${newRole.hoist}`);
    }
    if (oldRole.mentionable !== newRole.mentionable) {
        changes.push(`**Mentionable:** ${oldRole.mentionable} → ${newRole.mentionable}`);
    }

    if (!changes.length) return;

    const executor = await findAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    await logEvent(
        newRole.guild,
        "✏️ Role Updated",
        `**Role:** ${newRole} (${newRole.id})\n${changes.join("\n")}\n**Changed by:** ${executor ? `${executor.tag} (${executor.id})` : "Unknown"}`
    );
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
    const oldRoles = new Set(oldMember.roles.cache.keys());
    const newRoles = new Set(newMember.roles.cache.keys());

    const added = [...newRoles].filter(id => !oldRoles.has(id));
    const removed = [...oldRoles].filter(id => !newRoles.has(id));

    if (added.length || removed.length) {
        const executor = await findAuditExecutor(
            newMember.guild,
            AuditLogEvent.MemberRoleUpdate,
            newMember.id
        );

        const addedText = added.length
            ? `**Given:** ${added.map(id => newMember.guild.roles.cache.get(id)?.toString() || id).join(", ")}`
            : "**Given:** None";

        const removedText = removed.length
            ? `**Removed:** ${removed.map(id => oldMember.guild.roles.cache.get(id)?.name || id).join(", ")}`
            : "**Removed:** None";

        await logEvent(
            newMember.guild,
            "🎭 Member Roles Updated",
            `**Member:** ${newMember.user.tag} (${newMember.id})\n${addedText}\n${removedText}\n**Changed by:** ${executor ? `${executor.tag} (${executor.id})` : "Unknown"}`
        );
    }

    if (oldMember.nickname !== newMember.nickname) {
        const executor = await findAuditExecutor(
            newMember.guild,
            AuditLogEvent.MemberUpdate,
            newMember.id
        );

        await logEvent(
            newMember.guild,
            "🏷️ Nickname Changed",
            `**Member:** ${newMember.user.tag} (${newMember.id})\n**Before:** ${oldMember.nickname || "None"}\n**After:** ${newMember.nickname || "None"}\n**Changed by:** ${executor ? `${executor.tag} (${executor.id})` : "Unknown"}`
        );
    }
});

client.on("guildMemberRemove", async member => {
    const executor = await findAuditExecutor(
        member.guild,
        AuditLogEvent.MemberKick,
        member.id
    );

    if (executor) {
        await logEvent(
            member.guild,
            "👢 Member Kicked",
            `**Member:** ${member.user.tag} (${member.id})\n**Kicked by:** ${executor.tag} (${executor.id})`
        );
    } else {
        await logEvent(
            member.guild,
            "🚪 Member Left",
            `**Member:** ${member.user.tag} (${member.id})`
        );
    }
});

client.on("guildBanAdd", async ban => {
    const executor = await findAuditExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    await logEvent(
        ban.guild,
        "🔨 Member Banned",
        `**Member:** ${ban.user.tag} (${ban.user.id})\n**Banned by:** ${executor ? `${executor.tag} (${executor.id})` : "Unknown"}`
    );
});

client.on("guildBanRemove", async ban => {
    const executor = await findAuditExecutor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    await logEvent(
        ban.guild,
        "🔓 Member Unbanned",
        `**Member:** ${ban.user.tag} (${ban.user.id})\n**Unbanned by:** ${executor ? `${executor.tag} (${executor.id})` : "Unknown"}`
    );
});

client.on("channelCreate", async channel => {
    if (!channel.guild || channel.name === LOG_CHANNEL_NAME) return;
    const executor = await findAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    await logEvent(
        channel.guild,
        "🆕 Channel Created",
        `**Channel:** ${channel} (${channel.id})\n**Type:** ${channel.type}\n**Created by:** ${executor ? `${executor.tag} (${executor.id})` : "Unknown"}`
    );
});

client.on("channelDelete", async channel => {
    if (!channel.guild || channel.name === LOG_CHANNEL_NAME) return;
    const executor = await findAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    await logEvent(
        channel.guild,
        "🗑️ Channel Deleted",
        `**Channel:** #${channel.name} (${channel.id})\n**Deleted by:** ${executor ? `${executor.tag} (${executor.id})` : "Unknown"}`
    );
});

client.on("channelUpdate", async (oldChannel, newChannel) => {
    if (!newChannel.guild || newChannel.name === LOG_CHANNEL_NAME) return;

    const changes = [];
    if (oldChannel.name !== newChannel.name) {
        changes.push(`**Name:** ${oldChannel.name} → ${newChannel.name}`);
    }
    if (oldChannel.topic !== newChannel.topic && "topic" in oldChannel && "topic" in newChannel) {
        changes.push(`**Topic:** ${truncateLog(oldChannel.topic || "None", 300)} → ${truncateLog(newChannel.topic || "None", 300)}`);
    }
    if (oldChannel.parentId !== newChannel.parentId) {
        changes.push(`**Category changed.**`);
    }

    if (!changes.length) return;

    const executor = await findAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
    await logEvent(
        newChannel.guild,
        "✏️ Channel Updated",
        `**Channel:** ${newChannel} (${newChannel.id})\n${changes.join("\n")}\n**Changed by:** ${executor ? `${executor.tag} (${executor.id})` : "Unknown"}`
    );
});

client.on("guildUpdate", async (oldGuild, newGuild) => {
    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push(`**Name:** ${oldGuild.name} → ${newGuild.name}`);
    if (oldGuild.description !== newGuild.description) changes.push(`**Description changed.**`);
    if (!changes.length) return;

    const executor = await findAuditExecutor(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
    await logEvent(
        newGuild,
        "⚙️ Server Updated",
        `${changes.join("\n")}\n**Changed by:** ${executor ? `${executor.tag} (${executor.id})` : "Unknown"}`
    );
});

client.on("inviteCreate", async invite => {
    if (!invite.guild) return;
    await logEvent(
        invite.guild,
        "🔗 Invite Created",
        `**Code:** ${invite.code}\n**Channel:** ${invite.channel || "Unknown"}\n**Created by:** ${invite.inviter ? `${invite.inviter.tag} (${invite.inviter.id})` : "Unknown"}`
    );
});

client.on("inviteDelete", async invite => {
    if (!invite.guild) return;
    await logEvent(
        invite.guild,
        "🗑️ Invite Deleted",
        `**Code:** ${invite.code}\n**Channel:** ${invite.channel || "Unknown"}`
    );
});

client.on("voiceStateUpdate", async (oldState, newState) => {
    if (!newState.guild) return;
    if (oldState.channelId === newState.channelId && oldState.serverMute === newState.serverMute && oldState.serverDeaf === newState.serverDeaf) return;

    let action = "🎙️ Voice State Updated";
    let details = `**Member:** ${newState.member?.user.tag || newState.id} (${newState.id})`;

    if (!oldState.channelId && newState.channelId) {
        action = "🎙️ Joined Voice Channel";
        details += `\n**Channel:** <#${newState.channelId}>`;
    } else if (oldState.channelId && !newState.channelId) {
        action = "🚪 Left Voice Channel";
        details += `\n**Channel:** <#${oldState.channelId}>`;
    } else if (oldState.channelId !== newState.channelId) {
        action = "🔄 Moved Voice Channel";
        details += `\n**From:** <#${oldState.channelId}>\n**To:** <#${newState.channelId}>`;
    } else {
        details += `\n**Server mute:** ${oldState.serverMute} → ${newState.serverMute}\n**Server deaf:** ${oldState.serverDeaf} → ${newState.serverDeaf}`;
    }

    await logEvent(newState.guild, action, details);
});

// ============================================================
// READY
// ============================================================

client.once("clientReady", async () => {

    console.log(
        `🛡️ USM Defenses is online as ${client.user.tag}`
    );

    try {

        // IMPORTANT:
        // This removes old guild-specific commands.
        // It fixes the duplicate-command issue.
        await clearOldGuildCommands();

        // Then publish the one global command set.
        await registerCommands();

        console.log(
            "✅ Command registration complete."
        );

        // Don't let role/invite setup block the bot from becoming ready.
        setImmediate(async () => {

            for (const guild of client.guilds.cache.values()) {

                try {
                    console.log(
                        `🔧 Setting up ${guild.name}...`
                    );

                    ensureGuildData(guild.id);

                    await setupRoles(guild);
                    await setupLogging(guild);
                    await cacheInvites(guild);

                    console.log(
                        `✅ ${guild.name} setup complete.`
                    );

                } catch (error) {
                    console.error(
                        `❌ Setup failed for ${guild.name}:`,
                        error.message
                    );
                }
            }

            saveDatabase();

            console.log(
                `🟢 USM Defenses is fully ready in ${client.guilds.cache.size} server(s).`
            );
        });

    } catch (error) {

        console.error(
            "❌ Startup registration error:",
            error
        );
    }
});

// ============================================================
// NEW SERVER
// ============================================================

client.on("guildCreate", async guild => {

    console.log(
        `➕ Added to server: ${guild.name}`
    );

    ensureGuildData(guild.id);
    saveDatabase();

    try {
        await setupRoles(guild);
        await setupLogging(guild);
    } catch (error) {
        console.error(
            `Role setup error in ${guild.name}:`,
            error.message
        );
    }

    try {
        await cacheInvites(guild);
    } catch (error) {
        console.error(
            `Invite setup error in ${guild.name}:`,
            error.message
        );
    }
});

// ============================================================
// ERROR HANDLING
// ============================================================

process.on("unhandledRejection", error => {
    console.error(
        "❌ Unhandled promise rejection:",
        error
    );
});

process.on("uncaughtException", error => {
    console.error(
        "❌ Uncaught exception:",
        error
    );
});

client.on("error", error => {
    console.error(
        "❌ Discord client error:",
        error
    );
});

client.on("shardError", error => {
    console.error(
        "❌ Discord shard error:",
        error
    );
});

// ============================================================
// LOGIN
// ============================================================

client.login(TOKEN);

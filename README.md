# 🛡️ USM Defenses
**Some are placeholders for now**
**USM Defenses** is a Discord moderation and management bot designed for military simulation, Roblox groups, communities, and general Discord servers.

It provides moderation, security, Roblox verification, invite tracking, duty tracking, commendations, and other tools designed to help server staff manage their communities.

---

## ✨ Features

### 🔐 Security & Moderation

* `/security` — Open the server security dashboard
* Moderation tools for staff
* Warnings and moderation records
* Server lockdown system
* Anti-spam and raid protection
* Staff-only commands
* Audit logging

### 🎖️ Military Community Features

* On Duty / Off Duty system
* Duty-time tracking
* Service records
* Commendations
* Automatic decorative role creation
* Leave of Absence tracking
* Staff management tools

### 🎮 Roblox Integration

* Roblox account verification
* Verification codes
* Roblox profile linking
* Designed for Roblox military and group communities

### 📊 Invite Tracking

* `/invite` — View your invite information
* `/invites` — View invite statistics
* `/inviteleaderboard` — View the server's top inviters
* Invite tracking and statistics

### 🛠️ Server Management

* Configurable staff roles
* Server-specific settings
* Global bot commands
* Server configuration
* Persistent database storage

---

# 🤖 Using USM Defenses

If you want to use the **official USM Defenses bot**, join the USM Defenses Discord server.

The server will contain information about the bot, setup instructions, support, updates, and how to get started.

> The official server link will be provided here once available.

---

# 💻 Self-Hosting USM Defenses

Want to run **your own instance** of USM Defenses?

You can download this repository and host the bot yourself.

## 1. Download the Repository

Clone the repository:

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd USM-Defenses
```

Or download the repository as a ZIP from GitHub.

---

## 2. Install Node.js

USM Defenses requires **Node.js**.

Download Node.js from:

https://nodejs.org/

A current LTS version is recommended.

Check that Node.js is installed:

```bash
node -v
npm -v
```

---

## 3. Install Dependencies

Inside the bot folder, run:

```bash
npm install
```

This will install the required packages.

---

# 🔑 4. Create Your Discord Bot

Go to the **Discord Developer Portal**:

https://discord.com/developers/applications

Create a new application.

Then:

1. Open your application.
2. Go to **Bot**.
3. Create the bot.
4. Copy the bot token.
5. Keep the token private.

### ⚠️ NEVER publish your bot token

Do **not** put your token directly inside `index.js`.

Do not upload it to GitHub.

If your token is accidentally exposed, immediately regenerate it in the Discord Developer Portal.

---

# ⚙️ 5. Configure Environment Variables

Create an environment variable named:

```text
DISCORD_TOKEN
```

and set it to your Discord bot token.

For local hosting, you can use a `.env` file if the project supports it.

Example:

```env
DISCORD_TOKEN=YOUR_BOT_TOKEN
```

### Important

Never commit your `.env` file to GitHub.

Your `.gitignore` should include:

```gitignore
.env
node_modules/
```

---

# 🏠 6. Invite Your Self-Hosted Bot

Once your bot is configured, create an OAuth2 invite URL through the Discord Developer Portal.

Use these scopes:

```text
bot
applications.commands
```

Give the bot only the permissions it actually needs.

For development/testing, you may temporarily use broader permissions, but using Administrator permissions in production is **not recommended** unless absolutely necessary.

---

# ▶️ 7. Start the Bot

Run:

```bash
node index.js
```

If everything is configured correctly, you should see startup messages similar to:

```text
Database loaded
Web server running
Registering server commands
Server commands registered
USM Defenses is online
```

Your bot should now appear online in Discord.

---

# ☁️ Hosting Options

USM Defenses can be hosted on a computer or a cloud hosting provider that supports Node.js.

Examples include:

* Replit
* Railway
* Other Node.js hosting providers
* Your own computer/server

When using a hosting provider, make sure the provider supports:

* Node.js
* Environment variables
* Persistent storage/database if required
* A long-running process

---

# 🗄️ Database

USM Defenses uses persistent data for things such as:

* Warnings
* Roblox links
* Duty time
* Service records
* Leave of Absence records
* Reports
* Invite tracking
* Server settings
* Audit information

If you self-host the bot, make sure your hosting environment provides persistent storage.

Otherwise, your database may be lost when the application restarts or redeploys.

---

# 🔒 Security

USM Defenses is designed with server security and moderation in mind.

However, **self-hosting means you are responsible for your own server, bot token, database, and hosting environment.**

Never share:

* Your Discord bot token
* Database credentials
* API keys
* Hosting credentials
* `.env` files containing secrets

If you believe your bot token has been compromised, regenerate it immediately.

---

# 📜 Privacy Policy & Terms of Service

USM Defenses has its own Privacy Policy and Terms of Service.

### Privacy Policy

**[View the USM Defenses Privacy Policy](YOUR_PRIVACY_POLICY_URL_HERE)**

### Terms of Service

**[View the USM Defenses Terms of Service](YOUR_TOS_URL_HERE)**

By using the hosted USM Defenses bot, users are subject to the applicable Terms of Service and Privacy Policy.

---

# 🧑‍💻 Developers

USM Defenses is designed to be customizable.

You can modify the source code to add:

* New slash commands
* Moderation systems
* Roblox integrations
* Logging
* Custom server settings
* New security features
* Military-specific systems

If you modify the bot, make sure you understand the Discord API and the permissions required by your commands.

---

# ⚠️ Disclaimer

USM Defenses is an independent Discord bot and is not affiliated with, endorsed by, or sponsored by Discord or Roblox.

Discord and Roblox are trademarks of their respective owners.

---

# 📄 License

This project is provided under the license included in this repository.

If this repository does not contain a license, all rights are reserved by the project owner.

Do not redistribute, sell, or claim the project as your own without permission from the project owner.

---

# 🛡️ USM Defenses

**Secure your server. Manage your community.**

Made for Discord communities, Roblox groups, and military simulation communities.

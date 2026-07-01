# Newsie Discord Bot — Setup Guide

## Step 1: Create the Discord Bot

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it `Newsie`
3. Go to **Bot** tab → click **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - ✅ **Message Content Intent** (required for prefix commands)
5. Copy the **Bot Token** — you'll need it in Step 3

## Step 2: Invite the Bot to Your Server

In the Developer Portal:
1. Go to **OAuth2 → URL Generator**
2. Scopes: check `bot`
3. Bot Permissions: check:
   - Read Messages/View Channels
   - Send Messages
   - Embed Links
   - Read Message History
4. Copy the generated URL and open it in a browser
5. Select your Discord server and click **Authorize**

## Step 3: Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```
DISCORD_TOKEN=paste_your_bot_token_here
DISCORD_CLIENT_ID=paste_your_application_id_here   # from General Information tab
ETHERSCAN_API_KEY=optional_but_improves_whale_data
```

## Step 4: Install & Run

```bash
npm install
npm start
```

You should see:
```
✅ Newsie Bot online as: Newsie#1234
   Prefix: !
   Commands: score, rug, whale, trend, newsie
```

## Commands

| Command | Example | What it does |
|---------|---------|-------------|
| `!score <protocol>` | `!score aave` | Safety score 0–100 + risk breakdown |
| `!rug <address> [chain]` | `!rug 0xabc...123 1` | Rug pull risk check |
| `!whale <token>` | `!whale eth` | Whale moves & sentiment |
| `!trend` | `!trend` | 24h community intelligence report |
| `!newsie` | `!newsie` | Help menu |

## Chain IDs for !rug

| Chain | ID |
|-------|----|
| Ethereum | 1 |
| BNB Chain | 56 |
| Polygon | 137 |
| Base | 8453 |
| Arbitrum | 42161 |
| Optimism | 10 |
| Celo | 42220 |

## Deploy to Production (Free)

**Railway.app** (easiest):
1. Push code to GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add environment variables in Railway dashboard
4. Done — bot runs 24/7 for free

**Alternatively:** Render.com, Fly.io, or a $5 VPS

## Growth Strategy

The bot is your distribution engine for Newsie.tech:
1. Join DeFi Discord servers (Uniswap, Aave, DeFiLlama community, Bankless)
2. Ask server mods: "Can I add a free DeFi safety bot?"
3. Every `!score` response shows your Newsie.tech link to everyone in the channel
4. Use `!trend` to understand what each community cares about most
5. Post insights from the trend data publicly → builds your reputation as "the DeFi safety person"

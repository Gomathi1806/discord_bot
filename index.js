/**
 * Newsie Discord AI Agent
 * ─────────────────────────────────────────────────────────────────────────────
 * This is a full AI agent — not just a command bot.
 *
 * How to interact:
 *   @Newsie is aave safe?                    → agent decides what to check
 *   @Newsie compare uniswap vs curve         → agent calls compare tool
 *   @Newsie check this contract 0xabc...     → agent calls rug check
 *   @Newsie what's happening with eth whales → agent calls whale tool
 *   @Newsie what's the community worried about? → agent checks trends
 *
 * Old !commands still work too:
 *   !score, !rug, !whale, !trend, !analyze, !ask, !newsie
 *
 * Architecture:
 *   Message → Agent Loop (Pollinations AI / Groq)
 *     → Tool calls (DeFiLlama, GoPlusLabs, CoinGecko)
 *     → Synthesized response
 *
 * AI: Pollinations AI (primary, zero config) → Groq (fallback, free key)
 *
 * Setup:
 *   1. cp .env.example .env  →  fill in DISCORD_TOKEN
 *   2. npm install
 *   3. node index.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';

// Agent (natural language → tool use → response)
import { runAgent } from './agent/agent.js';

// Legacy prefix commands (still work, now route through agent context too)
import { scoreCommand } from './commands/score.js';
import { rugCommand } from './commands/rug.js';
import { whaleCommand } from './commands/whale.js';
import { trendCommand } from './commands/trend.js';
import { analyzeCommand } from './commands/analyze.js';
import { askCommand } from './commands/ask.js';

import { trackMessage } from './intelligence/tracker.js';
import { getProviderName } from './intelligence/ai.js';

// ─── Validation ───────────────────────────────────────────────────────────────
if (!process.env.DISCORD_TOKEN) {
  console.error('❌  DISCORD_TOKEN missing. Copy .env.example → .env and fill it in.');
  process.exit(1);
}

const PREFIX = process.env.PREFIX || '!';
const NEWSIE_URL = process.env.NEWSIE_URL || 'https://newsie.tech';

// ─── Discord client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,   // Enable in Dev Portal → Bot → Privileged Intents
    GatewayIntentBits.DirectMessages,
  ]
});

// ─── Ready ────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, (c) => {
  console.log(`\n✅ Newsie AI Agent online: ${c.user.tag}`);
  console.log(`   AI provider: ${getProviderName()}`);
  console.log(`   @mention me with any DeFi safety question`);
  console.log(`   Legacy prefix: ${PREFIX}\n`);
  c.user.setActivity('DeFi | @mention me anything', { type: 3 }); // WATCHING
});

// ─── Message handler ──────────────────────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // Always track for community intelligence
  try { trackMessage(message); } catch (_) {}

  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1; // DM channel

  // ── AGENT MODE: @mention or DM → natural language → AI agent ─────────────
  if (isMentioned || isDM) {
    // Strip the @mention from the text
    const userText = message.content
      .replace(`<@${client.user.id}>`, '')
      .replace(`<@!${client.user.id}>`, '')
      .trim();

    if (!userText) {
      return message.reply(
        `Hey! I'm the **Newsie DeFi Safety Agent** 🛡️\n` +
        `Just ask me anything in plain English:\n` +
        `• "Is Aave safe to use?"\n` +
        `• "Compare Uniswap vs Curve"\n` +
        `• "Check this contract: 0x..."\n` +
        `• "What's happening with ETH whales?"\n\n` +
        `Or use prefix commands: \`!score\`, \`!rug\`, \`!whale\`, \`!trend\`\n` +
        `Full platform: ${NEWSIE_URL}`
      );
    }

    return runAgent(message, userText);
  }

  // ── PREFIX COMMANDS: legacy !commands still work ──────────────────────────
  if (!message.content.startsWith(PREFIX)) return;

  const [rawCmd, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();

  try {
    switch (cmd) {
      case 'score':         return scoreCommand(message, args);
      case 'rug':
      case 'rugcheck':      return rugCommand(message, args);
      case 'whale':         return whaleCommand(message, args);
      case 'trend':
      case 'intel':         return trendCommand(message);
      case 'analyze':
      case 'ai':            return analyzeCommand(message, args);
      case 'ask':
      case 'explain':       return askCommand(message, args);
      case 'clear':
      case 'reset': {
        // Clear agent memory for this channel
        const { clearMemory } = await import('./agent/memory.js');
        clearMemory(message.channel.id);
        return message.reply('🧠 Memory cleared for this channel.');
      }
      case 'newsie':
      case 'help':          return helpCommand(message);
      default: break;
    }
  } catch (err) {
    console.error(`[${cmd}] error:`, err);
    try { await message.reply('⚠️ Something went wrong. Try again.'); } catch (_) {}
  }
});

// ─── Help ─────────────────────────────────────────────────────────────────────
async function helpCommand(message) {
  await message.reply({
    embeds: [{
      color: 0x5865f2,
      title: '🛡️ Newsie — DeFi Safety AI Agent',
      description: `I understand natural language. Just **@mention me** with any question.\nOr use the prefix commands below.\n\nPowered by [Newsie.tech](${NEWSIE_URL})`,
      fields: [
        {
          name: '🤖 Agent Mode (recommended)',
          value: [
            '`@Newsie is aave safe for $50k?`',
            '`@Newsie compare uniswap vs curve`',
            '`@Newsie check contract 0xabc...123`',
            '`@Newsie what are whales doing with eth?`',
            '`@Newsie what is this community worried about?`',
          ].join('\n'),
          inline: false,
        },
        {
          name: '⌨️ Prefix Commands',
          value: [
            `\`${PREFIX}score <protocol>\` — Safety score 0–100`,
            `\`${PREFIX}rug <0x...> [chain]\` — Rug risk check`,
            `\`${PREFIX}whale <token>\` — Whale movements`,
            `\`${PREFIX}trend\` — Community intelligence (24h)`,
            `\`${PREFIX}analyze <protocol>\` — Deep AI analysis`,
            `\`${PREFIX}ask <question>\` — DeFi safety Q&A`,
            `\`${PREFIX}clear\` — Reset my memory for this channel`,
          ].join('\n'),
          inline: false,
        },
        {
          name: '🧠 AI Provider',
          value: getProviderName(),
          inline: true,
        },
        {
          name: '🔗 Full Platform',
          value: `[newsie.tech](${NEWSIE_URL})`,
          inline: true,
        },
      ],
      footer: { text: 'Newsie.tech • Not financial advice' },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ─── Error handling ───────────────────────────────────────────────────────────
client.on(Events.Error, err => console.error('[Discord]', err));
process.on('unhandledRejection', err => console.error('[Unhandled]', err));

client.login(process.env.DISCORD_TOKEN);

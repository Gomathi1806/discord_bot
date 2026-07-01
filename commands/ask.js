/**
 * !ask <question>
 * Free-form DeFi safety Q&A powered by Groq / Llama 3.
 * Users can ask anything about DeFi risks, protocols, or safety practices.
 *
 * Examples:
 *   !ask is it safe to use a new protocol with $500k TVL?
 *   !ask what are the signs of a rug pull?
 *   !ask explain impermanent loss risks on Uniswap v3
 */

import { EmbedBuilder } from 'discord.js';
import { answerQuestion, isAIEnabled, getActiveProvider } from '../intelligence/ai.js';

const NEWSIE_URL = process.env.NEWSIE_URL || 'https://newsie.tech';

// Rate limiting: one AI call per user per 15 seconds
const cooldowns = new Map();
const COOLDOWN_MS = 15_000;

export async function askCommand(message, args) {
  if (!args.length) {
    return message.reply(
      'Usage: `!ask <your DeFi safety question>`\n' +
      'Examples:\n' +
      '• `!ask what are the signs of a rug pull?`\n' +
      '• `!ask is Aave safe for large deposits?`\n' +
      '• `!ask explain impermanent loss`'
    );
  }

  // AI is always enabled (Pollinations needs no key)

  // Rate limit per user
  const userId = message.author.id;
  const lastUsed = cooldowns.get(userId) || 0;
  const remaining = COOLDOWN_MS - (Date.now() - lastUsed);
  if (remaining > 0) {
    return message.reply(`⏳ Slow down! Try again in **${Math.ceil(remaining / 1000)}s**.`);
  }
  cooldowns.set(userId, Date.now());

  const question = args.join(' ').trim();

  // Block clearly off-topic questions
  const offTopic = ['price prediction', 'will it pump', 'should i buy', 'moon', 'lambo'];
  if (offTopic.some(t => question.toLowerCase().includes(t))) {
    return message.reply("🚫 I'm a DeFi **safety** AI — I don't do price predictions or investment advice. Ask me about risks, audits, or red flags instead.");
  }

  const loadingMsg = await message.reply(`🤖 Thinking about: *"${question.slice(0, 80)}${question.length > 80 ? '...' : ''}"*`);

  try {
    const answer = await answerQuestion(question);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🤖 Newsie AI — DeFi Safety Answer')
      .setDescription(answer)
      .addFields({
        name: '❓ Your question',
        value: question.slice(0, 1024),
        inline: false
      })
      .addFields({
        name: '🔗 More Tools',
        value: `[Safety Scores](${NEWSIE_URL}) • [Rug Alerts](${NEWSIE_URL}/rug-alerts) • [Whale Watch](${NEWSIE_URL}/whale-watcher)`,
        inline: false
      })
      .setFooter({ text: `Asked by ${message.author.username} • Newsie.tech • AI: ${getActiveProvider()} • Not financial advice` })
      .setTimestamp();

    await loadingMsg.edit({ content: '', embeds: [embed] });
  } catch (err) {
    console.error('[ask] error:', err);
    await loadingMsg.edit('⚠️ AI timed out. Try again in a moment.');
  }
}

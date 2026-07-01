/**
 * !analyze <protocol>
 * Fetches real on-chain data (DeFiLlama) then sends it to Groq/Llama 3
 * for a deep AI-written safety analysis — goes beyond the numeric score.
 */

import fetch from 'node-fetch';
import { EmbedBuilder } from 'discord.js';
import { analyzeProtocol, getActiveProvider } from '../intelligence/ai.js';

const NEWSIE_URL = process.env.NEWSIE_URL || 'https://newsie.tech';

export async function analyzeCommand(message, args) {
  if (!args.length) {
    return message.reply('Usage: `!analyze <protocol>`\nExample: `!analyze compound`');
  }

  const query = args.join(' ').toLowerCase().trim();
  const loadingMsg = await message.reply(`🤖 Running AI safety analysis on **${query}**... (powered by ${getActiveProvider()})`);

  try {
    // 1. Fetch protocol data from DeFiLlama
    const protocol = await fetchProtocol(query);

    if (!protocol) {
      await loadingMsg.edit(`❌ Protocol **"${query}"** not found. Try the exact name, e.g. \`!analyze aave-v3\``);
      return;
    }

    // 2. Build context object for AI
    const metrics = {
      name: protocol.name,
      category: protocol.category,
      tvl: protocol.tvl,
      tvlChange24h: protocol.change_1d,
      tvlChange7d: protocol.change_7d,
      chains: protocol.chains?.slice(0, 5),
      audits: protocol.audit_links?.length || 0,
      listedAt: protocol.listedAt
        ? `${Math.floor((Date.now() / 1000 - protocol.listedAt) / 86400)} days ago`
        : 'unknown',
      url: protocol.url,
      twitter: protocol.twitter,
      github: protocol.github,
    };

    // 3. Send to Groq for AI analysis
    const aiAnalysis = await analyzeProtocol(query, metrics);

    // 4. Build embed
    const tvlChange = metrics.tvlChange24h;
    const color = tvlChange > 5 ? 0x00c853 : tvlChange < -10 ? 0xd50000 : 0x5865f2;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`🤖 AI Analysis — ${protocol.name}`)
      .setURL(`${NEWSIE_URL}/?q=${encodeURIComponent(query)}`)
      .setDescription(aiAnalysis)
      .addFields(
        {
          name: '📊 Live Metrics',
          value: [
            `**TVL:** $${formatNumber(metrics.tvl)}`,
            `**24h Change:** ${tvlChange?.toFixed(2) ?? 'N/A'}%`,
            `**7d Change:** ${metrics.tvlChange7d?.toFixed(2) ?? 'N/A'}%`,
            `**Age:** ${metrics.listedAt}`,
            `**Audits on record:** ${metrics.audits}`,
          ].join('\n'),
          inline: false
        },
        {
          name: '🔗 Full Safety Report',
          value: `[View on Newsie.tech →](${NEWSIE_URL}/?q=${encodeURIComponent(query)})`,
          inline: false
        }
      )
      .setFooter({ text: `Newsie.tech • AI: ${getActiveProvider()} • Not financial advice` })
      .setTimestamp();

    await loadingMsg.edit({ content: '', embeds: [embed] });
  } catch (err) {
    console.error('[analyze] error:', err);
    await loadingMsg.edit('⚠️ AI analysis failed. Try `!score` instead, or try again in a moment.');
  }
}

async function fetchProtocol(query) {
  const res = await fetch('https://api.llama.fi/protocols');
  if (!res.ok) throw new Error('DeFiLlama error');
  const protocols = await res.json();
  return protocols.find(p =>
    p.name?.toLowerCase() === query ||
    p.slug?.toLowerCase() === query ||
    p.name?.toLowerCase().includes(query) ||
    p.slug?.toLowerCase().includes(query)
  ) || null;
}

function formatNumber(n) {
  if (!n) return 'N/A';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toString();
}

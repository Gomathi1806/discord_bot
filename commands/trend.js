/**
 * !trend
 * Shows what protocols are being talked about most in this server right now.
 * Powered by the community intelligence tracker.
 * Also shows predictions of what the community will need next.
 */

import { EmbedBuilder } from 'discord.js';
import { getTrends, getRecentQuestions, predictNextNeeds } from '../intelligence/tracker.js';

const NEWSIE_URL = process.env.NEWSIE_URL || 'https://newsie.tech';

export async function trendCommand(message) {
  const trends = getTrends(10);
  const predictions = predictNextNeeds();

  if (trends.length === 0) {
    return message.reply(
      '📊 Not enough data yet — I need to observe some conversations first!\n' +
      'The more people talk in this server, the better my trend detection gets.\n' +
      `Meanwhile, check live DeFi trends at [newsie.tech](${NEWSIE_URL})`
    );
  }

  const trendLines = trends.map((t, i) => {
    const sentimentIcon = t.concern > 1.5 ? '😰' : t.concern > 0.5 ? '😐' : '😊';
    const bar = '█'.repeat(Math.max(1, Math.round(t.mentions / Math.max(...trends.map(x => x.mentions)) * 8)));
    return `**${i + 1}. ${t.protocol.charAt(0).toUpperCase() + t.protocol.slice(1)}** ${sentimentIcon}\n${bar} ${t.mentions} mention${t.mentions !== 1 ? 's' : ''} in last 24h`;
  });

  const recentQ = getRecentQuestions(3);
  const questionLines = recentQ.length > 0
    ? recentQ.map(q => `• "${q.text.slice(0, 80)}${q.text.length > 80 ? '...' : ''}" — #${q.channel}`)
    : ['No safety questions captured yet'];

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📊 Community Trend Report — Last 24 Hours')
    .setURL(`${NEWSIE_URL}/signals`)
    .setDescription(`Tracking protocol mentions & sentiment in **${message.guild?.name || 'this server'}**`)
    .addFields(
      {
        name: '🔥 Trending Protocols',
        value: trendLines.join('\n\n') || 'No data yet',
        inline: false
      },
      {
        name: '🔮 Prediction',
        value: predictions.insight,
        inline: false
      }
    );

  if (predictions.risingConcerns.length > 0) {
    embed.addFields({
      name: '⚠️ Rising Safety Concerns',
      value: predictions.risingConcerns.map(p =>
        `• **${p}** — community showing concern, [check safety score](${NEWSIE_URL}/?q=${p})`
      ).join('\n'),
      inline: false
    });
  }

  embed.addFields(
    {
      name: '❓ Recent Safety Questions',
      value: questionLines.join('\n'),
      inline: false
    },
    {
      name: '🔗 Live DeFi Signals',
      value: `[View on Newsie.tech →](${NEWSIE_URL}/signals)`,
      inline: false
    }
  )
  .setFooter({ text: 'Newsie.tech — Community Intelligence • Updates every 24h' })
  .setTimestamp();

  await message.reply({ embeds: [embed] });
}

/**
 * !score <protocol>
 * Fetches DeFiLlama data + GoPlus security checks and returns a Newsie-style
 * safety score (0–100) with risk breakdown.
 */

import fetch from 'node-fetch';
import { EmbedBuilder } from 'discord.js';

const NEWSIE_URL = process.env.NEWSIE_URL || 'https://newsie.tech';

export async function scoreCommand(message, args) {
  if (!args.length) {
    return message.reply('Usage: `!score <protocol-name>`\nExample: `!score uniswap`');
  }

  const query = args.join(' ').toLowerCase().trim();
  const loadingMsg = await message.reply(`🔍 Scoring **${query}** on Newsie...`);

  try {
    const [llamaData, securityData] = await Promise.allSettled([
      fetchDeFiLlama(query),
      fetchGoPlusSecurity(query)
    ]);

    const protocol = llamaData.status === 'fulfilled' ? llamaData.value : null;
    const security = securityData.status === 'fulfilled' ? securityData.value : null;

    if (!protocol) {
      await loadingMsg.edit(`❌ Protocol **"${query}"** not found on DeFiLlama. Try the exact name (e.g. \`!score aave-v3\`).`);
      return;
    }

    const { score, breakdown, riskLevel, color } = calculateScore(protocol, security);

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${riskEmoji(riskLevel)} ${protocol.name} — Safety Score: ${score}/100`)
      .setURL(`${NEWSIE_URL}/?q=${encodeURIComponent(query)}`)
      .setDescription(`**Risk Level: ${riskLevel}**\n\nPowered by [Newsie.tech](${NEWSIE_URL}) • DeFiLlama • GoPlusLabs`)
      .addFields(
        {
          name: '📊 Score Breakdown',
          value: breakdown.map(b => `${b.icon} **${b.label}**: ${b.value}`).join('\n'),
          inline: false
        },
        {
          name: '💰 TVL',
          value: protocol.tvl ? `$${formatNumber(protocol.tvl)}` : 'N/A',
          inline: true
        },
        {
          name: '⛓️ Chain',
          value: protocol.chains?.slice(0, 3).join(', ') || 'Unknown',
          inline: true
        },
        {
          name: '📅 Category',
          value: protocol.category || 'Unknown',
          inline: true
        }
      )
      .addFields({
        name: '🔗 Full Report',
        value: `[View on Newsie.tech →](${NEWSIE_URL}/?q=${encodeURIComponent(query)})`,
        inline: false
      })
      .setFooter({ text: 'Newsie.tech — Score it before you stake it' })
      .setTimestamp();

    await loadingMsg.edit({ content: '', embeds: [embed] });
  } catch (err) {
    console.error('[score] error:', err);
    await loadingMsg.edit(`⚠️ Something went wrong checking **${query}**. Try again or visit [newsie.tech](${NEWSIE_URL}).`);
  }
}

// ─── Scoring algorithm (mirrors Newsie methodology) ───────────────────────────
function calculateScore(protocol, security) {
  let score = 50; // baseline
  const breakdown = [];

  // TVL signal (0–25 pts)
  const tvl = protocol.tvl || 0;
  let tvlPts = 0;
  if (tvl > 1_000_000_000) tvlPts = 25;
  else if (tvl > 100_000_000) tvlPts = 20;
  else if (tvl > 10_000_000) tvlPts = 13;
  else if (tvl > 1_000_000) tvlPts = 7;
  else tvlPts = 0;
  score += tvlPts - 12; // normalize around 0
  breakdown.push({
    icon: tvlPts >= 20 ? '🟢' : tvlPts >= 7 ? '🟡' : '🔴',
    label: 'TVL',
    value: tvl ? `$${formatNumber(tvl)} (${tvlPts}/25 pts)` : 'Unknown'
  });

  // Protocol age (0–20 pts)
  const ageDays = protocol.listedAt
    ? Math.floor((Date.now() / 1000 - protocol.listedAt) / 86400)
    : null;
  let agePts = 0;
  if (ageDays > 730) agePts = 20;
  else if (ageDays > 365) agePts = 15;
  else if (ageDays > 90) agePts = 8;
  else if (ageDays !== null) agePts = 2;
  score += agePts - 10;
  breakdown.push({
    icon: agePts >= 15 ? '🟢' : agePts >= 8 ? '🟡' : '🔴',
    label: 'Age',
    value: ageDays !== null ? `${ageDays} days (${agePts}/20 pts)` : 'Unknown'
  });

  // Audit status — from GoPlus or protocol metadata
  const isAudited = security?.is_open_source === '1' || protocol.audit_links?.length > 0;
  const auditPts = isAudited ? 20 : 0;
  score += auditPts - 5;
  breakdown.push({
    icon: isAudited ? '🟢' : '🔴',
    label: 'Audit / Open Source',
    value: isAudited ? `Yes (+${auditPts} pts)` : 'Not found (-5 pts)'
  });

  // GoPlus security flags
  if (security) {
    const flags = [];
    if (security.is_honeypot === '1') { flags.push('🍯 Honeypot'); score -= 40; }
    if (security.is_proxy === '1') flags.push('🔄 Proxy contract');
    if (security.can_take_back_ownership === '1') { flags.push('⚠️ Ownership takeback'); score -= 15; }
    if (security.hidden_owner === '1') { flags.push('👤 Hidden owner'); score -= 20; }
    if (security.selfdestruct === '1') { flags.push('💣 Self-destruct'); score -= 30; }
    if (parseFloat(security.buy_tax || 0) > 0.1) flags.push(`💸 Buy tax: ${(security.buy_tax * 100).toFixed(0)}%`);
    if (parseFloat(security.sell_tax || 0) > 0.1) { flags.push(`💸 Sell tax: ${(security.sell_tax * 100).toFixed(0)}%`); score -= 10; }

    if (flags.length) {
      breakdown.push({ icon: '🔴', label: 'Security Flags', value: flags.join(', ') });
    } else {
      breakdown.push({ icon: '🟢', label: 'Security Flags', value: 'None detected' });
    }
  }

  // Clamp 0–100
  score = Math.max(0, Math.min(100, score));

  let riskLevel, color;
  if (score >= 75) { riskLevel = 'LOW RISK'; color = 0x00c853; }
  else if (score >= 50) { riskLevel = 'MEDIUM RISK'; color = 0xffd600; }
  else if (score >= 25) { riskLevel = 'HIGH RISK'; color = 0xff6d00; }
  else { riskLevel = 'CRITICAL RISK'; color = 0xd50000; }

  return { score, breakdown, riskLevel, color };
}

// ─── DeFiLlama ────────────────────────────────────────────────────────────────
async function fetchDeFiLlama(query) {
  const res = await fetch('https://api.llama.fi/protocols');
  if (!res.ok) throw new Error('DeFiLlama error');
  const protocols = await res.json();

  // Fuzzy match by name or slug
  const match = protocols.find(p =>
    p.name?.toLowerCase() === query ||
    p.slug?.toLowerCase() === query ||
    p.name?.toLowerCase().includes(query) ||
    p.slug?.toLowerCase().includes(query)
  );
  return match || null;
}

// ─── GoPlusLabs (ETH mainnet by default) ─────────────────────────────────────
async function fetchGoPlusSecurity(query) {
  // Only useful when query is a contract address
  if (!query.startsWith('0x') || query.length < 40) return null;
  const res = await fetch(
    `https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=${query}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  const results = data?.result || {};
  return results[query.toLowerCase()] || null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatNumber(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toString();
}

function riskEmoji(level) {
  const map = { 'LOW RISK': '🟢', 'MEDIUM RISK': '🟡', 'HIGH RISK': '🟠', 'CRITICAL RISK': '🔴' };
  return map[level] || '⚪';
}

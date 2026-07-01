/**
 * !rug <contract_address> [chain_id]
 * Runs a contract through GoPlusLabs and returns a rug risk report.
 * Default chain: Ethereum (1). Common chains: 56=BSC, 137=Polygon, 8453=Base, 42220=Celo
 */

import fetch from 'node-fetch';
import { EmbedBuilder } from 'discord.js';

const NEWSIE_URL = process.env.NEWSIE_URL || 'https://newsie.tech';

const CHAIN_NAMES = {
  '1': 'Ethereum', '56': 'BNB Chain', '137': 'Polygon',
  '8453': 'Base', '42161': 'Arbitrum', '10': 'Optimism',
  '43114': 'Avalanche', '42220': 'Celo', '250': 'Fantom'
};

export async function rugCommand(message, args) {
  if (!args.length) {
    return message.reply(
      'Usage: `!rug <contract_address> [chain_id]`\n' +
      'Example: `!rug 0xabc...123 1` (Ethereum)\n' +
      'Chains: 1=ETH, 56=BSC, 137=Polygon, 8453=Base, 42220=Celo'
    );
  }

  const address = args[0].toLowerCase();
  const chainId = args[1] || '1';
  const chainName = CHAIN_NAMES[chainId] || `Chain ${chainId}`;

  if (!address.startsWith('0x') || address.length < 40) {
    return message.reply('⚠️ Please provide a valid contract address (starts with `0x`).');
  }

  const loadingMsg = await message.reply(`🔍 Running rug check on \`${address.slice(0, 10)}...\` on ${chainName}...`);

  try {
    const res = await fetch(
      `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`
    );

    if (!res.ok) throw new Error(`GoPlus API error: ${res.status}`);
    const data = await res.json();
    const token = data?.result?.[address];

    if (!token) {
      await loadingMsg.edit(`❌ No data found for \`${address}\` on ${chainName}. Make sure the chain ID is correct.`);
      return;
    }

    const { rugScore, flags, safeFlags, color, verdict } = analyzeToken(token);

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${verdict.emoji} Rug Check — ${token.token_name || address.slice(0, 10) + '...'} (${token.token_symbol || '?'})`)
      .setURL(`${NEWSIE_URL}/wallet-risk?address=${address}`)
      .setDescription(`**Verdict: ${verdict.label}**\n\nChain: **${chainName}** • Contract: \`${address.slice(0, 8)}...${address.slice(-6)}\``)
      .addFields(
        {
          name: `🚩 Risk Flags (${flags.length})`,
          value: flags.length ? flags.join('\n') : '✅ None detected',
          inline: false
        },
        {
          name: `✅ Safe Signals (${safeFlags.length})`,
          value: safeFlags.length ? safeFlags.join('\n') : '⚠️ None found',
          inline: false
        },
        {
          name: '👤 Owner',
          value: token.owner_address
            ? `\`${token.owner_address.slice(0, 8)}...${token.owner_address.slice(-6)}\``
            : 'Renounced / None',
          inline: true
        },
        {
          name: '🏭 Creator',
          value: token.creator_address
            ? `\`${token.creator_address.slice(0, 8)}...${token.creator_address.slice(-6)}\``
            : 'Unknown',
          inline: true
        },
        {
          name: '💧 Holders',
          value: token.holder_count ? token.holder_count.toString() : 'Unknown',
          inline: true
        }
      )
      .addFields({
        name: '🔗 Full Wallet Risk Report',
        value: `[Check on Newsie.tech →](${NEWSIE_URL}/wallet-risk?address=${address})`,
        inline: false
      })
      .setFooter({ text: 'Newsie.tech — Powered by GoPlusLabs • Not financial advice' })
      .setTimestamp();

    await loadingMsg.edit({ content: '', embeds: [embed] });
  } catch (err) {
    console.error('[rug] error:', err);
    await loadingMsg.edit(`⚠️ Error checking contract. Try again or visit [newsie.tech/wallet-risk](${NEWSIE_URL}/wallet-risk).`);
  }
}

// ─── Token risk analysis ───────────────────────────────────────────────────────
function analyzeToken(token) {
  const flags = [];
  const safeFlags = [];
  let rugScore = 0;

  // Critical flags
  if (token.is_honeypot === '1') { flags.push('🍯 **HONEYPOT** — You cannot sell this token!'); rugScore += 50; }
  if (token.hidden_owner === '1') { flags.push('👤 Hidden owner detected'); rugScore += 25; }
  if (token.can_take_back_ownership === '1') { flags.push('⚠️ Owner can reclaim ownership'); rugScore += 20; }
  if (token.selfdestruct === '1') { flags.push('💣 Contract has self-destruct function'); rugScore += 30; }
  if (token.external_call === '1') { flags.push('📞 Has external calls (risk of manipulation)'); rugScore += 10; }

  // Medium flags
  if (token.is_proxy === '1') { flags.push('🔄 Proxy contract — logic can be changed'); rugScore += 15; }
  if (token.is_mintable === '1') { flags.push('🖨️ Token supply can be minted (inflation risk)'); rugScore += 15; }
  if (token.trading_cooldown === '1') { flags.push('⏳ Trading cooldown enforced'); rugScore += 5; }
  if (token.transfer_pausable === '1') { flags.push('⏸️ Transfers can be paused by owner'); rugScore += 10; }
  if (token.cannot_sell_all === '1') { flags.push('🔒 Cannot sell entire balance'); rugScore += 15; }
  if (token.anti_whale_modifiable === '1') { flags.push('🐋 Anti-whale limits modifiable by owner'); rugScore += 5; }

  // Tax flags
  const buyTax = parseFloat(token.buy_tax || 0);
  const sellTax = parseFloat(token.sell_tax || 0);
  if (buyTax > 0.2) { flags.push(`💸 High buy tax: ${(buyTax * 100).toFixed(1)}%`); rugScore += 10; }
  if (sellTax > 0.2) { flags.push(`💸 High sell tax: ${(sellTax * 100).toFixed(1)}%`); rugScore += 15; }

  // LP lock check
  if (token.lp_holders?.some(h => h.is_locked === 1)) {
    safeFlags.push('🔐 Liquidity is locked');
  } else {
    flags.push('🔓 Liquidity not locked — rug risk');
    rugScore += 20;
  }

  // Safe signals
  if (token.is_open_source === '1') safeFlags.push('📖 Contract is open source');
  if (token.owner_address === null || token.owner_address === '0x0000000000000000000000000000000000000000') {
    safeFlags.push('🔑 Ownership renounced');
  }
  if (token.is_anti_whale === '1') safeFlags.push('🐋 Anti-whale protection active');
  if (buyTax <= 0.05 && sellTax <= 0.05) safeFlags.push('✅ Low buy/sell tax (≤5%)');
  if (parseInt(token.holder_count || 0) > 1000) safeFlags.push(`👥 ${parseInt(token.holder_count).toLocaleString()} holders (good distribution)`);

  // Verdict
  rugScore = Math.min(100, rugScore);
  let verdict, color;
  if (rugScore === 0 && flags.length === 0) {
    verdict = { emoji: '🟢', label: 'LOOKS SAFE' }; color = 0x00c853;
  } else if (rugScore < 20) {
    verdict = { emoji: '🟡', label: 'LOW RISK — minor concerns' }; color = 0xffd600;
  } else if (rugScore < 50) {
    verdict = { emoji: '🟠', label: 'MEDIUM RISK — proceed with caution' }; color = 0xff6d00;
  } else {
    verdict = { emoji: '🔴', label: 'HIGH RUG RISK — avoid!' }; color = 0xd50000;
  }

  return { rugScore, flags, safeFlags, color, verdict };
}

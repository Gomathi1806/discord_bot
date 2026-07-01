/**
 * !whale <token_symbol_or_address>
 * Shows recent large transactions (whale moves) for a token using DeFiLlama.
 * Falls back to Etherscan large transfer data when available.
 */

import fetch from 'node-fetch';
import { EmbedBuilder } from 'discord.js';

const NEWSIE_URL = process.env.NEWSIE_URL || 'https://newsie.tech';
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;

// Known token addresses for quick lookup
const TOKEN_MAP = {
  'eth': { address: 'ethereum', coingecko: 'ethereum' },
  'btc': { address: 'bitcoin', coingecko: 'bitcoin' },
  'usdc': { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', coingecko: 'usd-coin' },
  'usdt': { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', coingecko: 'tether' },
  'weth': { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', coingecko: 'weth' },
  'aave': { address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', coingecko: 'aave' },
  'uni': { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', coingecko: 'uniswap' },
  'link': { address: '0x514910771af9ca656af840dff83e8264ecf986ca', coingecko: 'chainlink' },
};

export async function whaleCommand(message, args) {
  if (!args.length) {
    return message.reply(
      'Usage: `!whale <token>`\n' +
      'Example: `!whale eth` or `!whale aave`\n' +
      'Also try: `!whale 0xcontract...`'
    );
  }

  const query = args[0].toLowerCase();
  const loadingMsg = await message.reply(`🐋 Tracking whale moves for **${query.toUpperCase()}**...`);

  try {
    // Fetch price + volume data from CoinGecko (free, no key)
    const tokenInfo = TOKEN_MAP[query] || null;
    const cgId = tokenInfo?.coingecko || query;

    const [priceData, largeTransfers] = await Promise.allSettled([
      fetchCoinGeckoData(cgId),
      fetchLargeTransfers(query, tokenInfo)
    ]);

    const price = priceData.status === 'fulfilled' ? priceData.value : null;
    const transfers = largeTransfers.status === 'fulfilled' ? largeTransfers.value : [];

    if (!price) {
      await loadingMsg.edit(`❌ Token **${query.toUpperCase()}** not found. Try the full name (e.g. \`!whale ethereum\`).`);
      return;
    }

    const priceChange = price.market_data?.price_change_percentage_24h || 0;
    const volume = price.market_data?.total_volume?.usd || 0;
    const mktCap = price.market_data?.market_cap?.usd || 0;
    const currentPrice = price.market_data?.current_price?.usd || 0;

    // Sentiment from price action
    const sentiment = priceChange > 5 ? '🚀 Strong buying pressure'
      : priceChange > 1 ? '📈 Mild bullish'
      : priceChange < -5 ? '📉 Heavy selling / whales exiting'
      : priceChange < -1 ? '🔻 Mild bearish'
      : '➡️ Sideways — whales accumulating quietly?';

    const embed = new EmbedBuilder()
      .setColor(priceChange >= 0 ? 0x00c853 : 0xd50000)
      .setTitle(`🐋 Whale Watch — ${price.name} (${price.symbol?.toUpperCase()})`)
      .setURL(`${NEWSIE_URL}/whale-watcher`)
      .setDescription(`**Market Sentiment: ${sentiment}**`)
      .addFields(
        {
          name: '💵 Price',
          value: `$${currentPrice.toLocaleString('en-US', { maximumFractionDigits: 6 })}`,
          inline: true
        },
        {
          name: `📊 24h Change`,
          value: `${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%`,
          inline: true
        },
        {
          name: '📦 24h Volume',
          value: `$${formatNumber(volume)}`,
          inline: true
        },
        {
          name: '🏦 Market Cap',
          value: `$${formatNumber(mktCap)}`,
          inline: true
        },
        {
          name: '📈 7d High',
          value: price.market_data?.high_24h?.usd ? `$${price.market_data.high_24h.usd.toLocaleString()}` : 'N/A',
          inline: true
        },
        {
          name: '📉 7d Low',
          value: price.market_data?.low_24h?.usd ? `$${price.market_data.low_24h.usd.toLocaleString()}` : 'N/A',
          inline: true
        }
      );

    // Add large transfers if we found any
    if (transfers.length > 0) {
      embed.addFields({
        name: `🔀 Recent Large Transfers (${transfers.length})`,
        value: transfers.slice(0, 5).map(t =>
          `• **$${formatNumber(t.value)}** — \`${t.from.slice(0, 8)}...\` → \`${t.to.slice(0, 8)}...\``
        ).join('\n'),
        inline: false
      });
    } else {
      embed.addFields({
        name: '🔀 On-Chain Whale Transfers',
        value: `[Track live whale moves on Newsie →](${NEWSIE_URL}/whale-watcher)`,
        inline: false
      });
    }

    // Volume spike alert
    if (volume > mktCap * 0.15) {
      embed.addFields({
        name: '⚡ Volume Alert',
        value: `Volume is **${((volume / mktCap) * 100).toFixed(1)}%** of market cap — unusual activity detected!`,
        inline: false
      });
    }

    embed
      .setFooter({ text: 'Newsie.tech — Whale Watcher • Not financial advice' })
      .setTimestamp();

    await loadingMsg.edit({ content: '', embeds: [embed] });
  } catch (err) {
    console.error('[whale] error:', err);
    await loadingMsg.edit(`⚠️ Error fetching whale data. Visit [newsie.tech/whale-watcher](${NEWSIE_URL}/whale-watcher) directly.`);
  }
}

// ─── CoinGecko (free, no key needed) ─────────────────────────────────────────
async function fetchCoinGeckoData(id) {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`,
    { headers: { 'Accept': 'application/json' } }
  );
  if (!res.ok) throw new Error(`CoinGecko: ${res.status}`);
  return res.json();
}

// ─── Etherscan large transfers (requires API key) ─────────────────────────────
async function fetchLargeTransfers(query, tokenInfo) {
  if (!ETHERSCAN_KEY || !tokenInfo?.address || tokenInfo.address.startsWith('bitcoin')) return [];

  const res = await fetch(
    `https://api.etherscan.io/api?module=account&action=tokentx` +
    `&contractaddress=${tokenInfo.address}&page=1&offset=20&sort=desc&apikey=${ETHERSCAN_KEY}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  if (data.status !== '1') return [];

  // Filter transfers > $100k equivalent (crude filter by token amount)
  return data.result
    .filter(tx => parseFloat(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal)) > 50000)
    .slice(0, 5)
    .map(tx => ({
      from: tx.from,
      to: tx.to,
      value: parseFloat(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal)),
      hash: tx.hash
    }));
}

function formatNumber(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n?.toFixed(2) || '0';
}

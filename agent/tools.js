/**
 * Agent Tools
 * These are the functions the AI agent can decide to call autonomously.
 * Each tool fetches real data and returns a structured result.
 *
 * Tool schema is described to the AI in plain English inside the agent prompt.
 * The AI outputs JSON like: {"tool":"get_protocol_score","args":{"name":"aave"}}
 * The agent loop parses this and calls the matching function here.
 */

import fetch from 'node-fetch';

// ─── Tool: get_protocol_score ─────────────────────────────────────────────────
export async function get_protocol_score({ name }) {
  const protocols = await fetchDeFiLlama();
  const p = findProtocol(protocols, name);
  if (!p) return { error: `Protocol "${name}" not found on DeFiLlama` };

  const ageDays = p.listedAt
    ? Math.floor((Date.now() / 1000 - p.listedAt) / 86400)
    : null;

  let score = 50;
  const tvl = p.tvl || 0;
  if (tvl > 1e9) score += 20;
  else if (tvl > 1e8) score += 12;
  else if (tvl > 1e7) score += 5;
  else if (tvl < 1e5) score -= 20;

  if (ageDays > 730) score += 15;
  else if (ageDays > 365) score += 8;
  else if (ageDays < 30) score -= 15;

  if (p.audit_links?.length > 0) score += 15;
  score = Math.max(0, Math.min(100, score));

  return {
    name: p.name,
    score,
    risk: score >= 75 ? 'LOW' : score >= 50 ? 'MEDIUM' : score >= 25 ? 'HIGH' : 'CRITICAL',
    tvl: `$${fmt(tvl)}`,
    age: ageDays ? `${ageDays} days` : 'unknown',
    chains: p.chains?.slice(0, 4),
    category: p.category,
    audited: p.audit_links?.length > 0,
    tvl24hChange: p.change_1d,
    tvl7dChange: p.change_7d,
  };
}

// ─── Tool: check_contract_rug ─────────────────────────────────────────────────
export async function check_contract_rug({ address, chain_id = '1' }) {
  if (!address?.startsWith('0x')) {
    return { error: 'Invalid address — must start with 0x' };
  }
  const res = await fetch(
    `https://api.gopluslabs.io/api/v1/token_security/${chain_id}?contract_addresses=${address.toLowerCase()}`
  );
  if (!res.ok) return { error: `GoPlus error: ${res.status}` };
  const data = await res.json();
  const token = data?.result?.[address.toLowerCase()];
  if (!token) return { error: 'No data found for this contract' };

  const flags = [];
  if (token.is_honeypot === '1') flags.push('HONEYPOT — cannot sell');
  if (token.hidden_owner === '1') flags.push('hidden owner');
  if (token.selfdestruct === '1') flags.push('self-destruct function');
  if (token.is_mintable === '1') flags.push('mintable supply');
  if (token.transfer_pausable === '1') flags.push('transfers pausable');
  if (token.can_take_back_ownership === '1') flags.push('ownership reclaimable');
  if (!token.lp_holders?.some(h => h.is_locked === 1)) flags.push('liquidity NOT locked');
  const sellTax = parseFloat(token.sell_tax || 0);
  if (sellTax > 0.1) flags.push(`high sell tax: ${(sellTax * 100).toFixed(0)}%`);

  return {
    name: token.token_name || 'unknown',
    symbol: token.token_symbol || '?',
    is_open_source: token.is_open_source === '1',
    owner_renounced: !token.owner_address || token.owner_address === '0x0000000000000000000000000000000000000000',
    holder_count: token.holder_count,
    risk_flags: flags,
    verdict: flags.some(f => f.includes('HONEYPOT')) ? 'CRITICAL'
      : flags.length > 3 ? 'HIGH'
      : flags.length > 1 ? 'MEDIUM'
      : flags.length === 0 ? 'LOW'
      : 'LOW-MEDIUM',
  };
}

// ─── Tool: get_whale_data ─────────────────────────────────────────────────────
export async function get_whale_data({ token }) {
  const id = CG_MAP[token.toLowerCase()] || token.toLowerCase();
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`
  );
  if (!res.ok) return { error: `Token "${token}" not found on CoinGecko` };
  const d = await res.json();
  const md = d.market_data || {};
  const change24h = md.price_change_percentage_24h || 0;
  const volume = md.total_volume?.usd || 0;
  const mktcap = md.market_cap?.usd || 0;

  return {
    name: d.name,
    symbol: d.symbol?.toUpperCase(),
    price_usd: md.current_price?.usd,
    change_24h_pct: change24h.toFixed(2),
    volume_24h: `$${fmt(volume)}`,
    market_cap: `$${fmt(mktcap)}`,
    volume_to_mcap_ratio: mktcap ? (volume / mktcap * 100).toFixed(1) + '%' : 'N/A',
    volume_spike: volume > mktcap * 0.15,
    sentiment: change24h > 5 ? 'strong buying' : change24h > 1 ? 'mild bullish'
      : change24h < -5 ? 'heavy selling / whale exit' : change24h < -1 ? 'mild bearish' : 'sideways',
  };
}

// ─── Tool: search_protocols ───────────────────────────────────────────────────
export async function search_protocols({ query, limit = 5 }) {
  const protocols = await fetchDeFiLlama();
  const q = query.toLowerCase();
  const matches = protocols
    .filter(p => p.name?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q))
    .slice(0, limit)
    .map(p => ({ name: p.name, tvl: `$${fmt(p.tvl)}`, category: p.category, chains: p.chains?.slice(0,3) }));
  return { results: matches, count: matches.length };
}

// ─── Tool: get_community_trends ───────────────────────────────────────────────
export async function get_community_trends(_args) {
  // Import dynamically to avoid circular dep
  const { getTrends, predictNextNeeds } = await import('../intelligence/tracker.js');
  const trends = getTrends(8);
  const predictions = predictNextNeeds();
  return { trending: trends, prediction: predictions };
}

// ─── Tool: compare_protocols ─────────────────────────────────────────────────
export async function compare_protocols({ names }) {
  const results = await Promise.all(names.map(n => get_protocol_score({ name: n })));
  return { comparison: results.map((r, i) => ({ ...r, queried_as: names[i] })) };
}

// ─── Tool registry (tells the agent what tools exist) ─────────────────────────
export const TOOL_REGISTRY = {
  get_protocol_score,
  check_contract_rug,
  get_whale_data,
  search_protocols,
  get_community_trends,
  compare_protocols,
};

export const TOOL_DESCRIPTIONS = `
Available tools (call by outputting valid JSON):

1. get_protocol_score(name: string)
   → Safety score 0-100, TVL, age, audit status for a DeFi protocol
   Example: {"tool":"get_protocol_score","args":{"name":"aave"}}

2. check_contract_rug(address: string, chain_id?: string)
   → Rug risk check on a contract address. chain_id: 1=ETH, 56=BSC, 8453=Base, 42220=Celo
   Example: {"tool":"check_contract_rug","args":{"address":"0xabc...","chain_id":"1"}}

3. get_whale_data(token: string)
   → Price, 24h change, volume, whale sentiment for a token (eth, btc, aave, etc.)
   Example: {"tool":"get_whale_data","args":{"token":"eth"}}

4. search_protocols(query: string, limit?: number)
   → Search DeFiLlama for protocols matching a name or category
   Example: {"tool":"search_protocols","args":{"query":"lending","limit":5}}

5. get_community_trends()
   → What protocols this Discord server is discussing + safety concerns
   Example: {"tool":"get_community_trends","args":{}}

6. compare_protocols(names: string[])
   → Side-by-side safety comparison of multiple protocols
   Example: {"tool":"compare_protocols","args":{"names":["aave","compound"]}}
`.trim();

// ─── Helpers ──────────────────────────────────────────────────────────────────
let _llamaCache = null;
let _llamaCacheTime = 0;

async function fetchDeFiLlama() {
  // Cache for 5 minutes
  if (_llamaCache && Date.now() - _llamaCacheTime < 300_000) return _llamaCache;
  const res = await fetch('https://api.llama.fi/protocols');
  if (!res.ok) throw new Error('DeFiLlama error');
  _llamaCache = await res.json();
  _llamaCacheTime = Date.now();
  return _llamaCache;
}

function findProtocol(protocols, query) {
  const q = query.toLowerCase();
  return protocols.find(p =>
    p.name?.toLowerCase() === q || p.slug?.toLowerCase() === q ||
    p.name?.toLowerCase().includes(q) || p.slug?.toLowerCase().includes(q)
  ) || null;
}

function fmt(n) {
  if (!n) return 'N/A';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toString();
}

const CG_MAP = {
  eth: 'ethereum', btc: 'bitcoin', bnb: 'binancecoin',
  usdc: 'usd-coin', usdt: 'tether', weth: 'weth',
  aave: 'aave', uni: 'uniswap', link: 'chainlink',
  matic: 'matic-network', sol: 'solana', arb: 'arbitrum',
};

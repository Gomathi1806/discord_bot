/**
 * Community Intelligence Tracker
 * Tracks protocol mentions, questions, and sentiment across Discord channels.
 * Powers the !trend command and feeds Newsie's product decisions.
 */

const mentions = new Map();      // protocol -> { count, lastSeen, sentiments[] }
const questions = [];            // raw "what is / is X safe / rug?" messages
const DECAY_HOURS = 24;          // rolling 24-hour window

// ─── Record a message for intelligence ────────────────────────────────────────
export function trackMessage(message) {
  const text = message.content.toLowerCase();
  const now = Date.now();

  // Strip old data beyond the rolling window
  _pruneOldMentions(now);

  // Detect protocol mentions (simple keyword pass — extend this list)
  const knownProtocols = [
    'uniswap', 'aave', 'compound', 'curve', 'convex', 'lido', 'maker',
    'synthetix', 'balancer', 'yearn', 'sushi', 'pancake', 'gmx', 'dydx',
    'radiant', 'pendle', 'eigenlayer', 'hyperliquid', 'aerodrome', 'morpho'
  ];

  for (const protocol of knownProtocols) {
    if (text.includes(protocol)) {
      const entry = mentions.get(protocol) || { count: 0, timestamps: [], sentiments: [] };
      entry.count++;
      entry.timestamps.push(now);

      // Basic sentiment: look for risky/safe keywords near protocol name
      const sentiment = _detectSentiment(text, protocol);
      entry.sentiments.push(sentiment);
      mentions.set(protocol, entry);
    }
  }

  // Capture safety questions for product intelligence
  const safetyKeywords = ['safe', 'rug', 'scam', 'legit', 'audit', 'hack', 'exploit', 'risk'];
  if (safetyKeywords.some(k => text.includes(k))) {
    questions.push({
      text: message.content.slice(0, 200),
      channel: message.channel.name || 'unknown',
      timestamp: now,
      guild: message.guild?.name || 'DM'
    });
    // Keep only last 500 questions
    if (questions.length > 500) questions.shift();
  }
}

// ─── Get top trending protocols ───────────────────────────────────────────────
export function getTrends(limit = 10) {
  _pruneOldMentions(Date.now());

  return [...mentions.entries()]
    .map(([protocol, data]) => ({
      protocol,
      mentions: data.count,
      concern: _avgSentiment(data.sentiments),  // 0=bullish, 1=concerned, 2=scared
      lastSeen: data.timestamps.at(-1)
    }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, limit);
}

// ─── Get recent safety questions ─────────────────────────────────────────────
export function getRecentQuestions(limit = 5) {
  return questions.slice(-limit).reverse();
}

// ─── Predict what community will ask next ─────────────────────────────────────
export function predictNextNeeds() {
  const trends = getTrends(5);
  const recentQ = getRecentQuestions(10);

  // Protocols trending UP in concern = likely next support requests
  const risingConcerns = trends.filter(t => t.concern > 0.5);

  return {
    hotProtocols: trends.map(t => t.protocol),
    risingConcerns: risingConcerns.map(t => t.protocol),
    commonQuestions: _extractCommonThemes(recentQ),
    insight: risingConcerns.length > 0
      ? `⚡ Community is getting nervous about: ${risingConcerns.map(t => t.protocol).join(', ')}. Good time to post a Newsie safety check.`
      : '✅ Community sentiment looks stable right now.'
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
function _pruneOldMentions(now) {
  const cutoff = now - DECAY_HOURS * 60 * 60 * 1000;
  for (const [protocol, data] of mentions.entries()) {
    data.timestamps = data.timestamps.filter(t => t > cutoff);
    data.count = data.timestamps.length;
    if (data.count === 0) mentions.delete(protocol);
    else mentions.set(protocol, data);
  }
}

function _detectSentiment(text, protocol) {
  const idx = text.indexOf(protocol);
  const window = text.slice(Math.max(0, idx - 30), idx + 60);
  const scaredWords = ['rug', 'hack', 'exploit', 'scam', 'rekt', 'dead', 'dump'];
  const worriedWords = ['safe', 'risk', 'audit', 'worried', 'careful', 'sus'];
  if (scaredWords.some(w => window.includes(w))) return 2;
  if (worriedWords.some(w => window.includes(w))) return 1;
  return 0;
}

function _avgSentiment(sentiments) {
  if (!sentiments.length) return 0;
  return sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
}

function _extractCommonThemes(recentQ) {
  const themes = { rug: 0, audit: 0, risk: 0, yield: 0, hack: 0 };
  for (const q of recentQ) {
    const t = q.text.toLowerCase();
    for (const theme of Object.keys(themes)) {
      if (t.includes(theme)) themes[theme]++;
    }
  }
  return Object.entries(themes)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([theme]) => theme);
}

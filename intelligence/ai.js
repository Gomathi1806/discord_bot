/**
 * AI Provider — Pollinations (primary, zero config) + Groq (fallback, free key)
 *
 * Priority:
 *   1. Pollinations AI — https://pollinations.ai
 *      Completely FREE. No API key. No sign-up. Works instantly.
 *      Model: Mistral (via Pollinations)
 *
 *   2. Groq (fallback) — https://console.groq.com
 *      FREE with API key. Faster, higher quality. Llama 3 70B.
 *      Set GROQ_API_KEY in .env to enable.
 */

import fetch from 'node-fetch';

const GROQ_API_KEY = process.env.GROQ_API_KEY;

const POLLINATIONS_URL = 'https://text.pollinations.ai/';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama3-70b-8192';

/**
 * Send messages array to AI. Pollinations first, Groq if it fails and key exists.
 */
export async function callAI(messages, opts = {}) {
  try {
    return await callPollinations(messages, opts);
  } catch (err) {
    if (GROQ_API_KEY) {
      console.warn('[AI] Pollinations failed, falling back to Groq:', err.message);
      return await callGroq(messages, opts);
    }
    throw err;
  }
}

async function callPollinations(messages, { temperature = 0.4, max_tokens = 600 } = {}) {
  const res = await fetch(POLLINATIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      model: 'mistral',
      seed: 42,
      private: true,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Pollinations ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text.trim();
}

async function callGroq(messages, { temperature = 0.4, max_tokens = 600 } = {}) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: GROQ_MODEL, messages, max_tokens, temperature }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

export function getProviderName() {
  return GROQ_API_KEY
    ? 'Pollinations AI (Mistral) → Groq fallback'
    : 'Pollinations AI (Mistral)';
}

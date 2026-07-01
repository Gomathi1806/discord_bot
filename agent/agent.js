/**
 * Newsie AI Agent — ReAct Loop (Reason → Act → Observe → Respond)
 *
 * How it works:
 * 1. User sends a natural language message (no !command needed)
 * 2. Agent decides which tool(s) to call based on intent
 * 3. Tools fetch real on-chain data (DeFiLlama, GoPlusLabs, CoinGecko)
 * 4. Agent synthesizes a natural language response using the data
 * 5. Response is posted to Discord with rich embed
 *
 * Triggered when:
 *   - Bot is @mentioned: "@Newsie is aave safe?"
 *   - Message is in bot's DM
 *   - Old-style !commands still work too (routed through agent)
 *
 * AI: Pollinations (primary, no key) → Groq (fallback, free key)
 */

import { EmbedBuilder } from 'discord.js';
import { callAI, getProviderName } from '../intelligence/ai.js';
import { TOOL_REGISTRY, TOOL_DESCRIPTIONS } from './tools.js';
import { addToMemory, getMemory } from './memory.js';
import { trackMessage } from '../intelligence/tracker.js';

const NEWSIE_URL = process.env.NEWSIE_URL || 'https://newsie.tech';
const MAX_TOOL_CALLS = 3; // prevent infinite loops

// ─── System prompt — defines the agent's identity and capabilities ─────────────
const SYSTEM_PROMPT = `You are the Newsie DeFi Safety Agent — an autonomous AI that helps Discord users stay safe in DeFi.

Your capabilities:
- Analyze protocol safety (TVL, age, audits, risk score)
- Detect rug pull risks in smart contracts
- Track whale movements and market sentiment
- Monitor community trends and predict emerging risks
- Compare multiple protocols side-by-side

Behavior rules:
- Always use tools to get REAL data before answering safety questions
- Never make up numbers — if unsure, call a tool
- Be concise and direct. Max 300 words per response.
- Format for Discord: use **bold**, no markdown headers, emoji sparingly
- End safety answers with a clear verdict line
- Never give financial advice — only safety/risk analysis
- If asked something off-topic, gently redirect to DeFi safety

Tool usage format — when you need to call a tool, output ONLY this JSON (no other text):
{"tool":"<tool_name>","args":{<args>}}

After receiving tool results, synthesize a natural language response.
If no tool is needed (e.g., general DeFi education question), respond directly.

${TOOL_DESCRIPTIONS}`;

// ─── Main agent entry point ───────────────────────────────────────────────────
export async function runAgent(message, userText) {
  const channelId = message.channel.id;

  // Track for community intelligence
  try { trackMessage(message); } catch (_) {}

  // Show typing indicator
  await message.channel.sendTyping();

  // Build message history (gives agent memory of the conversation)
  const history = getMemory(channelId);
  addToMemory(channelId, 'user', userText);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userText },
  ];

  try {
    const result = await agentLoop(messages, channelId);
    await sendAgentResponse(message, userText, result);
  } catch (err) {
    console.error('[agent] error:', err);
    await message.reply(`⚠️ Agent hit an error: ${err.message}\nTry rephrasing or use \`!score\`, \`!rug\`, \`!whale\` directly.`);
  }
}

// ─── ReAct loop: Reason → Act → Observe, up to MAX_TOOL_CALLS ────────────────
async function agentLoop(messages, channelId) {
  const toolCallLog = [];

  for (let i = 0; i < MAX_TOOL_CALLS; i++) {
    const aiResponse = await callAI(messages);

    // Try to parse a tool call from the AI response
    const toolCall = parseTool(aiResponse);

    if (!toolCall) {
      // No tool call — this is the final answer
      addToMemory(channelId, 'assistant', aiResponse);
      return { answer: aiResponse, toolCallLog };
    }

    // Execute the tool
    const toolFn = TOOL_REGISTRY[toolCall.tool];
    if (!toolFn) {
      // Unknown tool — treat the response as final
      addToMemory(channelId, 'assistant', aiResponse);
      return { answer: aiResponse, toolCallLog };
    }

    console.log(`[agent] calling tool: ${toolCall.tool}`, toolCall.args);
    let toolResult;
    try {
      toolResult = await toolFn(toolCall.args || {});
    } catch (err) {
      toolResult = { error: err.message };
    }

    toolCallLog.push({ tool: toolCall.tool, args: toolCall.args, result: toolResult });

    // Feed result back to AI as an "observation"
    messages.push(
      { role: 'assistant', content: aiResponse },
      {
        role: 'user',
        content: `Tool result for ${toolCall.tool}:\n\`\`\`json\n${JSON.stringify(toolResult, null, 2)}\n\`\`\`\n\nNow provide your final response to the user based on this data. Do NOT call another tool unless truly necessary.`
      }
    );
  }

  // Exhausted tool call budget — ask for final answer
  messages.push({ role: 'user', content: 'Please give your final response now.' });
  const finalAnswer = await callAI(messages);
  addToMemory(channelId, 'assistant', finalAnswer);
  return { answer: finalAnswer, toolCallLog };
}

// ─── Parse tool call JSON from AI response ────────────────────────────────────
function parseTool(text) {
  // Try direct JSON parse
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed.tool && TOOL_REGISTRY[parsed.tool]) return parsed;
  } catch (_) {}

  // Try to extract JSON from within text
  const match = text.match(/\{[\s\S]*?"tool"[\s\S]*?\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed.tool && TOOL_REGISTRY[parsed.tool]) return parsed;
    } catch (_) {}
  }
  return null;
}

// ─── Send response as a Discord embed ─────────────────────────────────────────
async function sendAgentResponse(message, userText, { answer, toolCallLog }) {
  // If answer is short and no tools used, just reply as text
  if (answer.length < 200 && toolCallLog.length === 0) {
    return message.reply(answer);
  }

  // Determine color from answer sentiment
  const color = /critical|honeypot|rug|avoid|danger/i.test(answer) ? 0xd50000
    : /high risk|be careful|caution/i.test(answer) ? 0xff6d00
    : /medium|moderate/i.test(answer) ? 0xffd600
    : /safe|low risk|looks good/i.test(answer) ? 0x00c853
    : 0x5865f2;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setDescription(answer.slice(0, 4000))
    .setFooter({
      text: `Newsie Agent • ${getProviderName()} • Tools used: ${toolCallLog.map(t => t.tool).join(', ') || 'none'} • Not financial advice`
    })
    .setTimestamp();

  // Add tool result summaries as fields
  for (const call of toolCallLog) {
    if (call.result?.error) continue;

    if (call.tool === 'get_protocol_score' && call.result?.name) {
      embed.addFields({
        name: `📊 ${call.result.name} — Score: ${call.result.score}/100 (${call.result.risk} RISK)`,
        value: `TVL: **${call.result.tvl}** • Age: ${call.result.age} • Audited: ${call.result.audited ? '✅' : '❌'} • Chains: ${call.result.chains?.join(', ')}`,
        inline: false,
      });
    }

    if (call.tool === 'check_contract_rug' && call.result?.name) {
      embed.addFields({
        name: `🔍 Contract: ${call.result.name} (${call.result.symbol}) — ${call.result.verdict} RISK`,
        value: call.result.risk_flags.length
          ? `⚠️ Flags: ${call.result.risk_flags.join(' • ')}`
          : '✅ No major risk flags detected',
        inline: false,
      });
    }

    if (call.tool === 'get_whale_data' && call.result?.name) {
      embed.addFields({
        name: `🐋 ${call.result.name} (${call.result.symbol})`,
        value: `Price: **$${call.result.price_usd?.toLocaleString()}** • 24h: ${call.result.change_24h_pct}% • Vol: ${call.result.volume_24h} • Sentiment: ${call.result.sentiment}`,
        inline: false,
      });
    }

    if (call.tool === 'compare_protocols' && call.result?.comparison) {
      const rows = call.result.comparison.map(p =>
        `**${p.name}** — Score: ${p.score}/100 | TVL: ${p.tvl} | Risk: ${p.risk}`
      ).join('\n');
      embed.addFields({ name: '⚖️ Comparison', value: rows, inline: false });
    }
  }

  embed.addFields({
    name: '🔗 Full Analysis',
    value: `[newsie.tech →](${NEWSIE_URL})`,
    inline: true,
  });

  await message.reply({ embeds: [embed] });
}

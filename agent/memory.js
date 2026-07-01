/**
 * Agent Memory
 * Keeps conversation history per channel/DM so the agent has context.
 * Sliding window — keeps last N messages to stay within token limits.
 */

const MAX_HISTORY = 10; // last 10 turns per channel
const memory = new Map(); // channelId → messages[]

export function addToMemory(channelId, role, content) {
  if (!memory.has(channelId)) memory.set(channelId, []);
  const history = memory.get(channelId);
  history.push({ role, content });
  // Trim to max window
  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, 2); // remove oldest user+assistant pair
  }
}

export function getMemory(channelId) {
  return memory.get(channelId) || [];
}

export function clearMemory(channelId) {
  memory.delete(channelId);
}

// Clean up inactive channels every hour
setInterval(() => {
  // In production you'd track last-active time; for now just cap total size
  if (memory.size > 500) {
    const oldest = [...memory.keys()].slice(0, 100);
    oldest.forEach(k => memory.delete(k));
  }
}, 3_600_000);

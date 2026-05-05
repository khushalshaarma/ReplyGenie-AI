const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const gemini = require('./geminiClient');
const cache = require('../utils/cache');

// Build context from last N messages
async function getLastMessagesText(conversationId, limit = 10) {
  const msgs = await Message.find({ conversationId }).sort({ createdAt: -1 }).limit(limit).lean();
  const reversed = msgs.reverse();
  return reversed.map(m => `${m.sender}: ${m.text}`).join('\n');
}

async function getConversationSummary(conversationId) {
  const conv = await Conversation.findById(conversationId).lean();
  return conv?.summary || '';
}

async function generateSuggestions({ conversationId, currentInput, language = 'English', tone = 'Casual', lastMessages = null }) {
  try {
    if (!currentInput || currentInput.trim().length < 1) {
      return [];
    }

    // Build context either from provided lastMessages (client) or from DB
    let history = '';
    if (Array.isArray(lastMessages) && lastMessages.length > 0) {
      // lastMessages expected as [{ sender, text, createdAt }, ...]
      history = lastMessages.slice(-10).map(m => `${m.sender}: ${m.text}`).join('\n');
      console.log('Using client-provided lastMessages for suggestion context');
    } else {
      history = await getLastMessagesText(conversationId, 10);
    }

    const summary = await getConversationSummary(conversationId);
    const key = `${conversationId}::${language}::${tone}::${currentInput.trim()}::${history.slice(-200)}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const replies = await gemini.generateReplies({ context: history, currentInput, language, tone, summary });
    cache.set(key, replies, 1000 * 60 * 5); // cache 5 minutes
    return replies;
  } catch (err) {
    // Log full error and return graceful fallback suggestions so clients don't get 500
    console.error('generateSuggestions error', err && (err.stack || err));
    // Simple fallback: use context-aware heuristics
    const safe = (currentInput || '').trim();
    if (!safe) return [];
    const low = safe.toLowerCase();
    const fallback = [];
    // If lastMessages provided, try to use last message for context
    if (lastMessages && lastMessages.length) {
      const last = lastMessages[lastMessages.length - 1].text || '';
      if (/\b(see you|on my way|arriv|coming)\b/.test(last.toLowerCase())) {
        fallback.push('On my way');
        fallback.push('Be there soon');
        fallback.push('ETA 10 mins');
      } else if (/\b(thank|thanks|thx)\b/.test(last.toLowerCase())) {
        fallback.push('You are welcome');
        fallback.push('No problem');
        fallback.push('Anytime');
      } else {
        fallback.push('Sounds good');
        fallback.push('Okay');
        fallback.push('Let me know');
      }
    } else {
      // basic heuristics without context
      if (/\b(hi|hello|hey)\b/.test(low)) {
        fallback.push('Hi!');
        fallback.push('Hey there');
        fallback.push('Hello');
      } else if (low.endsWith('?') || /^who|what|where|when|why|how|is|are|do|did|can|could/.test(low)) {
        fallback.push("I'll check.");
        fallback.push('Good question');
        fallback.push('Let me see');
      } else {
        fallback.push('Sounds good');
        fallback.push('On my way');
        fallback.push('Okay, thanks');
      }
    }
    try { cache.set(`${conversationId}::fallback::${safe}`, fallback, 1000 * 60); } catch (e) {}
    return fallback;
  }
}

module.exports = { generateSuggestions };

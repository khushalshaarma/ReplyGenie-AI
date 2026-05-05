const express = require('express');
const router = express.Router();
const suggestionsController = require('../controllers/suggestionsController');

// POST /api/suggestions
// body: { conversationId, currentInput, language, tone }
router.post('/', async (req, res) => {
  // defensive: ensure body exists
  const body = req.body || {};
  const conversationId = body.conversationId || body.room || 'default-room';
  const currentInput = body.currentInput || body.input || '';
  const language = body.language || 'English';
  const tone = body.tone || 'Casual';

  try {
    const lastMessages = body.lastMessages || body.last_messages || null;
    console.log('POST /api/suggestions', { conversationId, currentInput: currentInput && currentInput.slice(0,200), language, tone, lastMessagesCount: Array.isArray(lastMessages) ? lastMessages.length : 0 });
    const suggestions = await suggestionsController.generateSuggestions({ conversationId, currentInput, language, tone, lastMessages });
    // Ensure we always send an array
    return res.json({ suggestions: Array.isArray(suggestions) ? suggestions : [] });
  } catch (err) {
    // Log and return graceful fallback suggestions instead of 500
    console.error('Suggestion route error', err && (err.stack || err));
    // simple fallback
    const safe = (currentInput || '').trim();
    let fallback = [];
    if (!safe) fallback = ['Sure', 'Okay', 'Sounds good'];
    else if (/\b(hi|hello|hey)\b/i.test(safe)) fallback = ['Hi!', 'Hello', 'Hey'];
    else if (safe.endsWith('?')) fallback = ["I'll check.", 'Good question', 'Let me see'];
    else fallback = ['Sounds good', 'On my way', 'Okay, thanks'];
    return res.json({ suggestions: fallback });
  }
});

module.exports = router;

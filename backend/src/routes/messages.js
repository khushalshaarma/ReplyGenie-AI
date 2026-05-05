const express = require('express');
const router = express.Router();
const Message = require('../models/Message');

// GET messages for a conversation
// Optional query param `targetLanguage` can be set to request server-side translations
router.get('/:conversationId', async (req, res) => {
  const conversationId = req.params.conversationId;
  const targetLanguage = req.query.targetLanguage || 'English';
  const msgs = await Message.find({ conversationId }).sort({ createdAt: 1 }).lean();

  // If no translation requested (or English requested but messages already English), return raw messages
  if (!targetLanguage || String(targetLanguage).toLowerCase().startsWith('english')) {
    return res.json({ messages: msgs });
  }

  const translatedMsgs = [];
  for (const m of msgs) {
    let translation = m.text;
    try {
      const cache = require('../utils/cache');
      const cacheKey = `${m._id}::${targetLanguage}`;
      translation = cache.get(cacheKey) || null;
      if (!translation) {
        const gemini = require('../controllers/geminiClient');
        // detect source language
        let detected = cache.get(`${m._id}::detected`) || null;
        if (!detected) {
        detected = await gemini.detectLanguage(m.text);
          try { cache.set(`${m._id}::detected`, detected || '', 1000 * 60 * 60); } catch (e) {}
        }
        const targetCode = gemini.langNameToCode(targetLanguage);
        if (detected && targetCode && String(detected).toLowerCase().startsWith(targetCode)) {
          translation = m.text;
        } else {
          translation = await gemini.translateText(m.text, targetLanguage);
          if ((String(targetLanguage).toLowerCase().startsWith('english')) && typeof gemini.refineToPerfectEnglish === 'function') {
            try {
              translation = await gemini.refineToPerfectEnglish(translation);
            } catch (e) {
              console.warn('refineToPerfectEnglish failed in messages route, using raw translation', e && (e.message || e));
            }
          }
        }
        try { cache.set(cacheKey, translation, 1000 * 60 * 60); } catch (e) {}
      }
    } catch (err) {
      translation = m.text;
    }
    translatedMsgs.push({ ...m, translation });
  }

  return res.json({ messages: translatedMsgs });
});

module.exports = router;

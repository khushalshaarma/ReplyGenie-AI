const express = require('express');
const router = express.Router();
const gemini = require('../controllers/geminiClient');

// GET /api/ai/probe
// Quick probe to check Gemini availability and configuration
router.get('/probe', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.json({ ok: false, reason: 'GEMINI_API_KEY not set' });
    }
    // call a minimal prompt to verify the model is accessible
    try {
      await gemini.callGeminiRaw('Say OK', { maxOutputTokens: 10 });
      return res.json({ ok: true, gemini: true });
    } catch (err) {
      return res.status(502).json({ ok: false, gemini: false, error: err?.response?.data || err?.message || String(err) });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// POST /api/ai/translate-test
// body: { text, lang }
router.post('/translate-test', async (req, res) => {
  try {
    const { text = 'Hello', lang = 'Hindi' } = req.body || {};
    const out = await gemini.translateText(text, lang);
    return res.json({ ok: true, text, lang, translated: out });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

module.exports = router;

const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;
const FORCE_LOCAL_AI = (String(process.env.FORCE_LOCAL_AI || '').toLowerCase() === 'true') || process.env.FORCE_LOCAL_AI === '1';
const ENABLE_GEMINI = Boolean(API_KEY) && !FORCE_LOCAL_AI;
const cache = require('../utils/cache');
const BASE = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta2/models';
const MODEL = process.env.GEMINI_MODEL || 'text-bison-001';
// Use a more reliable public LibreTranslate instance by default
const TRANSLATE_URL = process.env.TRANSLATE_URL || 'https://translate.argosopentech.com/translate';

// Simple circuit-breaker for Gemini failures to avoid spamming bad requests
let geminiHealthy = true;
let geminiLastErrorAt = 0;
const GEMINI_COOLDOWN_MS = parseInt(process.env.GEMINI_COOLDOWN_MS || '300000', 10); // 5 minutes default

function checkAndResetGeminiHealth() {
  if (!geminiHealthy) {
    const now = Date.now();
    if (now - geminiLastErrorAt > GEMINI_COOLDOWN_MS) {
      geminiHealthy = true;
    }
  }
  return geminiHealthy;
}

if (!API_KEY) {
  console.warn('GEMINI_API_KEY not set; falling back to lightweight local suggestions and LibreTranslate for translations (if reachable).');
}

async function callGeminiRaw(prompt, options = {}) {
  // Uses the Generative Language API (v1beta2 generateText)
  if (!API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  // If circuit-breaker disabled, refuse to call
  if (!checkAndResetGeminiHealth()) {
    throw new Error('Gemini temporarily disabled due to recent errors');
  }
  const url = `${BASE}/${MODEL}:generateText?key=${API_KEY}`;
  try {
    const body = {
      prompt: { text: prompt },
      temperature: options.temperature ?? 0.5,
      maxOutputTokens: options.maxOutputTokens ?? 256,
      candidateCount: options.candidateCount ?? 1
    };
    const res = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' }
    });
    return res.data;
  } catch (err) {
    // If model endpoint not found (404), attempt the chat-style endpoint :generateMessage as a fallback
    const status = err?.response?.status;
    console.error('Gemini call failed', err?.response?.data || err.message || err);
    if (status === 404) {
      // try generateMessage
      try {
        const msgUrl = `${BASE}/${MODEL}:generateMessage?key=${API_KEY}`;
        const body2 = {
          messages: [{ author: 'user', content: [{ type: 'text', text: prompt }] }],
          temperature: options.temperature ?? 0.5,
          maxOutputTokens: options.maxOutputTokens ?? 256,
          candidateCount: options.candidateCount ?? 1
        };
        const res2 = await axios.post(msgUrl, body2, { headers: { 'Content-Type': 'application/json' } });
        return res2.data;
      } catch (err2) {
        console.error('Gemini generateMessage fallback failed', err2?.response?.data || err2?.message || err2);
        // mark unhealthy
        geminiHealthy = false;
        geminiLastErrorAt = Date.now();
        console.warn(`Disabling Gemini for ${GEMINI_COOLDOWN_MS}ms due to status ${status}`);
        throw err2;
      }
    }

    // mark unhealthy on persistent error codes
    try {
      if (status && (status === 401 || status === 403 || status >= 500)) {
        geminiHealthy = false;
        geminiLastErrorAt = Date.now();
        console.warn(`Disabling Gemini for ${GEMINI_COOLDOWN_MS}ms due to status ${status}`);
      }
    } catch (e) {
      console.error('Error while handling Gemini failure', e && (e.stack || e));
    }
    throw err;
  }
}

// Google Translate web API fallback (no API key, not guaranteed but usable for dev)
async function googleTranslate(text, targetCode) {
  try {
    const encoded = encodeURIComponent(text);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetCode}&dt=t&q=${encoded}`;
    const res = await axios.get(url, { timeout: 5000 });
    // response is nested arrays: [[ [translated, original, ...], ... ], null, detectedSource]
    if (Array.isArray(res.data)) {
      const parts = res.data[0] || [];
      const translated = parts.map(p => p[0]).join('');
      const detected = res.data[2] || null;
      return { translated: translated || text, detected: detected || null };
    }
    return { translated: text, detected: null };
  } catch (err) {
    // not fatal; caller will try other fallbacks
    throw err;
  }
}

// Map human language names to ISO codes used in translation APIs
function langNameToCode(name) {
  if (!name) return 'en';
  const map = {
    english: 'en',
    en: 'en',
    hindi: 'hi',
    hi: 'hi',
    marathi: 'mr',
    mr: 'mr',
    spanish: 'es',
    es: 'es',
    french: 'fr',
    fr: 'fr',
    german: 'de',
    de: 'de'
  };
  const key = String(name).toLowerCase();
  return map[key] || map[key.split('-')[0]] || 'en';
}

async function detectLanguage(text) {
  try {
    const out = await googleTranslate(text, 'en');
    if (out && out.detected) return out.detected;
  } catch (err) {
    // ignore and fallback to script detection
  }
  // Fallback: simple script detection for Devanagari (Hindi/Marathi)
  try {
    if (/[\u0900-\u097F]/.test(text)) return 'hi';
    if (/[\u0A80-\u0AFF]/.test(text)) return 'mr';
  } catch (e) {}
  return null;
}

async function refineToPerfectEnglish(text) {
  if (!text) return text;
  const cacheKey = `${text}::polish::en`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  if (!ENABLE_GEMINI) return text;
  if (!checkAndResetGeminiHealth()) return text;
  const prompt = `Paraphrase and correct the following text into natural, idiomatic English. Fix spelling and grammar, keep it concise (max 20 words). Output only the corrected text.\n\n${text}`;
  try {
    const data = await callGeminiRaw(prompt, { temperature: 0.1, maxOutputTokens: 60 });
    const textOut = (data?.candidates && data.candidates[0]?.output) || data?.output || '';
    const first = (textOut || '').split(/\r?\n/)[0].trim();
    if (first) {
      cache.set(cacheKey, first, 1000 * 60 * 60);
      return first;
    }
    return text;
  } catch (err) {
    console.warn('Refine to perfect English failed', err && (err.message || err));
    return text;
  }
}

async function generateReplies({ context, currentInput, language, tone, summary }) {
  // Ensure minimal input length
  if (!currentInput || currentInput.trim().length < 1) return [];

  // Local fallback generator (uses conversation context and last message)
  function makeFallbackSuggestions(context, input, tone, language) {
    const t = (tone || 'Casual');
    const inTxt = (input || '').trim();
    const inLower = inTxt.toLowerCase();

    // Extract last message from context if present
    let lastText = '';
    if (context) {
      const lines = context.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length) {
        const last = lines[lines.length - 1];
        const idx = last.indexOf(':');
        lastText = idx === -1 ? last : last.slice(idx + 1).trim();
      }
    }
    const lastLower = (lastText || '').toLowerCase();

    // Tone-aware templates
    const templates = {
      Casual: {
        positive: ['Sounds good', 'On my way', 'Okay, thanks'],
        confirm: ['Sure', 'Yep', 'Got it'],
        neutral: ['Let me know', 'I will check', 'Will do']
      },
      Formal: {
        positive: ['Understood', 'I will follow up', 'Noted'],
        confirm: ['Certainly', 'I will check', 'Acknowledged'],
        neutral: ['Please advise', 'I will confirm', 'Thank you']
      },
      Funny: {
        positive: ['Sounds epic', 'On a unicorn!', 'BRB, tacos'],
        confirm: ['You bet', 'Heck yeah', 'Righto'],
        neutral: ['I will investigate', 'LOL ok', 'Nice!']
      },
      Flirty: {
        positive: ['Can’t wait 😉', 'See you soon 😏', 'I’m in 😉'],
        confirm: ['Only if you ask 😉', 'Yes, please', 'Sounds tempting'],
        neutral: ['Tell me more', 'I’m listening', 'Do tell 😉']
      }
    };

    const toneBucket = templates[t] || templates.Casual;

    // Heuristics based on last message
    const keywordChecks = {
      arriving: /\b(arriv|on my way|coming|coming now|be there|eta)\b/,
      location: /\b(where|location|where are you|where r u|where's)\b/,
      thanks: /\b(thank|thanks|thx)\b/,
      meeting: /\b(meet|meet up|coffee|lunch|dinner|call|phone)\b/,
      question: /\b(who|what|where|when|why|how|is|are|do|did|can|could)\b/
    };

    let picks = [];

    if (keywordChecks.thanks.test(lastLower)) {
      picks = [toneBucket.confirm[0] || 'You are welcome', toneBucket.positive[0] || 'No problem', 'Anytime'];
    } else if (keywordChecks.arriving.test(lastLower) || keywordChecks.location.test(lastLower)) {
      picks = ['On my way', 'Where are you?', 'ETA 10 mins'];
    } else if (keywordChecks.meeting.test(lastLower)) {
      picks = ['See you there', 'What time?', 'Sounds good'];
    } else if (inLower && /\b(ok|sure|yep|yea|yes|nah|no)\b/.test(inLower)) {
      // If user typed a simple confirmation, offer short variants
      picks = ['Sure', 'On it', 'Got it'];
    } else if (keywordChecks.question.test(inLower) || inLower.endsWith('?')) {
      picks = ['I will check', 'Good question', 'Let me see'];
    } else if (inLower.length > 0) {
      // Leverage input to create variations
      const base = inTxt.split(/[\.!?]/)[0].trim();
      if (base.length > 0) {
        // If the user's requested language is non-English and the input appears to be
        // in Devanagari (Hindi/Marathi), avoid echoing the raw input back as a suggestion.
        // Instead prefer short template replies which will be translated into the
        // requested language, producing more natural suggestions.
        const langLow = (language || 'English').toString().toLowerCase();
        const isNonEnglish = langLow && !langLow.startsWith('english');
        const hasDevanagari = /[\u0900-\u097F]/.test(base);
        if (isNonEnglish && hasDevanagari) {
          picks = ['Sounds good', 'On my way', 'Okay, thanks'];
        } else {
          // create small paraphrases
          picks = [base, `Sure, ${base}`, 'Sounds good'].map(s => s.trim());
        }
      }
    }

    if (!picks.length) picks = toneBucket.positive.slice(0, 3);

    // Ensure short replies (max 10 words)
    const short = picks.map(s => {
      const words = s.split(/\s+/);
      if (words.length > 10) return words.slice(0, 10).join(' ');
      return s;
    }).slice(0, 3);
    // If requested language is not English, try internal translation map first
    const lang = (language || 'English').toString().toLowerCase();
    if (lang && !lang.startsWith('english')) {
      const translations = {
        hindi: {
          'Sounds good': 'ठीक है',
          'On my way': 'रास्ते में हूँ',
          'Okay, thanks': 'ठीक है, धन्यवाद',
          'Sure': 'ज़रूर',
          'Yep': 'हाँ',
          'Got it': 'समझ गया',
          'Let me know': 'मुझे बताइए',
          'I will check': 'मैं देखता हूँ',
          'Will do': 'ठीक है',
          'Understood': 'समझ गया',
          'I will follow up': 'मैं आगे संपर्क करूँगा',
          'Noted': 'नोट किया',
          'Certainly': 'निश्चित रूप से',
          'Please advise': 'कृपया बताएं',
          'I will confirm': 'मैं पुष्टि करूँगा',
          'Thank you': 'धन्यवाद',
          'On it': 'कर रहा हूँ',
          'Be there soon': 'जल्द आ रहा हूँ',
          'ETA 10 mins': '10 मिनट में पहुंचूँगा',
          'Where are you?': 'आप कहाँ हैं?',
          'See you there': 'वहां मिलते हैं',
          'What time?': 'कौन सा समय?'
        },
        marathi: {
          'Sounds good': 'ठीक आहे',
          'On my way': 'मी येतोय',
          'Okay, thanks': 'ठीक आहे, धन्यवाद',
          'Sure': 'नक्की',
          'Yep': 'होय',
          'Got it': 'समजलं',
          'Let me know': 'मला कळवा',
          'I will check': 'मी तपासेन',
          'Will do': 'करीन',
          'Understood': 'समजलं',
          'I will follow up': 'मी नंतर संपर्क करेन',
          'Noted': 'नोंद घेतली',
          'Please advise': 'कृपया कळवा',
          'I will confirm': 'मी पुष्टी करेन',
          'Thank you': 'धन्यवाद',
          'On it': 'करतो आहे',
          'Be there soon': 'लवकर येईन',
          'ETA 10 mins': '10 मिनिटांत येईन',
          'Where are you?': 'तू कुठे आहेस?',
          'See you there': 'तिथे भेटूया',
          'What time?': 'कुठ्या वेळी?'
        },
        spanish: {
          'Sounds good': 'Suena bien',
          'On my way': 'En camino',
          'Okay, thanks': 'De acuerdo, gracias',
          'Sure': 'Claro',
          'Yep': 'Sí',
          'Got it': 'Entendido',
          'Let me know': 'Avísame',
          'I will check': 'Lo comprobaré',
          'Will do': 'Lo haré',
          'Understood': 'Entendido',
          'I will follow up': 'Haré seguimiento',
          'Noted': 'Anotado',
          'Please advise': 'Por favor avise',
          'I will confirm': 'Confirmaré',
          'Thank you': 'Gracias',
          'On it': 'En ello',
          'Be there soon': 'Llegaré pronto',
          'ETA 10 mins': 'Llegaré en 10 min',
          'Where are you?': '¿Dónde estás?',
          'See you there': 'Nos vemos allí',
          'What time?': '¿A qué hora?'
        }
      };

      const map = translations[lang] || translations[lang.split('-')[0]];
      if (map) {
        return short.map(s => map[s] || s);
      }
      // If no internal map available, return English short replies and let translateText attempt
    }

    return short;
  }

  // If Gemini is enabled, try it and gracefully fallback on errors
  if (ENABLE_GEMINI) {
    // Compose a detailed prompt that asks the model to use conversation context and the
    // partially-typed input to generate 3 distinct short reply suggestions. If the
    // current input looks like a partial sentence, the model should offer completions
    // that continue the typed prefix.
    const prompt = `You are an assistant that suggests short, natural chat replies and predicts how a user might finish typing.\n\nConversation context (most recent last):\n${context}\n\nConversation summary: ${summary || ''}\n\nUser is typing: ${currentInput}\n\nTone: ${tone}\nLanguage: ${language}\n\nGuidelines:\n- Provide exactly 3 distinct WhatsApp-style replies appropriate for the context and tone.\n- Keep each reply between 1 and 10 words.\n- If the user's input appears partial, provide completions that start with the same prefix.\n- Vary the suggestions (e.g., confirmatory, short acknowledgement, follow-up question).\n- Output MUST be a single JSON array of 3 strings, for example: ["Sure, coming now", "On my way", "Can you share location?"].\n- Output only the JSON array and nothing else.`;
    try {
      const data = await callGeminiRaw(prompt, { temperature: 0.45, maxOutputTokens: 200, candidateCount: 3 });

      // Parse outputs robustly. Prefer candidate outputs when available.
      let rawTexts = [];
      if (Array.isArray(data?.candidates) && data.candidates.length) {
        rawTexts = data.candidates.map(c => (c.output || '').toString());
      } else if (data?.output) {
        rawTexts = [data.output.toString()];
      } else if (data?.candidate?.output) {
        rawTexts = [data.candidate.output.toString()];
      }

      let replies = [];
      // Try to find a JSON array inside any candidate
      for (const t of rawTexts) {
        if (!t) continue;
        const match = t.match(/\[[\s\S]*?\]/);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            if (Array.isArray(parsed) && parsed.length) {
              replies = parsed.map(r => String(r).trim());
              break;
            }
          } catch (e) {
            // ignore parse error and continue
          }
        }
      }

      // If no JSON array found, fallback to extracting short lines from candidates
      if (!replies.length) {
        for (const t of rawTexts) {
          if (!t) continue;
          const lines = t.split(/\r?\n/).map(s => s.replace(/^[-\d\.\)\s]+/, '').trim()).filter(Boolean);
          for (const l of lines) {
            if (replies.length >= 3) break;
            replies.push(l);
          }
          if (replies.length >= 3) break;
        }
      }

      // Final sanitize and ensure we have up to 3 suggestions
      replies = replies.map(r => (typeof r === 'string' ? r.trim() : String(r))).filter(Boolean);
      // Deduplicate while preserving order
      replies = replies.filter((v, i, a) => a.indexOf(v) === i).slice(0, 3);

      if (!replies.length) {
        throw new Error('No usable suggestions from Gemini');
      }

      // If language requested is non-English, translate replies to the requested language
      if (language && !String(language).toLowerCase().startsWith('english')) {
        try {
          const translated = await Promise.all(replies.map(r => translateText(r, language)));
          return translated.slice(0, 3);
        } catch (err) {
          console.warn('Failed translating Gemini replies, returning original replies', err?.message || err);
          return replies;
        }
      }

      return replies;
    } catch (err) {
      console.warn('Gemini generation failed, falling back to local suggestions', err?.message || err);
      const fallback = makeFallbackSuggestions(context, currentInput, tone, language);
      if (language && !String(language).toLowerCase().startsWith('english')) {
        try {
          const translated = await Promise.all(fallback.map(r => translateText(r, language)));
          return translated.slice(0, 3);
        } catch (e) {
          return fallback;
        }
      }
      return fallback;
    }
  }

  // No Gemini — fallback branch
  const fallback = makeFallbackSuggestions(context, currentInput, tone, language);
  if (language && !String(language).toLowerCase().startsWith('english')) {
    try {
      const translated = await Promise.all(fallback.map(r => translateText(r, language)));
      return translated.slice(0, 3);
    } catch (err) {
      console.warn('Fallback translation failed, returning English replies', err?.message || err);
      return fallback;
    }
  }
  return fallback;
}

async function summarizeConversation(messages) {
  // Prefer Gemini when available
  if (ENABLE_GEMINI) {
    const context = messages.map(m => `${m.sender}: ${m.text}`).join('\n');
    const prompt = `Summarize the following conversation in 1-2 short sentences that capture the key topics and tone. Output only the summary.\n\n${context}`;
    try {
      const data = await callGeminiRaw(prompt, { temperature: 0.2, maxOutputTokens: 120 });
      const text = (data?.candidates && data.candidates[0]?.output) || data?.output || '';
      const summary = text.trim().replace(/\n+/g, ' ').slice(0, 500);
      return summary;
    } catch (err) {
      console.warn('Gemini summarize failed, using simple fallback', err?.message || err);
    }
  }

  // Fallback simple summarization
  try {
    const context = (messages || []).slice(-10).map(m => `${m.sender}: ${m.text}`).join(' | ');
    return (context || '').slice(0, 300);
  } catch (err) {
    return '';
  }
}

// Small helper: convert Devanagari digits to ASCII digits
function devanagariDigitsToAscii(s) {
  if (!s) return s;
  const map = { '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9' };
  return s.replace(/[०-९]/g, ch => map[ch] || ch);
}

// Simple rule-based translator for very short time/quantity phrases (e.g. "4 घंटे" -> "4 hours")
function simpleUnitTranslate(text, targetLanguage) {
  if (!text) return null;
  const t = devanagariDigitsToAscii(String(text)).trim();
  // only handle English target for now
  if (!targetLanguage || !String(targetLanguage).toLowerCase().startsWith('english')) return null;
  const unitMap = {
    'घंटे': 'hours', 'घंटा': 'hour', 'मिनट': 'minutes', 'मिनटों': 'minutes', 'सेकंड': 'seconds', 'दिन': 'days', 'महीना': 'month', 'सप्ताह': 'week'
  };
  const keys = Object.keys(unitMap).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`^\\s*(\\d+)\\s*(${keys.join('|')})\\s*$`, 'i');
  const m = t.match(re);
  if (m) {
    const num = m[1];
    const unit = m[2];
    const mapped = unitMap[unit] || unitMap[unit.toLowerCase()];
    if (mapped) return `${num} ${mapped}`;
  }
  return null;
}

async function translateText(text, targetLanguage) {
  if (!targetLanguage) return text;

  const targetCode = langNameToCode(targetLanguage);

  // Detect source language if possible
  let sourceCode = null;
  try {
    sourceCode = await detectLanguage(text);
  } catch (err) {
    sourceCode = null;
  }

  // If source language equals target language, return original text
  if (sourceCode && targetCode && sourceCode.toLowerCase().startsWith(targetCode)) {
    return text;
  }

  // Debug log
  try { console.log('[geminiClient] translateText', { text: (text || '').slice(0,200), targetLanguage }); } catch (e) {}

  // If Gemini is available and healthy, prefer it for higher-quality translations
  if (ENABLE_GEMINI) {
    if (!checkAndResetGeminiHealth()) {
      try { console.warn('Gemini currently disabled by circuit-breaker, skipping Gemini translate'); } catch (e) {}
    } else {
      try {
        const prompt = `Translate the following text into ${targetLanguage}. Output only the translated text.\n\n${text}`;
        const data = await callGeminiRaw(prompt, { temperature: 0.1, maxOutputTokens: 300 });
        const textOut = (data?.candidates && data.candidates[0]?.output) || data?.output || '';
        if (textOut && textOut.trim().length) {
          try { console.log('[geminiClient] Gemini translate result', { targetLanguage, result: textOut.slice(0,200) }); } catch (e) {}
          return textOut.trim();
        }
      } catch (err) {
        console.warn('Gemini translate failed, falling back to public translate service', err?.message || err);
      }
    }
  }

  // Try Google translate public endpoint (no API key) first — it also detects the source
  // Quick heuristic: handle short time/number phrases without calling external APIs
  try {
    const quick = simpleUnitTranslate(text, targetLanguage);
    if (quick) return quick;
  } catch (e) {}

  try {
    const g = await googleTranslate(text, targetCode);
    if (g && g.translated) {
      try { console.log('[geminiClient] googleTranslate success', { targetLanguage, result: (g.translated || '').slice(0,200) }); } catch (e) {}
      return g.translated;
    }
  } catch (err) {
    console.warn('Google translate fallback failed', err && (err.message || err));
  }

  // Fallback: use LibreTranslate public instance
  try {
    const tgt2 = targetCode || 'en';
    const res = await axios.post(TRANSLATE_URL, {
      q: text,
      source: 'auto',
      target: tgt2,
      format: 'text'
    }, { headers: { 'Content-Type': 'application/json' } });
    const translated = (res.data && (res.data.translatedText || res.data.result || res.data)) || '';
    if (typeof translated === 'object') return text;
    try { console.log('[geminiClient] libreTranslate success', { targetLanguage, result: String(translated).slice(0,200) }); } catch (e) {}
    return String(translated).trim();
  } catch (err) {
    console.warn('LibreTranslate failed', err?.response?.data || err.message || err);
    return text; // fallback to original text
  }
}

module.exports = {
  generateReplies,
  summarizeConversation,
  translateText,
  callGeminiRaw,
  detectLanguage,
  langNameToCode,
  refineToPerfectEnglish
};

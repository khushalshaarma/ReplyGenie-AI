ReplyGenie AI
=========

Real-time chat with per-recipient translation and AI-powered reply suggestions. Built as a lightweight, developer-friendly demo that is easy to run locally and extend for production.

Highlights
----------
- Per-recipient translation: each participant sees messages translated into their preferred language (server-side).
- AI suggestions: Gemini-powered context-aware short replies and typing completions. Local heuristics and public translate fallbacks when Gemini is not available.
- Polished UI: improved typography, chat bubbles, suggestion pills, and subtle animations.

Quick Start (local)
-------------------
1. Ensure MongoDB is running (example local URI: `mongodb://localhost:27017/aoto-chat`).
2. Backend
   - cd backend
   - npm install
   - Copy `.env.example` to `.env` and set values (see below)
   - npm run dev
3. Frontend
   - cd frontend
   - npm install
   - (optional) set `VITE_BACKEND_URL` in `frontend/.env` or use default `http://localhost:4000`
   - npm run dev

.env example
------------
Copy `./.env.example` to `backend/.env` (or to project root if you run backend from root) and update:

```
MONGO_URI=mongodb://localhost:27017/aoto-chat
PORT=4000
GEMINI_API_KEY=your_gemini_key_here
GEMINI_API_URL=
GEMINI_MODEL=text-bison-001
TRANSLATE_URL=https://translate.argosopentech.com/translate
FORCE_LOCAL_AI=false
GEMINI_COOLDOWN_MS=300000
VITE_BACKEND_URL=http://localhost:4000
```

Important environment variables
-------------------------------
- MONGO_URI — MongoDB connection string
- PORT — backend port (default 4000)
- GEMINI_API_KEY — set this to enable Gemini (recommended for best suggestions/translations)
- FORCE_LOCAL_AI — set to `true` to force use of local heuristics and disable Gemini calls
- TRANSLATE_URL — LibreTranslate instance (fallback)

How it works (summary)
----------------------
- When a socket joins, it sends `user:join` including `language` and `tone`.
- The server translates historical messages to the joined user's language (cached per message id).
- On new messages the server detects source language, translates for each recipient, and emits `message:new` with `{ message, translation, sourceLang }`.
- Suggestions: POST /api/suggestions uses conversation context and the partially typed input to generate 3 short replies. Gemini is used if `GEMINI_API_KEY` is set; otherwise local templates are used.

Endpoints & Socket events
-------------------------
- POST /api/suggestions
  - request body: `{ conversationId, currentInput, language, tone, lastMessages }`
  - response: `{ suggestions: [ ... ] }`
- GET /api/messages/:conversationId?targetLanguage=English
  - returns messages; when `targetLanguage` is set server includes a `translation` field for each message

Socket events (client ↔ server)
- client -> server: `user:join` { username, conversationId, language, tone }
- client -> server: `message:send` { conversationId, sender, text }
- client -> server: `typing` { conversationId, isTyping }
- server -> client: `history` { messages: [...] }
- server -> client: `message:new` { message, translation, sourceLang }
- server -> client: `typing` { sender, isTyping }

Translation notes
-----------------
- Short numeric+unit phrases (e.g. "4 घंटे") are handled by a local rule that converts Devanagari digits and maps common units to English (so recipients set to English reliably see "4 hours").
- The server caches language detection and translations to reduce API calls.
- For English target translations the server attempts a light polishing step via `refineToPerfectEnglish` when Gemini is available.

Gemini and debugging
---------------------
- Enable Gemini by setting `GEMINI_API_KEY` in backend `.env` and restarting the server.
- Circuit-breaker: if Gemini returns persistent errors the server disables Gemini calls temporarily (check logs for "Disabling Gemini...").
- Logs: backend prints helpful `[geminiClient]` lines showing which translation path was used.

UI notes
--------
- Frontend uses Tailwind CSS with custom styles (fonts: Playfair Display for headings, Poppins for UI).
- New UI elements: refined bubbles, avatars, suggestion pills, and subtle pop-in animations.

Troubleshooting
---------------
- If suggestions are empty: check server logs and ensure `GEMINI_API_KEY` is set (or FORCE_LOCAL_AI=false to allow Gemini).
- If translations look wrong: check `TRANSLATE_URL` fallback and backend logs for which translator was used.

Git & .env handling
-------------------
- There is a `.gitignore` at project root that excludes env files, node_modules, and common build artifacts. Keep your production secrets out of source control.
- Use `.env.example` as the template for required environment variables; do NOT commit your real `.env` to git.

Contributing / Next steps
-------------------------
- Add tests for translation heuristics and suggestion parsing.
- Improve prompt engineering for Gemini (I already added a more robust prompt; you can iterate on it using logs).

If you want, I can commit these README and .env.example changes for you. Tell me the commit message and branch you'd like to use.

Backend (Node.js + Express + Socket.IO)

Setup

1. Copy `backend/.env.sample` -> `backend/.env` and fill values (MongoDB URI, GEMINI_API_KEY)
2. Install dependencies: `cd backend && npm install`
3. Run: `npm run dev` (requires nodemon) or `npm start`

Server endpoints

- `POST /api/suggestions` - generate 3 AI reply suggestions (calls Gemini)

Socket events

- `user:join` - join a conversation and set preferences (username, conversationId, language, tone)
- `message:send` - send a message to a conversation
- `typing` - broadcast typing indicator

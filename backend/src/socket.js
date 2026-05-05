const Message = require('./models/Message');
const Conversation = require('./models/Conversation');
const gemini = require('./controllers/geminiClient');
const cache = require('./utils/cache');

// In-memory maps: socketId -> prefs, roomId -> Set(socketId)
const socketPrefs = new Map();
const roomMembers = new Map();

function addToRoom(roomId, socketId) {
  if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set());
  roomMembers.get(roomId).add(socketId);
}

function removeFromRoom(roomId, socketId) {
  if (!roomMembers.has(roomId)) return;
  roomMembers.get(roomId).delete(socketId);
}

async function initSocket(io) {
  io.on('connection', (socket) => {
    console.log('socket connected', socket.id);

    socket.on('user:join', async (payload) => {
      // payload: { username, conversationId, language, tone }
      const { username, conversationId, language = 'English', tone = 'Casual' } = payload || {};
      socketPrefs.set(socket.id, { username, conversationId, language, tone });
      socket.join(conversationId);
      addToRoom(conversationId, socket.id);

      // Add participant to conversation doc
      try {
        await Conversation.findByIdAndUpdate(conversationId, { $addToSet: { participants: username }, $set: { lastUpdated: new Date() } }, { upsert: true });
      } catch (err) {
        console.warn('Failed to update conversation participants', err.message);
      }

      // After join, send translated history to this socket so their UI shows translated past messages
      try {
        const msgs = await Message.find({ conversationId }).sort({ createdAt: 1 }).limit(200).lean();
        const translatedMsgs = [];
        for (const m of msgs) {
          let translated = m.text;
          try {
            const targetLang = (language || 'English');
            if (targetLang) {
              const cacheKey = `${m._id}::${targetLang}`;
              // Try cache first
              translated = cache.get(cacheKey);
              if (!translated) {
                // Detect source language for this message (cached per message id)
                let detected = cache.get(`${m._id}::detected`) || null;
                if (!detected) {
                  try {
                    detected = await gemini.detectLanguage(m.text);
                  } catch (e) {
                    detected = null;
                  }
                  try { cache.set(`${m._id}::detected`, detected || '', 1000 * 60 * 60); } catch (e) {}
                }

                // If source language is same as target code, no translation needed
                try {
                  const targetCode = gemini.langNameToCode(targetLang);
                  if (detected && targetCode && String(detected).toLowerCase().startsWith(targetCode)) {
                    translated = m.text;
                  } else {
                    translated = await gemini.translateText(m.text, targetLang);
                    // If translating to English, polish the result for naturalness
                    if (String(targetLang).toLowerCase().startsWith('english')) {
                      translated = await gemini.refineToPerfectEnglish(translated);
                    }
                    if (!translated) translated = m.text;
                  }
                } catch (e) {
                  // If anything fails, fallback to original text
                  translated = m.text;
                }

                try { cache.set(cacheKey, translated, 1000 * 60 * 60); } catch (e) {}
              }
            }
          } catch (err) {
            console.warn('History translation failed', err && (err.message || err));
            translated = m.text;
          }
          translatedMsgs.push({ ...m, translation: translated });
        }
        socket.emit('history', { messages: translatedMsgs });
      } catch (err) {
        console.warn('Failed to send history to joining socket', err && (err.message || err));
      }
    });

    socket.on('typing', (payload) => {
      // payload: { conversationId, isTyping }
      const { conversationId, isTyping } = payload || {};
      const prefs = socketPrefs.get(socket.id) || {};
      // broadcast to others in room
      socket.to(conversationId).emit('typing', { sender: prefs.username, isTyping });
    });

    socket.on('message:send', async (payload) => {
      // payload: { conversationId, sender, text }
      try {
        const { conversationId, sender, text } = payload;
        if (!conversationId || !sender || !text) return;
        const message = await Message.create({ conversationId, sender, text });

        // update conversation lastUpdated
        await Conversation.findByIdAndUpdate(conversationId, { $set: { lastUpdated: new Date() } }, { upsert: true });

        // For each socket in room, translate message to that user's language and emit
        const memberSet = roomMembers.get(conversationId) || new Set();
        // Group sockets by target language so we translate once per language
        const langMap = new Map();
        for (const sid of memberSet) {
          const prefs = socketPrefs.get(sid) || {};
          const targetLang = prefs.language || 'English';
          if (!langMap.has(targetLang)) langMap.set(targetLang, []);
          langMap.get(targetLang).push(sid);
        }

        const messageObj = { _id: message._id, conversationId, sender, text, createdAt: message.createdAt };

        // Detect source language once (cached per message id) so clients can optionally show original language
        let detectedLang = cache.get(`${message._id}::detected`) || null;
        if (!detectedLang) {
          try {
            detectedLang = await gemini.detectLanguage(text);
            if (!detectedLang) detectedLang = null;
            try { cache.set(`${message._id}::detected`, detectedLang || '', 1000 * 60 * 60); } catch (e) {}
          } catch (err) {
            console.warn('Language detection failed', err && (err.message || err));
            detectedLang = null;
          }
        }

        for (const [targetLang, sids] of langMap.entries()) {
          const cacheKey = `${message._id}::${targetLang}`;
          let translated = cache.get(cacheKey);
          if (!translated) {
            try {
              // translateText now detects source and translates accordingly
              translated = await gemini.translateText(text, targetLang);
              // If target is English, and source was e.g. Hindi/Marathi, refine the English to be natural
              if ((String(targetLang).toLowerCase().startsWith('english') || String(targetLang).toLowerCase().startsWith('en')) && typeof gemini.refineToPerfectEnglish === 'function') {
                try {
                  translated = await gemini.refineToPerfectEnglish(translated);
                } catch (e) {
                  console.warn('refineToPerfectEnglish failed, using raw translation', e && (e.message || e));
                }
              }
              if (!translated) translated = text;
              try { cache.set(cacheKey, translated, 1000 * 60 * 10); } catch (e) {}
            } catch (err) {
              console.warn('Translation failed', err && (err.message || err));
              translated = text;
            }
          }
          for (const sid of sids) {
            try {
              io.to(sid).emit('message:new', { message: messageObj, translation: translated, sourceLang: detectedLang });
            } catch (err) {
              console.warn('Emit failed for sid', sid, err && (err.message || err));
            }
          }
        }

        // Optionally update conversation summary every 5 messages
        const count = await Message.countDocuments({ conversationId });
        if (count % 5 === 0) {
          try {
            const msgs = await Message.find({ conversationId }).sort({ createdAt: -1 }).limit(50).lean();
            const summary = await gemini.summarizeConversation(msgs.reverse());
            await Conversation.findByIdAndUpdate(conversationId, { $set: { summary } }, { upsert: true });
          } catch (err) {
            console.warn('Failed to update summary', err.message);
          }
        }
      } catch (err) {
        console.error('message:send error', err.message);
      }
    });

    socket.on('disconnect', () => {
      const prefs = socketPrefs.get(socket.id);
      if (prefs) {
        const { conversationId } = prefs;
        removeFromRoom(conversationId, socket.id);
      }
      socketPrefs.delete(socket.id);
      console.log('socket disconnected', socket.id);
    });
  });
}

module.exports = initSocket;

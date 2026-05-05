import React, { useEffect, useRef, useState } from 'react'
import { connectSocket } from '../api/socket'
import axios from 'axios'
import MessageBubble from './MessageBubble'
import Suggestions from './Suggestions'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

export default function Chat({ username, conversationId }) {
  const socket = useRef(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [language, setLanguage] = useState('English');
  const [tone, setTone] = useState('Casual');
  const [typingIndicator, setTypingIndicator] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const typingTimeout = useRef(null);
  const suggestionDebounce = useRef(null);

  useEffect(() => {
    socket.current = connectSocket();
    socket.current.on('connect', () => {
      socket.current.emit('user:join', { username, conversationId, language, tone });
    });

    socket.current.on('message:new', ({ message, translation, sourceLang }) => {
      setMessages(m => [...m, { ...message, translation, sourceLang }]);
    });

    socket.current.on('history', ({ messages: hist }) => {
      // replace message list with translated history from server
      if (Array.isArray(hist)) setMessages(hist);
    });

    socket.current.on('typing', ({ sender, isTyping }) => {
      setTypingIndicator(isTyping ? `${sender} is typing...` : '');
    });

    // load history (requesting server-side translations for this user's language)
    axios.get(`${BACKEND}/api/messages/${conversationId}?targetLanguage=${encodeURIComponent(language)}`).then(res => {
      const msgs = res.data.messages || [];
      setMessages(msgs);
    }).catch(err => console.warn(err));

    return () => {
      if (socket.current) socket.current.disconnect();
    }
  }, []);

  useEffect(() => {
    // update server prefs when language or tone changes
    if (socket.current && socket.current.connected) {
      socket.current.emit('user:join', { username, conversationId, language, tone });
      // reload history in the selected language
      axios.get(`${BACKEND}/api/messages/${conversationId}?targetLanguage=${encodeURIComponent(language)}`).then(res => {
        const msgs = res.data.messages || [];
        setMessages(msgs);
      }).catch(() => {});
    }
  }, [language, tone]);

  function sendMessage() {
    if (!input.trim()) return;
    socket.current.emit('message:send', { conversationId, sender: username, text: input });
    setMessages(m => [...m, { _id: 'local-' + Date.now(), conversationId, sender: username, text: input, createdAt: new Date().toISOString(), translation: input }]);
    setInput('');
    setSuggestions([]);
  }

  function onInputChange(e) {
    const val = e.target.value;
    setInput(val);
    // typing indicator
    if (socket.current) {
      socket.current.emit('typing', { conversationId, isTyping: true });
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => {
        socket.current.emit('typing', { conversationId, isTyping: false });
      }, 1200);
    }

    // debounce suggestions (400ms)
    if (suggestionDebounce.current) clearTimeout(suggestionDebounce.current);
    suggestionDebounce.current = setTimeout(() => {
      // send lastMessages to server so AI can use exact recent context
      // prefer translated text (what the user sees) when available
      const lastMessages = messages.slice(-10).map(m => ({ sender: m.sender, text: (m.translation || m.text), createdAt: m.createdAt }));
      fetchSuggestions(val, lastMessages);
    }, 400);
  }

  async function fetchSuggestions(text, lastMessages = []) {
    if (!text || text.trim().length < 1) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }
    setLoadingSuggestions(true);
    try {
      const res = await axios.post(`${BACKEND}/api/suggestions`, { conversationId, currentInput: text, language, tone, lastMessages });
      setSuggestions(res.data.suggestions || []);
    } catch (err) {
      // Log richer error info for debugging
      console.warn('Suggestion fetch error', {
        status: err?.response?.status,
        data: err?.response?.data,
        message: err?.message
      });
      // Ensure UI shows no suggestions on error
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }

  function pickSuggestion(s) {
    setInput(s);
  }

  return (
    <div className="p-6 md:p-8 flex gap-6 h-[76vh]">
      <div className="w-72 sidebar hidden md:block">
        <div className="search">
          <input placeholder="Search rooms" className="w-full p-2 input-glass" />
        </div>
        <div className="space-y-2">
          <div className="room-item active"># {conversationId}</div>
          <div className="room-item"># marketing</div>
          <div className="room-item"># support</div>
        </div>
      </div>

      <div className="flex-1 flex flex-col rounded-lg bg-transparent">
        <div className="topbar px-4">
          <div>
            <div className="text-sm text-gray-500">Conversation</div>
            <div className="font-medium">{conversationId} <span className="badge ml-2">Logged in as {username}</span></div>
          </div>
          <div className="flex items-center gap-3">
            <select value={language} onChange={e => setLanguage(e.target.value)} className="p-2 rounded input-glass">
              <option>English</option>
              <option>Hindi</option>
              <option>Marathi</option>
              <option>Spanish</option>
            </select>
            <select value={tone} onChange={e => setTone(e.target.value)} className="p-2 rounded input-glass">
              <option>Casual</option>
              <option>Formal</option>
              <option>Funny</option>
              <option>Flirty</option>
            </select>
          </div>
        </div>

        <div className="messages-scroll" id="messages">
          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} mine={m.sender === username} translation={m.translation} sourceLang={m.sourceLang} language={language} />
          ))}
        </div>

        <div className="p-4 border-t bg-transparent">
          <div className="text-sm text-gray-500 mb-2">{typingIndicator ? <span className="typing-dots"><span></span><span></span><span></span></span> : null} {typingIndicator}</div>
          <div className="composer">
            <input value={input} onChange={onInputChange} placeholder="Type a message..." className="compose-input" />
            <button onClick={sendMessage} className="send-btn">Send</button>
          </div>
          <Suggestions suggestions={suggestions} onPick={pickSuggestion} loading={loadingSuggestions} />
        </div>
      </div>

      <div className="w-80 right-panel hidden lg:block">
        <div className="p-4 rounded-lg bg-gradient-to-b from-white to-gray-50">
          <h4 className="font-semibold mb-2">Participants</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-3"><div className="avatar">A</div><div>Alex</div></div>
            <div className="flex items-center gap-3"><div className="avatar">S</div><div>Sam</div></div>
          </div>
        </div>
      </div>
    </div>
  )
}

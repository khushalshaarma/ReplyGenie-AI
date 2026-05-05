import React, { useState } from 'react'
import Chat from './components/Chat'

export default function App() {
  const [username, setUsername] = useState('User' + Math.floor(Math.random() * 1000));
  const [conversationId, setConversationId] = useState('room-1');
  const [joined, setJoined] = useState(false);

  return (
    <div className="min-h-screen p-6 bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
      <div className="max-w-7xl w-full app-card chat-card overflow-hidden">
        {!joined ? (
          <div className="p-10 md:p-14 flex items-center gap-8">
            <div className="flex-1">
              <div className="logo mb-6">
                <div className="logo-mark">A</div>
                <div>
                  <div className="text-lg font-semibold">AOTO Chat</div>
                  <div className="text-xs text-gray-500">AI Smart Replies & Per-recipient translation</div>
                </div>
              </div>

              <h1 className="text-3xl font-playfair font-semibold mb-4">Welcome</h1>
              <p className="text-sm text-gray-500 mb-6">Experience fast human-like suggestions and polished translations. Customize language and tone to fit the conversation.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block mb-2 text-sm text-gray-600">Display name</label>
                  <input value={username} onChange={e => setUsername(e.target.value)} className="w-full p-3 input-glass mb-4" />
                  <label className="block mb-2 text-sm text-gray-600">Conversation ID</label>
                  <input value={conversationId} onChange={e => setConversationId(e.target.value)} className="w-full p-3 input-glass mb-4" />
                  <div className="flex gap-3">
                    <button className="px-5 py-3 send-btn" onClick={() => setJoined(true)}>Join Chat</button>
                    <button className="px-4 py-3 bg-white border rounded" onClick={() => { setUsername('User' + Math.floor(Math.random() * 1000)); }}>Random</button>
                  </div>
                </div>
                <div className="flex items-center">
                  <div className="w-full text-sm text-gray-600">
                    <h3 className="font-semibold mb-2">Why AOTO?</h3>
                    <ul className="list-disc pl-5 text-sm space-y-1">
                      <li>Per-recipient translation and refined English output</li>
                      <li>AI-driven short reply suggestions using conversation context</li>
                      <li>Sleek, responsive UI for mobile and desktop</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
            <div className="w-80 hidden md:block">
              <div className="p-4 bg-gradient-to-b from-white to-gray-50 rounded-lg shadow-sm">
                <h4 className="font-semibold mb-2">Preview</h4>
                <div className="text-xs text-gray-500">A refined chat UI awaits after joining — clean bubbles, italics for originals, and quick suggestions.</div>
              </div>
            </div>
          </div>
        ) : (
          <Chat username={username} conversationId={conversationId} />
        )}
      </div>
    </div>
  )
}

import React from 'react'

export default function MessageBubble({ message, mine, translation, sourceLang, language }) {
  // If the recipient's preferred language differs from the detected source language, show translation as primary.
  // Keep original primary for the sender (mine === true).
  const userLang = (language || 'English').toString().toLowerCase();
  const src = (sourceLang || '').toString().toLowerCase();
  const prefIsEnglish = userLang.startsWith('english') || userLang.startsWith('en');
  const srcIsEnglish = src.startsWith('en');
  const hasTranslation = translation && translation.trim().length && translation !== message.text;

  const showPrimaryTranslation = !mine && hasTranslation && prefIsEnglish && !srcIsEnglish;

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`msg-bubble ${mine ? 'msg-bubble-sent' : 'msg-bubble-recv'} pop-in`}>
        <div className="flex items-start gap-3">
          {!mine && <div className="avatar">{(message.sender || '').slice(0,1).toUpperCase()}</div>}
          <div className="flex-1">
            <div className="text-sm font-medium mb-1">{!mine ? message.sender : 'You'}</div>
            <div className="text-sm">{showPrimaryTranslation ? translation : message.text}</div>
            {hasTranslation ? (
              <div className="text-xs mt-1 text-gray-400">{showPrimaryTranslation ? <span className="italic">{message.text}</span> : translation} {sourceLang ? <span className="ml-1 text-[10px] text-gray-400">({sourceLang})</span> : null}</div>
            ) : null}
            <div className="msg-meta text-right">{new Date(message.createdAt).toLocaleTimeString()}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

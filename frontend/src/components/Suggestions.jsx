import React from 'react'

export default function Suggestions({ suggestions = [], onPick, loading }) {
  return (
    <div className="mt-4 flex gap-3 items-center flex-wrap">
      {loading ? (
        <div className="text-sm text-gray-500 self-center">AI thinking...</div>
      ) : null}
      {suggestions.map((s, i) => (
        <button key={i} onClick={() => onPick(s)} className="suggestion-pill pop-in" title="Use suggestion">{s}</button>
      ))}
      {(!loading && (!suggestions || suggestions.length === 0)) ? (
        <div className="text-sm text-gray-400">Suggestions will appear as you type</div>
      ) : null}
    </div>
  )
}

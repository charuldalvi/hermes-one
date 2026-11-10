// The quick entry bar (⌥Space from anywhere): one line to Chief. Enter sends and stays where you are;
// ⌘Enter sends and opens Hermes One; Esc closes it.
import { useEffect, useRef, useState } from 'react'
import { BotFace } from './BotFace'

export function QuickEntry() {
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    return window.hermesNative.onQuickShown?.(() => { setText(''); setTimeout(() => input.current?.focus(), 10) })
  }, [])
  const send = (open: boolean) => { const t = text.trim(); if (!t && !open) return; setText(''); void window.hermesNative.quickSend?.(t, open) }
  return (
    <div className="qe">
      <BotFace profile="default" size={34} watch={false} />
      <input ref={input} value={text} placeholder="Ask Hermes anything" spellCheck
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); void window.hermesNative.quickHide?.() }
          else if (e.key === 'Enter') { e.preventDefault(); send(e.metaKey || e.ctrlKey) }
        }} />
      <span className="qe-k">↵ send · ⌘↵ send and open</span>
    </div>
  )
}

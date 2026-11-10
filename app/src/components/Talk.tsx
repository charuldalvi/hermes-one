// Talk: a spoken conversation with Chief (Hermes Remote's Talk dock, for the Mac). You speak; when you
// pause, Hermes writes it down and sends it as a spoken turn (it answers short and plain), reads the
// answer aloud in its voice, then listens again. End stops it at any point.
import { useEffect, useRef, useState } from 'react'
import { rest } from '../lib/api'
import { sendToChief, stopChief, toast } from '../lib/hermes'
import { Icon } from '../lib/icons'
import { BotFace, type Mood } from './BotFace'

type Stage = 'listening' | 'hearing' | 'writing' | 'thinking' | 'speaking'
const WORDS: Record<Stage, string> = { listening: 'Listening…', hearing: 'Go on, I’m listening', writing: 'Writing it down…', thinking: 'Hermes is thinking…', speaking: 'Speaking…' }
const MOOD: Record<Stage, Mood> = { listening: 'idle', hearing: 'nod', writing: 'writing', thinking: 'thinking', speaking: 'callout' }

export function TalkButton() {
  const [on, setOn] = useState(false)
  return (
    <>
      <button className={`plus talkb${on ? ' on' : ''}`} title="Talk with Hermes" onClick={() => setOn(!on)}><Icon name="wave" size={17} /></button>
      {on ? <TalkDock onEnd={() => setOn(false)} /> : null}
    </>
  )
}

function TalkDock({ onEnd }: { onEnd: () => void }) {
  const [stage, setStage] = useState<Stage>('listening')
  const [heard, setHeard] = useState('')
  const lvl = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  const cleanup = useRef<() => void>(() => {})
  const audio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    alive.current = true
    void listen()
    return () => { alive.current = false; cleanup.current(); audio.current?.pause() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Listen until you've spoken and then paused for ~1.3 s (or 60 s pass), then write it down.
  async function listen() {
    if (!alive.current) return
    setStage('listening')
    try {
      await window.hermesNative.askMic?.()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(an)
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' })
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      const buf = new Uint8Array(an.fftSize)
      let spoke = 0, quietSince = 0, raf = 0
      const t0 = performance.now()
      const stopAll = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); void ctx.close().catch(() => {}) }
      cleanup.current = () => { try { rec.state !== 'inactive' && rec.stop() } catch { /* stopped */ } stopAll() }
      const tick = () => {
        an.getByteTimeDomainData(buf)
        let sum = 0; for (const v of buf) sum += (v - 128) ** 2
        const rms = Math.sqrt(sum / buf.length)
        if (lvl.current) lvl.current.style.transform = `scale(${1 + Math.min(1, rms / 24) * 0.6})`
        const now = performance.now()
        if (rms > 6) { if (!spoke) { spoke = now; setStage('hearing') } quietSince = 0 } else if (spoke && !quietSince) quietSince = now
        const long = now - t0 > 60_000
        if ((spoke && quietSince && now - quietSince > 1300 && now - spoke > 500) || long) { rec.stop(); return }
        raf = requestAnimationFrame(tick)
      }
      rec.onstop = async () => {
        stopAll()
        if (!alive.current) return
        const blob = new Blob(chunks, { type: 'audio/webm' })
        if (!spoke || blob.size < 3000) { void listen(); return }
        setStage('writing')
        try {
          const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob) })
          const out: any = await rest('POST', '/api/audio/transcribe', { data_url: dataUrl, mime_type: 'audio/webm' })
          const text = String(out?.text ?? out?.transcript ?? '').trim()
          if (!alive.current) return
          if (!text) { void listen(); return }
          setHeard(text)
          await converse(text)
        } catch (e: any) { toast(`Couldn’t hear that: ${e?.message ?? e}`); if (alive.current) void listen() }
      }
      rec.start(250)
      raf = requestAnimationFrame(tick)
    } catch (e: any) {
      toast(/denied|not allowed|permission/i.test(String(e?.message)) ? 'Hermes One can’t use the microphone. Allow it in System Settings › Privacy & Security › Microphone.' : `Couldn’t start talking: ${e?.message ?? e}`)
      onEnd()
    }
  }

  // Send it, wait for Chief's answer, read it aloud, then listen again.
  async function converse(text: string) {
    setStage('thinking')
    const reply = new Promise<{ text: string; error?: boolean }>((resolve) => {
      const on = (e: Event) => { window.removeEventListener('hermes:chief-reply', on); resolve((e as CustomEvent).detail) }
      window.addEventListener('hermes:chief-reply', on)
    })
    const ok = await sendToChief(text, [], { spoken: true })
    if (!ok) { if (alive.current) void listen(); return }
    const r = await reply
    if (!alive.current) return
    const plain = (r.text || '').replace(/```[\s\S]*?```/g, ' ').replace(/MEDIA:\S+/g, '').replace(/[#*_`>|]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').trim().slice(0, 3000)
    if (!plain || r.error) { void listen(); return }
    setStage('speaking')
    try {
      const out: any = await rest('POST', '/api/audio/speak', { text: plain })
      const url = URL.createObjectURL(await (await fetch(out.data_url)).blob())
      const a = new Audio(url); audio.current = a
      await new Promise<void>((resolve) => { a.onended = () => resolve(); a.onerror = () => resolve(); void a.play().catch(() => resolve()) })
      URL.revokeObjectURL(url)
    } catch (e: any) { toast(`Couldn’t speak the answer: ${e?.message ?? e}`) }
    if (alive.current) void listen()
  }

  const end = () => { alive.current = false; cleanup.current(); audio.current?.pause(); if (stage === 'thinking') void stopChief(); onEnd() }
  return (
    <div className="talk" role="dialog" aria-label="Talking with Hermes">
      <div className="talk-bead"><div className="talk-ring" ref={lvl} /><BotFace profile="default" size={56} mood={MOOD[stage]} watch /></div>
      <div className="talk-tx"><b>{WORDS[stage]}</b>{heard ? <span>“{heard.length > 120 ? heard.slice(0, 120) + '…' : heard}”</span> : <span>Speak naturally. Pause and Hermes answers out loud.</span>}</div>
      {stage === 'speaking' ? <button className="b-soft" onClick={() => { audio.current?.pause(); audio.current?.dispatchEvent(new Event('ended')) }}>Skip</button> : null}
      <button className="b-danger" onClick={end}>End</button>
    </div>
  )
}

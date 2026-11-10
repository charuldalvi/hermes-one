// Speak instead of typing: hold or click the mic, talk, and Hermes turns it into text in the message box
// (Hermes' own speech-to-text, POST /api/audio/transcribe, the same one Hermes Remote's voice notes use).
import { useEffect, useRef, useState } from 'react'
import { rest } from '../lib/api'
import { toast } from '../lib/hermes'
import { Icon } from '../lib/icons'
import { Spinner } from './ui'

const LIMIT_MS = 10 * 60 * 1000

export function VoiceButton({ onText }: { onText: (text: string) => void }) {
  const [stage, setStage] = useState<'idle' | 'rec' | 'busy'>('idle')
  const [secs, setSecs] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const level = useRef<HTMLSpanElement>(null)
  const stopAll = useRef<() => void>(() => {})

  useEffect(() => () => stopAll.current(), [])

  const start = async () => {
    try {
      await window.hermesNative.askMic?.()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const r = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 })
      chunks.current = []
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data) }
      // A live level under the mic, so you can see it hears you.
      const ctx = new AudioContext()
      const an = ctx.createAnalyser(); an.fftSize = 256
      ctx.createMediaStreamSource(stream).connect(an)
      const buf = new Uint8Array(an.frequencyBinCount)
      let raf = 0
      const t0 = Date.now()
      const tick = () => {
        an.getByteTimeDomainData(buf)
        let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
        if (level.current) level.current.style.transform = `scale(${1 + Math.min(1, peak / 50) * 0.9})`
        setSecs(Math.floor((Date.now() - t0) / 1000))
        if (Date.now() - t0 > LIMIT_MS) finish(); else raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      stopAll.current = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); void ctx.close().catch(() => {}) }
      r.onstop = async () => {
        stopAll.current()
        const blob = new Blob(chunks.current, { type: 'audio/webm' })
        if (blob.size < 2000) { setStage('idle'); return }
        setStage('busy')
        try {
          const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob) })
          const out: any = await rest('POST', '/api/audio/transcribe', { data_url: dataUrl, mime_type: 'audio/webm' })
          const text = String(out?.text ?? out?.transcript ?? '').trim()
          if (text) onText(text); else toast('Didn’t catch any words')
        } catch (e: any) { toast(`Couldn’t turn that into text: ${e?.message ?? e}`) } finally { setStage('idle') }
      }
      rec.current = r
      r.start(250)
      setSecs(0)
      setStage('rec')
    } catch (e: any) {
      toast(/denied|not allowed|permission/i.test(String(e?.message)) ? 'Hermes One can’t use the microphone. Allow it in System Settings › Privacy & Security › Microphone.' : `Couldn’t start the mic: ${e?.message ?? e}`)
      setStage('idle')
    }
  }
  const finish = () => { if (rec.current && rec.current.state !== 'inactive') rec.current.stop() }
  const cancel = () => { chunks.current = []; if (rec.current && rec.current.state !== 'inactive') { rec.current.ondataavailable = null; rec.current.onstop = () => { stopAll.current(); setStage('idle') }; rec.current.stop() } }

  if (stage === 'rec') return (
    <span className="voice rec">
      <button className="vx" title="Cancel" onClick={cancel}><Icon name="x" size={14} /></button>
      <span className="vt">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
      <button className="vgo" title="Done: turn it into text" onClick={finish}><span className="lvl" ref={level} /><Icon name="check" size={14} /></button>
    </span>
  )
  return (
    <button className="plus voice" title={stage === 'busy' ? 'Writing it down…' : 'Speak instead of typing'} disabled={stage === 'busy'} onClick={() => void start()}>
      {stage === 'busy' ? <Spinner size={14} /> : <Icon name="mic" size={17} />}
    </button>
  )
}

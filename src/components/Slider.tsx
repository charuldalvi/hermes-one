// A settings slider in the app's precision-tool look: a thin rail, a mono fill, a knob cut out of the card
// with a hairline gap, and quarter ticks. It moves like liquid:
//   - a click on the rail springs the knob there, keeping its speed if you click again mid-flight;
//   - while you drag, the knob follows the pointer 1:1, swells a little, and stretches with its speed;
//   - on release it settles with a small overshoot.
// A tag above the knob shows the value while you hold it (or move it with the keys). Double-click the
// knob to go back to the usual value. Calm motion (Settings › This app) and reduced motion snap instead.
import { useEffect, useRef, useState } from 'react'
// @ts-ignore plain JS engine
import { Sp, REDUCED } from '../quicksilver/engine.js'

const calm = () => REDUCED || document.documentElement.dataset.motion === 'calm'
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export function Slider({ value, onChange, min = 0, max = 100, step = 1, from, to, label, format, usual }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number
  /** The words at either end ("Subtle", "Strong"); a click on one goes all the way there. */
  from: string; to: string; label: string
  /** The value as words for the tag and for VoiceOver ("Medium · 42%"). */
  format?: (v: number) => string
  /** The usual value, restored by a double-click on the knob. */
  usual?: number
}) {
  const rail = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLSpanElement>(null)
  const frac = (v: number) => clamp01((v - min) / (max - min))
  const valueAt = (f: number) => { const v = min + clamp01(f) * (max - min); return Math.round(v / step) * step }
  const st = useRef({
    pos: new Sp(frac(value), 380, 0.8), size: new Sp(1, 520, 0.42), stretch: new Sp(0, 600, 0.9),
    dragging: false, pressed: false, hover: false, raf: 0, last: 0, sent: value, trail: [] as { t: number; f: number }[],
  })
  const [held, setHeld] = useState(false)
  const [keyed, setKeyed] = useState(false)
  const [shown, setShown] = useState(value)
  const send = useRef(onChange)
  send.current = onChange

  const paint = () => {
    const s = st.current
    const f = clamp01(s.pos.v)
    rail.current?.style.setProperty('--f', String(f))
    // Stretch along the way it moves, thinner across, so it reads as one soft drop of liquid.
    const k = s.stretch.v
    const sx = s.size.v * (1 + k), sy = s.size.v * (1 - k * 0.45)
    if (knob.current) knob.current.style.transform = `translate(-50%, -50%) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`
  }
  const run = () => {
    const s = st.current
    if (s.raf) return
    s.last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(1 / 30, (now - s.last) / 1000); s.last = now
      const n = Math.max(1, Math.ceil(dt / (1 / 240)))
      for (let i = 0; i < n; i++) { if (!s.dragging) s.pos.step(dt / n); s.size.step(dt / n); s.stretch.step(dt / n) }
      // While springing, the knob stretches with its own speed (rail widths per second).
      if (!s.dragging) s.stretch.to = Math.min(0.16, Math.abs(s.pos.vel) * 0.05)
      paint()
      const moving = s.dragging || Math.abs(s.pos.v - s.pos.to) > 0.0005 || Math.abs(s.pos.vel) > 0.002
        || Math.abs(s.size.v - s.size.to) > 0.002 || Math.abs(s.size.vel) > 0.004 || Math.abs(s.stretch.v - s.stretch.to) > 0.002 || s.stretch.to > 0.002
      if (moving) s.raf = requestAnimationFrame(frame)
      else { s.raf = 0; s.pos.v = s.pos.to; s.pos.vel = 0; s.stretch.v = 0; s.size.v = s.size.to; paint() }
    }
    s.raf = requestAnimationFrame(frame)
  }
  const springTo = (f: number) => {
    const s = st.current
    s.pos.to = clamp01(f)
    if (calm()) { s.pos.v = s.pos.to; s.pos.vel = 0; paint(); return }
    run()
  }
  const commit = (v: number) => { const s = st.current; setShown(v); if (v !== s.sent) { s.sent = v; send.current(v) } }

  // A new value from outside springs the knob there.
  useEffect(() => { const s = st.current; if (!s.dragging && value !== s.sent) { s.sent = value; setShown(value); springTo(frac(value)) } }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { paint(); const s = st.current; return () => { if (s.raf) cancelAnimationFrame(s.raf) } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const at = (clientX: number) => { const r = rail.current!.getBoundingClientRect(); return clamp01((clientX - r.left) / r.width) }
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const s = st.current
    e.preventDefault()
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* a synthetic pointer */ }
    ;(e.currentTarget as HTMLElement).focus({ preventScroll: true })
    setKeyed(false)
    const f = at(e.clientX)
    const onKnob = Math.abs(f - s.pos.v) * rail.current!.getBoundingClientRect().width < 14
    s.pressed = true; s.dragging = false; s.trail = []
    setHeld(true)
    s.size.to = 1.16
    // On the knob: it's picked up where it is. On the rail: it springs there (and a drag takes it from there).
    if (onKnob) s.pos.vel = 0
    else { const v = valueAt(f); springTo(frac(v)); commit(v) }
    if (calm()) { s.size.v = s.size.to; paint() } else run()
  }
  const move = (e: React.PointerEvent) => {
    const s = st.current
    if (!s.pressed) return
    const f = at(e.clientX)
    if (!s.dragging) { s.dragging = true; s.pos.vel = 0; s.trail = [] }
    const now = performance.now()
    s.trail.push({ t: now, f }); while (s.trail.length > 5) s.trail.shift()
    const a = s.trail[0], b = s.trail[s.trail.length - 1]
    const vel = a && b && b.t > a.t ? (b.f - a.f) / ((b.t - a.t) / 1000) : 0
    s.pos.v = s.pos.to = f; s.pos.vel = vel
    s.stretch.to = calm() ? 0 : Math.min(0.16, Math.abs(vel) * 0.05)
    if (calm()) paint(); else run()
    commit(valueAt(f))
  }
  const up = () => {
    const s = st.current
    if (!s.pressed) return
    s.pressed = false
    const wasDragging = s.dragging
    s.dragging = false; setHeld(false)
    s.size.to = s.hover ? 1.1 : 1; s.stretch.to = 0
    // Settle on the exact step, carrying a little of the throw so it lands softly.
    if (wasDragging) { s.pos.to = frac(valueAt(s.pos.v)); s.pos.vel *= 0.25 }
    if (calm()) { s.size.v = 1; s.stretch.v = 0; s.pos.v = s.pos.to; paint() } else run()
  }
  const key = (e: React.KeyboardEvent) => {
    const big = (max - min) / 10
    const cur = st.current.sent
    const next = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? cur + (e.shiftKey ? big : step)
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? cur - (e.shiftKey ? big : step)
      : e.key === 'PageUp' ? cur + big : e.key === 'PageDown' ? cur - big
      : e.key === 'Home' ? min : e.key === 'End' ? max : null
    if (next === null) return
    e.preventDefault()
    const v = Math.max(min, Math.min(max, Math.round(next / step) * step))
    setKeyed(true)
    springTo(frac(v)); commit(v)
  }
  const jump = (v: number) => { springTo(frac(v)); commit(v) }
  // Hovering the slider lifts the knob a touch, so it reads as something to grab.
  const hover = (on: boolean) => { const s = st.current; s.hover = on; if (s.pressed) return; s.size.to = on ? 1.1 : 1; if (calm()) { s.size.v = s.size.to; paint() } else run() }
  const text = format ? format(shown) : String(shown)
  const ticks = [0.25, 0.5, 0.75]
  return (
    <div className={`sld${held ? ' held' : ''}${keyed ? ' keyed' : ''}`}>
      <button type="button" className="sld-end" tabIndex={-1} onClick={() => jump(min)}>{from}</button>
      <div className="sld-hit" role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={shown} aria-valuetext={text}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key} onBlur={() => setKeyed(false)}
        onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}
        onDoubleClick={() => { if (usual !== undefined) jump(usual) }}>
        <div className="sld-rail" ref={rail}>
          <i className="sld-fill" />
          {ticks.map((t) => <b key={t} className="sld-tick" style={{ left: `${t * 100}%` }} />)}
          <span className="sld-knob" ref={knob} />
          <em className="sld-tag" aria-hidden="true">{text}</em>
        </div>
      </div>
      <button type="button" className="sld-end" tabIndex={-1} onClick={() => jump(max)}>{to}</button>
    </div>
  )
}

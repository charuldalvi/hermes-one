// The thinking-effort slider, ported from Hermes Remote's PixelEffortSlider: a field of square pixels
// behind a white handle. Pixels light up blue behind the handle, more of them, brighter and twinkling
// faster as effort rises, with a shimmer running toward the handle. At Max the field blooms: it glows,
// rings of light ripple out from the handle and pixels burst off it. The handle follows the pointer,
// springs to the nearest of the five stops when let go (carrying the throw).
import { useEffect, useRef, useState } from 'react'
// @ts-ignore plain JS engine
import { Sp, REDUCED } from '../quicksilver/engine.js'

const INK = {
  track: '#0E1015', dim: '255,255,255', lit: '76,141,255', hot: '227,236,255', spark: '122,167,255', sparkHot: '255,255,255',
  mark: 'rgba(255,255,255,.5)', glow: '#CFE0FF', shadow: 'rgba(0,0,0,.4)', knobOff: '#C7C7CC',
}
const H = 44

interface Pixel { x: number; y: number; seed: number; seed2: number; phase: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; size: number; hot: boolean; age: number }

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

function spawn(sparks: Spark[], f: number, speed: number, span: number) {
  if (sparks.length > 220) return
  const a = Math.random() * Math.PI * 2
  const sp = (40 + Math.random() * 70) * speed
  const hx = 22 + f * (span - 44)
  sparks.push({ x: hx + Math.cos(a) * 13, y: 22 + Math.sin(a) * 13, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.6, size: 1.6 + Math.random() * 1.4, hot: Math.random() < 0.45, age: 0 })
}

function drawField(g: CanvasRenderingContext2D, w: number, h: number, pixels: Pixel[], sparks: Spark[], f: number, level: number, stops: number, t: number, span: number, glow: boolean) {
  const sx = w / span, sy = h / H
  const hx = 22 + f * (span - 44)
  const lit = level > 0 ? 0.35 + 0.65 * f : 0
  const L = Math.max(0, Math.min(4, level))
  const peak = [0, 0.4, 0.55, 0.75, 1][L]
  const hot = [0, 0, 0.05, 0.12, 0.3][L]
  const twinkle = [0, 1.2, 2, 3.2, 5][L]
  const band = (t * (40 + 90 * f)) % (hx + 60) - 30
  const ring = level === stops ? (t * 90) % 120 : -99
  g.save()
  g.beginPath(); g.roundRect(0, 0, w, h, 22 * sy); g.clip()
  for (const p of pixels) {
    let a = 0.07
    let col = INK.dim
    if (p.x < hx && p.seed < lit) {
      const r = p.x / hx, near = r * Math.sqrt(r)
      a = peak * (0.45 + 0.55 * near) * (0.65 + 0.35 * Math.sin(t * twinkle + p.phase))
      if (level < stops && Math.abs(p.x - band) < 9) a += 0.3 * (1 - Math.abs(p.x - band) / 9)
      if (level === stops) a += 0.5 * Math.max(0, 1 - Math.abs(Math.hypot(p.x - hx, p.y - 22) - ring) / 6)
      a = Math.min(1, a)
      col = p.seed2 < hot * (0.4 + near) ? INK.hot : INK.lit
    } else if (glow) continue
    g.fillStyle = `rgba(${col},${a})`
    g.fillRect((p.x - 1.25) * sx, (p.y - 1.25) * sy, 2.5 * sx, 2.5 * sy)
  }
  if (!glow) {
    g.fillStyle = INK.mark
    for (let i = 0; i <= stops; i++) {
      const x = 22 + i * (span - 44) / stops
      if (x > hx + 16) g.fillRect((x - 2) * sx, 20 * sy, 4 * sx, 4 * sy)
    }
  }
  g.restore()
  if (glow) { g.fillStyle = INK.glow; g.beginPath(); g.arc(hx * sx, 22 * sy, 14 * sy, 0, Math.PI * 2); g.fill() }
  for (const s of sparks) {
    const k = Math.max(0, Math.min(1, 1 - s.age / s.life))
    const z = s.size * (0.5 + 0.5 * k)
    g.fillStyle = `rgba(${s.hot ? INK.sparkHot : INK.spark},${k})`
    g.fillRect((s.x - z / 2) * sx, (s.y - z / 2) * sy, z * sx, z * sy)
  }
}

export function EffortSlider({ stop, onStop, labels, enabled = true, width = 300 }: { stop: number; onStop: (i: number) => void; labels: string[]; enabled?: boolean; width?: number }) {
  const stops = labels.length - 1
  const cv = useRef<HTMLCanvasElement>(null)
  const glowCv = useRef<HTMLCanvasElement>(null)
  const st = useRef({ pos: new Sp(stop / stops, 320, 0.72), dragging: false, clock: 0, sparks: [] as Spark[], lastLevel: stop, emit: 0, trail: [] as { t: number; x: number }[], onStop, stop })
  st.current.onStop = onStop
  st.current.stop = stop
  const [held, setHeld] = useState(false)
  const span = width
  const cols = Math.floor((span - 6) / 4) + 1
  const pixels = useRef<Pixel[]>([])
  if (pixels.current.length !== cols * 10) {
    const r = rng(7)
    pixels.current = Array.from({ length: 10 * cols }, (_, i) => ({ x: 3 + (i % cols) * 4, y: 4 + Math.floor(i / cols) * 4, seed: r(), seed2: r(), phase: r() * 6.28 }))
  }

  // A new stop from outside (or a tap on a label) springs the handle there.
  useEffect(() => { const s = st.current; if (!s.dragging) s.pos.to = stop / stops }, [stop, stops])

  useEffect(() => {
    let raf = 0, last = 0
    const dpr = window.devicePixelRatio || 1
    const c = cv.current!, gc = glowCv.current!
    for (const el of [c, gc]) { el.width = Math.round(width * dpr); el.height = Math.round(H * dpr) }
    const g = c.getContext('2d')!, gg = gc.getContext('2d')!
    const frame = (now: number) => {
      const s = st.current
      const dt = last ? Math.min(0.033, (now - last) / 1000) : 0
      last = now
      if (!REDUCED) s.clock += dt
      if (!s.dragging) { const n = Math.max(1, Math.ceil(dt / (1 / 240))); for (let i = 0; i < n; i++) s.pos.step(dt / n); if (REDUCED) s.pos.v = s.pos.to }
      const f = Math.max(0, Math.min(1, s.pos.v))
      const level = Math.round(f * stops)
      if (!REDUCED && level === stops && s.lastLevel !== stops) for (let i = 0; i < 80; i++) spawn(s.sparks, f, 1.7, span)
      s.lastLevel = level
      if (!REDUCED && level === stops) { s.emit += dt * 45; while (s.emit > 1) { s.emit -= 1; spawn(s.sparks, f, 1, span) } }
      for (const p of s.sparks) { p.age += dt; p.vx *= 1 - 1.6 * dt; p.vy *= 1 - 1.6 * dt; p.x += p.vx * dt; p.y += p.vy * dt }
      s.sparks = s.sparks.filter((p) => p.age < p.life)
      const w = c.width, h = c.height, k = h / H
      g.clearRect(0, 0, w, h)
      drawField(g, w, h, pixels.current, s.sparks, f, level, stops, s.clock, span, false)
      // The handle: a plain white knob that swells while you hold it.
      const cx = (22 + f * (span - 44)) * k
      const r = 14 * k * (s.dragging ? 1.08 : 1)
      g.fillStyle = INK.shadow; g.beginPath(); g.arc(cx, h / 2 + k, r + 1.5 * k, 0, Math.PI * 2); g.fill()
      g.fillStyle = level === 0 ? INK.knobOff : '#fff'; g.beginPath(); g.arc(cx, h / 2, r, 0, Math.PI * 2); g.fill()
      // The bloom, only at the top stops: the bright pixels again, blurred behind.
      gg.clearRect(0, 0, w, h)
      gc.style.opacity = level >= stops - 1 ? (level === stops ? '1' : '.35') : '0'
      if (level >= stops - 1) drawField(gg, w, h, pixels.current, s.sparks, f, level, stops, s.clock, span, true)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [width, span, stops])

  const at = (clientX: number) => {
    const r = cv.current!.getBoundingClientRect()
    const inset = 22 * (r.height / H)
    return Math.max(0, Math.min(1, (clientX - r.left - inset) / (r.width - 2 * inset)))
  }
  const down = (e: React.PointerEvent) => {
    if (!enabled) return
    const s = st.current
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    s.dragging = true; setHeld(true)
    s.pos.v = s.pos.to = at(e.clientX); s.pos.vel = 0
    s.trail = [{ t: performance.now(), x: s.pos.v }]
  }
  const move = (e: React.PointerEvent) => {
    const s = st.current
    if (!s.dragging) return
    s.pos.v = s.pos.to = at(e.clientX)
    s.trail.push({ t: performance.now(), x: s.pos.v })
    if (s.trail.length > 6) s.trail.shift()
  }
  const up = () => {
    const s = st.current
    if (!s.dragging) return
    s.dragging = false; setHeld(false)
    const a = s.trail[0], b = s.trail[s.trail.length - 1]
    const v = a && b && b.t > a.t ? (b.x - a.x) / ((b.t - a.t) / 1000) : 0
    const target = Math.max(0, Math.min(stops, Math.round((s.pos.v + v * 0.12) * stops)))
    s.pos.vel = v; s.pos.to = target / stops
    if (target !== s.stop) s.onStop(target)
  }
  return (
    <div className={`effort${enabled ? '' : ' off'}${held ? ' held' : ''}`} style={{ width }}>
      <div className="effort-field" role="slider" tabIndex={enabled ? 0 : -1} aria-label="Thinking effort" aria-valuemin={0} aria-valuemax={stops} aria-valuenow={stop} aria-valuetext={labels[stop]}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onKeyDown={(e) => {
          if (!enabled) return
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onStop(Math.min(stops, stop + 1)) }
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onStop(Math.max(0, stop - 1)) }
        }}>
        <canvas ref={glowCv} className="effort-glow" style={{ width, height: H }} />
        <canvas ref={cv} style={{ width, height: H }} />
      </div>
      <div className="effort-labels" style={{ padding: '0 22px' }}>
        {labels.map((l, i) => (
          <button key={l} className={i === stop ? 'on' : ''} disabled={!enabled} style={{ left: `calc(22px + ${(i / stops)} * (100% - 44px))` }} onClick={() => onStop(i)}>{l}</button>
        ))}
      </div>
    </div>
  )
}

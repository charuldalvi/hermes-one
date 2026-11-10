// Spring motion, after Hermes Remote's Motion.kt: interruptible springs that keep their velocity when
// retargeted, stepped in fixed 1/240 s substeps so stiff springs stay stable when a frame drops.
// @ts-ignore engine is plain JS
import { Sp, REDUCED } from '../quicksilver/engine.js'

export const SPRING = {
  press: [1100, 0.85], release: [480, 0.5], fluid: [380, 0.8], pop: [520, 0.42], screen: [300, 0.9],
  dropletLead: [620, 0.66], dropletTrail: [230, 0.86],
} as const

type Anim = { s: any; running: boolean; last: number; apply: (v: number) => void; done?: () => void; eps: number }
const ANIM = new Map<string, Anim>()

export function springTo(id: string, to: number, opts: { from?: number; k?: number; z?: number; eps?: number; apply: (v: number) => void; done?: () => void }) {
  const { from, k = 380, z = 0.8, eps = 0.2, apply, done } = opts
  if (REDUCED) { apply(to); done?.(); return }
  let a = ANIM.get(id)
  if (!a || (from !== undefined && !a.running)) { a = { s: new Sp(from ?? to, k, z), running: false, last: 0, apply, eps }; ANIM.set(id, a) }
  a.s.k = k; a.s.z = z; a.s.to = to; a.apply = apply; a.done = done; a.eps = eps
  if (a.running) return
  a.running = true; a.last = performance.now()
  const anim = a
  const step = (now: number) => {
    const dt = Math.min(1 / 30, (now - anim.last) / 1000); anim.last = now
    const n = Math.max(1, Math.ceil(dt / (1 / 240)))
    for (let i = 0; i < n; i++) anim.s.step(dt / n)
    anim.apply(anim.s.v)
    if (Math.abs(anim.s.v - anim.s.to) > anim.eps || Math.abs(anim.s.vel) > anim.eps * 2) requestAnimationFrame(step)
    else { anim.s.v = anim.s.to; anim.s.vel = 0; anim.apply(anim.s.to); anim.running = false; const d = anim.done; anim.done = undefined; d?.() }
  }
  requestAnimationFrame(step)
}

export function pop(el: HTMLElement | null, id: string) {
  if (!el) return
  ANIM.delete(id)
  springTo(id, 1, { from: 0.4, k: SPRING.pop[0], z: SPRING.pop[1], eps: 0.002, apply: (v) => { el.style.transform = `scale(${v})` } })
}

/** One highlight that moves like liquid: the edge moving toward the target leads, the other trails. */
export class Liquid {
  el: HTMLDivElement
  top: any; bot: any; op: any; running = false
  constructor(cls: string) {
    this.el = document.createElement('div'); this.el.className = 'liq ' + cls
    this.top = new Sp(0, 620, 0.66); this.bot = new Sp(0, 230, 0.86); this.op = new Sp(0, 380, 0.8)
  }
  moveTo(row: HTMLElement) {
    const t = row.offsetTop, b = t + row.offsetHeight
    if (this.op.v < 0.05) { this.top.v = this.top.to = t; this.bot.v = this.bot.to = b; this.top.vel = this.bot.vel = 0 }
    const down = t > this.top.to
    ;[this.bot.k, this.bot.z, this.top.k, this.top.z] = down ? [620, 0.66, 230, 0.86] : [230, 0.86, 620, 0.66]
    this.top.to = t; this.bot.to = b; this.op.to = 1; this.run()
  }
  snap(row: HTMLElement) { this.top.v = this.top.to = row.offsetTop; this.bot.v = this.bot.to = row.offsetTop + row.offsetHeight; this.op.v = this.op.to = 1; this.paint() }
  hide() { this.op.to = 0; this.run() }
  paint() { this.el.style.transform = `translateY(${this.top.v}px)`; this.el.style.height = Math.max(0, this.bot.v - this.top.v) + 'px'; this.el.style.opacity = String(Math.max(0, Math.min(1, this.op.v))) }
  run() {
    if (REDUCED) { this.top.v = this.top.to; this.bot.v = this.bot.to; this.op.v = this.op.to; this.paint(); return }
    if (this.running) return
    this.running = true
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(1 / 30, (now - last) / 1000); last = now
      const n = Math.max(1, Math.ceil(dt / (1 / 240)))
      for (let i = 0; i < n; i++) { this.top.step(dt / n); this.bot.step(dt / n); this.op.step(dt / n) }
      this.paint()
      const busy = [this.top, this.bot, this.op].some((s: any) => Math.abs(s.v - s.to) > 0.05 || Math.abs(s.vel) > 0.1)
      if (busy) requestAnimationFrame(step); else this.running = false
    }
    requestAnimationFrame(step)
  }
}

/** Shared-element move: a copy of `from` travels on springs to wherever `to` is, even while `to` moves. */
export function fly(from: Element | null, to: HTMLElement | null, opts: { k?: number; z?: number; fade?: boolean } = {}) {
  if (!from || !to || REDUCED) return
  const { k = 300, z = 0.86, fade = false } = opts
  const a = from.getBoundingClientRect()
  if (!a.width) return
  const g = from.cloneNode(true) as HTMLElement
  const oc = from.querySelectorAll('canvas'), cc = g.querySelectorAll('canvas')
  cc.forEach((cv, i) => { cv.width = oc[i].width; cv.height = oc[i].height; cv.getContext('2d')?.drawImage(oc[i], 0, 0) })
  g.classList.add('ghost')
  Object.assign(g.style, { width: a.width + 'px', height: a.height + 'px', transform: `translate(${a.left}px, ${a.top}px)` })
  document.body.appendChild(g)
  to.style.visibility = 'hidden'
  const sx = new Sp(a.left, k, z), sy = new Sp(a.top, k, z), ss = new Sp(1, k, z), so = new Sp(1, 380, 0.8)
  let last = performance.now()
  const step = (now: number) => {
    const dt = Math.min(1 / 30, (now - last) / 1000); last = now
    if (!to.isConnected) { g.remove(); return }
    const b = to.getBoundingClientRect()
    sx.to = b.left; sy.to = b.top; ss.to = b.width / a.width; so.to = fade ? 0 : 1
    const n = Math.max(1, Math.ceil(dt / (1 / 240)))
    for (let i = 0; i < n; i++) [sx, sy, ss, so].forEach((s: any) => s.step(dt / n))
    g.style.transform = `translate(${sx.v}px, ${sy.v}px) scale(${ss.v})`; g.style.opacity = String(so.v)
    const moving = Math.abs(sx.v - sx.to) + Math.abs(sy.v - sy.to) > 0.4 || Math.abs(sx.vel) + Math.abs(sy.vel) > 3 || Math.abs(ss.v - ss.to) > 0.004
    if (moving) requestAnimationFrame(step); else { to.style.visibility = ''; g.remove() }
  }
  requestAnimationFrame(step)
}

// Hermes, ported from hermes-android master (ui/components/Hermes.kt and Crew.kt):
// the mood engine, the bead shapes, the satin body, the eyes, the crew colours and shapes.
// Units are the prototype's 120-unit box; every part rides its own spring in fixed 1/240 s substeps.
/* eslint-disable */
// =============================================================================================
// Hermes, ported from hermes-android master: ui/components/Hermes.kt (HermesEngine,
// BeadShape, drawBody in satin, eyes) and Crew.kt (crew colours, shapes, badges). Units are the
// prototype's 120-unit box; every part rides its own spring in fixed 1/240 s substeps.
// =============================================================================================
const f = (n) => Math.round(n * 100) / 100;
class Sp { constructor(v, k = 320, z = 0.72) { this.v = v; this.to = v; this.vel = 0; this.k = k; this.z = z; }
  step(h) { const c = 2 * this.z * Math.sqrt(this.k); this.vel += (-this.k * (this.v - this.to) - c * this.vel) * h; this.v += this.vel * h; }
  snap() { this.v = this.to; this.vel = 0; } }
const bump = (t, a, b) => (t > a && t < b ? Math.sin(Math.PI * (t - a) / (b - a)) : 0);
const GLANCES = [[0, 0], [0, 0], [-3, 0], [3, 0], [2, -1.5], [-2, 1]];
const CROWN = [-55, -20, 20, 55];
const CALL_CYCLE = 8, CALL_BURST = 3;
const ALERT = new Set(['hand', 'knock', 'callout']);
const OFFLINE = new Set(['doze', 'search']);
const EYE_DROP = { drop: 4, capsule: 3, letter: 3, cloud: 5, triangle: 8, arch: 4 };

class Engine {
  constructor(shape) {
    this.shape = shape; this.mood = 'idle'; this.time = 0; this.calm = true; this.since = 0; this.prevT = -1; this.prevPh = -1; this.first = true;
    this.mcx = new Sp(60, 260, .55); this.mcy = new Sp(70.5, 260, .55); this.mrx = new Sp(29.5, 260, .55); this.mry = new Sp(29.5, 260, .55);
    this.drops = [0, 1, 2, 3].map(() => ({ cx: new Sp(60, 520, .8), cy: new Sp(75, 520, .8), r: new Sp(8, 520, .8) }));
    const eye = () => ({ ax: new Sp(0, 520, .74), ay: new Sp(0, 520, .74), qx: new Sp(0, 520, .74), qy: new Sp(0, 520, .74), bx: new Sp(0, 520, .74), by: new Sp(0, 520, .74), sw: new Sp(7, 520, .74) });
    this.eL = eye(); this.eR = eye();
    this.shCx = new Sp(60); this.shRx = new Sp(26); this.zz = new Sp(0); this.att = new Sp(0, 160, 1); this.lean = new Sp(0, 180, .5);
    this.touch = null; this.touchedAt = -9; this.tgx = 0; this.tgy = 0; this.lift = 0;
    this.rings = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
    this.T = { cx: 60, cy: 70.5, rx: 29.5, ry: 29.5 }; this.dT = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]; this.dSet = [0, 0, 0, 0];
    this.tL = [0, 0, 0, 0, 0, 0, 7]; this.tR = [0, 0, 0, 0, 0, 0, 7];
    this.nextBlink = 1 + Math.random() * 3; this.nextGlance = 1.5; this.gx = 0; this.gy = 0; this.shut = false; this.blinkEdge = false; this.prevPhNext = -1;
    this.springs = [this.mcx, this.mcy, this.mrx, this.mry, this.shCx, this.shRx, this.zz, this.att, this.lean, ...this.drops.flatMap((d) => [d.cx, d.cy, d.r]), ...Object.values(this.eL), ...Object.values(this.eR)];
  }
  get following() { return this.touch != null || this.time - this.touchedAt < 1.4; }
  get turn() { return Math.max(-1.2, Math.min(1.2, this.lean.v / 11)); }
  get tilt() { return this.tgy / 3.5 * Math.max(0, Math.min(1, this.att.v)); }
  setMood(m) { if (m === this.mood) return; this.mood = m; this.since = this.time; this.prevT = -1; this.prevPh = -1;
    if (m === 'hop') this.stretch(); if (m === 'splash') { this.mry.vel -= 150; this.mrx.vel += 60; } }
  frame(t, dt) {
    if (t < this.time) this.touchedAt = -9;
    this.time = t; this.targets(t);
    this.mcx.to = this.T.cx; this.mcy.to = this.T.cy; this.mrx.to = this.T.rx; this.mry.to = this.T.ry;
    this.drops.forEach((d, i) => { d.cx.to = this.dT[i][0]; d.cy.to = this.dT[i][1]; d.r.to = this.dT[i][2]; });
    ['ax', 'ay', 'qx', 'qy', 'bx', 'by', 'sw'].forEach((k, i) => { this.eL[k].to = this.tL[i]; this.eR[k].to = this.tR[i]; });
    if (this.first || dt <= 0) { this.springs.forEach((s) => s.snap()); this.first = false; return; }
    if (this.blinkEdge) { Object.values(this.eL).forEach((s) => s.snap()); Object.values(this.eR).forEach((s) => s.snap()); this.blinkEdge = false; }
    const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
    for (let i = 0; i < n; i++) for (const s of this.springs) s.step(h);
  }
  stretch() { this.mry.vel += 90; this.mrx.vel -= 45; }
  squash(k = 1) { this.mry.vel -= 140 * k; this.mrx.vel += 75 * k; }
  grounded(rx, ry, cx = 60) { this.T.cx = cx; this.T.cy = 100 - ry; this.T.rx = rx; this.T.ry = ry; }
  drop(i, cx, cy, r) { this.dT[i] = [cx, cy, r]; this.dSet[i] = 1; }
  passed(x, t) { return this.prevT < x && t >= x; }
  cycle(t, len) { const ph = t % len; this.prevPhNext = ph; return ph; }
  crossed(x, ph) { return (this.prevPh < x || this.prevPh > ph) && ph >= x; }
  blink(t) { if (t > this.nextBlink + .14) this.nextBlink = t + 2.2 + Math.random() * 3.2;
    const now = t >= this.nextBlink && t <= this.nextBlink + .14; if (now !== this.shut) { this.shut = now; this.blinkEdge = true; } return now; }
  glance(t) { if (t > this.nextGlance) { this.nextGlance = t + 1.6 + Math.random() * 2.4; [this.gx, this.gy] = GLANCES[Math.floor(Math.random() * GLANCES.length)]; } }
  open(fx, fy, u = 1, o = {}) {
    const gazeX = o.gx ?? this.gx, gazeY = o.gy ?? this.gy, h = o.h ?? 12, w = o.w ?? 7, shut = o.shut ?? false;
    const a = Math.max(0, Math.min(1, this.att.v));
    const lookX = gazeX + (this.tgx - gazeX) * a, lookY = gazeY + (this.tgy - gazeY) * a;
    [[this.tL, fx - 10 * u], [this.tR, fx + 10 * u]].forEach(([out, ex]) => {
      const x = ex + lookX * u, y = fy + lookY * u;
      if (shut) out.splice(0, 7, x - 3.2 * u, y, x, y, x + 3.2 * u, y, 2.2 * u);
      else { const l = (h - w) * u; out.splice(0, 7, x, y - l / 2, x, y, x, y + l / 2, w * u); }
    });
  }
  happy(fx, fy, u = 1) { [[this.tL, fx - 10 * u], [this.tR, fx + 10 * u]].forEach(([o, ex]) => o.splice(0, 7, ex - 4.6 * u, fy + 2 * u, ex, fy - 6.5 * u, ex + 4.6 * u, fy + 2 * u, 3.4 * u)); }
  sleepy(fx, fy, u = 1) { [[this.tL, fx - 10 * u], [this.tR, fx + 10 * u]].forEach(([o, ex]) => o.splice(0, 7, ex - 4.6 * u, fy + 1 * u, ex, fy + 3.5 * u, ex + 4.6 * u, fy + 1 * u, 2.6 * u)); }
  ripple(r, age) { if (age < 0) { r[4] = 0; return; } r[0] = 60; r[1] = 100; r[2] = 22 + age * 60; r[3] = 3.5 + age * 9; r[4] = Math.max(0, .85 - age * 1.4); }
  idle(t, mx, my) { this.open(mx, my - 4, 1, { shut: this.blink(t) }); }
  restFor() {
    if (!this.calm || this.shut || this.following) return 0;
    if (this.springs.some((s) => Math.abs(s.v - s.to) > .02 || Math.abs(s.vel) > .05)) return 0;
    const toBlink = this.nextBlink - this.time;
    let r = 0;
    if (this.mood === 'idle') r = toBlink;
    else if (this.mood === 'callout') { const burst = (this.time - this.since) % CALL_CYCLE; r = burst < CALL_BURST ? 0 : Math.min(toBlink, CALL_CYCLE - burst); }
    return Math.max(0, Math.min(4, r));
  }
  targets(now) {
    const t = now - this.since, wob = this.calm ? 0 : Math.sin(now * 3.1);
    const mx = this.mcx.v, my = this.mcy.v;
    this.grounded(29.5 + wob * .9, 29.5 - wob * .9);
    this.dSet = [0, 0, 0, 0]; this.lift = 0; this.rings.forEach((r) => { r[4] = 0; });
    let zzT = 0; this.prevPhNext = -1;
    const fg = this.touch, awake = this.mood !== 'doze'; let rise = 0;
    if (fg && awake) {
      this.touchedAt = now;
      const dx = fg.x - mx, dy = fg.y - (my - 4), d = Math.sqrt(dx * dx + dy * dy + 900);
      this.tgx = 4.5 * dx / d; this.tgy = 3.5 * dy / d;
      this.lean.to = 11 * dx / Math.sqrt(dx * dx + 4900); rise = -3.5 * dy / Math.sqrt(dy * dy + 4900);
    } else this.lean.to = 0;
    this.att.to = awake && now - this.touchedAt < .8 ? 1 : 0;
    if (!this.calm && this.att.v < .05) this.glance(now);
    const m = this.mood, bl = () => this.blink(now);
    if (m === 'idle') this.idle(now, mx, my);
    else if (m === 'thinking') {
      this.grounded(27.5, 27.5); const a = now * 3.4, r = 37 + Math.sin(now * 1.7) * 6;
      this.drop(0, 60 + Math.cos(a) * r, 70 + Math.sin(a) * r * .5, 7); this.drop(1, 60 - Math.cos(a) * r, 70 - Math.sin(a) * r * .5, 6);
      this.open(mx, my - 4, .95, { gx: 1.5, gy: -2.5, shut: bl() });
    } else if (m === 'writing') {
      this.T.cx = 46; this.T.cy = 75.5; this.T.rx = 24.5; this.T.ry = 24.5;
      this.drop(0, 79, 92 - Math.max(0, Math.sin(now * 6)) * 8, 7); this.drop(1, 96, 93 - Math.max(0, Math.sin(now * 6 - 1.3)) * 8, 6);
      this.open(mx + 2, my - 4, .95, { gx: 3, gy: 0, shut: bl() });
    } else if (m === 'hand') {
      this.grounded(28.5, 28.5, 54); this.drop(0, 78, 60, 8.5); this.drop(1, 85, 48, 7.5);
      this.drop(2, 89 + Math.sin(now * 7) * 4.5, 34 + Math.cos(now * 7) * 1.5, 9.5);
      this.open(mx - 2, my - 4, 1, { gx: 0, gy: -.5, h: 12.6, w: 7.4, shut: bl() });
    } else if (m === 'knock') {
      const ph = this.cycle(t, 1.8);
      if (this.crossed(.05, ph) || this.crossed(.45, ph)) this.stretch();
      if (this.crossed(.33, ph) || this.crossed(.73, ph)) this.squash(.8);
      this.lift = bump(ph, .05, .33) * 12 + bump(ph, .45, .73) * 12;
      this.ripple(this.rings[0], ph - .33); this.ripple(this.rings[1], ph - .73);
      this.open(mx, my - 4, 1, { gx: 0, gy: -1, h: 12.6, w: 7.4, shut: bl() });
    } else if (m === 'callout') {
      const burst = t % CALL_CYCLE;
      for (let i = 0; i < 3; i++) {
        const a = this.calm ? (burst - i * .6) / 1.8 : ((t + i * .6) % 1.8) / 1.8;
        if (a < 0 || a > 1) continue;
        const r = 31 + a * 26; const rg = this.rings[i];
        rg[0] = 60; rg[1] = 72; rg[2] = r * 1.04; rg[3] = r * .94; rg[4] = .65 * (1 - a) * (this.calm ? 1 : Math.min(1, t * 3));
      }
      this.open(mx, my - 4, 1, { gx: 0, gy: 0, shut: bl() });
    } else if (m === 'hop') {
      if (t < 2) { if (this.passed(.52, t)) this.squash(); this.lift = bump(t, 0, .52) * 26; this.happy(mx, my - 4); } else this.idle(now, mx, my);
    } else if (m === 'splash') {
      if (t < 2.2) {
        if (t < 1.05) { const k = t / 1.05; CROWN.forEach((deg, i) => { const a = deg * Math.PI / 180; this.drop(i, 60 + Math.sin(a) * (8 + k * 42), 48 - Math.sin(k * Math.PI) * (36 - Math.abs(deg) / 3), 4); }); }
        this.happy(mx, my - 4);
      } else this.idle(now, mx, my);
    } else if (m === 'nod') {
      if (t < 2) { const b = bump(t, .15, .42) + bump(t, .6, .87); this.grounded(29.5 + 2 * b, 29.5 - 5 * b); this.happy(mx, my - 4); } else this.idle(now, mx, my);
    } else if (m === 'doze') {
      const ph = this.cycle(t, 5), b = Math.sin(now * 1.4), droop = ph > 3 && ph < 4.1 ? (ph - 3) / 1.1 : 0;
      if (this.crossed(4.1, ph)) this.mry.vel += 80;
      this.lift = bump(ph, 4.1, 4.4) * 5;
      this.grounded(29.5 + b * .8 + droop * 2, 28.5 + b * .8 - droop * 3);
      const aw = ph > 4.15 && ph < 4.65; zzT = droop > 0 || aw ? 0 : 1;
      if (aw) this.open(mx + droop * 2, my - 3, 1, { gx: 0, gy: 0 }); else this.sleepy(mx + droop * 2, my - 3 + droop * 2);
    }
    if (rise !== 0) { this.T.ry += rise; this.T.rx -= rise * .5; this.T.cy -= rise; }
    for (let i = 0; i < 4; i++) if (!this.dSet[i]) this.dT[i] = [this.T.cx, this.T.cy + 3, 8];
    this.shCx.to = this.T.cx; this.shRx.to = this.T.rx * .85 * (1 - this.lift / 70); this.zz.to = zzT;
    if (this.prevPhNext >= 0) this.prevPh = this.prevPhNext;
    this.prevT = t;
  }
}

// -- shapes, as paths in mascot units (all wound clockwise so overlaps join) ------------------------
const circ = (x, y, r) => `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 1 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 1 ${f(-2 * r)} 0Z`;
const ell = (x, y, rx, ry) => `M${f(x - rx)} ${f(y)}a${f(rx)} ${f(ry)} 0 1 1 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 1 ${f(-2 * rx)} 0Z`;
function rrect(cx, cy, w, h, r) { r = Math.min(r, w / 2, h / 2); const x = cx - w / 2, y = cy - h / 2;
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`; }
function poly(n, pt) { let d = ''; for (let i = 0; i < n; i++) { const [x, y] = pt(i); d += (i ? 'L' : 'M') + f(x) + ' ' + f(y); } return d + 'Z'; }
function roundedPoly(pts, r) { let d = ''; const n = pts.length;
  for (let i = 0; i < n; i++) { const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const v1 = [p0[0] - p1[0], p0[1] - p1[1]], v2 = [p2[0] - p1[0], p2[1] - p1[1]], l1 = Math.hypot(...v1), l2 = Math.hypot(...v2), k = Math.min(r, Math.min(l1, l2) / 2);
    const a = [p1[0] + v1[0] / l1 * k, p1[1] + v1[1] / l1 * k], b = [p1[0] + v2[0] / l2 * k, p1[1] + v2[1] / l2 * k];
    d += (i ? 'L' : 'M') + f(a[0]) + ' ' + f(a[1]) + 'Q' + f(p1[0]) + ' ' + f(p1[1]) + ' ' + f(b[0]) + ' ' + f(b[1]); }
  return d + 'Z'; }
function wavy(t, cx, cy, rx, ry, k, amp) { const a = t * 2 * Math.PI, m = 1 + amp * Math.cos(k * a); return [cx + rx * m * Math.sin(a), cy - ry * m * Math.cos(a)]; }
function shapePath(s, cx, cy, rx, ry) {
  switch (s) {
    case 'squircle': return poly(64, (i) => { const a = i / 64 * 2 * Math.PI, c = Math.cos(a), sn = Math.sin(a); return [cx + rx * .98 * Math.sign(c) * Math.abs(c) ** (2 / 4.2), cy + ry * .98 * Math.sign(sn) * Math.abs(sn) ** (2 / 4.2)]; });
    case 'capsule': return rrect(cx, cy + ry * .22, rx * 2.44, ry * 1.56, ry * .78);
    case 'letter': return rrect(cx, cy + ry * .2, rx * 2.36, ry * 1.6, 9);
    case 'hexagon': return poly(6, (i) => { const a = Math.PI / 6 + i * Math.PI / 3; return [cx + Math.cos(a) * rx * 1.1, cy - ry * .1 + Math.sin(a) * ry * 1.1]; });
    case 'drop': { const dy = cy + ry * .1, top = dy - ry * 1.5, by = dy + ry * .1;
      return `M${f(cx)} ${f(top)}C${f(cx + rx * .35)} ${f(dy - ry * .95)} ${f(cx + rx)} ${f(dy - ry * .45)} ${f(cx + rx)} ${f(by)}A${f(rx)} ${f(ry * .8)} 0 0 1 ${f(cx - rx)} ${f(by)}C${f(cx - rx)} ${f(dy - ry * .45)} ${f(cx - rx * .35)} ${f(dy - ry * .95)} ${f(cx)} ${f(top)}Z`; }
    case 'cloud': return circ(cx - rx * .55, cy + ry * .38, rx * .62) + circ(cx + rx * .55, cy + ry * .38, rx * .62) + circ(cx, cy, rx * .72);
    case 'triangle': return roundedPoly([[cx, cy - ry * .98], [cx + rx * 1.14, cy + ry], [cx - rx * 1.14, cy + ry]], 11);
    case 'diamond': { const c = cy - ry * .18; return roundedPoly([[cx, c - ry * 1.18], [cx + rx * 1.18, c], [cx, cy + ry], [cx - rx * 1.18, c]], 10); }
    case 'cookie': return poly(96, (i) => wavy(i / 96, cx, cy, rx * .97, ry * .97, 9, .085));
    case 'sunny': return poly(96, (i) => wavy(i / 96, cx, cy, rx * .92, ry * .92, 8, .14));
    case 'clover': { const r = rx * .56; let d = ''; for (const sx of [-1, 1]) for (const sy of [-1, 1]) d += circ(cx + sx * rx * .43, cy + sy * ry * .43, r); return d + circ(cx, cy, rx * .6); }
    case 'arch': { const w = rx * .86; return circ(cx, cy - ry + w, w) + rrect(cx, cy + w / 2, w * 2, ry * 2 - w, 6); }
    default: return ell(cx, cy, rx, ry);
  }
}

// -- colour ----------------------------------------------------------------------------------------
const hex2rgb = (h) => { h = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;
const rgba = (c, a) => `rgba(${c.map((v) => Math.round(v)).join(',')},${a})`;
const lum = (c) => { const l = c.map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * l[0] + .7152 * l[1] + .0722 * l[2]; };
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
const THEME = { dark: false, accent: '#2563eb', alert: '#f59e0b', sleep: '#a1a8b6', bg: '#ffffff' };
function readTheme() {
  const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim();
  THEME.accent = g('--ac'); THEME.alert = g('--m-alert'); THEME.sleep = g('--m-sleep'); THEME.bg = g('--bg');
  THEME.dark = lum(hex2rgb(THEME.bg)) < .2;
}

// -- crew looks (Crew.kt): colour, shape and badge from the profile name --------------------------
const jhash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; };
const CREW_COLORS = ['#8b5cf6', '#14b8a6', '#ec4899', '#0ea5e9', '#06b6d4', '#a855f7'];
const CREW_SHAPES = ['squircle', 'capsule', 'drop', 'hexagon', 'letter', 'cloud'];
// Hermes One hands every agent its own look (src/lib/looks.ts); the name rules below are the fallback.
let LOOKS = {};
export function setLooks(map) { LOOKS = map || {}; }
function crewStyle(profile) {
  const l = LOOKS[profile];
  if (l) return { color: l.color, badge: null, shape: l.shape };
  const n = profile.toLowerCase(), hashed = ((jhash(n) % 65536) + 65536) % 65536;
  if (n.includes('inbox') || n.includes('mail')) return { color: '#d946ef', badge: 'mail', shape: 'letter' };
  if (n.includes('direct')) return { color: '#8b5cf6', badge: 'clapper', shape: 'squircle' };
  if (n.includes('operat') || n.includes('camera') || n.includes('render')) return { color: '#14b8a6', badge: 'video', shape: 'capsule' };
  if (n.includes('author') || n.includes('writ') || n.includes('prompt')) return { color: '#ec4899', badge: 'pencil', shape: 'drop' };
  if (n.includes('continu') || n.includes('review') || n.includes('check')) return { color: '#0ea5e9', badge: 'eye', shape: 'hexagon' };
  if (n.includes('research') || n.includes('search')) return { color: '#06b6d4', badge: 'search', shape: 'cloud' };
  return { color: CREW_COLORS[hashed % 6], badge: null, shape: CREW_SHAPES[hashed % 6] };
}
const label = (p) => { const s = p.replace(/[-_]/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

// -- a bead on screen ------------------------------------------------------------------------------
let UID = 0;
const BEADS = new Set();
const IC = {};
const PTR = { x: -1e4, y: -1e4, t: -10 };
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
class Bead {
  constructor(o) {
    // o: { size, profile, disc, watch, badge }
    this.o = o; this.id = 'q' + (++UID);
    const st = o.profile === 'chief' || o.profile === 'default' ? { color: null, shape: 'round', badge: null } : crewStyle(o.profile);
    this.color = st.color; this.shape = st.shape; this.badge = o.badge === false ? null : st.badge;
    this.eng = new Engine(this.shape); this.mood = 'idle';
    this.fps = o.size <= 64 ? 30 : 0; this.shadow = !o.disc && o.size >= 56;
    this.build(); this.cur = null; this.start = -1; this.last = 0; this.restUntil = 0; this.wake = true;
    this.eng.frame(0, 0); this.paintColor(0); this.draw();
    BEADS.add(this);
  }
  destroy() { BEADS.delete(this); this.el.remove(); }
  build() {
    const o = this.o, S = o.size, id = this.id;
    const box = o.disc ? S * 1.16 : S, left = (S - box) / 2, top = (S - box) / 2 - S * .11;
    const el = document.createElement('span'); el.className = 'av'; el.style.width = el.style.height = S + 'px';
    const svgSize = box * 1.4;
    el.innerHTML = `${o.disc ? '<span class="disc"></span>' : ''}<span class="bx" style="width:${box}px;height:${box}px;left:${left}px;top:${top}px">
      <svg viewBox="-24 -24 168 168" width="${svgSize}" height="${svgSize}" style="left:${-box * .2}px;top:${-box * .2}px" aria-hidden="true"><defs>
      <filter id="g${id}" filterUnits="userSpaceOnUse" x="-30" y="-40" width="180" height="180" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="4.2"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"/></filter>
      <path id="p${id}"/>
      <radialGradient id="s${id}" gradientUnits="userSpaceOnUse"><stop offset="0"/><stop offset=".4"/><stop offset="1"/></radialGradient>
      <radialGradient id="e${id}" gradientUnits="userSpaceOnUse"><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".26"/></radialGradient>
      <radialGradient id="w${id}"><stop offset="0" stop-opacity=".5"/><stop offset=".5" stop-opacity=".3"/><stop offset="1" stop-opacity="0"/></radialGradient>
      <radialGradient id="h${id}"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity=".13"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <clipPath id="c${id}"><use href="#p${id}"/></clipPath></defs>
      <ellipse class="q-sh" fill="var(--m-shadow)" rx="0" ry="0"/>
      <g fill="none" stroke-width="2" class="q-rings"><ellipse opacity="0"/><ellipse opacity="0"/><ellipse opacity="0"/></g>
      <g class="q-lean"><g class="q-lift"><g filter="url(#g${id})"><use href="#p${id}" fill="url(#s${id})"/><use href="#p${id}" fill="url(#e${id})"/>
        <g clip-path="url(#c${id})"><ellipse class="q-glow" fill="url(#w${id})"/><ellipse class="q-sheen" fill="url(#h${id})"/></g></g></g>
        <g class="q-eyes" fill="none" stroke-linecap="round"><path/><path/></g></g>
      <g fill="none" stroke="var(--t3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="q-zz"><path opacity="0"/><path opacity="0"/></g></svg></span>
      ${this.badge && S >= 30 ? `<span class="badge"></span>` : ''}`;
    this.el = el; const q = (s) => el.querySelector(s);
    this.box = q('.bx'); this.disc = q('.disc');
    this.P = { body: q(`#p${id}`), sat: q(`#s${id}`), satStops: el.querySelectorAll(`#s${id} stop`), edge: q(`#e${id}`), glowStops: el.querySelectorAll(`#w${id} stop`),
      glow: q('.q-glow'), sheen: q('.q-sheen'), lift: q('.q-lift'), lean: q('.q-lean'), eyesG: q('.q-eyes'), eyes: el.querySelectorAll('.q-eyes path'),
      sh: q('.q-sh'), rings: el.querySelectorAll('.q-rings ellipse'), zz: el.querySelectorAll('.q-zz path') };
    const b = q('.badge');
    if (b) { const d = Math.max(16, Math.min(22, S * .4)); Object.assign(b.style, { width: d + 'px', height: d + 'px', right: '-3px', bottom: '-3px', background: this.color, boxShadow: `0 0 0 2px var(--bg)` }); b.innerHTML = `<svg class="ic" viewBox="0 0 24 24" style="width:${d * .58}px;height:${d * .58}px;stroke-width:2.2">${IC[this.badge]}</svg>`; }
  }
  baseColor() { return hex2rgb(this.color || THEME.accent); }
  targetColor() { return ALERT.has(this.mood) ? hex2rgb(THEME.alert) : OFFLINE.has(this.mood) ? hex2rgb(THEME.sleep) : this.baseColor(); }
  setMood(m) {
    if (m === this.mood) return; this.mood = m;
    this.eng.calm = m === 'idle' || m === 'callout';
    this.eng.setMood(m); this.wake = true; this.restUntil = 0;
    if (REDUCED) { this.eng.frame(m === 'callout' ? 1 : 0, 0); this.paintColor(0); this.draw(); }
  }
  themeChanged() { this.cur = null; this.paintColor(0); this.draw(); }
  paintColor(dt) {
    const tg = this.targetColor();
    if (!this.cur || dt === 0) this.cur = tg.slice(); else { const k = Math.min(1, dt * 9); this.cur = mix(this.cur, tg, k); }
    const c = this.cur, key = this.cur.map(Math.round).join(',');
    if (key === this.paintedKey) return; this.paintedKey = key;
    const s = this.P.satStops;
    s[0].setAttribute('stop-color', rgb(mix(c, WHITE, .55))); s[1].setAttribute('stop-color', rgb(c)); s[2].setAttribute('stop-color', rgb(mix(c, BLACK, .3)));
    this.P.glowStops.forEach((st) => st.setAttribute('stop-color', rgb(mix(c, WHITE, .4))));
    this.P.rings.forEach((r) => r.setAttribute('stroke', rgb(c)));
    const ink = lum(c) > .7 ? '#111113' : '#ffffff'; this.P.eyesG.setAttribute('stroke', ink);
    if (this.disc) this.disc.style.backgroundColor = rgba(ALERT.has(this.mood) ? hex2rgb(THEME.alert) : this.baseColor(), THEME.dark ? .2 : .16);
  }
  tick(T) {
    if (REDUCED || !this.el.isConnected) return;
    if (this.start < 0) this.start = T;
    const t = T - this.start;
    if (!this.wake) {
      if (t < this.restUntil) return;
      if (this.fps && this.last > 0 && t - this.last < 1 / this.fps - .008) return;
    }
    this.wake = false;
    let touch = null;
    if (this.o.watch && T - PTR.t < 1.2) { const r = this.box.getBoundingClientRect(); if (r.width > 0) touch = { x: (PTR.x - r.left) * 120 / r.width, y: (PTR.y - r.top) * 120 / r.height }; }
    this.eng.touch = touch;
    const dt = this.last === 0 ? 0 : Math.min(1 / 15, t - this.last);
    this.eng.frame(t, dt); this.last = Math.max(t, 1e-4);
    this.paintColor(dt || 1 / 60); this.draw();
    const rest = this.eng.restFor(); this.restUntil = rest > .05 ? t + rest : 0;
  }
  draw() {
    const e = this.eng, P = this.P, set = (el, o) => { for (const k in o) el.setAttribute(k, o[k]); };
    const rx = Math.max(0, e.mrx.v), ry = Math.max(0, e.mry.v), cx = e.mcx.v, cy = e.mcy.v;
    let d = shapePath(this.shape, cx, cy, rx, ry);
    for (const dr of e.drops) { const r = Math.max(0, dr.r.v); if (r > .05) d += circ(dr.cx.v, dr.cy.v, r); }
    P.body.setAttribute('d', d);
    P.lift.setAttribute('transform', `translate(0 ${f(-e.lift)})`);
    const r = Math.max(1, rx, ry), lx = cx - rx * (.24 + .2 * e.turn), ly = cy - ry * (.44 + .1 * e.tilt);
    set(P.sat, { cx: f(lx), cy: f(ly), r: f(r * 1.9) }); set(P.edge, { cx: f(lx), cy: f(ly), r: f(r * 1.62) });
    set(P.glow, { cx: f(cx), cy: f(cy + ry * .68), rx: f(rx * .8), ry: f(rx * .4) });
    set(P.sheen, { cx: f(cx - rx * (.08 + .16 * e.turn)), cy: f(cy - ry * (.52 + .06 * e.tilt)), rx: f(rx * .64), ry: f(rx * .64 * .56) });
    const k = -e.lean.v / 59; P.lean.setAttribute('transform', Math.abs(k) < 1e-4 ? '' : `matrix(1 0 ${f(k)} 1 ${f(-k * 100)} 0)`);
    P.eyesG.setAttribute('transform', `translate(0 ${f(-e.lift + (EYE_DROP[this.shape] || 0))})`);
    [e.eL, e.eR].forEach((y, i) => set(P.eyes[i], { d: `M${f(y.ax.v)} ${f(y.ay.v)}Q${f(y.qx.v)} ${f(y.qy.v)} ${f(y.bx.v)} ${f(y.by.v)}`, 'stroke-width': f(Math.max(.5, y.sw.v)) }));
    if (this.shadow) set(P.sh, { cx: f(e.shCx.v), cy: 102, rx: f(Math.max(0, e.shRx.v)), ry: 3.4 });
    e.rings.forEach((rg, i) => { const el = P.rings[i]; if (rg[4] <= .01 || rg[2] <= 0) { el.setAttribute('opacity', 0); return; } set(el, { cx: f(rg[0]), cy: f(rg[1]), rx: f(rg[2]), ry: f(rg[3]), opacity: f(Math.min(1, rg[4])) }); });
    const zz = Math.max(0, Math.min(1, e.zz.v));
    [[92, 58, 9], [103, 48, 7]].forEach(([zx, zy, w], i) => {
      if (zz <= .01) { P.zz[i].setAttribute('opacity', 0); return; }
      const p = ((e.time + i) % 2.8) / 2.8, a = (p < .3 ? p / .3 : 1 - (p - .3) / .7) * zz, ox = zx + 8 * p, oy = zy + 4 - 16 * p;
      set(P.zz[i], { d: `M${f(ox)} ${f(oy - w)}L${f(ox + w)} ${f(oy - w)}L${f(ox)} ${f(oy)}L${f(ox + w)} ${f(oy)}`, opacity: f(a) });
    });
  }
}



// -- Hermes Remote's six resting poses (Hermes.kt Pose): dx, dy, scale, tilt, eyeX, eyeY ---------
export const POSES = { Round: [0, 0, 1, 0, 0, 0], Peek: [0, .39, 1.3, 0, 0, -9], Corner: [.2, .31, 1.2, 0, -5, -9], Side: [-.36, .05, 1.2, 0, 14, -2], Hang: [0, -.39, 1.26, 0, 0, 22], Lean: [0, 0, 1, -16, 0, 0] };
const POSE_ORDER = ['Round', 'Peek', 'Corner', 'Side', 'Hang', 'Lean'];
/** Remote's Persona.of(key).pose: the chat id picks it, so a bot keeps its pose. */
export function poseFor(key) {
  if (!key) return POSES.Round;
  const h = Math.floor((jhash(key) >>> 0) / 11);
  return POSES[POSE_ORDER[Math.floor(h / 7) % 6]];
}
const poseMoves = (p) => p[0] || p[1] || p[2] !== 1 || p[3];
Engine.prototype.idle = function (t, mx, my) { const p = this.poseArr || POSES.Round; this.open(mx + p[4], my - 4 + p[5], 1, { shut: this.blink(t) }); };

let started = false;
export function startBeads() {
  if (started) return; started = true;
  readTheme();
  // Light and dark follow the Mac (or This app's choice): re-read the colours and repaint every bead.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => requestAnimationFrame(() => { readTheme(); for (const b of BEADS) b.themeChanged(); }));
  const loop = (ms) => { const T = ms / 1000; for (const b of BEADS) b.tick(T); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  addEventListener('pointermove', (e) => { PTR.x = e.clientX; PTR.y = e.clientY; PTR.t = performance.now() / 1000; for (const b of BEADS) if (b.o.watch) b.wake = true; }, { passive: true });
  // The pose holds while a bead rests; a live mood springs it back to the middle (fluid spring).
  let last = 0;
  const poseLoop = (now) => {
    const dt = last ? Math.min(1 / 30, (now - last) / 1000) : 0; last = now;
    for (const b of BEADS) {
      if (!b.poseArr || !b.el.isConnected) continue;
      const want = b.mood === 'idle' && poseMoves(b.poseArr) ? 1 : 0;
      if (!b.posed) b.posed = new Sp(want, 380, 0.8);
      b.posed.to = want;
      if (Math.abs(b.posed.v - want) < 0.001 && Math.abs(b.posed.vel) < 0.001 && b.posedPainted) continue;
      const n = Math.max(1, Math.ceil(dt / (1 / 240))); for (let i = 0; i < n && dt > 0; i++) b.posed.step(dt / n);
      const k = b.posed.v, [dx, dy, sc, tilt] = b.poseArr, sz = b.o.size;
      b.box.style.transform = `translate(${dx * sz * k}px, ${dy * sz * k}px) rotate(${tilt * k}deg) scale(${1 + (sc - 1) * k})`;
      b.el.classList.toggle('posed', k > 0.001); b.posedPainted = true;
    }
    requestAnimationFrame(poseLoop);
  };
  requestAnimationFrame(poseLoop);
}

export { Sp, Engine, Bead, BEADS, crewStyle, label, shapePath, circ, hex2rgb, mix, rgb, rgba, lum, THEME, readTheme, REDUCED, ALERT, OFFLINE };

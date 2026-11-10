// Hermes One apps: small live apps that bots build for the user, ported from DeepSeek Pod's apps.
//
// Where things live:
//   Sources (bots write them):  <hermes root>/hermes-one/apps-src/<id>/   app.json, main.js, web/  (shared by Chief and every bot)
//   Published versions:         <userData>/apps/<id>/versions/<n>/       the last ten; `current` names the live one
//   The app's data:             <userData>/apps/<id>/data/               state.json, files it writes, uploads/  (survives versions)
//   Its log:                    <userData>/apps/<id>/log.txt             the last few hundred lines
//
// Each live app runs in its own worker thread, inside a fresh V8 context with no Node modules: it gets its
// state, ctx.hermes (the folders app.json lets it read, its data folder, fetch for http(s), timers, notify,
// chat) and nothing else, so a bug or a busy loop never touches the window. Screens travel to the renderer
// as JSON and are drawn with Hermes One's own parts. A localhost control endpoint (127.0.0.1, random port,
// token in a 0600 file) lets the Hermes plugin's tools publish, test-run, undo, read logs and use apps.
import { app as electronApp, BrowserWindow, Notification, protocol, shell, type IpcMain } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { Worker } from 'node:worker_threads'
import { defaultHermesHome } from './gateway'

export const APP_SCHEME = 'hermes-app'
// Before `ready` (this module loads with main.ts): app files, web pages and audio streams load over
// hermes-app://, which must bypass the window's CSP (index.html allows no frames and no https media).
// corsEnabled: a web page runs in a sandboxed frame (origin "null"), so its JavaScript modules
// (`import … from './engine.js'`) are cross-origin loads; web/ files answer them (webResponse).
// Electron allows one registerSchemesAsPrivileged call per app: add any other scheme to this list.
try {
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, bypassCSP: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])
} catch (error) {
  console.warn('[apps] could not register hermes-app://', error)
}

export const APP_ID = /^[a-z][a-z0-9-]{0,30}$/
const KEEP_VERSIONS = 10
const REQUEST_MS = 20_000
const LOAD_MS = 30_000
const IDLE_MS = 15 * 60_000
const LOG_LINES = 300
const COPY_MAX_BYTES = 50 * 1024 * 1024
const COPY_MAX_FILES = 2000
const UPLOAD_MAX_BYTES = 200 * 1024 * 1024
// What Hermes One knows how to draw and do (the guide's blocks and actions). Anything else shows as
// "needs a newer Hermes One" and comes back to the bot as a warning when it publishes.
export const BLOCKS = new Set([
  'text', 'markdown', 'section', 'card', 'row', 'stack', 'grid', 'image', 'button', 'icon_button', 'toggle',
  'slider', 'segmented', 'chips', 'field', 'progress', 'stat', 'chart', 'empty', 'divider', 'spacer', 'player',
  'web', 'code', 'badge', 'list',
])
export const ACTIONS = new Set(['act', 'open', 'back', 'play', 'audio', 'link', 'share', 'copy', 'toast', 'chat', 'confirm', 'refresh', 'pick', 'locate', 'notify'])
export const ABILITIES = new Set(['audio', 'web', 'notify', 'signin', 'photos', 'camera', 'files', 'location', 'screensaver', 'widget', 'agents'])
const NOT_HERE: Record<string, string> = {
  screensaver: 'Hermes One has no screen saver yet; the "screensaver" screen is kept for later.',
  widget: 'Hermes One has no widgets yet; the "widget" screen is kept for later.',
}
const SKIP = new Set(['node_modules', '.git', 'data', '.DS_Store'])
const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.pdf': 'application/pdf',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
}

export interface Manifest { id: string; name: string; icon: string; color: string; description: string; read: string[]; abilities: string[]; background: boolean }
export interface ToolInfo { name: string; description: string; parameters: Record<string, unknown> }
interface Meta { screens: string[]; actions: string[]; tools: ToolInfo[]; callback?: boolean; bot?: string; publishedAt?: number; source?: string }
export interface AppSummary {
  id: string; name: string; icon: string; color: string; description: string; abilities: string[]; background: boolean
  version: number; versions: number[]; rev: number; tools: ToolInfo[]; screens: string[]; bot?: string; publishedAt?: number; running: boolean
}
export type AppsEvent =
  | { kind: 'list' }
  | { kind: 'changed'; app: string; rev: number }
  | { kind: 'effect'; app: string; action: unknown }
  | { kind: 'chat'; app: string; name: string; bot: string; text: string }
  | { kind: 'open'; app: string }
  | { kind: 'published'; app: string; name: string; version: number; bot?: string }
export interface Note { title?: string; text?: string; at?: number; id?: string; cancel?: boolean }

type Coded = Error & { code?: string }
const fail = (message: string, code = 'apps/invalid'): Coded => Object.assign(new Error(message), { code })
const home = () => os.homedir()
const expand = (p: string) => (p === '~' ? home() : p.startsWith('~/') ? path.join(home(), p.slice(2)) : p)
const real = (p: string) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }
const inside = (p: string, root: string) => { const rel = path.relative(root, p); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) }
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'))
const b64url = (text: string) => Buffer.from(text).toString('base64url')
const clock = () => new Date().toTimeString().slice(0, 8)

/** The Hermes root (the default profile's home); app sources live in <root>/hermes-one/apps-src. */
export function hermesRoot(): string {
  const env = process.env.HERMES_HOME?.trim()
  const dir = env ? path.resolve(expand(env)) : defaultHermesHome()
  return path.basename(path.dirname(dir)) === 'profiles' ? path.dirname(path.dirname(dir)) : dir
}
export const defaultSourceRoot = () => process.env.HERMES_ONE_APPS_SRC?.trim() || path.join(hermesRoot(), 'hermes-one', 'apps-src')

/** Check an app.json; returns the clean manifest or throws with what's wrong. */
export function checkManifest(id: string, raw: any): Manifest {
  if (!APP_ID.test(id)) throw fail(`"${id}" can't be an app id: use lowercase letters, digits and dashes, starting with a letter (like "music" or "habit-tracker").`)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw fail('app.json must be a JSON object.')
  const name = String(raw.name ?? '').trim()
  if (name === '' || name.length > 40) throw fail('app.json needs a "name" of 1 to 40 characters.')
  const list = (value: unknown) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]).map(String)
  return {
    id,
    name,
    icon: String(raw.icon ?? 'spark').slice(0, 24),
    color: String(raw.color ?? 'blue').slice(0, 16),
    description: String(raw.description ?? '').slice(0, 200),
    read: list(raw.read).slice(0, 10),
    abilities: list(raw.abilities).filter(Boolean).slice(0, 10),
    background: raw.background === true,
  }
}

/** Walk a screen and list what Hermes One won't understand. Throws when it isn't a screen at all. */
export function checkScreen(screen: any, where = 'home'): string[] {
  if (typeof screen !== 'object' || screen === null || Array.isArray(screen)) throw fail(`Screen "${where}" must return an object like { title, body: [...] }.`)
  if (!Array.isArray(screen.body)) throw fail(`Screen "${where}" must have a body array.`)
  const warnings: string[] = []
  const checkAction = (action: any, at: string) => {
    if (action === undefined || action === null) return
    if (Array.isArray(action)) { action.forEach((a, i) => checkAction(a, `${at}[${i}]`)); return }
    if (typeof action !== 'object' || !ACTIONS.has(action.do)) warnings.push(`${at}: unknown action ${JSON.stringify(action?.do ?? action)}`)
    if (action?.do === 'confirm') checkAction(action.then, `${at}.then`)
  }
  // A list's items are rows unless they say otherwise.
  const walk = (blocks: any, at: string, kind?: string) => {
    if (!Array.isArray(blocks)) { warnings.push(`${at} should be a list of blocks`); return }
    blocks.forEach((block, index) => {
      const here = `${at}[${index}]`
      if (block === null || block === false || block === undefined) return
      if (typeof block !== 'object') { warnings.push(`${here} is not a block`); return }
      const type = block.type ?? kind
      if (!BLOCKS.has(type)) warnings.push(`${here}: unknown block type ${JSON.stringify(type)}`)
      for (const key of ['action', 'hold']) checkAction(block[key], `${here}.${key}`)
      if (block.toggle) checkAction(block.toggle.action, `${here}.toggle.action`)
      for (const item of Array.isArray(block.menu) ? block.menu : []) checkAction(item?.action, `${here}.menu`)
      if (block.children !== undefined) walk(block.children, `${here}.children`)
      if (block.items !== undefined) walk(block.items, `${here}.items`, 'row')
    })
  }
  for (const item of Array.isArray(screen.actions) ? screen.actions : []) checkAction(item?.action, `${where}.actions`)
  walk(screen.body, `${where}.body`)
  return warnings
}

function copyApp(from: string, to: string) {
  let files = 0
  let bytes = 0
  const count = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) count(p)
      else if (entry.isFile()) { files += 1; bytes += fs.statSync(p).size }
    }
  }
  count(from)
  if (files > COPY_MAX_FILES) throw fail(`The app has ${files} files; keep it under ${COPY_MAX_FILES}.`)
  if (bytes > COPY_MAX_BYTES) throw fail(`The app is ${Math.round(bytes / 1048576)} MB; keep it under ${COPY_MAX_BYTES / 1048576} MB. Big media belongs in the data folder or a folder the app reads.`)
  fs.cpSync(from, to, { recursive: true, filter: (source) => !SKIP.has(path.basename(source)) })
}

// ---------------------------------------------------------------------------------------------------
// The worker: one app, in its own thread and its own V8 context. Kept as source text so the main
// bundle stays one file (esbuild builds only main.ts and preload.ts). No backticks or dollar-braces
// inside it: it is a String.raw template.
// ---------------------------------------------------------------------------------------------------
export const WORKER_SOURCE = String.raw`'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const P = require('node:path');
const nodeCrypto = require('node:crypto');

const W = workerData;
const LIST_MAX = 5000;
const FETCH_MAX = 20 * 1024 * 1024;
const FETCH_MS = 30000;
const STATE_FILE = P.join(W.dataDir, 'state.json');

function send(m) { try { parentPort.postMessage(m) } catch (e) { /* the host is gone */ } }
// Stacks keep the app's own frames, with paths relative to its folder ("main.js:12:5").
function describe(e) {
  try {
    const text = e && e.stack ? String(e.stack) : String(e && e.message ? e.message : e);
    return text.split('\n').filter(function (line) { return !/^\s+at .*(\[worker eval\]|node:|nodejs\.internal|hermes-app-runtime\.js)/.test(line) }).join('\n').split(W.appDir + P.sep).join('').split(appRealPrefix()).join('');
  } catch (x) { return 'error' }
}
function appRealPrefix() { try { return fs.realpathSync(W.appDir) + P.sep } catch (e) { return W.appDir + P.sep } }
function message(e) { try { return e && e.message ? String(e.message) : String(e) } catch (x) { return 'error' } }
function log(level, text) { send({ type: 'log', level: String(level), text: String(text).slice(0, 4000) }) }
process.on('uncaughtException', function (e) { log('error', 'uncaught: ' + describe(e)) });
process.on('unhandledRejection', function (e) { log('error', 'unhandled: ' + describe(e)) });

// ---- Paths: what the app may read (its files, its data, app.json's "read") and write (its data).
function real(p) {
  let cur = P.resolve(p); const rest = [];
  for (;;) {
    try { const r = fs.realpathSync(cur); return rest.length ? P.join(r, ...rest.reverse()) : r } catch (e) {
      const up = P.dirname(cur); if (up === cur) return P.resolve(p); rest.push(P.basename(cur)); cur = up;
    }
  }
}
const appReal = real(W.appDir);
const dataReal = real(W.dataDir);
const reads = W.reads.map(real);
function expand(p) { const t = String(p == null ? '' : p); return t === '~' ? W.home : t.startsWith('~/') ? P.join(W.home, t.slice(2)) : t }
function place(p) { const f = expand(p); return P.isAbsolute(f) ? P.resolve(f) : P.resolve(W.dataDir, f) }
function inside(p, root) { const r = P.relative(root, p); return r === '' || (r !== '..' && !r.startsWith('..' + P.sep) && !P.isAbsolute(r)) }
function readable(p) { const f = real(place(p)); if (!reads.some(function (root) { return inside(f, root) })) throw new Error('This app may not read ' + p + ' (add its folder to "read" in app.json).'); return f }
function writable(p) { const f = real(place(p)); if (!inside(f, dataReal)) throw new Error('Apps can write only inside their data folder; ' + p + ' is outside it.'); return f }

function wantedExts(exts) { return Array.isArray(exts) && exts.length ? new Set(exts.map(function (x) { x = String(x); return (x.startsWith('.') ? x : '.' + x).toLowerCase() })) : null }
function entry(root, folder, name, stat) { return { path: P.join(folder, name), name: P.basename(name, P.extname(name)), file: name, folder: P.relative(root, folder) || '', ext: P.extname(name).toLowerCase(), size: stat.size, modified: stat.mtimeMs } }
function listFiles(dir, opts) {
  const root = readable(dir); const deep = !!(opts && opts.deep); const wanted = wantedExts(opts && opts.exts); const found = [];
  const walk = function (folder, depth) {
    let names; try { names = fs.readdirSync(folder, { withFileTypes: true }) } catch (e) { return }
    for (const d of names) {
      if (found.length >= LIST_MAX) return;
      if (d.name.startsWith('.')) continue;
      const p = P.join(folder, d.name);
      if (d.isDirectory()) { if (deep && depth < 8) walk(p, depth + 1); continue }
      if (wanted && !wanted.has(P.extname(d.name).toLowerCase())) continue;
      let st; try { st = fs.statSync(p) } catch (e) { continue }
      found.push(entry(root, folder, d.name, st));
    }
  };
  walk(root, 0); return found;
}
async function scanFiles(dir, opts) {
  const root = readable(dir); const deep = !!(opts && opts.deep); const wanted = wantedExts(opts && opts.exts); const found = [];
  const walk = async function (folder, depth) {
    let names; try { names = await fsp.readdir(folder, { withFileTypes: true }) } catch (e) { return }
    for (const d of names) {
      if (found.length >= LIST_MAX) return;
      if (d.name.startsWith('.')) continue;
      const p = P.join(folder, d.name);
      if (d.isDirectory()) { if (deep && depth < 8) await walk(p, depth + 1); continue }
      if (wanted && !wanted.has(P.extname(d.name).toLowerCase())) continue;
      let st; try { st = await fsp.stat(p) } catch (e) { continue }
      found.push(entry(root, folder, d.name, st));
    }
  };
  await walk(root, 0); return found;
}
// A link Hermes One loads the file from: the path, signed with this app's secret. The main process checks
// the signature and that the path is one this app may read.
function fileUrl(p) {
  const full = place(p);
  const sig = nodeCrypto.createHmac('sha256', W.secret).update(W.appId + '\nfile\n' + full).digest('base64url').slice(0, 22);
  return W.scheme + '://' + W.appId + '/file/' + Buffer.from(full).toString('base64url') + '.' + sig + P.extname(full).toLowerCase();
}

async function doFetch(a) {
  let u; try { u = new URL(String(a.url)) } catch (e) { throw new Error('fetch needs a full http(s) address; got ' + a.url) }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('fetch works for http and https addresses only.');
  const ctl = new AbortController(); const timer = setTimeout(function () { ctl.abort() }, FETCH_MS);
  try {
    const method = String(a.method || 'GET').toUpperCase();
    const init = { method: method, headers: a.headers || {}, redirect: a.redirect === 'manual' ? 'manual' : 'follow', signal: ctl.signal };
    if (a.body != null && method !== 'GET' && method !== 'HEAD') init.body = a.bodyKind === 'base64' ? Buffer.from(String(a.body), 'base64') : String(a.body);
    let r;
    try { r = await fetch(u, init) } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('fetch gave up after 30 s waiting for ' + u.host);
      throw new Error('fetch failed for ' + u.host + ': ' + message(e && e.cause ? e.cause : e));
    }
    const chunks = []; let size = 0;
    if (r.body && method !== 'HEAD') {
      const reader = r.body.getReader();
      for (;;) {
        let step;
        try { step = await reader.read() } catch (e) { throw new Error(e && e.name === 'AbortError' ? 'fetch gave up after 30 s reading ' + u.host : 'fetch broke off reading ' + u.host + ': ' + message(e)) }
        if (step.done) break;
        size += step.value.length;
        if (size > FETCH_MAX) { ctl.abort(); throw new Error('The answer from ' + u.host + ' is over 20 MB; fetch reads at most 20 MB.') }
        chunks.push(step.value);
      }
    }
    const buf = Buffer.concat(chunks);
    const type = r.headers.get('content-type') || '';
    const textual = /^text\/|json|xml|javascript|x-www-form-urlencoded|svg|csv|yaml|mpegurl|scpls|x-pls/i.test(type);
    return { status: r.status, statusText: r.statusText, url: r.url, redirected: r.redirected, headers: Array.from(r.headers.entries()), text: textual ? buf.toString('utf8') : null, base64: textual ? null : buf.toString('base64') };
  } finally { clearTimeout(timer) }
}

// ---- What the app's context may ask of this thread: strings in, strings out, never an object of ours.
let saved = '';
let changeTimer = null;
// The agents feed (the "agents" ability): who the agents are, what each is doing, who talks to whom.
const NO_FEED = { at: 0, agents: [], groups: [], talks: [] };
let FEED = (function () { try { return W.feed ? JSON.parse(W.feed) : NO_FEED } catch (e) { return NO_FEED } })();
function persist() {
  let text; try { text = api.stateJson() } catch (e) { log('warn', 'state could not be saved: ' + message(e)); return }
  if (text === saved) return;
  saved = text;
  try { fs.writeFileSync(STATE_FILE + '.tmp', text); fs.renameSync(STATE_FILE + '.tmp', STATE_FILE) } catch (e) { log('warn', 'state could not be saved: ' + message(e)) }
}
function changed() {
  persist();
  if (changeTimer) return;
  changeTimer = setTimeout(function () { changeTimer = null; send({ type: 'changed' }) }, 50);
}
const SYNC = {
  log: function (a) { log(a.level, a.text) },
  changed: function () { changed() },
  chat: function (a) { send({ type: 'chat', bot: String(a.bot || ''), text: String(a.text || '').slice(0, 20000) }) },
  agents: function () { if (!W.agents) throw new Error('Add "agents" to "abilities" in app.json to see the agents.'); return FEED },
  perform: function (a) { send({ type: 'perform', action: a }) },
  notify: function (a) { send({ type: 'notify', note: a || {} }) },
  list: function (a) { return listFiles(a.dir, a.opts || {}) },
  read: function (a) { const f = readable(a.path); return a.encoding === 'base64' ? fs.readFileSync(f).toString('base64') : fs.readFileSync(f, 'utf8') },
  write: function (a) { const f = writable(a.name); fs.mkdirSync(P.dirname(f), { recursive: true }); fs.writeFileSync(f, a.kind === 'base64' ? Buffer.from(String(a.data), 'base64') : String(a.data)); return f },
  exists: function (a) { try { fs.statSync(readable(a.path)); return true } catch (e) { return false } },
  url: function (a) { return fileUrl(a.path) },
  uuid: function () { return nodeCrypto.randomUUID() },
  random: function (a) { return Array.from(nodeCrypto.randomBytes(Math.max(0, Math.min(65536, Number(a.n) | 0)))) },
  hash: function (a) {
    const data = a.kind === 'base64' ? Buffer.from(String(a.data), 'base64') : Buffer.from(String(a.data), 'utf8');
    const alg = String(a.alg || 'sha256').toLowerCase();
    const h = a.key != null ? nodeCrypto.createHmac(alg, a.keyKind === 'base64' ? Buffer.from(String(a.key), 'base64') : String(a.key)) : nodeCrypto.createHash(alg);
    h.update(data);
    return h.digest(a.enc === 'hex' ? 'hex' : a.enc === 'base64url' ? 'base64url' : 'base64');
  }
};
const LATER = {
  scan: function (a) { return scanFiles(a.dir, a.opts || {}) },
  fetch: doFetch
};
const timers = new Map();
let nextTimer = 1;
const sys = {
  call: function (name, json) {
    try {
      const f = SYNC[name]; if (!f) throw new Error('Unknown call ' + name);
      const v = f(JSON.parse(json));
      return JSON.stringify({ ok: true, value: v === undefined ? null : v });
    } catch (e) { return JSON.stringify({ ok: false, error: message(e) }) }
  },
  callAsync: function (name, json, cb) {
    let arg = null; try { arg = JSON.parse(json) } catch (e) { /* null */ }
    Promise.resolve().then(function () { const f = LATER[name]; if (!f) throw new Error('Unknown call ' + name); return f(arg) }).then(
      function (v) { reply(cb, { ok: true, value: v === undefined ? null : v }) },
      function (e) { reply(cb, { ok: false, error: message(e) }) });
  },
  timer: function (ms, repeat, cb) {
    const id = nextTimer++;
    const wait = Math.max(0, Math.min(2147483647, Number(ms) || 0));
    const run = function () { if (!repeat) timers.delete(id); try { cb() } catch (e) { log('error', 'timer: ' + describe(e)) } };
    timers.set(id, repeat ? setInterval(run, Math.max(wait, 10)) : setTimeout(run, wait));
    return id;
  },
  clear: function (id) { const t = timers.get(id); if (t) { clearTimeout(t); clearInterval(t); timers.delete(id) } }
};
function reply(cb, value) { try { cb(JSON.stringify(value)) } catch (e) { log('error', describe(e)) } }

// ---- Inside the app's context: the web platform bits apps expect, made of the context's own objects.
function prelude(sys, infoJson) {
  'use strict';
  const info = JSON.parse(infoJson);
  const G = globalThis;
  const sysCall = sys.call, sysLater = sys.callAsync, sysTimer = sys.timer, sysClear = sys.clear;
  const call = (name, arg) => { const r = JSON.parse(sysCall(name, JSON.stringify(arg === undefined ? null : arg))); if (!r.ok) throw new Error(r.error); return r.value };
  const later = (name, arg) => new Promise((resolve, reject) => { sysLater(name, JSON.stringify(arg === undefined ? null : arg), (text) => { const r = JSON.parse(text); if (r.ok) resolve(r.value); else reject(new Error(r.error)) }) });
  const def = (name, value) => { Object.defineProperty(G, name, { value, writable: true, configurable: true, enumerable: false }) };

  const fmt = (v) => { if (typeof v === 'string') return v; if (v === undefined) return 'undefined'; if (v instanceof Error) return v.stack || String(v); try { const t = JSON.stringify(v); return t === undefined ? String(v) : t } catch (e) { return String(v) } };
  const say = (level) => (...parts) => { try { call('log', { level, text: parts.map(fmt).join(' ') }) } catch (e) { /* never break the app over a log line */ } };
  def('console', { log: say('log'), info: say('info'), warn: say('warn'), error: say('error'), debug: say('log'), trace: say('log') });
  def('setTimeout', (fn, ms, ...args) => sysTimer(Number(ms) || 0, false, () => fn(...args)));
  def('setInterval', (fn, ms, ...args) => sysTimer(Number(ms) || 0, true, () => fn(...args)));
  def('clearTimeout', (id) => { if (id != null) sysClear(Number(id)) });
  def('clearInterval', (id) => { if (id != null) sysClear(Number(id)) });
  def('queueMicrotask', (fn) => { Promise.resolve().then(fn) });
  const T0 = Date.now();
  def('performance', { now: () => Date.now() - T0, timeOrigin: T0 });

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const LOOK = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) LOOK[B64.charCodeAt(i)] = i;
  LOOK[45] = 62; LOOK[95] = 63;
  const toB64 = (b) => {
    let s = ''; let i = 0;
    for (; i + 2 < b.length; i += 3) { const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2]; s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63] }
    const rest = b.length - i;
    if (rest === 1) { const n = b[i] << 16; s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + '==' }
    else if (rest === 2) { const n = (b[i] << 16) | (b[i + 1] << 8); s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + '=' }
    return s;
  };
  const fromB64 = (text) => {
    const t = String(text); const out = new Uint8Array(Math.ceil(t.length * 3 / 4)); let buf = 0, bits = 0, j = 0;
    for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); const v = c < 128 ? LOOK[c] : -1; if (v < 0) continue; buf = ((buf << 6) | v) & 0xffffff; bits += 6; if (bits >= 8) { bits -= 8; out[j++] = (buf >> bits) & 255 } }
    return out.subarray(0, j);
  };
  const urlB64 = (b) => toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const utf8 = (str) => {
    const out = [];
    for (const ch of String(str)) { const c = ch.codePointAt(0); if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63); else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63); else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63) }
    return new Uint8Array(out);
  };
  const unutf8 = (b) => {
    let s = '';
    for (let i = 0; i < b.length;) {
      const x = b[i++]; let c;
      if (x < 0x80) c = x;
      else if (x >= 0xf0) c = (x & 7) << 18 | (b[i++] & 63) << 12 | (b[i++] & 63) << 6 | (b[i++] & 63);
      else if (x >= 0xe0) c = (x & 15) << 12 | (b[i++] & 63) << 6 | (b[i++] & 63);
      else if (x >= 0xc0) c = (x & 31) << 6 | (b[i++] & 63);
      else c = 0xfffd;
      s += String.fromCodePoint(c > 0x10ffff ? 0xfffd : c);
    }
    return s;
  };
  const bytesOf = (d) => d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : null;
  const hex = (b) => Array.from(b, (x) => (x < 16 ? '0' : '') + x.toString(16)).join('');
  const unhex = (t) => { const s = String(t); const out = new Uint8Array(s.length >> 1); for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16); return out };
  class TextEncoder { get encoding() { return 'utf-8' } encode(s = '') { return utf8(s) } }
  class TextDecoder { get encoding() { return 'utf-8' } decode(b) { const x = b == null ? null : bytesOf(b); return x ? unutf8(x) : '' } }
  def('TextEncoder', TextEncoder);
  def('TextDecoder', TextDecoder);
  def('btoa', (s) => { const t = String(s); const b = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); if (c > 255) throw new Error('btoa: the text has characters outside Latin-1'); b[i] = c } return toB64(b) });
  def('atob', (s) => { const b = fromB64(s); let out = ''; for (let i = 0; i < b.length; i++) out += String.fromCharCode(b[i]); return out });

  const enc = (s) => encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const dec = (s) => { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')) } catch (e) { return String(s) } };
  class URLSearchParams {
    constructor(init) {
      this._l = []; this._u = null;
      if (init == null) return;
      if (typeof init === 'string') this._parse(init);
      else if (init instanceof URLSearchParams) this._l = init._l.map((p) => [p[0], p[1]]);
      else if (typeof init[Symbol.iterator] === 'function') for (const p of init) this._l.push([String(p[0]), String(p[1])]);
      else if (typeof init === 'object') for (const k of Object.keys(init)) this._l.push([k, String(init[k])]);
    }
    _parse(s) { this._l = []; const t = s.charAt(0) === '?' ? s.slice(1) : s; for (const part of t.split('&')) { if (!part) continue; const i = part.indexOf('='); this._l.push(i < 0 ? [dec(part), ''] : [dec(part.slice(0, i)), dec(part.slice(i + 1))]) } }
    _touch() { if (this._u) this._u._search = this._l.length ? '?' + this.toString() : '' }
    get size() { return this._l.length }
    append(k, v) { this._l.push([String(k), String(v)]); this._touch() }
    set(k, v) { k = String(k); const i = this._l.findIndex((p) => p[0] === k); if (i < 0) this._l.push([k, String(v)]); else { this._l[i][1] = String(v); this._l = this._l.filter((p, j) => j <= i || p[0] !== k) } this._touch() }
    get(k) { const p = this._l.find((q) => q[0] === String(k)); return p ? p[1] : null }
    getAll(k) { return this._l.filter((p) => p[0] === String(k)).map((p) => p[1]) }
    has(k) { return this._l.some((p) => p[0] === String(k)) }
    delete(k) { this._l = this._l.filter((p) => p[0] !== String(k)); this._touch() }
    sort() { this._l.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); this._touch() }
    forEach(fn, self) { for (const p of this._l) fn.call(self, p[1], p[0], this) }
    keys() { return this._l.map((p) => p[0])[Symbol.iterator]() }
    values() { return this._l.map((p) => p[1])[Symbol.iterator]() }
    entries() { return this._l.map((p) => [p[0], p[1]])[Symbol.iterator]() }
    [Symbol.iterator]() { return this.entries() }
    toString() { return this._l.map((p) => enc(p[0]) + '=' + enc(p[1])).join('&') }
  }
  const URL_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*:)(?:\/\/(?:([^:@\/?#]*)(?::([^@\/?#]*))?@)?(\[[^\]]*\]|[^:\/?#]*)(?::(\d*))?)?([^?#]*)(\?[^#]*)?(#[\s\S]*)?$/;
  const PORTS = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443', 'ftp:': '21' };
  const normPath = (p) => { const out = []; const segs = p.split('/'); segs.forEach((s, i) => { if (s === '..') { if (out.length > 1) out.pop(); if (i === segs.length - 1) out.push('') } else if (s === '.') { if (i === segs.length - 1) out.push('') } else out.push(s) }); const r = out.join('/'); return r.startsWith('/') ? r : '/' + r };
  class URL {
    constructor(input, base) {
      let s = String(input).trim(); let m = URL_RE.exec(s);
      if (!m || (m[4] === undefined && m[1].toLowerCase() in PORTS)) {
        if (base === undefined) throw new TypeError('Invalid URL: ' + s);
        const b = base instanceof URL ? base : new URL(base);
        if (s.startsWith('//')) s = b.protocol + s;
        else if (s.startsWith('/')) s = b.origin + s;
        else if (s.startsWith('?')) s = b.origin + b.pathname + s;
        else if (s.startsWith('#')) s = b.origin + b.pathname + b.search + s;
        else s = b.origin + b.pathname.replace(/[^/]*$/, '') + s;
        m = URL_RE.exec(s);
        if (!m) throw new TypeError('Invalid URL: ' + input);
      }
      this._protocol = m[1].toLowerCase(); this._username = m[2] || ''; this._password = m[3] || '';
      this._hostname = (m[4] || '').toLowerCase(); this._port = m[5] || '';
      if (PORTS[this._protocol] === this._port) this._port = '';
      const special = this._protocol in PORTS || this._protocol === 'file:';
      this._pathname = m[6] ? (special ? normPath(m[6]) : m[6]) : (special ? '/' : '');
      this._search = m[7] && m[7] !== '?' ? m[7] : ''; this._hash = m[8] && m[8] !== '#' ? m[8] : '';
      this._sp = new URLSearchParams(this._search); this._sp._u = this;
    }
    get protocol() { return this._protocol } set protocol(v) { const t = String(v).toLowerCase(); this._protocol = t.endsWith(':') ? t : t + ':' }
    get username() { return this._username } set username(v) { this._username = String(v) }
    get password() { return this._password } set password(v) { this._password = String(v) }
    get hostname() { return this._hostname } set hostname(v) { this._hostname = String(v).toLowerCase() }
    get port() { return this._port } set port(v) { const t = String(v); this._port = PORTS[this._protocol] === t ? '' : t }
    get host() { return this._hostname + (this._port ? ':' + this._port : '') } set host(v) { const i = String(v).lastIndexOf(':'); if (i > 0 && /^\d+$/.test(String(v).slice(i + 1))) { this.hostname = String(v).slice(0, i); this.port = String(v).slice(i + 1) } else this.hostname = String(v) }
    get pathname() { return this._pathname } set pathname(v) { const t = String(v); this._pathname = normPath(t.startsWith('/') ? t : '/' + t) }
    get search() { return this._search } set search(v) { const t = String(v); this._search = t && t !== '?' ? (t[0] === '?' ? t : '?' + t) : ''; this._sp._parse(this._search) }
    get hash() { return this._hash } set hash(v) { const t = String(v); this._hash = t && t !== '#' ? (t[0] === '#' ? t : '#' + t) : '' }
    get searchParams() { return this._sp }
    get origin() { return this._protocol in PORTS ? this._protocol + '//' + this.host : 'null' }
    get href() { const auth = this._username ? this._username + (this._password ? ':' + this._password : '') + '@' : ''; const slashes = this._hostname || this._protocol in PORTS || this._protocol === 'file:' ? '//' : ''; return this._protocol + slashes + auth + this.host + this._pathname + this._search + this._hash }
    set href(v) { const u = new URL(v); for (const k of ['_protocol', '_username', '_password', '_hostname', '_port', '_pathname', '_hash']) this[k] = u[k]; this.search = u._search }
    toString() { return this.href }
    toJSON() { return this.href }
    static canParse(i, b) { try { new URL(i, b); return true } catch (e) { return false } }
  }
  class Headers {
    constructor(init) {
      this._m = new Map();
      if (init == null) return;
      if (init instanceof Headers) init.forEach((v, k) => this.append(k, v));
      else if (typeof init[Symbol.iterator] === 'function') for (const p of init) this.append(p[0], p[1]);
      else for (const k of Object.keys(init)) this.append(k, init[k]);
    }
    append(k, v) { k = String(k).toLowerCase(); const old = this._m.get(k); this._m.set(k, old === undefined ? String(v) : old + ', ' + v) }
    set(k, v) { this._m.set(String(k).toLowerCase(), String(v)) }
    get(k) { const v = this._m.get(String(k).toLowerCase()); return v === undefined ? null : v }
    has(k) { return this._m.has(String(k).toLowerCase()) }
    delete(k) { this._m.delete(String(k).toLowerCase()) }
    forEach(fn, self) { for (const [k, v] of this._m) fn.call(self, v, k, this) }
    keys() { return this._m.keys() }
    values() { return this._m.values() }
    entries() { return this._m.entries() }
    [Symbol.iterator]() { return this._m.entries() }
  }
  class Response {
    constructor(body, init) {
      init = init || {};
      this._text = typeof body === 'string' ? body : body == null ? '' : String(body); this._bytes = null;
      this.status = init.status === undefined ? 200 : init.status; this.statusText = init.statusText || '';
      this.headers = new Headers(init.headers); this.url = init.url || ''; this.redirected = !!init.redirected; this.type = 'basic'; this.bodyUsed = false;
    }
    get ok() { return this.status >= 200 && this.status < 300 }
    async text() { this.bodyUsed = true; return this._text !== null ? this._text : unutf8(this._bytes) }
    async json() { return JSON.parse(await this.text()) }
    async bytes() { this.bodyUsed = true; return this._bytes !== null ? this._bytes : utf8(this._text) }
    async arrayBuffer() { const b = await this.bytes(); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
    async blob() { throw new Error('Response.blob() is not available in apps; use arrayBuffer(), bytes() or text().') }
    clone() { const r = new Response(null, this); r._text = this._text; r._bytes = this._bytes; return r }
  }
  class AbortSignal {
    constructor() { this.aborted = false; this.reason = undefined; this._l = []; this.onabort = null }
    addEventListener(type, fn) { if (type === 'abort') this._l.push(fn) }
    removeEventListener(type, fn) { this._l = this._l.filter((f) => f !== fn) }
    throwIfAborted() { if (this.aborted) throw this.reason }
    _fire(reason) { if (this.aborted) return; this.aborted = true; this.reason = reason === undefined ? new Error('This was aborted.') : reason; for (const f of [...this._l, this.onabort]) { if (typeof f === 'function') try { f.call(this, { type: 'abort' }) } catch (e) { /* ignore */ } } }
    static timeout(ms) { const c = new AbortController(); setTimeout(() => c.abort(new Error('Timed out after ' + ms + ' ms.')), ms); return c.signal }
    static abort(reason) { const c = new AbortController(); c.abort(reason); return c.signal }
  }
  class AbortController { constructor() { this.signal = new AbortSignal() } abort(reason) { this.signal._fire(reason) } }
  def('URLSearchParams', URLSearchParams); def('URL', URL); def('Headers', Headers); def('Response', Response);
  def('AbortController', AbortController); def('AbortSignal', AbortSignal);
  def('fetch', (input, init) => {
    init = init || {};
    let url = input, method = init.method, headers = init.headers, body = init.body;
    if (input && typeof input === 'object' && !(input instanceof URL) && input.url) { url = input.url; method = method || input.method; headers = headers || input.headers; if (body === undefined) body = input.body }
    const h = {}; new Headers(headers).forEach((v, k) => { h[k] = v });
    let out = null, kind = 'text';
    if (body != null) {
      const b = typeof body === 'string' ? null : bytesOf(body);
      if (typeof body === 'string') out = body;
      else if (body instanceof URLSearchParams) { out = body.toString(); if (!h['content-type']) h['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8' }
      else if (b) { out = toB64(b); kind = 'base64' }
      else out = String(body);
    }
    const signal = init.signal;
    if (signal && signal.aborted) return Promise.reject(signal.reason);
    const work = later('fetch', { url: String(url && url.href ? url.href : url), method: String(method || 'GET').toUpperCase(), headers: h, body: out, bodyKind: kind, redirect: init.redirect }).then((r) => {
      const res = new Response(r.text === null ? null : r.text, { status: r.status, statusText: r.statusText, headers: r.headers, url: r.url, redirected: r.redirected });
      if (r.text === null) { res._text = null; res._bytes = fromB64(r.base64 || '') }
      return res;
    });
    if (!signal || typeof signal.addEventListener !== 'function') return work;
    return new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason)); work.then(resolve, reject) });
  });
  def('structuredClone', (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v))));
  const random = (n) => Uint8Array.from(call('random', { n }));
  def('crypto', {
    randomUUID: () => call('uuid'),
    getRandomValues: (arr) => { const view = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); view.set(random(arr.byteLength)); return arr }
  });

  // ---- node:path and node:crypto, the two Node modules apps may import.
  const bytesObj = (b) => ({ length: b.length, bytes: b, toString: (e) => (e === 'hex' ? hex(b) : e === 'base64' ? toB64(b) : e === 'base64url' ? urlB64(b) : unutf8(b)) });
  const hashMaker = (alg, key) => {
    const parts = [];
    const h = {
      update(d, e) { parts.push(typeof d === 'string' ? (e === 'base64' ? fromB64(d) : e === 'hex' ? unhex(d) : utf8(d)) : bytesOf(d) || (d && d.bytes instanceof Uint8Array ? d.bytes : utf8(String(d)))); return h },
      digest(e) {
        let n = 0; for (const p of parts) n += p.length; const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length }
        const kb = key == null || typeof key === 'string' ? null : bytesOf(key) || (key.bytes instanceof Uint8Array ? key.bytes : null);
        const outEnc = e === 'hex' || e === 'base64' || e === 'base64url' ? e : 'base64';
        const out = call('hash', { alg: String(alg), data: toB64(all), kind: 'base64', key: key == null ? null : kb ? toB64(kb) : String(key), keyKind: kb ? 'base64' : 'text', enc: outEnc });
        return outEnc === e ? out : bytesObj(fromB64(out));
      }
    };
    return h;
  };
  const cryptoShim = {
    randomUUID: () => call('uuid'),
    randomBytes: (n) => bytesObj(random(Number(n) || 0)),
    randomInt: (a, b) => { const lo = b === undefined ? 0 : a, hi = b === undefined ? a : b; const r = random(4); return lo + ((r[0] << 24 >>> 0) + (r[1] << 16) + (r[2] << 8) + r[3]) % (hi - lo) },
    createHash: (alg) => hashMaker(alg),
    createHmac: (alg, key) => hashMaker(alg, key),
    getRandomValues: G.crypto.getRandomValues,
    webcrypto: G.crypto
  };
  cryptoShim.default = cryptoShim;
  const norm = (p) => { const abs = p.startsWith('/'); const out = []; for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs) out.push('..') } else out.push(s) } const r = (abs ? '/' : '') + out.join('/'); return r || (abs ? '/' : '.') };
  const pathShim = {
    sep: '/', delimiter: ':',
    normalize: (p) => { const t = String(p); const n = norm(t); return t.endsWith('/') && n !== '/' ? n + '/' : n },
    join: (...a) => pathShim.normalize(a.map(String).filter((x) => x !== '').join('/') || '.'),
    resolve: (...a) => { let r = ''; for (let i = a.length - 1; i >= 0 && !r.startsWith('/'); i--) { const s = String(a[i]); if (s) r = s + (r ? '/' + r : '') } if (!r.startsWith('/')) r = info.dataDir + '/' + r; return norm(r) },
    basename: (p, ext) => { let b = String(p).replace(/\/+$/, ''); b = b.slice(b.lastIndexOf('/') + 1); return ext && b.endsWith(ext) && b !== ext ? b.slice(0, -ext.length) : b },
    dirname: (p) => { const t = String(p).replace(/\/+$/, ''); const i = t.lastIndexOf('/'); return i < 0 ? '.' : i === 0 ? '/' : t.slice(0, i) },
    extname: (p) => { const b = pathShim.basename(p); const i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i) },
    isAbsolute: (p) => String(p).startsWith('/'),
    relative: (from, to) => { const f = pathShim.resolve(from).split('/').filter(Boolean); const t = pathShim.resolve(to).split('/').filter(Boolean); let i = 0; while (i < f.length && i < t.length && f[i] === t[i]) i++; return [...Array(f.length - i).fill('..'), ...t.slice(i)].join('/') },
    parse: (p) => { const base = pathShim.basename(p); const ext = pathShim.extname(p); return { root: pathShim.isAbsolute(p) ? '/' : '', dir: pathShim.dirname(p), base, ext, name: ext ? base.slice(0, -ext.length) : base } },
    format: (o) => (o.dir ? o.dir + '/' : o.root || '') + (o.base || (o.name || '') + (o.ext || ''))
  };
  pathShim.posix = pathShim; pathShim.default = pathShim;

  // ---- The app: ctx.hermes (ctx.pod for apps written for Pod), its state, screens, actions and tools.
  const files = Object.freeze({
    list: (dir, opts) => call('list', { dir: String(dir), opts: opts || {} }),
    scan: (dir, opts) => later('scan', { dir: String(dir), opts: opts || {} }),
    url: (p) => call('url', { path: String(p) }),
    read: (p, encoding) => {
      if (encoding === null || encoding === 'bytes' || encoding === 'binary' || encoding === 'buffer') return fromB64(call('read', { path: String(p), encoding: 'base64' }));
      return call('read', { path: String(p), encoding: encoding === 'base64' ? 'base64' : 'utf8' });
    },
    write: (name, data) => { const b = typeof data === 'string' || data == null ? null : bytesOf(data); return b ? call('write', { name: String(name), data: toB64(b), kind: 'base64' }) : call('write', { name: String(name), data: typeof data === 'string' ? data : JSON.stringify(data === undefined ? null : data, null, 2), kind: 'text' }) },
    exists: (p) => call('exists', { path: String(p) })
  });
  const oauth = Object.freeze({
    pkce: () => { const verifier = urlB64(random(48)); return { verifier, challenge: call('hash', { alg: 'sha256', data: verifier, kind: 'text', enc: 'base64url' }), method: 'S256' } },
    state: () => urlB64(random(18))
  });
  const hermes = Object.freeze({
    app: info.appId, home: info.home, dataDir: info.dataDir, files, oauth,
    callbackUrl: info.callbackUrl, localCallbackUrl: info.callbackUrl,
    update: () => { call('changed') },
    chat: (bot, text) => { call('chat', { bot: bot == null ? '' : String(bot), text: text == null ? '' : String(text) }) },
    agents: () => call('agents'),
    perform: (action) => { call('perform', action) },
    notify: (note) => { call('notify', note || {}) }
  });
  const pod = Object.freeze(Object.assign({}, hermes, { phone: hermes.perform }));
  let app = null;
  let state = {};
  const ctxFor = (screen, params) => ({ state, params: params || {}, screen: screen || 'home', hermes, pod });
  const adopt = (c) => { if (c.state !== state && c.state && typeof c.state === 'object') state = c.state };
  const clone = (v) => JSON.parse(JSON.stringify(v === undefined ? {} : v));
  return {
    setModule(mod) {
      const a = mod && mod.default !== undefined ? mod.default : mod;
      if (typeof a !== 'object' || a === null) throw new Error('main.js must export default an object: export default { state, screens: { home }, actions }');
      if (!a.screens || typeof a.screens.home !== 'function') throw new Error('main.js needs a home screen: screens: { home: (ctx) => ({ title, body: [...] }) }');
      app = a;
    },
    async init(storedJson) {
      const initial = typeof app.state === 'function' ? await app.state() : clone(app.state || {});
      let stored = {}; try { stored = storedJson ? JSON.parse(storedJson) : {} } catch (e) { console.warn('state.json could not be read; starting fresh') }
      state = Object.assign({}, initial, stored && typeof stored === 'object' ? stored : {});
      if (typeof app.start === 'function') { try { await app.start(ctxFor('home', {})) } catch (e) { console.error('start failed:', e) } }
      const tools = Object.keys(app.tools || {}).map((name) => { const t = app.tools[name] || {}; return { name, description: String(t.description || ''), parameters: t.parameters || {} } });
      return JSON.stringify({ screens: Object.keys(app.screens), actions: Object.keys(app.actions || {}), tools, callback: typeof app.callback === 'function' });
    },
    async render(screen, paramsJson) {
      const draw = app.screens[screen];
      if (typeof draw !== 'function') throw new Error('There is no screen called "' + screen + '"');
      const c = ctxFor(screen, JSON.parse(paramsJson || '{}'));
      const v = await draw(c); adopt(c);
      if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('Screen "' + screen + '" must return an object like { title, body: [...] }');
      return JSON.stringify(v);
    },
    async act(name, argsJson, screen, paramsJson) {
      const run = app.actions && app.actions[name];
      if (typeof run !== 'function') throw new Error('There is no action called "' + name + '"');
      const c = ctxFor(screen, JSON.parse(paramsJson || '{}'));
      const v = await run(c, JSON.parse(argsJson || '{}')); adopt(c);
      return JSON.stringify(v === undefined ? null : v);
    },
    async tool(name, argsJson) {
      const t = app.tools && app.tools[name];
      if (!t || typeof t.run !== 'function') throw new Error('There is no tool called "' + name + '". Its tools: ' + (Object.keys(app.tools || {}).join(', ') || 'none'));
      const c = ctxFor('home', {});
      const v = await t.run(c, JSON.parse(argsJson || '{}')); adopt(c);
      return JSON.stringify(v === undefined || v === null ? 'Done.' : v);
    },
    async callback(queryJson) {
      if (typeof app.callback !== 'function') throw new Error('This app has no callback(ctx, query).');
      const c = ctxFor('home', {});
      const v = await app.callback(c, JSON.parse(queryJson || '{}')); adopt(c);
      return JSON.stringify(typeof v === 'string' ? { title: v } : v == null ? { title: 'Done' } : v);
    },
    async onFeed(feedJson) {
      if (!app || typeof app.onAgents !== 'function') return 'null';
      const c = ctxFor('home', {});
      await app.onAgents(c, JSON.parse(feedJson || '{}')); adopt(c);
      return 'null';
    },
    stateJson() { return JSON.stringify(state === undefined ? {} : state) },
    newObject() { return {} },
    importer(hostImport, from) { return function (spec) { const r = hostImport(String(spec), from); if (typeof r === 'string') throw new Error(r); return r } },
    dynamic(imp) { return function (spec) { return new Promise((resolve) => resolve(imp(spec))) } },
    reexport(target, source) { for (const k of Object.keys(source)) if (k !== 'default') target[k] = source[k] },
    meta(url) { return { url } },
    jsonModule(text) { const v = JSON.parse(text); return { default: v } },
    shim(name) { return name === 'path' ? pathShim : name === 'crypto' ? cryptoShim : null }
  };
}

// ---- Modules: ES module syntax turned into plain functions; imports only from the app's own folder.
let modSeq = 0;
function newlines(t) { let n = 0; for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) n++; return '\n'.repeat(n) }
function importBindings(clause, mod) {
  let rest = clause.trim(); const out = [];
  let m = /^([A-Za-z_$][\w$]*)\s*(?:,\s*|$)/.exec(rest);
  if (m) { out.push('const ' + m[1] + ' = ' + mod + '.default;'); rest = rest.slice(m[0].length).trim() }
  m = /^\*\s*as\s+([A-Za-z_$][\w$]*)$/.exec(rest);
  if (m) { out.push('const ' + m[1] + ' = ' + mod + ';'); rest = '' }
  m = /^\{([\s\S]*)\}$/.exec(rest);
  if (m) {
    const names = m[1].split(',').map(function (s) { return s.trim() }).filter(Boolean).map(function (s) {
      const k = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(s);
      if (!k) throw new Error('This import is not supported: ' + s);
      return k[2] ? k[1] + ': ' + k[2] : k[1];
    });
    out.push('const { ' + names.join(', ') + ' } = ' + mod + ';'); rest = '';
  }
  if (rest) throw new Error('This import is not supported: import ' + clause.trim());
  return out.join(' ');
}
function exportList(list, mod) {
  return list.split(',').map(function (s) { return s.trim() }).filter(Boolean).map(function (s) {
    const k = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(s);
    if (!k) throw new Error('This export is not supported: ' + s);
    return '__exports.' + (k[2] || k[1]) + ' = ' + (mod ? mod + '.' + k[1] : k[1]) + ';';
  }).join(' ');
}
function transform(src) {
  let text = String(src).replace(/^﻿/, '').replace(/^#!.*/, '');
  const tail = [];
  const fresh = function () { modSeq += 1; return '__m' + modSeq };
  const q = JSON.stringify;
  text = text.replace(/^[ \t]*import\s+([^'";]*?)\s*from\s*(['"])([^'"\n]+)\2[ \t]*;?/gm, function (all, clause, quote, spec) { const v = fresh(); return 'const ' + v + ' = __import(' + q(spec) + '); ' + importBindings(clause, v) + newlines(all) });
  text = text.replace(/^[ \t]*import\s*(['"])([^'"\n]+)\1[ \t]*;?/gm, function (all, quote, spec) { return '__import(' + q(spec) + ');' });
  text = text.replace(/^[ \t]*export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*(['"])([^'"\n]+)\2[ \t]*;?/gm, function (all, ns, quote, spec) { return '__exports.' + ns + ' = __import(' + q(spec) + ');' });
  text = text.replace(/^[ \t]*export\s+\*\s+from\s*(['"])([^'"\n]+)\1[ \t]*;?/gm, function (all, quote, spec) { return '__reexport(__exports, __import(' + q(spec) + '));' });
  text = text.replace(/^[ \t]*export\s*\{([^}]*)\}\s*from\s*(['"])([^'"\n]+)\2[ \t]*;?/gm, function (all, list, quote, spec) { const v = fresh(); return 'const ' + v + ' = __import(' + q(spec) + '); ' + exportList(list, v) + newlines(all) });
  text = text.replace(/^[ \t]*export\s*\{([^}]*)\}[ \t]*;?/gm, function (all, list) { tail.push(exportList(list, null)); return newlines(all) });
  text = text.replace(/^([ \t]*)export\s+default\s+/m, '$1__exports.default = ');
  text = text.replace(/^([ \t]*)export\s+((?:async\s+)?function\b\s*\*?\s*|class\s+)([A-Za-z_$][\w$]*)/gm, function (all, ind, kw, id) { tail.push('__exports.' + id + ' = ' + id + ';'); return ind + kw + id });
  text = text.replace(/^([ \t]*)export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/gm, function (all, ind, kw, id) { tail.push('__exports.' + id + ' = ' + id + ';'); return ind + kw + ' ' + id });
  const left = /^[ \t]*export\b.*$/m.exec(text);
  if (left) throw new Error('This export is not supported: ' + left[0].trim() + ' (use export default { ... }, export const x = ..., export function f() {} or export { a, b }).');
  text = text.replace(/\bimport\.meta\b/g, '__meta');
  text = text.replace(/(^|[^.\w$])import\s*\(/g, '$1__dynamic(');
  return text + '\n;' + tail.join(' ');
}
let context = null;
let api = null;
const modules = new Map();
function resolveSpec(spec, from) {
  if (spec === 'node:path' || spec === 'path' || spec === 'node:path/posix' || spec === 'path/posix') return { shim: 'path' };
  if (spec === 'node:crypto' || spec === 'crypto') return { shim: 'crypto' };
  if (!spec.startsWith('.') && !spec.startsWith('/')) return { error: 'An app can\'t import "' + spec + '": Hermes One apps have no npm and no Node modules. Use ctx.hermes.files for files, fetch for the web, and node:path or node:crypto for paths and hashes.' };
  const base = spec.startsWith('/') ? spec : P.resolve(P.dirname(from), spec);
  for (const c of [base, base + '.js', base + '.mjs', base + '.json', P.join(base, 'index.js')]) {
    let f; try { f = real(c); if (!fs.statSync(f).isFile()) continue } catch (e) { continue }
    if (!inside(f, appReal)) return { error: 'Apps can import only files inside their own folder (' + spec + ').' };
    return { file: f };
  }
  return { error: 'There is no ' + spec + ' next to ' + (P.relative(appReal, from) || 'main.js') + '.' };
}
function hostImport(spec, from) {
  try {
    const r = resolveSpec(spec, from);
    if (r.error) return r.error;
    if (r.shim) return api.shim(r.shim);
    return loadModule(r.file);
  } catch (e) {
    if (e instanceof Error) return describe(e);
    throw e;
  }
}
function loadModule(file) {
  const seen = modules.get(file);
  if (seen) return seen;
  const source = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) { const j = api.jsonModule(source); modules.set(file, j); return j }
  const exportsObj = api.newObject();
  modules.set(file, exportsObj);
  const code = transform(source);
  const fn = vm.runInContext('(function (__exports, __import, __meta, __dynamic, __reexport) {"use strict";' + code + '\n})', context, { filename: file, timeout: 10000 });
  const imp = api.importer(hostImport, file);
  fn(exportsObj, imp, api.meta('file://' + file), api.dynamic(imp), api.reexport);
  return exportsObj;
}

async function load() {
  const blank = vm.constants && vm.constants.DONT_CONTEXTIFY ? vm.constants.DONT_CONTEXTIFY : Object.create(null);
  context = vm.createContext(blank, { name: 'app ' + W.appId });
  const make = vm.runInContext('(' + prelude.toString() + ')', context, { filename: 'hermes-app-runtime.js' });
  api = make(sys, JSON.stringify({ appId: W.appId, dataDir: W.dataDir, home: W.home, callbackUrl: W.callbackUrl || '' }));
  const main = P.join(appReal, 'main.js');
  if (!fs.existsSync(main)) throw new Error('main.js is missing from the app folder.');
  api.setModule(loadModule(main));
  let stored = null; try { stored = fs.readFileSync(STATE_FILE, 'utf8') } catch (e) { /* first run */ }
  saved = stored || '';
  const meta = JSON.parse(await api.init(stored));
  persist();
  return meta;
}
const json = function (v) { return JSON.stringify(v == null ? {} : v) };
const handlers = {
  load: load,
  render: async function (m) { const v = await api.render(String(m.screen || 'home'), json(m.params)); persist(); return JSON.parse(v) },
  act: async function (m) { try { return JSON.parse(await api.act(String(m.action || ''), json(m.args), String(m.screen || 'home'), json(m.params))) } finally { changed() } },
  tool: async function (m) { try { return JSON.parse(await api.tool(String(m.name || ''), json(m.args))) } finally { changed() } },
  callback: async function (m) { try { return JSON.parse(await api.callback(json(m.query))) } finally { changed() } },
  state: function () { return JSON.parse(api.stateJson()) },
  feed: async function (m) {
    try { FEED = JSON.parse(String(m.feed || 'null')) || FEED } catch (e) { return null }
    if (W.agents) { try { await api.onFeed(String(m.feed)) } catch (e) { log('error', 'onAgents failed: ' + describe(e)) } finally { changed() } }
    return null;
  }
};
parentPort.on('message', async function (m) {
  const h = handlers[m && m.type];
  if (!h) return send({ id: m && m.id, ok: false, error: 'Unknown request ' + (m && m.type) });
  if (m.type !== 'load' && !api) return send({ id: m.id, ok: false, error: 'The app has not loaded.' });
  try { send({ id: m.id, ok: true, value: await h(m) }) } catch (e) { send({ id: m.id, ok: false, error: describe(e) }) }
});
send({ type: 'ready' });
`

// ---------------------------------------------------------------------------------------------------
// The runtime: publishing, versions, the live workers, screens, actions, files. No Electron in here,
// so it can be driven from a plain Node script in tests.
// ---------------------------------------------------------------------------------------------------
export interface RuntimeOptions {
  root: string
  srcRoot: string
  emit?: (event: AppsEvent) => void
  notify?: (app: string, appName: string, note: Note) => void
  callbackBase?: () => string | undefined
}
interface Runner {
  id: string
  version: number
  worker: Worker
  used: number
  meta?: Meta
  ready: Promise<void>
  request<T = any>(type: string, payload?: Record<string, unknown>, timeout?: number): Promise<T>
  stop(): void
}

export function createAppsRuntime(options: RuntimeOptions) {
  const { root, srcRoot } = options
  const emit = options.emit ?? (() => {})
  const runners = new Map<string, Runner>()
  const revs = new Map<string, number>()
  const logs = new Map<string, string[]>()
  const logTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const queues = new Map<string, Promise<unknown>>()
  const base = Date.now()
  fs.mkdirSync(root, { recursive: true })
  // The agents feed from the window, kept for apps that start later and handed to running "agents" apps.
  let feedJson = ''
  const setFeed = (feed: unknown) => {
    feedJson = JSON.stringify(feed ?? {})
    for (const r of runners.values()) {
      if (!manifestOf(r.id)?.abilities.includes('agents')) continue
      // A feed update isn't use: it mustn't keep an idle app's worker running.
      const used = r.used
      r.request('feed', { feed: feedJson }, 5000).catch(() => { /* the app is restarting */ })
      r.used = used
    }
  }

  const appDir = (id: string) => path.join(root, id)
  const dataDir = (id: string) => path.join(appDir(id), 'data')
  const versionDir = (id: string, version: number) => path.join(appDir(id), 'versions', String(version))
  const current = (id: string): number | undefined => {
    try {
      const value = Number.parseInt(fs.readFileSync(path.join(appDir(id), 'current'), 'utf8'), 10)
      return Number.isInteger(value) && fs.existsSync(versionDir(id, value)) ? value : undefined
    } catch { return undefined }
  }
  const versions = (id: string): number[] => {
    try { return fs.readdirSync(path.join(appDir(id), 'versions')).map(Number).filter(Number.isInteger).sort((a, b) => a - b) } catch { return [] }
  }
  const secretOf = (id: string) => {
    const file = path.join(appDir(id), 'secret')
    try { return fs.readFileSync(file, 'utf8').trim() } catch {
      fs.mkdirSync(appDir(id), { recursive: true })
      const value = crypto.randomBytes(24).toString('base64url')
      fs.writeFileSync(file, value, { mode: 0o600 })
      return value
    }
  }
  const sign = (id: string, what: string) => crypto.createHmac('sha256', secretOf(id)).update(`${id}\n${what}`).digest('base64url').slice(0, 22)
  const manifestOf = (id: string, version = current(id)): Manifest | undefined => {
    if (version === undefined) return undefined
    try { return checkManifest(id, readJson(path.join(versionDir(id, version), 'app.json'))) } catch { return undefined }
  }
  const metaOf = (id: string, version = current(id)): Partial<Meta> => {
    if (version === undefined) return {}
    try { return readJson(path.join(versionDir(id, version), '.meta.json')) } catch { return {} }
  }
  const revOf = (id: string) => revs.get(id) ?? base
  const bump = (id: string) => {
    revs.set(id, revOf(id) + 1)
    emit({ kind: 'changed', app: id, rev: revOf(id) })
  }
  const logLines = (id: string) => {
    let lines = logs.get(id)
    if (!lines) {
      try { lines = fs.readFileSync(path.join(appDir(id), 'log.txt'), 'utf8').split('\n').filter(Boolean).slice(-LOG_LINES) } catch { lines = [] }
      logs.set(id, lines)
    }
    return lines
  }
  const note = (id: string, line: string) => {
    const lines = logLines(id)
    for (const part of line.split('\n')) if (part.trim()) lines.push(`${clock()} ${part}`)
    if (lines.length > LOG_LINES) lines.splice(0, lines.length - LOG_LINES)
    if (!logTimers.has(id)) {
      logTimers.set(id, setTimeout(() => {
        logTimers.delete(id)
        try { if (fs.existsSync(appDir(id))) fs.writeFileSync(path.join(appDir(id), 'log.txt'), `${(logs.get(id) ?? []).join('\n')}\n`) } catch { /* not critical */ }
      }, 800))
    }
  }
  const serial = <T>(id: string, work: () => Promise<T>): Promise<T> => {
    const next = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(work)
    queues.set(id, next)
    return next
  }
  // The folders an app may read: its own version, its data, and what its app.json asks for.
  const readable = (id: string, dir: string, manifest?: Manifest) => [
    dir,
    dataDir(id),
    ...(manifest?.read ?? []).map((p) => expand(p)).filter((p) => path.isAbsolute(p)),
  ].map(real)

  // Audio a play action names goes through hermes-app:// (the window's CSP allows no https media): each
  // stream link is signed for the app that asked, so nothing else can use it as a proxy.
  const streamUrl = (id: string, url: string) => `${APP_SCHEME}://${id}/stream/${b64url(url)}.${sign(id, `stream\n${url}`)}`
  const prepare = (id: string, value: any): any => {
    if (Array.isArray(value)) return value.map((v) => prepare(id, v))
    if (!value || typeof value !== 'object') return value
    if (value.do === 'play' && Array.isArray(value.queue)) {
      return { ...value, queue: value.queue.filter((t: any) => t && t.url).map((t: any) => ({ ...t, url: /^https?:\/\//i.test(String(t.url)) ? streamUrl(id, String(t.url)) : String(t.url) })) }
    }
    if (value.do === 'confirm' && value.then) return { ...value, then: prepare(id, value.then) }
    return value
  }

  // ---- Running an app in its own worker.
  function startRunner(id: string, version: number, { keep = true, dir }: { keep?: boolean; dir?: string } = {}): Runner {
    const folder = dir ?? versionDir(id, version)
    let manifest: Manifest | undefined
    try { manifest = checkManifest(id, readJson(path.join(folder, 'app.json'))) } catch { manifest = undefined }
    if (!manifest) throw fail(`The app "${id}" has no valid app.json.`)
    fs.mkdirSync(dataDir(id), { recursive: true })
    const callbackBase = options.callbackBase?.()
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      name: `app:${id}`,
      workerData: {
        appId: id, appDir: real(folder), dataDir: real(dataDir(id)), reads: readable(id, folder, manifest).filter((p) => fs.existsSync(p)),
        secret: secretOf(id), home: home(), scheme: APP_SCHEME, callbackUrl: callbackBase ? `${callbackBase}/apps/${id}/callback` : '',
        agents: manifest.abilities.includes('agents'), feed: manifest.abilities.includes('agents') ? feedJson : '',
      },
      env: { HOME: home(), LANG: process.env.LANG ?? 'en_US.UTF-8', TZ: process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone },
      resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 48 },
      stdout: true,
      stderr: true,
    })
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
    let nextId = 1
    let resolveReady!: () => void
    let rejectReady!: (e: Error) => void
    let stopped = false
    const runner: Runner = {
      id, version, worker, used: Date.now(),
      ready: new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject }),
      request(type, payload = {}, timeout = REQUEST_MS) {
        runner.used = Date.now()
        return new Promise((resolve, reject) => {
          if (stopped) return reject(fail('The app stopped.', 'apps/app-down'))
          const requestId = nextId++
          const timer = setTimeout(() => {
            pending.delete(requestId)
            // A worker that doesn't answer is stuck (a loop that never ends): stop it; the next request starts it again.
            note(id, `err "${type}" took over ${Math.round(timeout / 1000)}s, so the app was stopped`)
            runner.stop()
            reject(fail(`The app took too long (${Math.round(timeout / 1000)}s) to answer "${type}", so it was stopped.`, 'apps/app-slow'))
          }, timeout)
          pending.set(requestId, { resolve, reject, timer })
          worker.postMessage({ ...payload, id: requestId, type })
        })
      },
      stop() {
        if (stopped) return
        stopped = true
        if (keep && runners.get(id) === runner) runners.delete(id)
        void worker.terminate()
      },
    }
    runner.ready.catch(() => {})
    const lines = (stream: NodeJS.ReadableStream | null, level: string) => {
      if (!stream) return
      let rest = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => {
        const parts = (rest + chunk).split('\n')
        rest = parts.pop() ?? ''
        for (const text of parts) if (text.trim()) note(id, `${level} ${text}`)
      })
    }
    lines(worker.stdout, 'out')
    lines(worker.stderr, 'err')
    worker.on('message', (m: any) => {
      if (m?.type === 'ready') return resolveReady()
      if (m?.type === 'log') return note(id, `${m.level === 'log' ? 'out' : m.level} ${m.text}`)
      if (m?.type === 'changed') { if (keep) bump(id); return }
      if (!keep && (m?.type === 'chat' || m?.type === 'notify' || m?.type === 'perform')) return // a test run says nothing to anyone
      if (m?.type === 'chat') { emit({ kind: 'chat', app: id, name: manifest!.name, bot: String(m.bot ?? ''), text: String(m.text ?? '') }); note(id, `out asked ${m.bot || 'Chief'}: ${String(m.text ?? '').slice(0, 120)}`); return }
      if (m?.type === 'notify') { options.notify?.(id, manifest!.name, m.note ?? {}); return }
      if (m?.type === 'perform') { emit({ kind: 'effect', app: id, action: prepare(id, m.action) }); return }
      const waiting = pending.get(m?.id)
      if (!waiting) return
      pending.delete(m.id)
      clearTimeout(waiting.timer)
      if (m.ok) waiting.resolve(m.value)
      else waiting.reject(Object.assign(new Error(String(m.error ?? 'The app failed').replace(/^Error: /, '')), { code: 'apps/app-error' }))
    })
    worker.on('error', (error: Error & { code?: string }) => {
      note(id, `err ${error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'ran out of memory' : error.stack ?? error.message}`)
      rejectReady(fail(`The app stopped: ${error.message}`, 'apps/app-down'))
    })
    worker.on('exit', (code) => {
      stopped = true
      if (code !== 0 && code !== 1) note(id, `exit ${code}`)
      rejectReady(fail('The app stopped before it was ready.', 'apps/app-down'))
      for (const waiting of pending.values()) { clearTimeout(waiting.timer); waiting.reject(fail('The app stopped.', 'apps/app-down')) }
      pending.clear()
      if (keep && runners.get(id) === runner) runners.delete(id)
    })
    if (keep) runners.set(id, runner)
    return runner
  }

  async function loaded(runner: Runner) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([runner.ready, new Promise((_r, reject) => { timer = setTimeout(() => reject(fail('The app took too long to start.', 'apps/app-slow')), LOAD_MS) })])
    } finally { clearTimeout(timer) }
    runner.meta ??= await runner.request<Meta>('load', {}, LOAD_MS)
    return runner
  }

  /** The live app's worker, started if needed. */
  async function runnerOf(id: string) {
    const version = current(id)
    if (version === undefined) throw fail(`There is no app called "${id}".`, 'apps/no-app')
    let runner = runners.get(id)
    if (runner && runner.version !== version) { runner.stop(); runners.delete(id); runner = undefined }
    if (!runner) runner = startRunner(id, version)
    try {
      return await loaded(runner)
    } catch (error: any) {
      runner.stop()
      runners.delete(id)
      throw Object.assign(new Error(String(error?.message ?? error)), { code: error?.code ?? 'apps/app-error' })
    }
  }

  // Apps idle for a while stop; ones that work in the background keep going.
  const idle = setInterval(() => {
    for (const runner of runners.values()) {
      if (Date.now() - runner.used > IDLE_MS && !manifestOf(runner.id, runner.version)?.background) runner.stop()
    }
  }, 60_000)
  idle.unref?.()

  // ---- What the window and the bots see.
  function summary(id: string): AppSummary | undefined {
    const version = current(id)
    const manifest = manifestOf(id, version)
    if (!manifest || version === undefined) return undefined
    const meta = metaOf(id, version)
    return {
      id, name: manifest.name, icon: manifest.icon, color: manifest.color, description: manifest.description,
      abilities: manifest.abilities, background: manifest.background, version, versions: versions(id), rev: revOf(id),
      tools: meta.tools ?? [], screens: meta.screens ?? ['home'], bot: meta.bot, publishedAt: meta.publishedAt, running: runners.has(id),
    }
  }
  function ids() {
    try { return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && APP_ID.test(e.name)).map((e) => e.name) } catch { return [] }
  }
  function list() {
    return ids().map(summary).filter((a): a is AppSummary => !!a).sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || a.name.localeCompare(b.name))
  }

  async function screen({ app, screen: name = 'home', params = {}, rev }: { app: string; screen?: string; params?: any; rev?: number }) {
    const id = String(app ?? '')
    // Nothing changed since the window last drew it.
    if (rev !== undefined && rev !== null && Number(rev) === revOf(id) && runners.has(id)) return { app: id, rev: revOf(id), same: true }
    const runner = await runnerOf(id)
    const value = await runner.request('render', { screen: String(name), params: params ?? {} })
    checkScreen(value, String(name))
    return { app: id, rev: revOf(id), screen: value }
  }

  async function act({ app, action, args = {}, screen: name = 'home', params = {} }: { app: string; action: string; args?: any; screen?: string; params?: any }) {
    const id = String(app ?? '')
    const runner = await runnerOf(id)
    let result: any
    try {
      result = await runner.request('act', { action: String(action ?? ''), args: args ?? {}, screen: String(name), params: params ?? {} })
    } catch (error: any) {
      note(id, `err action "${action}" failed: ${String(error?.message ?? error)}`)
      throw error
    }
    const drawn = await runner.request('render', { screen: String(name), params: params ?? {} }).catch(() => undefined)
    return { app: id, rev: revOf(id), result: prepare(id, result), screen: drawn }
  }

  /** The app's state, for a web view's hermes.state. */
  async function stateOf(app: string) {
    const id = String(app ?? '')
    const runner = await runnerOf(id)
    return { app: id, rev: revOf(id), state: await runner.request('state') }
  }

  async function tool({ app, name, args = {} }: { app: string; name: string; args?: any }) {
    const id = String(app ?? '')
    const runner = await runnerOf(id)
    try {
      const value = await runner.request('tool', { name: String(name ?? ''), args: args ?? {} })
      note(id, `out tool ${name} ran`)
      return value
    } catch (error: any) {
      note(id, `err tool "${name}" failed: ${String(error?.message ?? error)}`)
      throw error
    }
  }

  /** A sign-in page sent the user back to this app: its query goes to the app's callback. */
  async function callback(app: string, query: Record<string, string>) {
    const runner = await runnerOf(String(app ?? ''))
    return runner.request('callback', { query: query ?? {} }, 30_000)
  }

  /** A file picked in the window for an app's action: kept in its data folder under uploads/. */
  function saveUpload(app: string, name: string, body: { path?: string; bytes?: Uint8Array }) {
    const id = String(app ?? '')
    if (current(id) === undefined) throw fail(`There is no app called "${id}".`, 'apps/no-app')
    const safe = path.basename(String(name ?? 'file')).replace(/[^\w.\- ]+/g, '_').slice(-80) || 'file'
    const dir = path.join(dataDir(id), 'uploads')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${Date.now()}-${safe}`)
    if (body.path) {
      const size = fs.statSync(body.path).size
      if (size > UPLOAD_MAX_BYTES) throw fail(`That file is ${Math.round(size / 1048576)} MB; apps take files up to ${UPLOAD_MAX_BYTES / 1048576} MB.`)
      fs.copyFileSync(body.path, file)
    } else {
      const bytes = Buffer.from(body.bytes ?? new Uint8Array())
      if (bytes.length > UPLOAD_MAX_BYTES) throw fail('That file is too big for an app.')
      fs.writeFileSync(file, bytes)
    }
    return { path: file, name: safe, size: fs.statSync(file).size, type: TYPES[path.extname(safe).toLowerCase()] ?? 'application/octet-stream' }
  }
  async function upload(q: { app: string; action: string; name: string; path?: string; bytes?: Uint8Array; args?: any; screen?: string; params?: any }) {
    const file = saveUpload(q.app, q.name, { path: q.path, bytes: q.bytes })
    return act({ app: q.app, action: q.action, args: { ...(q.args ?? {}), file }, screen: q.screen || 'home', params: q.params ?? {} })
  }

  // ---- Publishing, undo and removal.
  function sourceOf(id: string, dir?: string) {
    return dir ? path.resolve(expand(String(dir))) : path.join(srcRoot, id)
  }

  /** Test-run the app in its source folder and make it live (or only test it, with checkOnly). */
  function publish({ id: rawId, dir, bot, checkOnly = false }: { id: string; dir?: string; bot?: string; checkOnly?: boolean }) {
    const id = String(rawId ?? '').trim()
    return serial(id, async () => {
      if (!APP_ID.test(id)) throw fail(`"${id}" can't be an app id: use lowercase letters, digits and dashes, starting with a letter.`)
      const source = sourceOf(id, dir)
      const shown = source.startsWith(home()) ? `~${source.slice(home().length)}` : source
      if (!fs.existsSync(path.join(source, 'app.json'))) throw fail(`There is no ${shown}/app.json. Write the app there first (app_guide explains how).`)
      let raw: unknown
      try { raw = readJson(path.join(source, 'app.json')) } catch (error: any) { throw fail(`${shown}/app.json is not valid JSON: ${error.message}`) }
      const manifest = checkManifest(id, raw)
      if (!fs.existsSync(path.join(source, 'main.js'))) throw fail(`${shown}/main.js is missing.`)
      const known = versions(id)
      const version = (known.at(-1) ?? 0) + 1
      const dirOut = checkOnly ? path.join(appDir(id), 'trial') : versionDir(id, version)
      fs.mkdirSync(path.dirname(dirOut), { recursive: true })
      fs.rmSync(dirOut, { recursive: true, force: true })
      copyApp(source, dirOut)
      // Try it before it goes live: it must start and draw its home screen.
      const trial = startRunner(id, version, { keep: false, dir: dirOut })
      let meta: Meta
      let warnings: string[]
      try {
        await loaded(trial)
        meta = trial.meta as Meta
        const homeScreen = await trial.request('render', { screen: 'home', params: {} })
        warnings = checkScreen(homeScreen, 'home')
      } catch (error: any) {
        trial.stop()
        fs.rmSync(dirOut, { recursive: true, force: true })
        const recent = logLines(id).slice(-8).join('\n')
        throw fail(`${checkOnly || current(id) === undefined ? 'It didn\'t run' : 'It didn\'t run, so the old version stays live'}.\n${String(error?.message ?? error)}${recent ? `\n\nRecent log:\n${recent}` : ''}`, 'apps/app-broken')
      }
      trial.stop()
      for (const ability of manifest.abilities) {
        if (!ABILITIES.has(ability)) warnings.push(`Hermes One doesn't know the ability "${ability}".`)
        else if (NOT_HERE[ability]) warnings.push(NOT_HERE[ability])
      }
      const usesWeb = JSON.stringify(manifest.abilities).includes('"web"')
      if (usesWeb && !fs.existsSync(path.join(dirOut, 'web'))) warnings.push('The app has the "web" ability but no web/ folder.')
      if (checkOnly) {
        fs.rmSync(dirOut, { recursive: true, force: true })
        note(id, `checked (not published)${warnings.length ? `: ${warnings.length} warnings` : ''}`)
        return { app: id, name: manifest.name, version: current(id) ?? 0, checked: true, warnings, screens: meta.screens, tools: meta.tools }
      }
      const full: Meta = { ...meta, bot: bot ? String(bot) : undefined, publishedAt: Date.now(), source }
      fs.writeFileSync(path.join(dirOut, '.meta.json'), JSON.stringify(full))
      fs.writeFileSync(path.join(appDir(id), 'current'), String(version))
      runners.get(id)?.stop()
      runners.delete(id)
      for (const old of known.slice(0, Math.max(0, known.length + 1 - KEEP_VERSIONS))) fs.rmSync(versionDir(id, old), { recursive: true, force: true })
      note(id, `published version ${version}${bot ? ` by ${bot}` : ''}`)
      bump(id)
      emit({ kind: 'list' })
      emit({ kind: 'published', app: id, name: manifest.name, version, bot: bot ? String(bot) : undefined })
      if (manifest.background) void runnerOf(id).catch((error) => note(id, `err background start failed: ${error.message}`))
      return { app: id, name: manifest.name, version, warnings, screens: meta.screens, tools: meta.tools }
    })
  }

  function undo(app: string) {
    const id = String(app ?? '')
    return serial(id, async () => {
      const now = current(id)
      if (now === undefined) throw fail(`There is no app called "${id}".`, 'apps/no-app')
      const before = versions(id).filter((v) => v < now).at(-1)
      if (before === undefined) throw fail(`${manifestOf(id)?.name ?? id} has no earlier version to go back to.`)
      fs.writeFileSync(path.join(appDir(id), 'current'), String(before))
      fs.rmSync(versionDir(id, now), { recursive: true, force: true })
      runners.get(id)?.stop()
      runners.delete(id)
      note(id, `back to version ${before}`)
      bump(id)
      emit({ kind: 'list' })
      if (manifestOf(id, before)?.background) void runnerOf(id).catch(() => {})
      return { app: id, version: before }
    })
  }

  function remove(app: string) {
    const id = String(app ?? '')
    return serial(id, async () => {
      if (current(id) === undefined) throw fail(`There is no app called "${id}".`, 'apps/no-app')
      runners.get(id)?.stop()
      runners.delete(id)
      // Kept aside (with its data), not deleted: a bot can bring it back by publishing again.
      const away = path.join(root, '.removed', `${id}-${Date.now()}`)
      fs.mkdirSync(path.dirname(away), { recursive: true })
      fs.renameSync(appDir(id), away)
      revs.delete(id)
      logs.delete(id)
      emit({ kind: 'list' })
      return { app: id, removed: true }
    })
  }

  function info(app: string) {
    const id = String(app ?? '')
    const now = current(id)
    if (now === undefined) throw fail(`There is no app called "${id}".`, 'apps/no-app')
    const meta = metaOf(id, now)
    return {
      app: id, version: now, source: meta.source ?? sourceOf(id), dataDir: dataDir(id), versionDir: versionDir(id, now),
      versions: versions(id).map((v) => { const m = metaOf(id, v); return { version: v, bot: m.bot, publishedAt: m.publishedAt } }),
    }
  }

  function logsOf(app: string) { return logLines(String(app ?? '')).join('\n') }

  // ---- Files over hermes-app://: signed file links, an app's web/ folder, and audio streams.
  function fileFor(id: string, name: string) {
    const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{22})(\.[A-Za-z0-9]{1,8})?$/.exec(String(name ?? ''))
    const version = current(id)
    if (!match || version === undefined) return undefined
    const full = Buffer.from(match[1], 'base64url').toString('utf8')
    const wanted = Buffer.from(sign(id, `file\n${full}`))
    const given = Buffer.from(match[2])
    if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return undefined
    const file = real(full)
    if (!readable(id, versionDir(id, version), manifestOf(id, version)).some((dir) => inside(file, dir))) return undefined
    return file
  }
  function webFileFor(id: string, rest: string) {
    const version = current(id)
    if (version === undefined) return undefined
    const web = real(path.join(versionDir(id, version), 'web'))
    let wanted = 'index.html'
    try { wanted = decodeURIComponent(rest || 'index.html') } catch { return undefined }
    const file = real(path.join(web, wanted.endsWith('/') ? `${wanted}index.html` : wanted))
    return inside(file, web) ? file : undefined
  }
  const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  function fileResponse(file: string | undefined, request: Request, extra: Record<string, string> = {}) {
    let stat: fs.Stats | undefined
    try { stat = file ? fs.statSync(file) : undefined } catch { stat = undefined }
    if (!file || !stat?.isFile()) return notFound()
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    const parts = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
    let start = 0
    let end = stat.size - 1
    let status = 200
    const headers: Record<string, string> = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600', ...extra }
    if (parts && (parts[1] !== '' || parts[2] !== '')) {
      if (parts[1] === '') start = Math.max(0, stat.size - Number(parts[2]))
      else { start = Number(parts[1]); if (parts[2] !== '') end = Math.min(end, Number(parts[2])) }
      if (start > end || start >= stat.size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${stat.size}` } })
      status = 206
      headers['content-range'] = `bytes ${start}-${end}/${stat.size}`
    }
    headers['content-length'] = String(Math.max(0, end - start + 1))
    if (request.method === 'HEAD' || stat.size === 0) return new Response(null, { status, headers })
    const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream
    return new Response(body, { status, headers })
  }
  function webResponse(id: string, rest: string, request: Request) {
    const file = webFileFor(id, rest)
    if (!file) return notFound()
    const self = `${APP_SCHEME}://${id}`
    const csp = `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${self}; style-src 'unsafe-inline' ${self}; img-src ${APP_SCHEME}: data: blob: https:; media-src ${APP_SCHEME}: data: blob: https:; font-src ${self} data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`
    // The page's own files load as modules from its sandboxed frame: let that frame read them.
    if (!/\.html?$/i.test(file)) return fileResponse(file, request, { 'content-security-policy': csp, 'access-control-allow-origin': '*' })
    let html: string
    try { html = fs.readFileSync(file, 'utf8') } catch { return notFound() }
    const at = /<head[^>]*>/i.exec(html)
    const page = at ? html.slice(0, at.index + at[0].length) + WEB_HEAD + html.slice(at.index + at[0].length) : WEB_HEAD + html
    return new Response(page, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp, 'cache-control': 'no-store', 'access-control-allow-origin': '*' } })
  }
  async function streamResponse(id: string, name: string, request: Request) {
    const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{22})$/.exec(name)
    if (!match || current(id) === undefined) return notFound()
    const url = Buffer.from(match[1], 'base64url').toString('utf8')
    const wanted = Buffer.from(sign(id, `stream\n${url}`))
    const given = Buffer.from(match[2])
    if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted) || !/^https?:\/\//i.test(url)) return notFound()
    const range = request.headers.get('range')
    try {
      const up = await fetch(url, { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers: { 'user-agent': 'Hermes One', ...(range ? { range } : {}) }, redirect: 'follow' })
      const headers: Record<string, string> = {}
      for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const v = up.headers.get(key); if (v) headers[key] = v }
      return new Response(request.method === 'HEAD' ? null : (up.body as any), { status: up.status, headers })
    } catch (error: any) {
      note(id, `err stream ${new URL(url).host}: ${error?.message ?? error}`)
      return new Response('The stream could not be reached', { status: 502 })
    }
  }
  /** Answer a hermes-app:// request (protocol.handle). */
  async function respond(request: Request): Promise<Response> {
    let url: URL
    try { url = new URL(request.url) } catch { return notFound() }
    const id = url.hostname
    if (!APP_ID.test(id)) return notFound()
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
    const [, kind, ...rest] = url.pathname.split('/')
    const tail = rest.join('/')
    if (kind === 'file') return fileResponse(fileFor(id, tail), request)
    if (kind === 'web') return webResponse(id, tail, request)
    if (kind === 'stream') return streamResponse(id, tail, request)
    return notFound()
  }

  /** Start the apps that work on their own. */
  function startBackground() {
    for (const id of ids()) if (manifestOf(id)?.background) void runnerOf(id).catch((error) => note(id, `err background start failed: ${error.message}`))
  }

  function close() {
    clearInterval(idle)
    for (const runner of runners.values()) runner.stop()
    runners.clear()
    for (const [id, timer] of logTimers) {
      clearTimeout(timer)
      try { if (fs.existsSync(appDir(id))) fs.writeFileSync(path.join(appDir(id), 'log.txt'), `${(logs.get(id) ?? []).join('\n')}\n`) } catch { /* not critical */ }
    }
    logTimers.clear()
  }

  /** A line an app's web page printed (console.log, errors), into its log: at most 10 a second per app. */
  const pageLines = new Map<string, number[]>()
  const pageLog = (id: string, level: 'out' | 'warn' | 'err', text: string) => {
    if (!APP_ID.test(id) || current(id) === undefined) return
    const now = Date.now()
    const recent = (pageLines.get(id) ?? []).filter((t) => now - t < 1000)
    if (recent.length >= 10) return
    recent.push(now)
    pageLines.set(id, recent)
    note(id, `${level} page: ${String(text).slice(0, 2000)}`)
  }

  /** The agents feed the window last gave (for remote web views with the "agents" ability). */
  const feed = () => { try { return feedJson ? JSON.parse(feedJson) : { at: 0, agents: [], groups: [], talks: [] } } catch { return { at: 0, agents: [], groups: [], talks: [] } } }

  return {
    root, srcRoot, list, summary, screen, act, state: stateOf, tool, callback, upload, publish, undo, remove, info, setFeed, feed, pageLog,
    logs: logsOf, exists: (id: string) => APP_ID.test(id) && fs.existsSync(appDir(id)), respond, startBackground, close, names: () => ids().map((id) => ({ id, name: manifestOf(id)?.name ?? id })),
  }
}
export type AppsRuntime = ReturnType<typeof createAppsRuntime>

// The page an app's web view gets: Hermes One's colours as CSS variables, and window.hermes (also
// window.pod) to run the app's actions and follow its state through the window (posted messages).
const WEB_HEAD = '<meta name="color-scheme" content="dark"><style>:root{--app-bg:#1a1a1a;--app-surface:#1f1f1f;--app-raised:#292929;--app-text:#dcdcdc;--app-text2:#9e9e9e;--app-text3:#777777;--app-accent:#ffffff;--app-line:#242424;--app-ok:#22c55e;--app-amber:#f59e0b;--app-danger:#ef4444;--pod-bg:var(--app-bg);--pod-surface:var(--app-surface);--pod-raised:var(--app-raised);--pod-text:var(--app-text);--pod-text2:var(--app-text2);--pod-text3:var(--app-text3);--pod-accent:var(--app-accent);--pod-line:var(--app-line);color-scheme:dark}html,body{margin:0;background:var(--app-bg);color:var(--app-text);font-family:"Inter Variable",Inter,system-ui,-apple-system,sans-serif}</style>'
  + '<script>(function(){var n=0,w={},ls=[],as=[],ts=[];function post(m){m.hermes=1;parent.postMessage(m,"*")}'
  + 'window.addEventListener("message",function(e){if(e.source!==parent)return;var d=e.data;if(!d||d.hermes!==1)return;'
  + 'if(d.type==="state"){api.state=d.state;ls.slice().forEach(function(f){try{f(d.state)}catch(x){console.error(x)}})}'
  + 'else if(d.type==="agents"){var old=api.agents;api.agents=d.feed;as.slice().forEach(function(f){try{f(d.feed)}catch(x){console.error(x)}});'
  + 'if(old){var seen={};(old.talks||[]).forEach(function(t){seen[t.id]=1});(d.feed.talks||[]).forEach(function(t){if(!seen[t.id])ts.slice().forEach(function(f){try{f(t)}catch(x){console.error(x)}})})}}'
  + 'else if(d.type==="done"){var p=w[d.id];delete w[d.id];if(p){d.ok?p[0](d.value):p[1](new Error(d.value))}}});'
  + 'var api={state:null,act:function(name,args){return new Promise(function(res,rej){var i=++n;w[i]=[res,rej];post({type:"act",id:i,name:String(name),args:args||{}})})},'
  + 'onState:function(f){ls.push(f);if(api.state)f(api.state);return function(){ls=ls.filter(function(g){return g!==f})}},'
  + 'agents:null,onAgents:function(f){as.push(f);if(api.agents)f(api.agents);return function(){as=as.filter(function(g){return g!==f})}},'
  + 'onTalk:function(f){ts.push(f);return function(){ts=ts.filter(function(g){return g!==f})}}};'
  + 'window.hermes=api;window.pod=api;post({type:"state"});post({type:"agents"})})();</script>'

// ---------------------------------------------------------------------------------------------------
// What the runtime emits, kept for Hermes Remote (it long-polls /v1/events through the plugin): the last
// 200 events that matter away from the Mac, each with a sequence number. Numbers start at the launch time,
// so they keep growing across launches and a phone's `after` from an earlier launch reads as a gap.
// ---------------------------------------------------------------------------------------------------
const REMOTE_EVENTS = new Set<AppsEvent['kind']>(['changed', 'list', 'published', 'effect'])
export function createEventRing(size = 200) {
  let seq = Date.now()
  const items: { seq: number; event: AppsEvent }[] = []
  const waiters = new Set<() => void>()
  return {
    push(event: AppsEvent) {
      if (!REMOTE_EVENTS.has(event.kind)) return
      seq += 1
      items.push({ seq, event })
      if (items.length > size) items.splice(0, items.length - size)
      for (const wake of [...waiters]) wake()
    },
    /** The events after `after`. `gap` means some were missed (dropped, or another launch): reload everything. */
    since(after?: number): { seq: number; events: AppsEvent[]; gap?: true } {
      if (after === undefined || !Number.isFinite(after)) return { seq, events: [] }
      const first = items[0]?.seq ?? seq + 1
      const events = items.filter((i) => i.seq > after).map((i) => i.event)
      return after > seq || after < first - 1 ? { seq, events, gap: true } : { seq, events }
    },
    /** Resolves on the next event or after `ms`; `stop` resolves it early (the client left). */
    next(ms: number) {
      let wake!: () => void
      const done = new Promise<void>((resolve) => { wake = resolve })
      const timer = setTimeout(wake, ms)
      waiters.add(wake)
      return { done: done.finally(() => { clearTimeout(timer); waiters.delete(wake) }), stop: () => wake() }
    },
  }
}
export type EventRing = ReturnType<typeof createEventRing>

// ---------------------------------------------------------------------------------------------------
// The control endpoint the Hermes plugin calls (its tools, and its /api/plugins/hermes-one/ routes for
// Hermes Remote): 127.0.0.1 only, a random port (kept across launches when it is free, so sign-in
// callback addresses stay put), and a fresh token each launch in <userData>/apps/control.json (mode
// 0600). OAuth callbacks come back to /apps/<id>/callback.
// ---------------------------------------------------------------------------------------------------
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
function callbackPage(title: string, text: string, ok: boolean) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title>`
    + '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1a1a1a;color:#dcdcdc;font:15px/1.5 system-ui,-apple-system,sans-serif}main{max-width:420px;padding:32px;text-align:center}h1{font-size:20px;font-weight:600;margin:0 0 8px}p{color:#9e9e9e;margin:0}i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-bottom:16px}</style>'
    + `<main><i style="background:${ok ? '#22c55e' : '#ef4444'}"></i><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></main>`
}

// The HTTP status for each error code (the body always says the code and the message).
const STATUS: Record<string, number> = {
  'apps/no-app': 404, 'apps/not-found': 404, 'apps/forbidden': 403, 'apps/unauthorized': 401,
  'apps/app-error': 422, 'apps/app-broken': 422, 'apps/app-down': 502, 'apps/app-slow': 504,
}
const FILE_ROUTE = /^\/v1\/files\/([a-z][a-z0-9-]{0,30})\/(web|file|stream)(?:\/(.*))?$/

export async function startControlServer(runtime: AppsRuntime, root: string, ring: EventRing = createEventRing()): Promise<{ server: http.Server; port: number; token: string; file: string }> {
  const token = crypto.randomBytes(32).toString('base64url')
  const file = path.join(root, 'control.json')
  const portFile = path.join(root, 'port')
  const reply = (res: http.ServerResponse, status: number, body: unknown) => {
    if (res.headersSent) { res.destroy(); return }
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  const ok = (res: http.ServerResponse, value: unknown) => reply(res, 200, { ok: true, value })
  const bad = (res: http.ServerResponse, status: number, message: string, code = 'apps/error') => reply(res, status, { ok: false, error: { code, message } })
  const authorized = (header: string | undefined) => {
    const given = Buffer.from(String(header ?? ''))
    const wanted = Buffer.from(`Bearer ${token}`)
    return given.length === wanted.length && crypto.timingSafeEqual(given, wanted)
  }
  const readBody = (req: http.IncomingMessage) => new Promise<any>((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 1024 * 1024) { reject(fail('The request is too big.')); req.destroy() } else chunks.push(chunk) })
    req.on('end', () => { try { const text = Buffer.concat(chunks).toString('utf8'); resolve(text ? JSON.parse(text) : {}) } catch { reject(fail('The request body must be JSON.')) } })
    req.on('error', reject)
  })
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const back = /^\/apps\/([a-z][a-z0-9-]{0,30})\/callback\/?$/.exec(url.pathname)
      if (back && req.method === 'GET') {
        let page: { title?: string; text?: string; ok?: boolean }
        try { page = await runtime.callback(back[1], Object.fromEntries(url.searchParams)) } catch (error: any) { page = { title: 'That didn’t work', text: String(error?.message ?? error).split('\n')[0], ok: false } }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(callbackPage(String(page?.title ?? 'Done'), String(page?.text ?? 'You can close this tab and go back to Hermes One.'), page?.ok !== false))
        return
      }
      // Only local tools: no browsers (they send Origin), no other host names (DNS rebinding), and the token.
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(req.headers.host ?? '')) || req.headers.origin) return bad(res, 403, 'Not allowed.', 'apps/forbidden')
      if (!authorized(req.headers.authorization)) return bad(res, 401, 'Missing or wrong token.', 'apps/unauthorized')
      // An app's files, exactly as hermes-app://<id>/<kind>/<rest> answers them in the window (web pages
      // with the bridge and their CSP, signed file links, audio streams), with Range passed through.
      const files = FILE_ROUTE.exec(url.pathname)
      if (files) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return bad(res, 405, 'Use GET.', 'apps/invalid')
        const headers = new Headers()
        if (req.headers.range) headers.set('range', String(req.headers.range))
        const answer = await runtime.respond(new Request(`${APP_SCHEME}://${files[1]}/${files[2]}/${files[3] ?? ''}${url.search}`, { method: req.method, headers }))
        const out: Record<string, string> = {}
        answer.headers.forEach((value, key) => { out[key] = value })
        res.writeHead(answer.status, out)
        if (!answer.body || req.method === 'HEAD') { res.end(); return }
        const stream = Readable.fromWeb(answer.body as any)
        stream.on('error', () => res.destroy())
        res.on('close', () => stream.destroy())
        stream.pipe(res)
        return
      }
      const body = req.method === 'POST' ? await readBody(req) : {}
      const id = String(body.id ?? body.app ?? url.searchParams.get('id') ?? '')
      const object = (value: unknown) => (typeof value === 'object' && value !== null ? value : {})
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /v1/health': return ok(res, { app: 'Hermes One', pid: process.pid })
        case 'GET /v1/apps': return ok(res, runtime.list())
        case 'POST /v1/act': return ok(res, await runtime.act({ app: id, action: String(body.action ?? ''), args: object(body.args), screen: String(body.screen ?? 'home'), params: object(body.params) }))
        case 'GET /v1/info':
        case 'POST /v1/info': {
          // No local paths: this goes to the phone.
          const { app, version, versions } = runtime.info(id)
          return ok(res, { app, version, versions })
        }
        case 'GET /v1/state':
        case 'POST /v1/state': return ok(res, await runtime.state(id))
        case 'GET /v1/feed': return ok(res, runtime.feed())
        case 'GET /v1/events': {
          // A long poll: answers at once when there is something after `after`, else waits up to `wait` seconds.
          const raw = url.searchParams.get('after')
          const after = raw === null || raw === '' ? undefined : Number(raw)
          const wait = Math.max(0, Math.min(30, Number(url.searchParams.get('wait')) || 0))
          let now = ring.since(after)
          if (after !== undefined && !now.events.length && !now.gap && wait > 0) {
            const next = ring.next(wait * 1000)
            res.on('close', next.stop)
            await next.done
            if (res.destroyed) return
            now = ring.since(after)
          }
          return ok(res, now)
        }
        case 'POST /v1/publish': return ok(res, await runtime.publish({ id, dir: body.dir ? String(body.dir) : undefined, bot: body.bot ? String(body.bot) : undefined, checkOnly: body.check_only === true || body.checkOnly === true }))
        case 'POST /v1/undo': return ok(res, await runtime.undo(id))
        case 'POST /v1/remove': return ok(res, await runtime.remove(id))
        case 'POST /v1/logs': {
          if (!runtime.exists(id)) return bad(res, 404, `There is no app called "${id}".`, 'apps/no-app')
          const lines = runtime.logs(id).split('\n')
          return ok(res, lines.slice(-Math.max(1, Math.min(300, Number(body.lines) || 120))).join('\n'))
        }
        case 'POST /v1/tool': return ok(res, await runtime.tool({ app: id, name: String(body.tool ?? body.name ?? ''), args: typeof body.args === 'object' && body.args ? body.args : {} }))
        case 'POST /v1/screen': {
          const rev = body.rev === undefined || body.rev === null ? undefined : Number(body.rev)
          return ok(res, await runtime.screen({ app: id, screen: String(body.screen ?? 'home'), params: object(body.params), rev: Number.isFinite(rev) ? rev : undefined }))
        }
        default: return bad(res, 404, 'Not found.', 'apps/not-found')
      }
    } catch (error: any) {
      bad(res, STATUS[error?.code] ?? 400, String(error?.message ?? error), error?.code ?? 'apps/error')
    }
  })
  server.requestTimeout = 180_000
  const listen = (port: number) => new Promise<number>((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error) }
    const onListening = () => { server.off('error', onError); resolve((server.address() as { port: number }).port) }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
  let remembered = 0
  try { remembered = Number.parseInt(fs.readFileSync(portFile, 'utf8'), 10) || 0 } catch { /* first launch */ }
  let port: number
  try { port = await listen(remembered > 1024 && remembered < 65536 ? remembered : 0) } catch { port = await listen(0) }
  try { fs.writeFileSync(portFile, String(port)) } catch { /* not critical */ }
  fs.writeFileSync(file, JSON.stringify({ url: `http://127.0.0.1:${port}`, port, token, pid: process.pid, started: Date.now() }), { mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch { /* best effort */ }
  return { server, port, token, file }
}

// ---------------------------------------------------------------------------------------------------
// Electron wiring: IPC for the window, hermes-app://, the control endpoint, macOS notifications.
// ---------------------------------------------------------------------------------------------------
function createNotifier(root: string, send: (channel: string, payload: unknown) => void) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  type Saved = { id: string; title?: string; text?: string; at: number; name: string }
  const file = (app: string) => path.join(root, app, 'notes.json')
  const load = (app: string): Saved[] => { try { const v = readJson(file(app)); return Array.isArray(v) ? v : [] } catch { return [] } }
  const save = (app: string, list: Saved[]) => { try { if (fs.existsSync(path.join(root, app))) fs.writeFileSync(file(app), JSON.stringify(list)) } catch { /* not critical */ } }
  const show = (app: string, name: string, note: { title?: string; text?: string }) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: String(note.title || name).slice(0, 120), body: String(note.text ?? '').slice(0, 400) })
    n.on('click', () => {
      const w = BrowserWindow.getAllWindows()[0]
      w?.show(); w?.focus()
      send('apps:event', { kind: 'open', app } satisfies AppsEvent)
    })
    n.show()
  }
  const arm = (app: string, entry: Saved) => {
    const key = `${app}:${entry.id}`
    clearTimeout(timers.get(key))
    const wait = entry.at - Date.now()
    if (wait <= 0) return
    timers.set(key, setTimeout(() => {
      timers.delete(key)
      if (entry.at - Date.now() > 1000) return arm(app, entry) // longer than a timer can wait: wait again
      save(app, load(app).filter((n) => n.id !== entry.id))
      show(app, entry.name, entry)
    }, Math.min(wait, 2 ** 31 - 1)))
  }
  return {
    handle(app: string, name: string, note: Note) {
      const id = String(note?.id ?? '').slice(0, 80)
      if (note?.cancel) {
        if (!id) return
        clearTimeout(timers.get(`${app}:${id}`))
        timers.delete(`${app}:${id}`)
        save(app, load(app).filter((n) => n.id !== id))
        return
      }
      const at = Number(note?.at)
      if (Number.isFinite(at) && at > Date.now() + 1000) {
        const entry: Saved = { id: id || crypto.randomUUID(), title: note.title, text: note.text, at, name }
        save(app, [...load(app).filter((n) => n.id !== entry.id), entry].slice(-100))
        arm(app, entry)
        return
      }
      show(app, name, note ?? {})
    },
    restore(apps: { id: string; name: string }[]) {
      for (const { id, name } of apps) {
        const keep = load(id).filter((n) => n.at > Date.now())
        save(id, keep)
        for (const entry of keep) arm(id, { ...entry, name })
      }
    },
    close() { for (const t of timers.values()) clearTimeout(t); timers.clear() },
  }
}

type Envelope = { ok: true; value: unknown } | { ok: false; error: { message: string; code?: string } }

export function registerApps(ipc: IpcMain, send: (channel: string, payload: unknown) => void): { pageConsole: (level: number, message: string, source: string) => void } {
  const root = path.join(electronApp.getPath('userData'), 'apps')
  fs.mkdirSync(root, { recursive: true })
  let controlPort = 0
  const notifier = createNotifier(root, send)
  const ring = createEventRing()
  const runtime = createAppsRuntime({
    root,
    srcRoot: defaultSourceRoot(),
    emit: (event) => { send('apps:event', event); ring.push(event) },
    notify: (app, name, note) => notifier.handle(app, name, note),
    callbackBase: () => (controlPort ? `http://127.0.0.1:${controlPort}` : undefined),
  })
  try { protocol.handle(APP_SCHEME, (request) => runtime.respond(request)) } catch (error) { console.warn('[apps] could not serve hermes-app://', error) }

  // Every handler answers { ok, value } or { ok: false, error }, so the window gets clean messages
  // (Electron would wrap a thrown error in "Error invoking remote method…").
  const handle = (channel: string, fn: (...args: any[]) => unknown) => {
    ipc.handle(channel, async (_event, ...args): Promise<Envelope> => {
      try { return { ok: true, value: await fn(...args) } } catch (error: any) { return { ok: false, error: { message: String(error?.message ?? error), code: error?.code } } }
    })
  }
  handle('apps:list', () => runtime.list())
  handle('apps:screen', (app: string, screen?: string, params?: unknown, rev?: number) => runtime.screen({ app, screen, params, rev }))
  handle('apps:act', (app: string, action: string, args?: unknown, screen?: string, params?: unknown) => runtime.act({ app, action, args, screen, params }))
  handle('apps:state', (app: string) => runtime.state(app))
  handle('apps:undo', (app: string) => runtime.undo(app))
  handle('apps:remove', (app: string) => runtime.remove(app))
  handle('apps:logs', (app: string) => runtime.logs(app))
  handle('apps:info', (app: string) => ({ ...runtime.info(app), callbackUrl: controlPort ? `http://127.0.0.1:${controlPort}/apps/${app}/callback` : undefined }))
  handle('apps:upload', (q: { app: string; action: string; name: string; path?: string; bytes?: Uint8Array; args?: unknown; screen?: string; params?: unknown }) => runtime.upload(q))
  handle('apps:feed', (feed: unknown) => { runtime.setFeed(feed) })
  handle('apps:notify', (app: string, note: Note) => { notifier.handle(app, runtime.summary(app)?.name ?? app, note ?? {}) })
  handle('apps:reveal', (app: string, what: 'source' | 'data' | 'version' = 'source') => {
    const i = runtime.info(app)
    const target = what === 'data' ? i.dataDir : what === 'version' ? i.versionDir : fs.existsSync(i.source) ? i.source : i.versionDir
    shell.showItemInFolder(target)
  })

  let control: Awaited<ReturnType<typeof startControlServer>> | undefined
  // Off-screen test copies leave the control endpoint (and its control.json) to the real app; one may publish a
  // test app (HERMES_ONE_TEST_APP, a source folder) into its own data (HERMES_ONE_USERDATA).
  if (process.env.HERMES_ONE_SNAPSHOT && process.env.HERMES_ONE_USERDATA && process.env.HERMES_ONE_TEST_APP) {
    const dir = process.env.HERMES_ONE_TEST_APP
    void runtime.publish({ id: path.basename(dir), dir }).then(() => console.log('[apps] test app published'), (e) => console.warn('[apps] test app failed', e?.message ?? e))
  }
  if (process.env.HERMES_ONE_SNAPSHOT) runtime.startBackground()
  else startControlServer(runtime, root, ring)
    .then((c) => { control = c; controlPort = c.port }, (error) => console.warn('[apps] control endpoint failed to start', error))
    .finally(() => runtime.startBackground())
  notifier.restore(runtime.names())
  electronApp.on('will-quit', () => {
    runtime.close()
    notifier.close()
    control?.server.close()
    // Only our own file: another Hermes One (a dev build) may have written its own since.
    if (control) { try { if (readJson(control.file)?.pid === process.pid) fs.rmSync(control.file, { force: true }) } catch { /* fine */ } }
  })
  // The window passes on what its frames print; lines from an app's page (hermes-app://<id>/…) go to that app's log.
  return {
    pageConsole(level, message, source) {
      const m = /^hermes-app:\/\/([a-z][a-z0-9-]{0,30})\//.exec(String(source ?? ''))
      if (m) runtime.pageLog(m[1], level >= 3 ? 'err' : level === 2 ? 'warn' : 'out', message)
    },
  }
}

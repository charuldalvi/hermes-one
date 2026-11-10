// The renderer's bridge to the Apps runtime (window.hermesNative.apps; typed in src/lib/apps.ts). Each
// call resolves with the runtime's value or throws an Error carrying the runtime's own message.
import { webUtils, type IpcRenderer } from 'electron'

type Envelope = { ok: true; value: unknown } | { ok: false; error?: { message?: string; code?: string } }

export function appsBridge(ipc: IpcRenderer) {
  const call = async (channel: string, ...args: unknown[]): Promise<any> => {
    const reply = (await ipc.invoke(channel, ...args)) as Envelope
    if (reply && reply.ok) return reply.value
    const error = new Error(reply?.error?.message || 'That didn’t work') as Error & { code?: string }
    error.code = reply?.error?.code
    throw error
  }
  return {
    list: () => call('apps:list'),
    screen: (app: string, screen?: string, params?: unknown, rev?: number) => call('apps:screen', app, screen, params, rev),
    act: (app: string, action: string, args?: unknown, screen?: string, params?: unknown) => call('apps:act', app, action, args, screen, params),
    state: (app: string) => call('apps:state', app),
    undo: (app: string) => call('apps:undo', app),
    remove: (app: string) => call('apps:remove', app),
    logs: (app: string) => call('apps:logs', app),
    info: (app: string) => call('apps:info', app),
    notify: (app: string, note: unknown) => call('apps:notify', app, note),
    // The agents feed (src/lib/feed.ts) for apps with the "agents" ability.
    feed: (feed: unknown) => call('apps:feed', feed),
    reveal: (app: string, what?: 'source' | 'data' | 'version') => call('apps:reveal', app, what),
    // A file picked for an app's action: its path when it has one (copied by the main process), else its bytes.
    upload: async (app: string, file: File, opts: { action: string; args?: unknown; screen?: string; params?: unknown }) => {
      let filePath = ''
      try { filePath = webUtils.getPathForFile(file) } catch { filePath = '' }
      return call('apps:upload', {
        app, action: opts.action, name: file.name, args: opts.args, screen: opts.screen, params: opts.params,
        ...(filePath ? { path: filePath } : { bytes: new Uint8Array(await file.arrayBuffer()) }),
      })
    },
    onEvent: (fn: (event: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => fn(payload)
      ipc.on('apps:event', handler)
      return () => { ipc.removeListener('apps:event', handler) }
    },
  }
}

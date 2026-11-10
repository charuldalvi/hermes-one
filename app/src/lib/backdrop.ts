// The window's frost and the chat background picture (Settings › This app). The main process keeps the
// picture file on this Mac and the window's frost and zoom (so the window opens right); the page shows the
// picture from memory (a blob), so it never needs the file's path.
import { applyPrefs, getPrefs, setPref } from './prefs'

let url: string | null = null

/** Loads the kept picture into the page (or clears it), and follows the window's own frost and zoom. */
export async function loadBackdrop() {
  const on = await window.hermesNative.frosted?.().catch(() => undefined)
  if (typeof on === 'boolean' && on !== getPrefs().frosted) setPref('frosted', on)
  const scale = await window.hermesNative.scale?.().catch(() => undefined)
  if (typeof scale === 'number' && scale !== getPrefs().scale) setPref('scale', scale)
  const pic = await window.hermesNative.picture?.().catch(() => null)
  if (url) { URL.revokeObjectURL(url); url = null }
  if (pic) url = URL.createObjectURL(new Blob([pic.data as BlobPart], { type: pic.mime }))
  document.documentElement.style.setProperty('--bg-pic', url ? `url("${url}")` : 'none')
  if (getPrefs().hasPicture !== !!pic) setPref('hasPicture', !!pic)
  else applyPrefs()
}

/** Asks for a picture; true when one was chosen and is now showing, or a reason it couldn't be opened. */
export async function choosePicture(): Promise<true | string | null> {
  const r = await window.hermesNative.pickPicture?.()
  if (!r) return null
  if ('error' in r) return r.error
  await loadBackdrop()
  return true
}

export async function removePicture() {
  await window.hermesNative.removePicture?.()
  await loadBackdrop()
}

export const pictureUrl = () => url

export function setFrosted(on: boolean) {
  setPref('frosted', on)
  void window.hermesNative.frosted?.(on)
}

export function setScale(v: number) {
  setPref('scale', v)
  void window.hermesNative.scale?.(v)
}

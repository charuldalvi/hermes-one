// Which computer Hermes One runs on, and its words for it.
//
// The screens are written in a Mac's words ("this Mac", ⌘K, Finder). On Windows a small pass swaps Hermes One's
// own words for Windows' ("this PC", Ctrl+K, File Explorer) as they appear, in text and in tooltips and
// placeholders. It never touches what people and agents wrote: messages, your own text, code, app screens and
// anything you type.
export const PLATFORM: string = window.hermesNative?.platform ?? 'darwin'
export const IS_MAC = PLATFORM === 'darwin'
export const IS_WIN = PLATFORM === 'win32'

// Most specific first.
const RULES: [RegExp, string][] = [
  [/⌘\+/g, 'Ctrl+Plus'], [/⌘−/g, 'Ctrl+Minus'], [/⌘ ?/g, 'Ctrl+'],
  [/⌥-click/g, 'Alt+click'], [/⌥ ?/g, 'Alt+'], [/⇧ ?/g, 'Shift+'],
  [/\bShow in Finder\b/g, 'Show in File Explorer'], [/\bFinder\b/g, 'File Explorer'],
  [/\bA Mac notification\b/g, 'A Windows notification'], [/\bMac notification/g, 'Windows notification'],
  [/\bmacOS’/g, 'Windows’'], [/\bmacOS's/g, "Windows'"], [/\bmacOS\b/g, 'Windows'],
  [/\bMac’s\b/g, 'PC’s'], [/\bMac's\b/g, "PC's"], [/\bMacs\b/g, 'PCs'], [/\bMac\b/g, 'PC'],
  [/\bthe Dock icon\b/g, 'the taskbar icon'], [/\bDock icon\b/g, 'taskbar icon'], [/\bthe Dock\b/g, 'the taskbar'],
]
const MAYBE = /[⌘⌥⇧]|Finder|Mac|Dock/
// What is never rewritten: rendered messages, your own bubbles, code, app screens, and editable text.
const KEEP = '.md, .you, .ha-blocks, pre, code, textarea, [contenteditable]'
const ATTRS = ['title', 'placeholder', 'aria-label']

/** A Mac phrase in this computer's words (unchanged on a Mac). */
export function localWords(text: string): string {
  if (IS_MAC || !MAYBE.test(text)) return text
  let out = text
  for (const [re, to] of RULES) out = out.replace(re, to)
  return out
}

function fixText(node: Text) {
  const parent = node.parentElement
  const value = node.nodeValue ?? ''
  if (!parent || !MAYBE.test(value) || parent.closest(KEEP)) return
  const fixed = localWords(value)
  if (fixed !== value) node.nodeValue = fixed
}
function fixAttrs(el: Element) {
  for (const name of ATTRS) {
    const value = el.getAttribute(name)
    if (!value || !MAYBE.test(value)) continue
    const fixed = localWords(value)
    if (fixed !== value) el.setAttribute(name, fixed)
  }
}
function fixTree(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) return fixText(node as Text)
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const root = node as Element
  // Inside kept content: an input's placeholder or a button's tooltip is still Hermes One's own word.
  if (root.closest('.md, .you, .ha-blocks, pre, code')) return
  fixAttrs(root)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && (n as Element).matches('.md, .you, .ha-blocks, pre, code') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) fixText(n as Text)
    else fixAttrs(n as Element)
  }
}

/** On Windows (or Linux), keep Hermes One's own words in this computer's terms as screens change. */
export function startLocalWords() {
  document.documentElement.dataset.platform = PLATFORM
  if (IS_MAC) return
  fixTree(document.body)
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') fixText(r.target as Text)
      else if (r.type === 'attributes') { if (!(r.target as Element).closest('.md, .you, .ha-blocks, pre, code')) fixAttrs(r.target as Element) }
      else r.addedNodes.forEach(fixTree)
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
}

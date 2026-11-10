// What needs you: an approval (Dismiss · Allow for this chat · Approve & Run) or a question (pick an answer
// or type one). The plan card from the reference: an inset header with a warm tile, then the detail.
import { useRef, useState } from 'react'
import { answerApproval, answerInput, answerQuestion, prettyName } from '../lib/hermes'
import { Icon } from '../lib/icons'
import { fly, pop } from '../lib/motion'
import type { Bot, Need } from '../lib/store'

export function NeedCard({ need, bot }: { need: Need; bot?: Bot }) {
  const card = useRef<HTMLDivElement>(null)
  const [typed, setTyped] = useState('')
  const who = bot?.name ?? prettyName(need.profile)

  if (need.outcome) {
    return (
      <div className="plan" ref={card}>
        <div className="outcome">
          {need.outcome.ok
            ? <span className="okb" ref={(el) => { if (el) pop(el, `ok-${need.key}`) }}><Icon name="check" size={11} /></span>
            : <span className="nob"><Icon name="x" size={11} /></span>}
          {need.outcome.label}
          <span className="sub">· {need.kind === 'approval' ? need.title : who}</span>
        </div>
      </div>
    )
  }

  // The pressed button travels into the tick as the card folds (a shared move).
  const decide = (choice: 'once' | 'session' | 'always' | 'deny', from?: HTMLElement | null) => {
    if (from) {
      const ghostTarget = card.current
      requestAnimationFrame(() => { const tick = ghostTarget?.querySelector<HTMLElement>('.okb, .nob'); if (tick) fly(from, tick, { k: 420, z: 0.8, fade: true }) })
    }
    void answerApproval(need, choice)
  }

  if (need.kind === 'input') return <InputCard need={need} who={who} />

  if (need.kind === 'approval') {
    const choices = need.choices ?? ['once', 'deny']
    return (
      <div className="plan" ref={card}>
        <div className="ph"><span className="tile"><Icon name="terminal" size={18} /></span><span className="tt">{need.description || 'Run a command'}</span><span className="cnt">{who} asks</span></div>
        <div className="pb">
          {need.command ? <div className="cmd">{need.command}</div> : null}
          <div className="why">{who} needs your OK before it does this. It stays waiting until you answer.</div>
        </div>
        <div className="ft">
          <button className="b-text" onClick={(e) => decide('deny', e.currentTarget)}>Deny</button>
          <span className="sp" />
          {choices.includes('always') ? <button className="b-text" onClick={(e) => decide('always', e.currentTarget)}>Always allow</button> : null}
          {choices.includes('session') ? <button className="b-soft" onClick={(e) => decide('session', e.currentTarget)}>Allow for this chat</button> : null}
          <button className="b-pri" onClick={(e) => decide('once', e.currentTarget)}>Approve &amp; Run</button>
        </div>
      </div>
    )
  }

  const q = need.questions?.[0]
  return (
    <div className="plan" ref={card}>
      <div className="ph"><span className="tile"><Icon name="question" size={18} /></span><span className="tt">{q?.question || need.title}</span><span className="cnt">{who} asks</span></div>
      <div className="choices">
        {(q?.choices ?? []).map((c) => {
          const rec = /\s*\(recommended\)\s*/i.test(c)
          const label = c.replace(/\s*\(recommended\)\s*/i, ' ').trim()
          return <button key={c} className="choice" onClick={() => void answerQuestion(need, c)}><i />{label}{rec ? <em>Recommended</em> : null}</button>
        })}
        <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) void answerQuestion(need, typed.trim()) }}>
          <input className="answer" placeholder={q?.choices?.length ? 'Or type your own answer' : 'Type your answer'} value={typed} onChange={(e) => setTyped(e.target.value)} />
        </form>
      </div>
    </div>
  )
}

/** Something Hermes needs you to type: masked for passwords and keys, plain for one-time codes. */
function InputCard({ need, who }: { need: Need; who: string }) {
  const m = need.input?.method ?? 'secret'
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const login = m === 'vault.save_login'
  const code = m === 'vault.code'
  const ready = login ? !!a.trim() && !!b : !!a.trim()
  const send = () => { if (!ready) return; answerInput(need, login ? JSON.stringify({ identifier: a.trim(), password: b }) : code ? a.replace(/[\s-]/g, '') : a); setA(''); setB('') }
  const why = m === 'sudo' ? `${who} wants to run this as administrator:` : m === 'display.install.sudo' ? 'Installing the agent screen needs administrator rights.' : m === 'secret' ? `${who} needs ${need.input?.envVar ?? 'a key'} to continue. It’s saved in Hermes’ keys, not shown again.` : code ? `${need.input?.hint || 'The site sent a code.'}` : login ? 'Hermes keeps it encrypted and fills it in next time.' : `${who} needs the vault unlocked to sign in.`
  return (
    <div className="plan">
      <div className="ph"><span className="tile"><Icon name={code ? 'key' : 'lock'} size={18} /></span><span className="tt">{need.title}</span></div>
      <div className="pb">
        <div className="why">{why}</div>
        {need.input?.command ? <div className="cmd">{need.input.command}</div> : null}
        {login ? <input className="answer" placeholder="Email or username" value={a} autoComplete="off" onChange={(e) => setA(e.target.value)} /> : null}
        <input className="answer" type={code ? 'text' : 'password'} autoComplete={code ? 'one-time-code' : 'off'} placeholder={code ? '123456' : login ? 'Password' : m === 'secret' ? (need.input?.envVar ?? 'Key') : 'Password'}
          value={login ? b : a} onChange={(e) => (login ? setB(e.target.value) : setA(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') send() }} />
      </div>
      <div className="ft"><span className="sp" /><button className="b-text" onClick={() => answerInput(need, '')}>{login ? 'Don’t save' : 'Skip'}</button><button className="b-pri" disabled={!ready} onClick={send}>{login ? 'Save' : code ? 'Send code' : 'Send'}</button></div>
    </div>
  )
}

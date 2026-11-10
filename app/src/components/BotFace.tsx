// An agent's Quicksilver: Hermes Remote's QuicksilverAvatar (a soft disc of the agent's colour, its crew shape,
// its resting pose, live moods). The bead lives outside React and draws itself on its own clock.
// `disc={false}` draws the bead on its own, with no round disc behind it: the agent's own shape and colour, always
// in the plain front pose. Empty states always use it (the user's rules: the disc and the resting poses belong to
// the sidebar and lists; an empty state shows the agent's own bead shape, facing front).
import { useEffect, useRef } from 'react'
// @ts-ignore plain JS engine
import { Bead, POSES, poseFor, startQuicksilver } from '../quicksilver/engine.js'
import { lookOf } from '../lib/looks'

export type Mood = 'idle' | 'thinking' | 'writing' | 'hand' | 'knock' | 'callout' | 'hop' | 'splash' | 'nod' | 'doze' | 'search'

export function BotFace({ profile, size, mood = 'idle', poseKey, watch, className, disc = true }: {
  profile: string; size: number; mood?: Mood; poseKey?: string; watch?: boolean; className?: string; disc?: boolean
}) {
  const host = useRef<HTMLSpanElement>(null)
  // The agent's own shape, colour and resting pose (lib/looks.ts); a new look redraws the bead.
  const look = lookOf(profile)
  const lookKey = look ? `${look.shape}/${look.color}/${look.pose}` : ''
  const bead = useRef<any>(null)
  useEffect(() => {
    startQuicksilver()
    const b: any = new (Bead as any)({ size, profile, disc, watch: watch ?? size >= 40, badge: false })
    const pose = !disc ? POSES.Round : look ? ((POSES as Record<string, number[]>)[look.pose] ?? POSES.Round) : poseKey ? poseFor(poseKey) : POSES.Round
    b.eng.poseArr = pose; b.poseArr = pose
    b.el.style.position = 'absolute'; b.el.style.left = '0px'; b.el.style.top = '0px'
    host.current?.appendChild(b.el)
    bead.current = b
    b.setMood(mood)
    return () => { b.destroy(); bead.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, size, poseKey, disc, lookKey])
  useEffect(() => { bead.current?.setMood(mood) }, [mood])
  return <span ref={host} className={`face ${className ?? ''}`} style={{ width: size, height: size }} data-face={profile} />
}

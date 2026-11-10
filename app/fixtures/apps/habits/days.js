// Day arithmetic for Habits: days are local calendar days, kept as "YYYY-MM-DD" keys.
export const DAY = 24 * 60 * 60 * 1000

export function dayKey(time = Date.now()) {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The last `count` days, oldest first, as times. */
export function lastDays(count, now = Date.now()) {
  return Array.from({ length: count }, (_, i) => now - (count - 1 - i) * DAY)
}

/** Days in a row up to today (or up to yesterday, when today isn't ticked yet). */
export function streakOf(done = {}, now = Date.now()) {
  let time = done[dayKey(now)] ? now : now - DAY
  let streak = 0
  while (done[dayKey(time)]) {
    streak += 1
    time -= DAY
  }
  return streak
}

export function bestStreak(done = {}) {
  const days = Object.keys(done).filter((key) => done[key]).sort()
  let best = 0
  let run = 0
  let previous
  for (const key of days) {
    const time = new Date(`${key}T12:00:00`).getTime()
    run = previous !== undefined && Math.round((time - previous) / DAY) === 1 ? run + 1 : 1
    best = Math.max(best, run)
    previous = time
  }
  return best
}

export const weekday = (time) => new Date(time).toLocaleDateString('en', { weekday: 'short' }).slice(0, 2)

/** The next time the clock reads `hour`:00, today or tomorrow. */
export function nextAt(hour, now = Date.now()) {
  const d = new Date(now)
  d.setHours(hour, 0, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
}

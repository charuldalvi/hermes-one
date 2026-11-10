// Habits: tick off daily habits, keep streaks, and get a nudge in the evening. A complete Hermes One
// app: two screens, actions, tools bots can call with use_app, a chart, and a scheduled notification.
import { bestStreak, dayKey, lastDays, nextAt, streakOf, weekday } from './days.js'

const ICONS = ['check', 'book', 'dumbbell', 'leaf', 'coffee', 'bike', 'heart', 'moon', 'sun', 'note']
const REMINDER = 'evening'

const today = () => dayKey()
const doneToday = (state, habit) => Boolean(state.done[habit.id]?.[today()])
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function addHabit(state, name) {
  const clean = String(name ?? '').trim().slice(0, 60)
  if (!clean) return undefined
  const habit = { id: crypto.randomUUID().slice(0, 8), name: clean, icon: ICONS[state.habits.length % ICONS.length], created: Date.now() }
  state.habits.push(habit)
  state.done[habit.id] = {}
  return habit
}

const find = (state, text) => {
  const q = String(text ?? '').toLowerCase().trim()
  return state.habits.find((h) => h.id === q) ?? state.habits.find((h) => h.name.toLowerCase() === q) ?? state.habits.find((h) => h.name.toLowerCase().includes(q))
}

function habitRow(state, habit) {
  const streak = streakOf(state.done[habit.id])
  return {
    type: 'row',
    title: habit.name,
    subtitle: streak ? `${plural(streak, 'day')} in a row` : 'Start a streak today',
    icon: habit.icon,
    toggle: { on: doneToday(state, habit), action: { do: 'act', name: 'tick', args: { id: habit.id } } },
    action: { do: 'open', screen: 'habit', params: { id: habit.id } },
    menu: [
      { label: 'Open', icon: 'chart', action: { do: 'open', screen: 'habit', params: { id: habit.id } } },
      { label: 'Delete', icon: 'trash', danger: true, action: { do: 'confirm', text: `Delete “${habit.name}” and its history?`, button: 'Delete', danger: true, then: { do: 'act', name: 'remove', args: { id: habit.id } } } }
    ]
  }
}

function scheduleReminder(state, hermes) {
  const left = state.habits.filter((h) => !doneToday(state, h)).length
  hermes.notify({ id: REMINDER, at: nextAt(state.remindHour), title: 'Habits', text: left ? `${plural(left, 'habit')} left for today` : 'Time to tick off today’s habits' })
}

export default {
  state: { habits: [], done: {}, filter: 'all', remind: false, remindHour: 21 },

  screens: {
    home: ({ state }) => {
      const total = state.habits.length
      const ticked = state.habits.filter((h) => doneToday(state, h)).length
      const shown = state.habits.filter((h) => state.filter === 'all' || (state.filter === 'done') === doneToday(state, h))
      const week = lastDays(7)
      const best = Math.max(0, ...state.habits.map((h) => bestStreak(state.done[h.id])))
      return {
        title: 'Habits',
        subtitle: total ? `${ticked} of ${total} done today` : 'Nothing to track yet',
        actions: total ? [{ icon: 'refresh', label: 'Clear today', action: { do: 'confirm', text: 'Untick every habit for today?', button: 'Clear', then: { do: 'act', name: 'clearToday' } } }] : [],
        body: [
          { type: 'field', placeholder: 'New habit, like “Read 20 pages”', button: 'Add', action: { do: 'act', name: 'add' } },
          total === 0 && { type: 'empty', icon: 'check', title: 'No habits yet', text: 'Add one above, then tick it off each day to build a streak.' },
          total > 0 && {
            type: 'grid', columns: 3, children: [
              { type: 'stat', label: 'Today', value: `${ticked}/${total}`, tone: ticked === total ? 'ok' : undefined },
              { type: 'stat', label: 'Best streak', value: String(best), hint: best === 1 ? 'day' : 'days' },
              { type: 'stat', label: 'This week', value: `${Math.round((100 * week.reduce((n, t) => n + state.habits.filter((h) => state.done[h.id]?.[dayKey(t)]).length, 0)) / (7 * total))}%` }
            ]
          },
          total > 0 && { type: 'progress', value: total ? ticked / total : 0, label: ticked === total ? 'All done for today' : `${plural(total - ticked, 'habit')} to go` },
          total > 0 && {
            type: 'section', label: 'Today', trailing: plural(shown.length, 'habit'),
            children: [
              { type: 'segmented', value: state.filter, action: { do: 'act', name: 'filter' }, options: [{ value: 'all', label: 'All' }, { value: 'todo', label: 'To do' }, { value: 'done', label: 'Done' }] },
              ...(shown.length ? shown.map((h) => habitRow(state, h)) : [{ type: 'text', text: state.filter === 'done' ? 'Nothing ticked yet today.' : 'Everything is done. Nice.', style: 'caption', color: 'text2', align: 'center' }])
            ]
          },
          total > 0 && {
            type: 'section', label: 'Last 7 days',
            children: [{ type: 'chart', kind: 'bar', points: week.map((t) => ({ label: weekday(t), value: state.habits.filter((h) => state.done[h.id]?.[dayKey(t)]).length })) }]
          },
          { type: 'divider' },
          { type: 'toggle', label: `Remind me at ${state.remindHour > 12 ? state.remindHour - 12 : state.remindHour} ${state.remindHour >= 12 ? 'pm' : 'am'}`, on: state.remind, action: { do: 'act', name: 'remind' } },
          state.remind && { type: 'slider', label: 'Reminder hour', value: state.remindHour, min: 6, max: 23, step: 1, action: { do: 'act', name: 'remindHour' } }
        ]
      }
    },

    habit: ({ state, params }) => {
      const habit = state.habits.find((h) => h.id === params.id)
      if (!habit) return { title: 'Gone', body: [{ type: 'empty', icon: 'trash', title: 'This habit was deleted', button: 'Back', action: { do: 'back' } }] }
      const done = state.done[habit.id] ?? {}
      const month = lastDays(30)
      const count = Object.values(done).filter(Boolean).length
      return {
        title: habit.name,
        subtitle: `Since ${new Date(habit.created).toLocaleDateString('en', { day: 'numeric', month: 'long' })}`,
        body: [
          {
            type: 'stack', children: [
              { type: 'stat', label: 'Streak', value: String(streakOf(done)), tone: doneToday(state, habit) ? 'ok' : undefined },
              { type: 'stat', label: 'Best', value: String(bestStreak(done)) },
              { type: 'stat', label: 'Total', value: String(count) }
            ]
          },
          { type: 'chart', kind: 'line', label: 'Last 30 days', points: month.map((t) => ({ label: '', value: done[dayKey(t)] ? 1 : 0 })) },
          { type: 'progress', label: `${month.filter((t) => done[dayKey(t)]).length} of the last 30 days`, value: month.filter((t) => done[dayKey(t)]).length / 30 },
          {
            type: 'stack', children: [
              { type: 'button', label: doneToday(state, habit) ? 'Done today' : 'Tick today', icon: 'check', style: doneToday(state, habit) ? 'secondary' : 'primary', action: { do: 'act', name: 'tick', args: { id: habit.id, on: !doneToday(state, habit) } } },
              { type: 'button', label: 'Delete', icon: 'trash', style: 'danger', action: { do: 'confirm', text: `Delete “${habit.name}” and its history?`, button: 'Delete', danger: true, then: { do: 'act', name: 'remove', args: { id: habit.id, back: true } } } }
            ]
          },
          { type: 'badge', text: doneToday(state, habit) ? 'Done today' : 'Not yet today', tone: doneToday(state, habit) ? 'ok' : 'amber' }
        ]
      }
    }
  },

  actions: {
    add: ({ state }, { text }) => {
      const habit = addHabit(state, text)
      if (!habit) return { do: 'toast', text: 'Type a habit first' }
      return { do: 'toast', text: `Added ${habit.name}` }
    },
    tick: ({ state, hermes }, { id, on }) => {
      const habit = state.habits.find((h) => h.id === id)
      if (!habit) return { do: 'toast', text: 'That habit is gone' }
      const value = on === undefined ? !doneToday(state, habit) : Boolean(on)
      state.done[id] = { ...(state.done[id] ?? {}), [today()]: value }
      if (state.remind) scheduleReminder(state, hermes)
      const left = state.habits.filter((h) => !doneToday(state, h)).length
      if (value && left === 0) return { do: 'toast', text: 'Everything done for today' }
      return undefined
    },
    filter: ({ state }, { value }) => { state.filter = ['all', 'todo', 'done'].includes(value) ? value : 'all' },
    remove: ({ state }, { id, back }) => {
      const habit = state.habits.find((h) => h.id === id)
      state.habits = state.habits.filter((h) => h.id !== id)
      delete state.done[id]
      const toast = { do: 'toast', text: habit ? `Deleted ${habit.name}` : 'Deleted' }
      return back ? [toast, { do: 'back' }] : toast
    },
    clearToday: ({ state }) => {
      for (const habit of state.habits) if (state.done[habit.id]) state.done[habit.id][today()] = false
    },
    remind: ({ state, hermes }, { on }) => {
      state.remind = Boolean(on)
      if (state.remind) {
        scheduleReminder(state, hermes)
        return { do: 'toast', text: 'You’ll get a nudge every evening' }
      }
      hermes.notify({ id: REMINDER, cancel: true })
      return undefined
    },
    remindHour: ({ state, hermes }, { value }) => {
      state.remindHour = Math.max(6, Math.min(23, Math.round(Number(value) || 21)))
      if (state.remind) scheduleReminder(state, hermes)
    }
  },

  tools: {
    add_habit: {
      description: 'Add a habit for the user to track every day.',
      parameters: { name: { type: 'string', description: 'The habit, like "Read 20 pages"' } },
      run: ({ state }, { name }) => {
        const habit = addHabit(state, name)
        return habit ? `Added “${habit.name}”.` : 'Give the habit a name.'
      }
    },
    tick_habit: {
      description: 'Mark one of the user\'s habits as done today.',
      parameters: { name: { type: 'string', description: 'The habit\'s name, or part of it' } },
      run: ({ state }, { name }) => {
        const habit = find(state, name)
        if (!habit) return `No habit matches “${name}”. Habits: ${state.habits.map((h) => h.name).join(', ') || 'none yet'}.`
        state.done[habit.id] = { ...(state.done[habit.id] ?? {}), [today()]: true }
        return `Ticked “${habit.name}” for today (${plural(streakOf(state.done[habit.id]), 'day')} in a row).`
      }
    },
    today: {
      description: 'What the user has and hasn\'t done today, with streaks.',
      parameters: {},
      run: ({ state }) => state.habits.length
        ? state.habits.map((h) => `${doneToday(state, h) ? '✓' : '·'} ${h.name} (${plural(streakOf(state.done[h.id]), 'day')} in a row)`).join('\n')
        : 'No habits yet.'
    }
  },

  // A reminder rings once; when the app starts again it books the next evening.
  start({ state, hermes }) {
    if (state.remind) scheduleReminder(state, hermes)
  }
}

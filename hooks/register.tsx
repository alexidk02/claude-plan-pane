import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Agent, Calendar, Group, Plan, Pose, Step, StepStatus, Todo } from '../types'
import { fetchCalendar } from './calendar'
import type { CalendarOptions } from './calendar'

const PANE = 'plan-steps'
const TOOL = 'mcp__plan-steps__plan_step'
// Change a tag when its value's fields change: it declines what an earlier version stored.
const planAtom = atom({ plugin: 'plan-steps', key: 'plan' } as const, null, { shape: 'plan-3' })
const todosAtom = atom({ plugin: 'plan-steps', key: 'todos' } as const, [], { shape: 'todos-1' })
const agentAtom = atom({ plugin: 'plan-steps', key: 'agent' } as const, { activity: 'waiting for you', pose: 'work', isWorking: false, frame: 0 }, { shape: 'agent-2' })
const usedSkillsAtom = atom({ plugin: 'plan-steps', key: 'usedSkills' } as const, [], { shape: 'used-1' })
const expandedAtom = atom({ plugin: 'plan-steps', key: 'expanded' } as const, [], { shape: 'expanded-1' })
const calendarAtom = atom({ plugin: 'plan-steps', key: 'calendar' } as const, null, { shape: 'calendar-3' })

const CAL_COLUMN = 17 // narrowest day column: "●08:10 Lecture 1"

/** The plugin's userConfig values as the calendar section uses them, defaults filled in. */
export function settingsOf(options: Record<string, unknown>) {
  const str = (k: string, d = '') => (typeof options[k] === 'string' ? (options[k] as string) : d)
  const num = (k: string, d: number) => (typeof options[k] === 'number' && Number.isFinite(options[k]) ? (options[k] as number) : d)
  const cal: CalendarOptions = {
    user: str('calendarUser').trim(), password: str('calendarPassword').trim(), serverUrl: str('serverUrl', 'https://caldav.icloud.com'),
    days: Math.max(1, Math.min(14, num('days', 7))), timeZone: str('timeZone'), hidden: str('hiddenCalendars').split(','),
  }
  return {
    cal,
    isShown: options.showCalendar !== false,
    hasLogin: !!cal.user && !!cal.password,
    layout: str('layout', 'columns') === 'list' ? ('list' as const) : ('columns' as const),
    position: str('position', 'bottom') === 'top' ? ('top' as const) : ('bottom' as const),
    refreshMinutes: Math.max(1, num('refreshMinutes', 15)),
  }
}

async function refreshCalendar($: EngineInterface, o: CalendarOptions): Promise<void> {
  let next: Calendar
  try {
    next = await fetchCalendar($, o)
  } catch (err) {
    const prev = await read($, calendarAtom)
    next = { ...(prev ?? { days: [], events: [] }), error: String((err as Error)?.message ?? err).slice(0, 80) }
  }
  await update($, calendarAtom, () => next)
}

// Sections that describe rather than do: shown as no steps.
const NOT_STEPS = /^(context|background|why|risks?|notes?|sources|skills?|ambition|goals?|summary|(critical )?files)\b/i
// A checks section with no numbered items still closes the plan as one step.
const CHECKS = /^(verification|verify|testing|tests?)\b/i
const SKILLS = /^skills?\b/i
// When a plan has a section with one of these names, only it (and checks) holds the steps; other numbered lists (a recipe, a format) are content.
const STEPS = /^(steps|implementation( steps)?|pași|pasi)\b/i

const clean = (s: string) =>
  s.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/:\s*$/, '').trim()

/** `anthropic-skills:pptx` → `pptx`, so the plan's names match what the Skill tool is called with. */
export const shortSkill = (s: string) => s.replace(/^.*:/, '')

/** The short name of a step: its bold lead if it has one, else its first clause; parentheses dropped. */
export function labelOf(raw: string): string {
  const bold = raw.match(/^\*\*(.+?)\*\*/)
  const lead = bold ? clean(bold[1]) : (clean(raw).match(/^(.{1,60}?)(?:[.:;—–]\s|\s-\s|$)/)?.[1] ?? clean(raw))
  return lead.replace(/\s*\([^)]*\)/g, '').replace(/[.:]$/, '').trim() || clean(raw)
}

/**
 * Plan markdown → groups of numbered steps: `##`/`###` headings are groups, top-level list items are steps.
 * When the plan numbers its steps (`1.`), only numbered items count, so bullets under other sections stay out.
 * Backticked names in a "Skills" section's bullets (before any dash) become the plan's skills.
 */
export function parsePlan(md: string, path: string): Plan {
  let title = 'Plan'
  const found: { title: string; isChecks: boolean; items: { raw: string; isNumbered: boolean }[] }[] = []
  const skills: string[] = []
  let group: (typeof found)[number] | null = null
  let skip = false
  let isSkills = false
  for (const line of md.split(/\r?\n/)) {
    const h1 = line.match(/^#\s+(.+)/)
    if (h1) { title = clean(h1[1]); continue }
    const h = line.match(/^#{2,3}\s+(.+)/)
    if (h) {
      const t = clean(h[1])
      skip = NOT_STEPS.test(t)
      isSkills = SKILLS.test(t)
      group = skip ? null : { title: t, isChecks: CHECKS.test(t), items: [] }
      if (group) found.push(group)
      continue
    }
    const item = line.match(/^(\d+\.|[-*])\s+(.+)/) // top level only: no indentation
    if (item && isSkills) {
      for (const m of item[2].split(/\s[—–-]\s/)[0].matchAll(/`([^`]+)`/g)) {
        const name = shortSkill(m[1])
        if (!skills.includes(name)) skills.push(name)
      }
    } else if (item && !skip) {
      if (!group) { group = { title: 'Steps', isChecks: false, items: [] }; found.push(group) }
      group.items.push({ raw: item[2], isNumbered: /\d/.test(item[1]) })
    }
  }
  const isNumberedPlan = found.some(g => g.items.some(i => i.isNumbered))
  const hasStepsSection = found.some(g => STEPS.test(g.title) && g.items.length)
  const groups: Group[] = []
  for (const g of found) {
    if (hasStepsSection && !STEPS.test(g.title) && !g.isChecks) continue
    const items = isNumberedPlan ? g.items.filter(i => i.isNumbered) : g.items
    if (items.length) groups.push({ title: g.title, steps: items.map(i => ({ n: 0, label: labelOf(i.raw), text: clean(i.raw), status: 'pending' })) })
    // A heading with no list under it is one step of its own.
    else if (!isNumberedPlan || g.isChecks) groups.push({ title: g.title, steps: [{ n: 0, label: g.title, text: g.title, status: 'pending' }] })
  }
  let n = 0
  for (const g of groups) for (const s of g.steps) s.n = ++n
  return { path, title, isApproved: false, groups, skills }
}

/** Keeps statuses across a rewrite of the same plan file, matched by step text. */
export function carryStatuses(next: Plan, prev: Plan | null): Plan {
  if (!prev || prev.path !== next.path) return next
  const old = new Map(prev.groups.flatMap(g => g.steps).map(s => [s.text, s.status]))
  return {
    ...next,
    isApproved: prev.isApproved,
    groups: next.groups.map(g => ({ ...g, steps: g.steps.map(s => ({ ...s, status: old.get(s.text) ?? s.status })) })),
  }
}

/** A progress bar `width` cells wide, with eighth-blocks for the partly filled cell. */
export function barOf(fraction: number, width: number): { filled: string; empty: string } {
  const cells = Math.max(0, Math.min(1, fraction)) * width
  const full = Math.floor(cells)
  const part = full < width ? ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'][Math.floor((cells - full) * 8)] : ''
  return { filled: '█'.repeat(full) + part, empty: '░'.repeat(width - full - (part ? 1 : 0)) }
}

/** What the little Claude is doing for a tool call, and the pose that shows it. */
export function activityOf(e: { tool: string } & Record<string, unknown>): { activity: string; pose: Pose } | null {
  const str = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  const ext = (str('file_path').match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  switch (e.tool) {
    case TOOL: return null
    case 'Read':
      return /^(png|jpe?g|gif|webp|pdf|svg)$/.test(ext) ? { activity: 'looking at the pictures', pose: 'look' } : { activity: 'reading files', pose: 'read' }
    case 'Write': case 'Edit': case 'NotebookEdit':
      if (/^(js|mjs|cjs|ts|tsx|jsx|py|ps1|json)$/.test(ext)) return { activity: 'coding', pose: 'code' }
      if (/^(pptx|svg|png|css|html)$/.test(ext)) return { activity: 'drawing', pose: 'draw' }
      return { activity: 'writing', pose: 'write' }
    case 'Bash': case 'PowerShell': {
      const cmd = str('command')
      if (/soffice|pdftoppm|\.pptx/i.test(cmd)) return { activity: 'rendering the slides', pose: 'draw' }
      if (/\bnode\b|\bnpm\b|\bpython\b|\btsc\b|plugin test/i.test(cmd)) return { activity: 'running code', pose: 'code' }
      return { activity: 'running a command', pose: 'run' }
    }
    case 'Grep': case 'Glob': return { activity: 'searching files', pose: 'search' }
    case 'WebSearch': case 'WebFetch': return { activity: 'browsing the web', pose: 'web' }
    case 'Skill': return { activity: `studying ${shortSkill(str('skill'))}`, pose: 'read' }
    case 'Agent': return { activity: `briefing ${str('subagent_type') || 'a helper'}`, pose: 'agent' }
    case 'AskUserQuestion': return { activity: 'asking you something', pose: 'ask' }
    default: return { activity: 'working', pose: 'work' }
  }
}

// The little Claude, 9 columns wide: head, body, legs; a pose may swap the head or body and adds a prop to the right.
const HEAD = ' ▐▛███▜▌ '
const GLASSES = ' ▐▛o-o▜▌ '
const ASLEEP = ' ▐▄███▄▌ '
const BODY = '▝▜█████▛▘'
const ARMS_UP = '▗▟█████▙▖'
const TYPING = ['▝▜█████▛▘', '▗▜█████▛▖']
const LEGS = ['  ▘▘ ▝▝  ', '  ▝▘ ▘▝  ']
type Look = { head?: string; body?: string[]; props: [string, string, string][]; walks?: boolean }
const POSES: Record<Pose | 'sleep' | 'cheer', Look> = {
  read: { head: GLASSES, props: [['', ' ╔╤╗', ' ╚╧╝'], ['', ' ╔═╗', ' ╚═╝']] },
  look: { head: GLASSES, props: [[' ┌──┐', ' │▤ │', ' └──┘'], [' ┌──┐', ' │ ▤│', ' └──┘']] },
  write: { props: [['', ' ✎', ' _'], ['', '  ✎', ' __'], ['', '   ✎', ' ___']] },
  code: { body: TYPING, props: [[' </>', '', ' ▀▀▀▀'], [' </>▌', '', ' ▀▀▀▀']] },
  draw: { props: [['', ' ✎', ' ╱'], ['', '  ✎', ' ╱╲'], ['', '   ✎', ' ╱╲╱']] },
  search: { props: [['', ' ○', '  ╲'], ['', '  ○', '   ╲']] },
  web: { props: [['', ' ◐', ''], ['', ' ◓', ''], ['', ' ◑', ''], ['', ' ◒', '']] },
  run: { props: [['', ' >_', ''], ['', ' > ', '']] },
  think: { walks: true, props: [[' ∘', '', ''], [' ○', '', ''], [' ◯', '', '']] },
  agent: { props: [[' ·', '  ▗▄▖', '  ▝▀▘'], [' ··', '  ▗▄▖', '  ▝▀▘'], [' ···', '  ▗▄▖', '  ▝▀▘']] },
  ask: { body: [ARMS_UP], props: [[' ?', '', ''], ['', '', '']] },
  work: { walks: true, props: [['', '', '']] },
  sleep: { head: ASLEEP, props: [['  z', ' Z', '']] },
  cheer: { body: [ARMS_UP], props: [[' ✦', '', ' ✦']] },
}

/** The sprite's three rows for a pose at a frame, shifted right by `x` columns. */
export function spriteRows(look: Look, frame: number, x: number): [string, string, string] {
  const pad = ' '.repeat(x)
  const prop = look.props[frame % look.props.length]
  const body = look.body ? look.body[frame % look.body.length] : BODY
  const legs = look.walks ? LEGS[frame % 2] : LEGS[0]
  return [pad + (look.head ?? HEAD) + prop[0], pad + body + prop[1], pad + legs + prop[2]]
}

const allSteps = (p: Plan) => p.groups.flatMap(g => g.steps)
const isPlanFile = (path: unknown): path is string =>
  typeof path === 'string' && /[\\/]\.claude[\\/]plans[\\/][^\\/]+\.md$/i.test(path)

export const register: Register = (on, options) => {
  const cfg = settingsOf(options)
  const wantsCalendar = cfg.isShown && cfg.hasLogin

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'plan-steps', description: 'Show the current plan step by step in a side pane' })
    await $.tool.register({
      name: 'plan_step',
      description:
        'Marks a step of the current approved plan in the user\'s Plan pane. Call it with status "in_progress" when you start a step and "done" when you finish it (or "skipped"); step numbers are the ones the pane shows (numbered top-level items of the plan file, in order). Cheap; skip it for tasks with no plan.',
      inputSchema: {
        type: 'object',
        properties: {
          step: { type: 'integer', minimum: 1, description: 'Step number as shown in the pane' },
          status: { type: 'string', enum: ['in_progress', 'done', 'skipped', 'pending'] },
        },
        required: ['step', 'status'],
      },
      isDeferred: false,
    })
    // The walk animation: advances only while a turn runs, so an idle pane never redraws.
    $.clock.every(300, () => {
      void update($, agentAtom, a => (a.isWorking ? { ...a, frame: a.frame + 1 } : a)).catch(() => {})
    })
    if (wantsCalendar) {
      $.clock.every(cfg.refreshMinutes * 60_000, () => void refreshCalendar($, cfg.cal))
      void refreshCalendar($, cfg.cal)
    }
    // With a calendar the pane is worth seeing even before any plan.
    if (wantsCalendar || (await read($, planAtom))) void $.ui.open({ id: PANE, title: 'Plan' })
    return next(e)
  })

  on('command.run', { command: 'plan-steps' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Plan' })
    if (wantsCalendar) void refreshCalendar($, cfg.cal)
    return { text: 'Plan pane opened; calendar refreshing.' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, agentAtom, a => ({ ...a, activity: 'thinking', pose: 'think', isWorking: true }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, agentAtom, a => ({ ...a, activity: 'waiting for you', isWorking: false }))
    return next(e)
  }).catch(($, e, next) => next(e))

  // A plan file written or edited: read it and show its steps. Every call also tells the little Claude what it is doing.
  on('tool.call', async ($, e, next) => {
    const doing = activityOf(e as { tool: string } & Record<string, unknown>)
    if (doing) await update($, agentAtom, a => ({ ...a, ...doing }))
    const ran = await next(e)
    if (ran.deny || ran.isError) return ran
    if ((e.tool === 'Write' || e.tool === 'Edit') && isPlanFile(e.file_path)) {
      const text = await $.fs.read(e.file_path)
      const prev = await read($, planAtom)
      await update($, planAtom, () => carryStatuses(parsePlan(text, e.file_path), prev))
      void $.ui.open({ id: PANE, title: 'Plan' })
    } else if (e.tool === 'ExitPlanMode') {
      await update($, planAtom, p => (p ? { ...p, isApproved: true } : p))
    } else if (e.tool === 'TodoWrite') {
      const todos: Todo[] = e.todos.map(t => ({ text: t.content, status: t.status }))
      await update($, todosAtom, () => todos)
      void $.ui.open({ id: PANE, title: 'Plan' })
    } else if (e.tool === 'Skill' || e.tool === 'Agent') {
      const used = shortSkill(String((e as Record<string, unknown>)[e.tool === 'Skill' ? 'skill' : 'subagent_type'] ?? ''))
      if (used) await update($, usedSkillsAtom, s => (s.includes(used) ? s : [...s, used]))
    }
    return ran
  }).catch(($, e, next) => next(e)) // a pane failure must never change or block the tool call itself

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const { step, status } = e as unknown as { step: number; status: StepStatus }
    const plan = await read($, planAtom)
    if (!plan) return { result: 'No plan is shown yet; write the plan file first.' }
    if (!allSteps(plan).some(s => s.n === step)) return { result: `There is no step ${step}; the plan has ${allSteps(plan).length}.` }
    let doneCount = 0
    await update($, planAtom, p => {
      if (!p) return p
      const groups = p.groups.map(g => ({ ...g, steps: g.steps.map((s): Step => (s.n === step ? { ...s, status } : s)) }))
      doneCount = groups.flatMap(g => g.steps).filter(s => s.status === 'done' || s.status === 'skipped').length
      return { ...p, groups }
    })
    return { result: `Step ${step} is ${status.replace('_', ' ')} (${doneCount}/${allSteps(plan).length} finished).` }
  }).catch(() => ({ result: 'The Plan pane could not be updated; carry on with the work.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const plan = await read($, planAtom)
    const todos = await read($, todosAtom)
    const agent: Agent = await read($, agentAtom)
    const usedSkills = await read($, usedSkillsAtom)
    const expanded = await read($, expandedAtom)
    const width = Math.max(16, e.props.bodyColumns)
    const MARK: Record<StepStatus, { icon: string; color: string }> = {
      done: { icon: '✔', color: 'success' },
      in_progress: { icon: '▶', color: 'claude' },
      pending: { icon: '○', color: 'subtle' },
      skipped: { icon: '⊘', color: 'subtle' },
    }
    const TODO_STATUS = { completed: 'done', in_progress: 'in_progress', pending: 'pending' } as const

    // The little Claude: acts out what it is doing while a turn runs, walks while it thinks, sleeps between turns.
    const allDone = !!plan && allSteps(plan).length > 0 && allSteps(plan).every(s => s.status === 'done' || s.status === 'skipped')
    const look = agent.isWorking ? POSES[agent.pose] ?? POSES.work : allDone ? POSES.cheer : POSES.sleep
    const maxX = Math.max(0, width - 14)
    const period = Math.max(1, maxX * 2)
    const p = agent.frame % period
    const x = agent.isWorking && look.walks ? (p <= maxX ? p : period - p) : 1
    const rows = spriteRows(look, agent.isWorking ? agent.frame : 0, x)
    const claude = (
      <Box flexDirection="column" marginTop={1}>
        <Text color="subtle">{'─'.repeat(width)}</Text>
        {rows.map(r => <Text color="claude" wrap="truncate-end">{r}</Text>)}
        <Text dimColor={!agent.isWorking} wrap="truncate-end">
          {agent.isWorking
            ? `Claude is ${agent.activity}${'.'.repeat((agent.frame % 3) + 1)}`
            : allDone ? 'All done! Claude is waiting for you' : 'Claude is waiting for you'}
        </Text>
      </Box>
    )

    // The calendar: `days` days from today, past events grey, the one under way bold; redrawn on each fetch.
    const cal = await read($, calendarAtom)
    const now = Date.now()
    const isList = cfg.layout === 'list'
    // Columns: days side by side, as many as the pane's width fits, wrapping onto the next row. List: one day under another.
    const perRow = isList ? 1 : Math.max(1, Math.min(7, Math.floor(width / CAL_COLUMN)))
    const colWidth = Math.floor(width / perRow)
    const day = (name: string, i: number, list: Calendar['events']) => (
      <Box flexDirection="column" width={colWidth} paddingRight={1}>
        <Text weight="bold" color={i === 0 ? 'claude' : undefined} dimColor={i > 0} wrap="truncate-end">{name}</Text>
        {list.length === 0 && <Text color="inactive">{isList ? '  No events' : '—'}</Text>}
        {list.map(ev => {
          const isPast = Date.parse(ev.end) <= now
          const isNow = !isPast && Date.parse(ev.start) <= now
          const when = isList ? ev.time.padEnd(11) : ev.time === 'all day' ? 'all day' : ev.time.slice(0, 5)
          return (
            <Box flexDirection="row">
              <Text color={isPast ? 'inactive' : ev.color ?? 'subtle'}>{isList ? '● ' : '●'}</Text>
              <Text wrap="truncate-end" weight={isNow ? 'bold' : 'regular'} color={isPast ? 'inactive' : isNow ? 'claude' : undefined}>
                {`${when} ${ev.title}`}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
    const dayLabel = (name: string, i: number) => (i === 0 ? (isList ? `Today · ${name}` : 'Today') : i === 1 ? (isList ? `Tomorrow · ${name}` : 'Tomorrow') : name)
    const rule = <Text color="subtle">{'─'.repeat(width)}</Text>
    const calendar = !cfg.isShown ? null : (
      <Box flexDirection="column" marginTop={cfg.position === 'bottom' ? 1 : 0} marginBottom={cfg.position === 'top' ? 1 : 0}>
        {cfg.position === 'bottom' && rule}
        {!cfg.hasLogin ? (
          <Text dimColor wrap="wrap">Calendar: set your Apple ID and app-specific password in this plugin's options (/plugin) to see your events here.</Text>
        ) : !cal ? <Text dimColor>Loading calendar…</Text> : (
          <Box flexDirection="column">
            {Array.from({ length: Math.ceil(cal.days.length / perRow) }, (_, r) => (
              <Box flexDirection="row" marginTop={1}>
                {cal.days.slice(r * perRow, r * perRow + perRow).map((name, k) => {
                  const i = r * perRow + k
                  return day(dayLabel(name, i), i, cal.events.filter(ev => ev.day === i))
                })}
              </Box>
            ))}
            {cal.error && <Text color="warning" dimColor wrap="truncate-end">{`Calendar not updated: ${cal.error}`}</Text>}
          </Box>
        )}
        {cfg.position === 'top' && <Box marginTop={1}>{rule}</Box>}
      </Box>
    )
    const calTop = cfg.position === 'top' ? calendar : null
    const calBottom = cfg.position === 'bottom' ? calendar : null

    if (!plan && !todos.length)
      return (
        <Box flexDirection="column">
          {calTop}
          <Text dimColor>No plan yet.</Text>
          <Text dimColor wrap="wrap">It appears here when Claude writes a plan, then fills in step by step.</Text>
          {claude}
          {calBottom}
        </Box>
      )

    const steps = plan ? allSteps(plan) : []
    const finished = steps.filter(s => s.status === 'done' || s.status === 'skipped').length
    const fraction = steps.length ? finished / steps.length : 0
    const bar = barOf(fraction, Math.max(6, Math.min(40, width - 6)))
    const current = steps.find(s => s.status === 'in_progress') ?? steps.find(s => s.status === 'pending')
    const detail = current && current.text !== current.label ? current.text.slice(0, 160) + (current.text.length > 160 ? '…' : '') : ''
    const showGroupTitles = !!plan && (plan.groups.length > 1 || plan.groups[0]?.title !== 'Steps')

    const row = (status: StepStatus, text: string) => (
      <Box flexDirection="row">
        <Text color={MARK[status].color}>{MARK[status].icon} </Text>
        <Text
          wrap="truncate-end"
          dimColor={status === 'done' || status === 'skipped'}
          strikethrough={status === 'skipped'}
          weight={status === 'in_progress' ? 'bold' : 'regular'}
          color={status === 'in_progress' ? 'claude' : undefined}
        >
          {text}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        {calTop}
        {plan && <Text weight="bold" wrap="wrap">{plan.title}</Text>}
        {plan && steps.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Box flexDirection="row">
              <Text color="success">{bar.filled}</Text>
              <Text color="subtle">{bar.empty}</Text>
              <Text weight="bold">{` ${Math.round(fraction * 100)}%`}</Text>
            </Box>
            <Text>
              <Text dimColor>{`${finished} of ${steps.length} steps · `}</Text>
              <Text color={plan.isApproved ? 'success' : 'warning'}>{plan.isApproved ? 'approved' : 'draft'}</Text>
            </Text>
          </Box>
        )}
        {plan && steps.length > 0 && (current ? (
          <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} marginTop={1}>
            <Text color="claude" weight="bold">{current.status === 'in_progress' ? '▶ Now' : '○ Next'} · step {current.n}</Text>
            <Text weight="bold" wrap="wrap">{current.label}</Text>
            {detail && <Text dimColor wrap="wrap">{detail}</Text>}
          </Box>
        ) : (
          <Box borderStyle="round" borderColor="success" paddingX={1} marginTop={1}>
            <Text color="success" weight="bold">✔ All steps done</Text>
          </Box>
        ))}
        {plan?.groups.map(g => (
          <Box flexDirection="column" marginTop={1}>
            {showGroupTitles && <Text weight="bold" dimColor wrap="truncate-end">{g.title}</Text>}
            {g.steps.map(s => {
              const isOpen = expanded.includes(s.n)
              const hasMore = s.text !== s.label
              return (
                <Box flexDirection="column">
                  <Button
                    key={`step-${s.n}`}
                    plain
                    label={`Step ${s.n}: ${s.label}`}
                    onPress={() => void update($, expandedAtom, list => (list.includes(s.n) ? list.filter(n => n !== s.n) : [...list, s.n]))}
                  >
                    <Text color="subtle">{hasMore ? (isOpen ? '▾ ' : '▸ ') : '  '}</Text>
                    <Text color={MARK[s.status].color}>{MARK[s.status].icon} </Text>
                    <Text
                      dimColor={s.status === 'done' || s.status === 'skipped'}
                      strikethrough={s.status === 'skipped'}
                      weight={s.status === 'in_progress' ? 'bold' : 'regular'}
                      color={s.status === 'in_progress' ? 'claude' : undefined}
                    >
                      {`${s.n}. ${s.label}`}
                    </Text>
                  </Button>
                  {isOpen && hasMore && (
                    <Box paddingLeft={4} marginBottom={1}>
                      <Text dimColor wrap="wrap">{s.text}</Text>
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        ))}
        {plan && plan.skills.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text weight="bold" dimColor>Skills</Text>
            <Text wrap="wrap">
              {plan.skills.map((s, i) => (
                <Text color={usedSkills.includes(s) ? 'success' : 'subtle'}>
                  {(i ? '   ' : '') + (usedSkills.includes(s) ? '✔ ' : '○ ') + s}
                </Text>
              ))}
            </Text>
          </Box>
        )}
        {todos.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text weight="bold" dimColor>Tasks</Text>
            {todos.map(t => row(TODO_STATUS[t.status], t.text))}
          </Box>
        )}
        {claude}
        {calBottom}
      </Box>
    )
  })
}

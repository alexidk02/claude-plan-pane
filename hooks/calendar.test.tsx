import { expect, test } from 'claude-code/testing'

import { abs, base64, colorOf, parseIcs, when } from './calendar'
import { settingsOf } from './register'

const PANE = {
  plugin: 'plan-steps',
  component: 'Pane',
  requestId: 'plan-steps',
  props: { title: 'Plan', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

test('iCalendar values become instants in the right zone; helpers need no Node or DOM', async () => {
  expect(new Date(when('TZID=Europe/Paris', '20261103T081000', 'UTC')!.ms).toISOString()).toBe('2026-11-03T07:10:00.000Z')
  expect(new Date(when('TZID=Europe/Paris', '20260701T081000', 'UTC')!.ms).toISOString()).toBe('2026-07-01T06:10:00.000Z') // summer time
  expect(new Date(when('TZID=America/Los_Angeles', '20261103T090000', 'UTC')!.ms).toISOString()).toBe('2026-11-03T17:00:00.000Z')
  expect(when('', '20261103T061000Z', 'Asia/Tokyo')!.ms).toBe(Date.UTC(2026, 10, 3, 6, 10))
  expect(when('VALUE=DATE', '20261103', 'Europe/Chisinau')).toEqual({ ms: Date.UTC(2026, 10, 2, 22), allDay: true })
  expect(parseIcs('BEGIN:VEVENT\r\nSUMMARY:Math\\, room 2\r\n  B\r\nDTSTART;TZID=Europe/Paris:20261103T081000\r\nEND:VEVENT')[0]).toEqual({ summary: 'Math, room 2 B', start: ['TZID=Europe/Paris', '20261103T081000'], end: undefined })
  expect(base64('me@icloud.com:abcd-efgh')).toBe('bWVAaWNsb3VkLmNvbTphYmNkLWVmZ2g=')
  expect(base64('ă:1')).toBe('xIM6MQ==')
  expect(abs('/123/calendars/', 'https://caldav.icloud.com')).toBe('https://caldav.icloud.com/123/calendars/')
  expect(abs('https://p01-caldav.icloud.com/x/', 'https://caldav.icloud.com/')).toBe('https://p01-caldav.icloud.com/x/')
  expect(colorOf('#FF2968FF')).toBe('#FF2968')
  expect(colorOf(undefined)).toBeUndefined()
})

test('options get defaults and limits', async () => {
  const s = settingsOf({})
  expect(s.isShown && !s.hasLogin && s.layout === 'columns' && s.position === 'bottom').toBe(true)
  expect(s.cal.days).toBe(7)
  expect(settingsOf({ days: 40, layout: 'list', position: 'top', calendarUser: 'a', calendarPassword: 'b' })).toMatchObject({ hasLogin: true, layout: 'list', position: 'top', cal: { days: 14 } })
})

// A tiny CalDAV server: principal, home, four collections (one hidden by option, one tasks-only), and events relative to today (UTC).
const at = (offsetDays: number, h: number, m = 0) => {
  const t = new Date()
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + offsetDays, h, m))
}
const ics = (title: string, s: Date, e: Date) => {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  return `BEGIN:VCALENDAR&#13;\nBEGIN:VEVENT&#13;\nSUMMARY:${title}&#13;\nDTSTART:${f(s)}&#13;\nDTEND:${f(e)}&#13;\nEND:VEVENT&#13;\nEND:VCALENDAR`
}
const HOME = 'https://p01.example.com/1/calendars/'
const EVENTS: Record<string, string[]> = {
  [`${HOME}lectures/`]: [
    ics('Old lecture', at(-1, 23), at(0, 0, 0)), // ended at today's midnight: not shown
    ics('Early lecture', at(-1, 23), at(0, 0, 1)), // past when the test runs (unless in the first minute of the UTC day)
    ics('Lab session', at(1, 10), at(1, 12)),
    ics('Exam &amp; review', at(6, 9), at(6, 11)),
  ],
  [`${HOME}personal/`]: [ics('Gym', at(1, 18), at(1, 19))],
  [`${HOME}birthdays/`]: [ics('Secret party', at(2, 18), at(2, 19))],
}
const resp = (href: string, prop: string) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${prop}</d:prop></d:propstat></d:response>`
const multi = (body: string) => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">${body}</d:multistatus>`
const calendarProps = (name: string, comp = 'VEVENT', color = '') =>
  `<d:displayname>${name}</d:displayname><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><cal:supported-calendar-component-set><cal:comp name="${comp}"/></cal:supported-calendar-component-set>${color}`

function caldav(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  if (init.headers?.Authorization !== `Basic ${base64('me@example.com:app-pass')}`) return { status: 401, ok: false, headers: {}, text: 'Unauthorized me@example.com' }
  const body = init.body ?? ''
  let text = ''
  if (body.includes('current-user-principal')) text = multi(resp('/', '<d:current-user-principal><d:href>/1/principal/</d:href></d:current-user-principal>'))
  else if (body.includes('calendar-home-set')) text = multi(resp('/1/principal/', `<cal:calendar-home-set><d:href>${HOME}</d:href></cal:calendar-home-set>`))
  else if (body.includes('displayname'))
    text = multi(
      resp('/1/calendars/', '<d:resourcetype><d:collection/></d:resourcetype>') +
      resp('/1/calendars/lectures/', calendarProps('Lectures', 'VEVENT', '<a:calendar-color>#FF2968FF</a:calendar-color>')) +
      // iCloud's own form: default namespace and single-quoted attributes
      `<response xmlns="DAV:"><href>/1/calendars/personal/</href><propstat><prop><displayname xmlns="DAV:">Personal</displayname><resourcetype xmlns="DAV:"><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><supported-calendar-component-set xmlns="urn:ietf:params:xml:ns:caldav"><comp name='VEVENT' xmlns='urn:ietf:params:xml:ns:caldav'/></supported-calendar-component-set></prop></propstat></response>` +
      resp('/1/calendars/birthdays/', calendarProps('Birthdays')) +
      resp('/1/calendars/tasks/', calendarProps('Tasks', 'VTODO')),
    )
  else if (init.method === 'REPORT') text = multi((EVENTS[url] ?? []).map((e, i) => resp(`${url}${i}.ics`, `<cal:calendar-data>${e}</cal:calendar-data>`)).join(''))
  return { status: 207, ok: true, headers: {}, text }
}

const LOGIN = { calendarUser: 'me@example.com', calendarPassword: 'app-pass', timeZone: 'UTC', hiddenCalendars: 'birthdays' }

function setup(on: any, fetched: string[], fail = { on: false }, opened = { n: 0 }) {
  on('command.register', () => ({ value: { command: 'plan-steps' } }))
  on('tool.register', () => ({ value: {} }))
  on('clock.every', () => ({ value: {} }))
  on('ui.open', () => { opened.n++; return { value: { isPlaced: true } } })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('http.fetch', (_: unknown, e: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }) => {
    fetched.push(e.url)
    if (fail.on) return { value: { status: 503, ok: false, headers: {}, text: 'down for me@example.com' } }
    return { value: caldav(e.url, e.init) }
  })
}
const settle = () => new Promise(r => setTimeout(r, 20))
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

test('columns at the bottom: days side by side below the little Claude, own colours, past grey, hidden calendars and tasks left out', { options: LOGIN }, async ($, on) => {
  const fetched: string[] = []
  const fail = { on: false }
  setup(on, fetched, fail)
  await $.session.start(START)
  await settle()
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Early lecture/ }))?.props.color).toBe('inactive')
  expect(await ui.find({ type: 'Text', text: /Old lecture/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^10:00 Lab session$/ }))?.props.color).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Gym/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Exam & review/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Secret party/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Tomorrow$/ })).toBeTruthy()
  const dots = await ui.findAll({ type: 'Text', text: '●' })
  expect(dots.some(d => d.props.color === '#FF2968')).toBe(true)
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.findIndex(t => /Claude is waiting/.test(t))).toBeLessThan(texts.findIndex(t => /^Today$/.test(t)))
  expect(fetched.some(u => u.includes('tasks'))).toBe(false)
  await ui.unmount()

  // A failed refresh keeps the last events and adds one warning line.
  fail.on = true
  await $.command.run({ command: 'plan-steps', args: '' } as never)
  await settle()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Calendar not updated/ }))?.text).toBe('Calendar not updated: server answered 503')
  expect(await ui.find({ type: 'Text', text: /Lab session/ })).toBeTruthy()
  await ui.unmount()
})

test('list layout at the top, 3 days', { options: { ...LOGIN, layout: 'list', position: 'top', days: 3 } }, async ($, on) => {
  setup(on, [])
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Tomorrow · / })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^10:00–12:00 +Lab session$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Exam/ })).toBeUndefined() // day 6 is past 3 days
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.findIndex(t => /^Today · /.test(t))).toBeLessThan(texts.findIndex(t => /No plan yet/.test(t)))
  await ui.unmount()
})

test('a wrong password says so, without echoing the server page', { options: { ...LOGIN, calendarPassword: 'wrong' } }, async ($, on) => {
  setup(on, [])
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Calendar not updated/ }))?.text).toBe('Calendar not updated: login refused: check the Apple ID and app-specific password')
  await ui.unmount()
})

test('no login: a hint, no network calls, and the pane does not open by itself', async ($, on) => {
  const fetched: string[] = []
  const opened = { n: 0 }
  setup(on, fetched, { on: false }, opened)
  await $.session.start(START)
  await settle()
  expect(opened.n).toBe(0)
  expect(fetched).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /set your Apple ID and app-specific password/ })).toBeTruthy()
  await ui.unmount()
})

test('showCalendar off: no calendar at all', { options: { ...LOGIN, showCalendar: false } }, async ($, on) => {
  const fetched: string[] = []
  setup(on, fetched)
  await $.session.start(START)
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Today|Apple ID/ })).toBeUndefined()
  expect(fetched).toEqual([])
  await ui.unmount()
})

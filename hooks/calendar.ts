import type { EngineInterface } from 'claude-code'

import type { CalEvent, Calendar } from '../types'

/** What the calendar section needs from the plugin's options. */
export type CalendarOptions = { user: string; password: string; serverUrl: string; days: number; timeZone: string; hidden: string[] }

// ---------- time zones ----------

/** Offset of time zone `tz` at UTC instant `ms`, in ms. */
function offset(tz: string, ms: number): number {
  const p: Record<string, string> = {}
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(ms))
    p[x.type] = x.value
  return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - ms
}
/** A wall-clock time (given as if UTC) in zone `tz` → the real UTC instant. */
export const zoned = (wall: number, tz: string) => wall - offset(tz, wall - offset(tz, wall))
const hm = (ms: number, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(ms)
const dayName = (ms: number, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(ms)
/** The zone to show times in: the option, else the computer's. */
export const zoneOf = (tz: string) => tz.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone

/** An iCalendar date value with its parameters, e.g. `DTSTART;TZID=Europe/Paris:20261103T081000` → instant and all-day flag. */
export function when(params: string, value: string, tz: string): { ms: number; allDay: boolean } | null {
  const m = value.match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?$/)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  if (h === undefined) return { ms: zoned(Date.UTC(+y!, +mo! - 1, +d!), tz), allDay: true }
  const wall = Date.UTC(+y!, +mo! - 1, +d!, +h, +mi!, +s!)
  if (z) return { ms: wall, allDay: false }
  return { ms: zoned(wall, params.match(/TZID=([^;:]+)/)?.[1] ?? tz), allDay: false } // no TZID: floating, the shown zone
}

// ---------- iCalendar ----------

type RawEvent = { summary: string; start: [string, string]; end?: [string, string] }

/** The VEVENTs of an iCalendar text: title and start/end as [params, value]. */
export function parseIcs(ics: string): RawEvent[] {
  const out: RawEvent[] = []
  let ev: Partial<RawEvent> | null = null
  for (const line of ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') ev = {}
    else if (line === 'END:VEVENT') { if (ev?.start) out.push({ summary: ev.summary ?? '', start: ev.start, end: ev.end }); ev = null }
    else if (ev) {
      const i = line.indexOf(':')
      if (i < 0) continue
      const [key, ...params] = line.slice(0, i).split(';')
      const val = line.slice(i + 1)
      if (key === 'SUMMARY') ev.summary = val.replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ')
      else if (key === 'DTSTART') ev.start = [params.join(';'), val]
      else if (key === 'DTEND') ev.end = [params.join(';'), val]
    }
  }
  return out
}

// ---------- CalDAV ----------

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, '\r').replace(/&amp;/g, '&')
/** The text inside the first `<prefix:name>` element (any namespace prefix). */
const tag = (xml: string, name: string) => xml.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`))?.[1]
const hrefIn = (xml: string | undefined) => (xml ? tag(xml, 'href')?.trim() : undefined)
const responses = (xml: string) => xml.split(/<(?:[\w-]+:)?response\b[^>]*>/).slice(1)
const ymd = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')

/** The calendar's own colour ("#RRGGBBAA" from Apple) as "#RRGGBB", if it gave one. */
export const colorOf = (raw: string | undefined) => raw?.trim().match(/^#[0-9a-f]{6}/i)?.[0]

/** `href` from a server reply made absolute against `base` (plain JS: mods have no URL class). */
export function abs(href: string, base: string): string {
  if (/^https?:\/\//i.test(href)) return href
  if (href.startsWith('/')) return (base.match(/^https?:\/\/[^/]+/i)?.[0] ?? '') + href
  return base.replace(/[^/]*$/, '') + href
}

/** Base64 of a UTF-8 string, without Node or the DOM. */
export function base64(s: string): string {
  const bytes = Array.from(encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))), c => c.charCodeAt(0))
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = bytes.slice(i, i + 3)
    const n = (a << 16) | (b << 8) | c
    out += A[(n >> 18) & 63]! + A[(n >> 12) & 63]! + (i + 1 < bytes.length ? A[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? A[n & 63]! : '=')
  }
  return out
}

/** Reads the next `days` days of every calendar on the server; iCloud (and most servers) expand repeating events for us. */
export async function fetchCalendar($: EngineInterface, o: CalendarOptions, now = Date.now()): Promise<Calendar> {
  const tz = zoneOf(o.timeZone)
  const auth = `Basic ${base64(`${o.user}:${o.password}`)}`
  const dav = async (url: string, method: string, depth: string, body: string) => {
    const r = await $.http.fetch(url, { method, headers: { Authorization: auth, Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' }, body })
    // The status alone: a server's error page could echo the login.
    if (r.status === 401) throw new Error('login refused: check the Apple ID and app-specific password')
    if (r.status >= 400) throw new Error(`server answered ${r.status}`)
    return r.text
  }
  const base =o.serverUrl.trim() || 'https://caldav.icloud.com'

  const who = await dav(base, 'PROPFIND', '0', '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>')
  const principal = hrefIn(tag(who, 'current-user-principal'))
  if (!principal) throw new Error('server gave no user principal')
  const home = hrefIn(tag(await dav(abs(principal, base), 'PROPFIND', '0',
    '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>'), 'calendar-home-set'))
  if (!home) throw new Error('server gave no calendar home')
  const homeUrl = abs(home, abs(principal, base))
  const list = await dav(homeUrl, 'PROPFIND', '1',
    '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><a:calendar-color/></d:prop></d:propfind>')
  const hidden = new Set(o.hidden.map(h => h.trim().toLowerCase()).filter(Boolean))
  const cals = responses(list)
    // A calendar collection that holds events (iCloud quotes attributes with ' ; others with ").
    .filter(r => /<(?:[\w-]+:)?calendar[\s/>]/.test(tag(r, 'resourcetype') ?? '') && /name=["']VEVENT["']/i.test(tag(r, 'supported-calendar-component-set') ?? "name='VEVENT'"))
    .map(r => ({ url: abs(hrefIn(r) ?? '', homeUrl), name: decode(tag(r, 'displayname') ?? 'Calendar').trim(), color: colorOf(tag(r, 'calendar-color')) }))
    .filter(c => !hidden.has(c.name.toLowerCase()))

  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now).split('-').map(Number)
  const n = Math.max(1, Math.min(14, Math.round(o.days)))
  const mids = Array.from({ length: n + 1 }, (_, i) => zoned(Date.UTC(y!, m! - 1, d! + i), tz)) // midnights: today .. n days on
  const range = `start="${ymd(mids[0]!)}" end="${ymd(mids[n]!)}"`
  const events: CalEvent[] = []
  for (const cal of cals) {
    const xml = await dav(cal.url, 'REPORT', '1',
      `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data><c:expand ${range}/></c:calendar-data></d:prop>` +
      `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range ${range}/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`)
    for (const r of responses(xml)) {
      for (const e of parseIcs(decode(tag(r, 'calendar-data') ?? ''))) {
        const s = when(e.start[0], e.start[1], tz)
        const en = (e.end && when(e.end[0], e.end[1], tz)) || s
        if (!s || !en || en.ms <= mids[0]! || s.ms >= mids[n]!) continue
        events.push({
          calendar: cal.name, color: cal.color, title: e.summary || '(no title)',
          start: new Date(s.ms).toISOString(), end: new Date(en.ms).toISOString(),
          time: s.allDay ? 'all day' : `${hm(s.ms, tz)}–${hm(en.ms, tz)}`,
          day: Math.max(0, mids.findLastIndex(t => t <= s.ms)), // still running from yesterday: today
        })
      }
    }
  }
  events.sort((a, b) => a.start.localeCompare(b.start))
  return { days: mids.slice(0, n).map(t => dayName(t, tz)), events }
}

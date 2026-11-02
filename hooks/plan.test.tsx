import { expect, test } from 'claude-code/testing'

import { activityOf, barOf, carryStatuses, parsePlan } from './register'

const MD = `# Build the thing

## Context
- why it matters

## 1. Research
- watch videos
- read docs

## Verification
Run the checks.
`

const PANE = {
  plugin: 'plan-steps',
  component: 'Pane',
  requestId: 'plan-steps',
  props: { title: 'Plan', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('a plan file becomes numbered steps; context sections are not steps', async () => {
  const p = parsePlan(MD, 'C:/x/.claude/plans/a.md')
  expect(p.title).toBe('Build the thing')
  expect(p.groups.map(g => g.title)).toEqual(['1. Research', 'Verification'])
  expect(p.groups.flatMap(g => g.steps).map(s => `${s.n} ${s.text}`)).toEqual(['1 watch videos', '2 read docs', '3 Verification'])
})

test('a numbered plan counts only its numbered steps, named by their bold lead', async () => {
  const md = `# Deck plan

## Skills and agents to use
- \`homework\` — the workflow
- \`dataviz\` — charts

## Ambition rewrite
A founder would start from raw data.

## Steps
1. **Course mapping (read-only).** Read the course files and build a map.
2. Research the market: rent, prices and tariffs.

## Verification
- model asserts pass
- every slide viewed
`
  const p = parsePlan(md, 'p.md')
  expect(p.groups.flatMap(g => g.steps).map(s => `${s.n} ${s.label}`)).toEqual(['1 Course mapping', '2 Research the market', '3 Verification'])
  expect(p.skills).toEqual(['homework', 'dataviz'])
})

test('a Steps section holds the steps; a numbered recipe elsewhere is content', async () => {
  const md = '# P\n## The recipe\n1. Pe scurt\n2. Flux\n## Steps\n1. **Extract**: text\n2. **Draft**: guides\n## Verification\n- all checked\n'
  const p = parsePlan(md, 'p.md')
  expect(p.groups.map(g => g.title)).toEqual(['Steps', 'Verification'])
  expect(p.groups.flatMap(g => g.steps).map(s => `${s.n} ${s.label}`)).toEqual(['1 Extract', '2 Draft', '3 Verification'])
})

test('skills keep only names before the dash, without plugin prefixes', async () => {
  const p = parsePlan('## Skills to use\n- `anthropic-skills:pptx` — design, not `this`\n- `general-purpose` agents and `transcript-reader`\n', 'p.md')
  expect(p.skills).toEqual(['pptx', 'general-purpose', 'transcript-reader'])
})

test('the bar fills by eighths and always spans its width', async () => {
  expect(barOf(0, 8)).toEqual({ filled: '', empty: '░░░░░░░░' })
  expect(barOf(1, 8)).toEqual({ filled: '████████', empty: '' })
  const half = barOf(0.53, 10)
  expect(half.filled).toBe('█████▎')
  expect([...half.filled].length + half.empty.length).toBe(10)
})

test('rewriting the same plan keeps statuses of unchanged steps', async () => {
  const a = parsePlan(MD, 'p.md')
  a.groups[0].steps[0].status = 'done'
  const b = carryStatuses(parsePlan(MD + '- extra\n', 'p.md'), a)
  expect(b.groups[0].steps[0].status).toBe('done')
  expect(b.groups[0].steps[1].status).toBe('pending')
})

test('writing a plan file fills the pane, and plan_step marks progress', async ($, on) => {
  on('command.register', () => ({ value: { command: 'plan-steps' } }))
  on('tool.register', () => ({ value: {} }))
  on('clock.every', () => ({ value: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', () => ({ value: MD }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: 'C:/Users/a/.claude/plans/p.md', content: MD })
  const marked = await $.tool.call({ tool: 'mcp__plan-steps__plan_step', step: 1, status: 'done' } as never)
  expect(String(marked.result)).toContain('1/3')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /watch videos/ }))?.text).toBe('1. watch videos')
  expect((await ui.find({ type: 'Text', text: /Next · step/ }))?.text).toBe('○ Next · step 2')
  expect(await ui.find({ type: 'Text', text: /33%/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Claude is waiting for you/ })).toBeTruthy()
  await ui.unmount()
})

test('each tool call picks a pose: glasses to read, typing to code, a brush to draw', async () => {
  expect(activityOf({ tool: 'Read', file_path: 'a.md' })?.pose).toBe('read')
  expect(activityOf({ tool: 'Read', file_path: 's-1.PNG' })?.pose).toBe('look')
  expect(activityOf({ tool: 'Write', file_path: 'model.js' })?.pose).toBe('code')
  expect(activityOf({ tool: 'Write', file_path: 'notes.md' })?.pose).toBe('write')
  expect(activityOf({ tool: 'PowerShell', command: 'soffice --convert-to pdf deck.pptx' })?.pose).toBe('draw')
  expect(activityOf({ tool: 'WebSearch', query: 'x' })?.pose).toBe('web')
  expect(activityOf({ tool: 'mcp__plan-steps__plan_step' })).toBe(null)
})

test('a step opens and closes like a drop-down', async ($, on) => {
  // Step 1 is the "Next" card's, which already shows its text; the drop-down is tested on step 2.
  const md = '# P\n\n## Steps\n1. Build it\n2. **Research.** Rent, prices and tariffs from real listings.\n'
  on('command.register', () => ({ value: { command: 'plan-steps' } }))
  on('tool.register', () => ({ value: {} }))
  on('clock.every', () => ({ value: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', () => ({ value: md }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: 'C:/Users/a/.claude/plans/p.md', content: md })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /real listings/ })).toBeUndefined()
  await ui.press({ key: 'step-2' })
  expect(await ui.find({ type: 'Text', text: /real listings/ })).toBeTruthy()
  await ui.press({ key: 'step-2' })
  expect(await ui.find({ type: 'Text', text: /real listings/ })).toBeUndefined()
  await ui.unmount()
})

test('a plan lists its skills and ticks one once the Skill tool uses it', async ($, on) => {
  const md = '# P\n\n## Skills\n- `homework` — flow\n- `anthropic-skills:pptx` — design\n\n## Steps\n1. Build it\n'
  on('command.register', () => ({ value: { command: 'plan-steps' } }))
  on('tool.register', () => ({ value: {} }))
  on('clock.every', () => ({ value: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', () => ({ value: md }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: 'C:/Users/a/.claude/plans/p.md', content: md })
  await $.tool.call({ tool: 'Skill', skill: 'anthropic-skills:pptx' } as never)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /pptx/ }))?.text).toBe('○ homework   ✔ pptx')
  await ui.unmount()
})


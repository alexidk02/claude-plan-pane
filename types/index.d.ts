export type StepStatus = 'pending' | 'in_progress' | 'done' | 'skipped'
/** `label` is the short name shown in the list (the step's bold lead or first clause); `text` the whole item. */
export type Step = { n: number; label: string; text: string; status: StepStatus }
export type Group = { title: string; steps: Step[] }
/** `skills`: the names in backticks under the plan's "Skills" section, in order. */
export type Plan = { path: string; title: string; isApproved: boolean; groups: Group[]; skills: string[] }
export type Todo = { text: string; status: 'pending' | 'in_progress' | 'completed' }
/** The little Claude's pose: which animation it plays at the bottom of the pane. */
export type Pose = 'read' | 'look' | 'write' | 'code' | 'draw' | 'search' | 'web' | 'run' | 'think' | 'agent' | 'ask' | 'work'
/** What the little Claude at the bottom is doing: a short verb phrase, its pose, and whether a turn is running. */
export type Agent = { activity: string; pose: Pose; isWorking: boolean; frame: number }
/** One event: `start`/`end` ISO instants, `time` already in the shown zone ("08:10–09:40" or "all day"), `day` an index into `Calendar.days`, `color` its calendar's own "#RRGGBB". */
export type CalEvent = { calendar: string; color?: string; title: string; start: string; end: string; time: string; day: number }
/** The last fetch of the calendar: day names from today (`day` indexes them), events, or a short error. */
export type Calendar = { days: string[]; events: CalEvent[]; error?: string }

declare module 'claude-code' {
  interface PluginState {
    'plan-steps': {
      plan: Shaped<Plan | null>
      todos: Shaped<Todo[]>
      agent: Shaped<Agent>
      usedSkills: Shaped<string[]>
      /** Step numbers whose drop-down is open. */
      expanded: Shaped<number[]>
      calendar: Shaped<Calendar | null>
    }
  }
}

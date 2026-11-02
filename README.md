# Plan pane for Claude Code

A side pane for the Claude Code terminal that keeps three things in view while Claude works:

- **The plan, step by step.** When Claude writes a plan (plan mode), its numbered steps show up with a progress bar, the step being worked on, and ✔ / ▶ / ○ marks. Claude ticks steps off itself through a small `plan_step` tool. Click a step to read all of it. Todo lists show up too.
- **A little animated Claude** that acts out what it is doing: reading, coding, searching the web, drawing, asking you something, sleeping between turns.
- **Your calendar** (Apple iCloud, or any CalDAV server): the next days of events, in your calendars' own colours. Past events turn grey, and the one happening now is bold.

```
Build the thing
██████████▌░░░░░░░░░ 52%
5 of 9 steps · approved
╭──────────────────────────────╮
│ ▶ Now · step 6                │
│ Write the tests               │
╰──────────────────────────────╯
 ✔ 1. Research
 ▶ 6. Write the tests
 ○ 7. Publish
 ▐▛o-o▜▌  ╔╤╗
▝▜█████▛▘ ╚╧╝
  ▘▘ ▝▝
Claude is reading files..
────────────────────────────────
Today            Tomorrow
●09:00 Lecture   ●10:00 Lab session
●16:30 Study     ●18:00 Gym
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install plan-steps --marketplace alexidk02/claude-plan-pane
```

Answer `y` to add the marketplace, then pick a scope (user is the usual one). From a shell, use `claude plugin install plan-steps --marketplace alexidk02/claude-plan-pane` instead.

Open the pane any time with `/plan-steps`. It opens by itself when Claude writes a plan, or at the start of every session once the calendar is set up.

## Calendar setup (Apple iCloud)

1. Go to [account.apple.com](https://account.apple.com) → **Sign-In and Security** → **App-Specific Passwords** and make one (name it, for example, `claude-calendar`). Your normal Apple ID password will not work.
2. In Claude Code, run `/plugin`, open **plan-steps**, and set **Apple ID** and **App-specific password**. You can also do it from a shell: `claude plugin configure plan-steps`.
3. Restart Claude Code or run `/reload-plugins`.

The password is kept in Claude Code's secure storage, never in a settings file. The plugin only talks to the CalDAV server you set, and only reads: it never changes your calendar.

Leave the Apple ID empty if you don't want the calendar. The pane then works exactly as before.

## Options

All options are set through `/plugin` → plan-steps (or `/config`). Changes apply on reload.

| Option | Default | What it does |
| --- | --- | --- |
| Apple ID | empty | Your Apple ID email, or your CalDAV username |
| App-specific password | empty | Stored securely; see setup above |
| Show calendar | on | Hide the calendar section without removing your login |
| Days to show | 7 | 1 to 14 days, starting today |
| Layout | `columns` | `columns`: days side by side, wrapping to fit the pane. `list`: one day under another, with start and end times |
| Position | `bottom` | `bottom`: under the little Claude. `top`: above the plan |
| Hidden calendars | empty | Names to leave out, separated by commas, e.g. `Birthdays, Holidays` |
| Time zone | your computer's | An IANA name such as `Europe/Paris`, if your computer's zone is not the one you live by |
| Refresh every (minutes) | 15 | How often the calendar is fetched again. `/plan-steps` also refreshes it right away |
| CalDAV server | `https://caldav.icloud.com` | Any CalDAV server that takes a username and password (Fastmail, Nextcloud, ...). Google Calendar needs OAuth, so it is not supported |

## Notes

- Repeating events are expanded by the server (CalDAV `expand`), so weekly classes show up correctly, exceptions included.
- If a refresh fails (no internet, wrong password), the pane keeps the last events it got and shows one short warning line.
- The pane needs a terminal at least ~110 columns wide to open by itself next to the chat. A narrower one shows it once you ask with `/plan-steps`.

## Development

```
claude plugin validate .
claude plugin test .
```

The hooks module is `hooks/register.tsx`, the CalDAV client is `hooks/calendar.ts`, and the tests sit next to them.

## License

MIT

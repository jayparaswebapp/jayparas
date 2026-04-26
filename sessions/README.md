# /sessions — Working Notes for Claude Code

This folder is the persistent memory between Claude Code sessions. Every time Jay (super-admin) starts a working session with Claude Code, the agent should:

## At session start
1. List `/sessions/` and read all files in chronological order (filenames are date-prefixed, so alphabetical = chronological).
2. Read `/docs/business-context.md` and `/docs/data-model.md` if not already in context.
3. Read the **last** session note carefully — its "Next session" block is the starting point.

## At session end
1. Create a new file: `YYYY-MM-DD-<short-slug>.md` (use today's date in IST).
2. Use the template below.
3. Commit the session note in the same commit as the code changes it describes — they belong together.

## File naming
- Date is the IST date the session **started**.
- Slug is 2–4 words, kebab-case, describing the main thing done.
- If multiple sessions happen on the same day, suffix with `-2`, `-3`, etc.

Examples:
- `2026-04-26-foundation-setup.md`
- `2026-04-27-master-data-tables.md`
- `2026-04-27-master-data-tables-2.md`

## Template

```markdown
# Session: <slug>

**Date:** YYYY-MM-DD (IST)
**Workstream:** WS-A | WS-B | WS-C | WS-D | WS-E | maintenance
**Duration (rough):** Xh

## Goals (from previous session or fresh)
- ...

## What was built
- File paths touched
- Migrations created/applied
- Dependencies added
- External services configured

## Decisions made
- Decision + 1-line rationale
- Link to ADR in `/docs/decisions.md` if heavyweight

## Tested & verified
- What was tested manually
- What's deployed where

## Open questions / blockers
- Things waiting on Jay's input
- Things parked deliberately

## Next session
- Specific, actionable items for the next pickup
- Any prep Jay should do before next session
```

## Why this convention
Claude Code has no memory across sessions. Without this, every session starts cold and either re-asks questions or, worse, makes inconsistent decisions. With this, every session starts with full context in 30 seconds of reading.

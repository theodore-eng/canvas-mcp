# Implementation Plan: Canvas MCP → Online in Claude Desktop

**Goal:** From current repo state to user having the MCP configured in Claude Desktop and able to use it.  
**Stop condition:** Execution stops at steps that require manual intervention; user proceeds from there.

---

## Scope

| In scope | Out of scope |
|----------|---------------|
| Verify build, test, lint pass | Implementing new features from research (e.g. priority scoring, Supabase) |
| Single runbook from "open repo" to "configured in Claude" | Changes that require Canvas API or env not already supported |
| Clear [MANUAL] markers for user steps | Multi-day or multi-PR work |
| Documentation consistency (setup, runbook, README) | |

**End state:** User has run `npm install`, `npm run build`; has added canvas-mcp to `claude_desktop_config.json` with token and base URL; has restarted Claude Desktop; can ask Claude "What's on my Canvas dashboard?" and get a response using the MCP.

---

## Prerequisites (pre-execution)

- **Repo path:** All Phase 2 commands and runbook examples use **`/Users/theo/canvas-mcp`**. A user on another machine must substitute their repo path in the runbook and in the "Next steps" copy-paste. Runbook assumes this path; user must replace with their path if different.
- Node.js 18+ is available on PATH. **[MANUAL: User must have Node 18+ installed.]**
- Claude Desktop app is installed. **[MANUAL: User must have Claude Desktop.]**
- User has or will obtain a Canvas API token and Canvas base URL. **[MANUAL: User gets token from Canvas Account → Settings → Approved Integrations.]**
- **Claude config path:** Runbook states macOS path explicitly; Windows/Linux paths are in runbook; setup doc covers other OSes.

---

## Phase 1: Plan critique and hardening (no code yet)

### Task 1.1 — Agent critique: completeness and gaps

- **Owner:** Agent (code-reviewer or generalPurpose).
- **Input:** This document (IMPLEMENTATION_PLAN_CLAUDE_ONLINE.md).
- **Instructions to agent:** Review the plan for missing steps, ambiguous acceptance criteria, or gaps that would prevent a user from going from "I have the repo" to "MCP works in Claude." List every missing step or unclear dependency. Focus on: (1) build/test/lint, (2) env and token handling, (3) Claude config file path and JSON shape, (4) restart and verification, (5) troubleshooting.
- **Output:** Bullet list of gaps and suggested additions. Merge into plan.

### Task 1.2 — Agent critique: feasibility and order

- **Owner:** Agent (architecture-strategist or generalPurpose).
- **Input:** This document.
- **Instructions to agent:** Check that the order of tasks is feasible (no step depends on a later step). Flag any step that assumes something not yet done. Suggest reorder or explicit "blocked by" notes. Confirm that "stop at manual intervention" is well-defined.
- **Output:** Reorder suggestions and blocked-by notes. Merge into plan.

### Acceptance criteria (Phase 1)

- [x] Both critiques completed and merged into this plan (code-reviewer + architecture-strategist).
- [ ] Every step has a clear owner (automated vs [MANUAL]).
- [ ] No step depends on an undefined or later step.

---

## Phase 2: Repo verification (automated)

### Task 2.1 — Install dependencies

- **Command:** `cd /Users/theo/canvas-mcp && npm install`
- **Success:** `node_modules` populated, no fatal npm errors.
- **Failure:** Document error; stop and report to user.

### Task 2.2 — Lint

- **Command:** `npm run lint`
- **Success:** Exit 0, no errors.
- **Failure:** Fix reported lint errors in `src/**/*.ts`; re-run until pass. If unfixable without product decisions, stop and report.

### Task 2.3 — Build

- **Command:** `npm run build`
- **Success:** `dist/` exists, `dist/index.js` present, exit 0.
- **Failure:** Fix TypeScript/build errors; re-run until pass. If unfixable, stop and report.

### Task 2.4 — Tests

- **Command:** `npm test` (or `npm run test`)
- **Success:** All tests pass, exit 0.
- **Failure:** Fix failing tests or mark known issues; prefer fix. If tests require network/Canvas token, document and optionally skip in CI; ensure at least unit/offline tests run.

### Task 2.5 — Smoke run (optional but recommended)

- **Blocked by:** Task 2.3 (build must succeed so `dist/index.js` exists).
- **Command:** `node dist/index.js` with env vars set. For optional smoke: copy `.env.example` to `.env` and set CANVAS_API_TOKEN and CANVAS_BASE_URL, or export them in the shell.
- **Success:** No immediate crash; startup message on stderr.
- **Note:** If CANVAS_API_TOKEN/CANVAS_BASE_URL are missing, server exits with error message; that is acceptable (confirms env check works). Verify `.env.example` exists; runbook does not require .env for Claude Desktop (credentials go in config file only).

### Acceptance criteria (Phase 2)

- [ ] `npm install` success.
- [ ] `npm run lint` exit 0.
- [ ] `npm run build` exit 0 and `dist/index.js` exists.
- [ ] `npm test` exit 0 (or documented skip for integration tests).
- [ ] Optional: `node dist/index.js` starts without crash when env is set.
- [ ] `.env.example` exists; Task 2.5 documents how to set env (copy `.env.example` to `.env` or export vars) for optional smoke run.

---

## Phase 3: Documentation and runbook

### Task 3.1 — Single runbook: "Get canvas-mcp online in Claude"

- **File:** `docs/RUNBOOK_CLAUDE_DESKTOP.md` (or equivalent single entrypoint).
- **Contents (detailed):**
  1. **Prerequisites** — Node 18+, Claude Desktop, Canvas account. [MANUAL]
  2. **Clone/open repo** — Path to repo; `cd` into it. [MANUAL if clone]
  3. **Install and build** — `npm install`, `npm run build`. Copy-paste commands. [MANUAL: user runs in terminal]
  4. **Get Canvas token** — Short steps: Account → Settings → Approved Integrations → New Access Token. [MANUAL]
  5. **Locate Claude config** — macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows/Linux alternatives if applicable. [MANUAL]
  6. **Add canvas-mcp to config** — Minimal JSON: `mcpServers.canvas-lms` with `command`, `args` (path to `dist/index.js`), `env.CANVAS_API_TOKEN`, `env.CANVAS_BASE_URL`. Example for macOS with path `/Users/theo/canvas-mcp`. [MANUAL: user edits JSON]
  7. **Restart Claude Desktop** — Quit fully (e.g. Cmd+Q), reopen. [MANUAL]
  8. **Verify** — Open new chat; ask "What's on my Canvas dashboard?" or "List my courses." Expect tools to be used and answer to reflect Canvas. [MANUAL]
  9. **Troubleshooting** — Missing env, wrong path, token invalid, JSON syntax; link to CLAUDE_DESKTOP_SETUP.md if needed.
- **Acceptance:** A user who has never configured an MCP can follow this runbook and reach "MCP works in Claude."

### Task 3.2 — Align CLAUDE_DESKTOP_SETUP.md with runbook

- **File:** `CLAUDE_DESKTOP_SETUP.md` (existing).
- **Action:** Ensure path to `dist/index.js`, env var names, and config shape match runbook. Add cross-link: runbook ↔ CLAUDE_DESKTOP_SETUP. No contradictory instructions.

### Task 3.3 — README pointer (if README exists)

- **File:** `README.md`.
- **Action:** Add a short "Quick start: use in Claude Desktop" section that points to the runbook or CLAUDE_DESKTOP_SETUP.md. One or two sentences + link.

### Acceptance criteria (Phase 3)

- [ ] Runbook exists and includes every [MANUAL] step in order.
- [ ] Runbook has full minimal JSON: `"command": "node"`, `"args": ["<absolute-path>/dist/index.js"]`; states path must be absolute.
- [ ] Runbook includes Windows and Linux config file paths (in addition to macOS).
- [ ] Runbook states explicitly: **for Claude Desktop, token and base URL go in the config file's `env` block only** (not in a `.env` file).
- [ ] Runbook includes: "If the config file doesn't exist, create it with `{}` and add `mcpServers`."
- [ ] Runbook verification step describes how to confirm MCP is loaded (e.g. tools/hammer icon visible, Claude uses Canvas tools).
- [ ] Troubleshooting covers: config file missing (create with `{}`), wrong path (absolute path, confirm `dist/index.js` exists after build), JSON syntax (trailing comma, key `mcpServers`).
- [ ] Single server key **`canvas-lms`** in runbook, CLAUDE_DESKTOP_SETUP.md, and README.
- [ ] CLAUDE_DESKTOP_SETUP.md and runbook consistent; cross-linked.
- [ ] README (if present) points to setup/runbook.

---

## Phase 4: Execution and stop at manual intervention

### Task 4.1 — Run Phase 2 (repo verification)

- Execute Task 2.1–2.4 (and 2.5 if feasible). Fix any failures. Document any skipped steps (e.g. tests that need token).

### Task 4.2 — Run Phase 3 (documentation)

- **Blocked by:** Task 4.1. Runbook references `dist/index.js` and build steps; Phase 2 must be complete so path and state are known.
- Create or update runbook (Task 3.1), align setup doc (Task 3.2), update README (Task 3.3). Use single server key **`canvas-lms`** in runbook, CLAUDE_DESKTOP_SETUP.md, and README.

### Task 4.3 — Handoff to user

- **Deliverables:** (1) Verified build and tests. (2) Runbook and setup docs. (3) Clear "Next steps for you" message.
- **Next steps for user (copy-paste ready):**
  - Install Node 18+ if needed.
  - Get Canvas API token (Account → Settings → Approved Integrations).
  - Run: `cd /Users/theo/canvas-mcp && npm install && npm run build`.
  - Open Claude config (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`).
  - Add `canvas-lms` under `mcpServers` with `command`, `args`, `env` (see runbook).
  - Restart Claude Desktop.
  - In a new chat, ask: "What's on my Canvas dashboard?" to verify.

### Stop condition

- **Success:** Execution stops **after Task 4.3**. All automated work is done. The agent does **not** run any [MANUAL] steps. It delivers the "Next steps for you" list and stops. User then: install Node 18+ (if needed), get Canvas token, run `cd … && npm install && npm run build`, open Claude config (create with `{}` if it doesn't exist), add `canvas-lms` with `command`: `"node"`, `args`: `["<absolute-path>/canvas-mcp/dist/index.js"]`, restart Claude Desktop, verify in UI.
- **Failure:** Execution stops at the first failing step among 2.1, 2.2, 2.3, 2.4 (and optionally 2.5) when the failure is "unfixable" or "stop and report"; the agent documents the error and reports to the user. Phase 3 and 4.3 do not run if Phase 2 fails.
- **Manual intervention:** Execution stops when the next step is any [MANUAL] step. Report: "Manual intervention required" + the copy-paste next steps. Token and base URL go in the config file's `env` block only—not in a .env file—when using Claude Desktop.

---

## Verification checklist (final)

Before declaring "plan complete and ready for user":

- [x] Phase 1: Plan critiqued and merged; no ordering/gap issues.
- [x] Phase 2: `npm install`, `npm run lint`, `npm run build`, `npm test` all pass (or documented skips).
- [x] Phase 3: Runbook exists with all criteria above; setup doc aligned; README links; handoff states restart required and credentials in config file for Claude Desktop.
- [x] Phase 4: Execution completed up to last automated step; handoff message and next steps written for user (see docs/NEXT_STEPS_FOR_USER.md).

---

## Risk and assumptions

- **Assumption:** User's machine can run Node 18+ and Claude Desktop; user has Canvas access.
- **Risk:** Claude config path or JSON format differs by OS/version — runbook should state macOS path and point to setup doc for others.
- **Risk:** Tests require Canvas token — plan allows "document and skip" so local verification doesn't block.

# Phase 3 Implementation Plan — Canvas MCP

## Architecture: 3 Pushes, 8 Agent Teams, 5 Checkpoints

Each "Push" is a git commit + build + memory save. You can safely close the conversation after any checkpoint and resume fresh.

---

## PUSH 1: Foundation Fixes (All Parallel — No Interdependencies)

### Team A: Grade Intelligence (Bug #8 + #13 + #12)
**Files:** `grades.ts`, `grade-analysis.ts`
**No conflicts with other teams.**

| Bug | What | File | Lines |
|-----|------|------|-------|
| #8 | Grade deflation — detect future-dated 0s, compute adjusted grade | `grades.ts` (get_my_grades) + `grade-analysis.ts` (get_grade_breakdown) | ~60 new |
| #13 | Fix final_score — label it clearly as "if-you-got-0-on-everything" | `grades.ts` (get_my_grades) | ~15 changed |
| #12 | What-if validation — warn impossible scores, add target_grade mode, allow future assignments | `grade-analysis.ts` (calculate_what_if_grade) | ~80 new |

### Team B: Content Extraction (Bug #1)
**Files:** `pages.ts`, `utils.ts`
**No conflicts with other teams.**

| Bug | What | File | Lines |
|-----|------|------|-------|
| #1 | Extract file links from HTML before stripping — return `linked_files` metadata | `pages.ts` (get_page_content), `utils.ts` (new `extractLinkedFiles` helper) | ~50 new |

### Team C: Pagination & Filtering (Bug #11 + #16 + #10)
**Files:** `discussions.ts`, `search.ts`, `activity.ts`
**No conflicts with other teams.**

| Bug | What | File | Lines |
|-----|------|------|-------|
| #11 | Discussion pagination — add `limit`/`offset` params, fix sort | `discussions.ts` | ~25 changed |
| #16 | Search pagination — add `content_type`, `limit`/`offset` | `search.ts` | ~30 changed |
| #10 | Activity stream — add `type` and `course_id` filters | `activity.ts` | ~20 changed |

### Checkpoint 1 (after Push 1)
- [ ] `npm run build` passes
- [ ] Git commit: "Phase 3 Push 1: grade fixes, file link extraction, pagination"
- [ ] Update MEMORY.md with completed items
- [ ] **SAFE TO STOP HERE** — Resume instructions in PHASE3_PROGRESS.md

---

## PUSH 2: New Capabilities (Parallel after Push 1)

### Team D: File System (Bug #4 + #3 + #5)
**Files:** `files.ts` (modify), `canvas-client.ts` (add downloadToFile method)
**No conflicts with other teams.**

| Bug | What | File | Lines |
|-----|------|------|-------|
| #4 | File categorization — `categorize=true` param, cross-ref modules | `files.ts` | ~60 new |
| #3 | Hidden files — `include_hidden=true` param, cross-ref modules | `files.ts` | ~20 new |
| #5 | File download — new `download_file` tool, uses folder mapping from prefs | `files.ts` (new tool) | ~80 new |

### Team E: Untracked Work Scanner (Bug #6)
**Files:** NEW `src/tools/untracked.ts`, `index.ts` (registration only)
**No conflicts with other teams.**

| Bug | What | File | Lines |
|-----|------|------|-------|
| #6 | `scan_untracked_work` — parse module SubHeaders, infer dates, keyword matching | New `untracked.ts` | ~200 new |

### Team F: Small Fixes (Bug #9 + #14 + #15)
**Files:** `dashboard.ts` (description only), `calendar.ts`, `planner.ts`
**No conflicts with other teams.**

| Bug | What | File | Lines |
|-----|------|------|-------|
| #9 | Differentiate overview tools — update descriptions | `dashboard.ts`, `search.ts` (desc only) | ~10 changed |
| #14 | Calendar default date range when course_ids specified | `calendar.ts` | ~10 changed |
| #15 | Planner note details round-trip | `planner.ts` | ~10 changed |

### Checkpoint 2 (after Push 2)
- [ ] Register new tools in `index.ts`
- [ ] `npm run build` passes
- [ ] Git commit: "Phase 3 Push 2: file download, untracked scanner, small fixes"
- [ ] Update MEMORY.md + PHASE3_PROGRESS.md
- [ ] **SAFE TO STOP HERE**

---

## PUSH 3: Major Features (Sequential — Depends on Push 1+2)

### Team G: Semester Setup (Bug #7)
**Files:** NEW `src/tools/semester.ts`, `index.ts`
**Depends on:** preferences infrastructure (already exists), file download (Push 2)

| Bug | What | File | Lines |
|-----|------|------|-------|
| #7 | `setup_semester` tool — scaffold folders, save mappings | New `semester.ts` | ~250 new |

### Team H: Daily Briefing Redesign (Bug #17)
**Files:** `dashboard.ts` (complete rewrite of `daily_briefing`)
**Depends on:** Bug #8 (grade deflation), Bug #6 (untracked scanner)

| Bug | What | File | Lines |
|-----|------|------|-------|
| #17 | Full redesign — 10-section briefing with exam alerts, urgency, prep, grades | `dashboard.ts` | ~400 rewritten |

### Checkpoint 3 (after Push 3)
- [ ] Register new tools in `index.ts`
- [ ] `npm run build` passes
- [ ] Git commit: "Phase 3 Push 3: semester setup, daily briefing redesign"
- [ ] Version bump to 2.4.0 in `package.json` and `index.ts`
- [ ] Update MEMORY.md with full Phase 3 completion
- [ ] **DONE — Full implementation complete**

---

## File Conflict Matrix (Why This Parallelization is Safe)

```
                 grades.ts  grade-analysis.ts  pages.ts  utils.ts  discussions.ts  search.ts  activity.ts  files.ts  calendar.ts  planner.ts  dashboard.ts  untracked.ts  semester.ts  index.ts
Team A (Grade)      ✏️           ✏️             .         .           .              .           .           .          .            .            .             .             .           .
Team B (Links)      .            .              ✏️        ✏️          .              .           .           .          .            .            .             .             .           .
Team C (Paging)     .            .              .         .           ✏️             ✏️          ✏️          .          .            .            .             .             .           .
Team D (Files)      .            .              .         .           .              .           .           ✏️         .            .            .             .             .           .
Team E (Untrack)    .            .              .         .           .              .           .           .          .            .            .             ✏️            .           ✏️
Team F (Fixes)      .            .              .         .           .              .           .           .          ✏️           ✏️           ✏️*           .             .           .
Team G (Semester)   .            .              .         .           .              .           .           .          .            .            .             .             ✏️          ✏️
Team H (Briefing)   .            .              .         .           .              .           .           .          .            .            ✏️            .             .           .
```
*Team F only touches dashboard.ts descriptions, Team H rewrites the function — no conflict since Push 3 runs after Push 2.

---

## Resume Protocol

If you stop at any checkpoint, the next conversation should:
1. Read `PHASE3_PROGRESS.md` for current state
2. Read `MEMORY.md` for project context
3. Run `npm run build` to verify clean state
4. Continue from the next Push

---

## Estimated Scope
- **Push 1:** ~280 lines changed/added across 5 files
- **Push 2:** ~390 lines changed/added across 6 files + 1 new file
- **Push 3:** ~650 lines changed/added across 2 new files + 1 rewrite
- **Total:** ~1,320 lines of implementation across 16 bugs/features

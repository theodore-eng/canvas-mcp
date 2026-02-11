# Canvas MCP v3.0 Review — Checkpoint File
# A fresh Claude Code session should read THIS FILE FIRST to resume work.

## Current Phase: WAVE 3 — IMPLEMENTATION (IN PROGRESS)
## Last Updated: 2026-02-10 ~6:45pm CT

## What Has Been Done
- Wave 1: 5 parallel analysis agents completed (reports in .review/wave1-team-*.md)
- Wave 2: Red team synthesized findings into IMPLEMENTATION.md (33 items, 3 tiers)
- Wave 3: Started implementation directly (subagents got permission-blocked, doing it in main session)

## IMPORTANT: Background agents FAILED
- Subagents cannot get Edit/Write/Bash permissions when running in background
- ALL implementation must be done in the main session where user can approve permissions
- Do NOT try background agents for code changes again

## Key Files to Read
1. **This file** — current state
2. `/Users/theo/canvas-mcp/.review/IMPLEMENTATION.md` — THE master list of 33 items with full details
3. Analysis reports (for reference only): `.review/wave1-team-{a,b,c,d,e}-*.md`

## Implementation Progress (checked = DONE)

### TIER 1: MUST DO
- [x] 1. Path traversal fix in download_file
- [x] 2. SSRF fix in uploadFileToUrl
- [x] 3. SSRF fix in downloadFile
- [x] 4. Cache LRU eviction
- [x] 5. Filesystem path validation
- [x] 6. Merge find_syllabus into get_course_syllabus
- [x] 7. Extract grade deflation logic
- [x] 8. Unify date parsing
- [x] 9. Add caching to listModules/listAssignments/listAssignmentGroups
- [x] 10. Restructure get_my_submission_status
- [x] 11. Restructure get_grade_breakdown

### TIER 2: SHOULD DO
- [x] 12. Standardize Zod ID validation
- [x] 13. Remove dead types from canvas.ts
- [x] 14. Fix dynamic import of extractTextFromFile in courses.ts
- [x] 15. Unify classification logic from untracked.ts/dashboard.ts
- [x] 16. Sanitize HTML in write tool inputs
- [x] 17. Add stripNulls utility
- [x] 18. Remove get_rubric standalone tool
- [x] 19. Fix get_recent_feedback course name bug
- [x] 20. Add human-friendly date display utility
- [x] 21. Create getActiveCourses() convenience method
- [x] 22. Improve error messages

### TIER 3: NICE TO HAVE
- [x] 23. Generic date sort utility
- [x] 24. Enable noUnusedLocals/noUnusedParameters
- [x] 25. Fix allowed_attempts: -1 display
- [x] 26. Remove noise fields from list_assignments
- [x] 27. Fix cache key determinism
- [x] 28. Remove SubHeader leak from scan_untracked_work
- [x] 29. URL-encode page slugs
- [x] 30. Add "when to use" tool descriptions
- [x] 31. Fix any type casts
- [x] 32. Add score_display computed field
- [x] 33. Sanitize filesystem paths in error messages

## How to Resume in New Window
1. Read this CHECKPOINT.md first
2. Read IMPLEMENTATION.md for full details on UNCHECKED items
3. Start implementing unchecked items in order (2, 3, 4, 6, 7, 8...)
4. For each item: read the file, make targeted edits, move to next
5. After ALL items done: `npm run build && npm run test`
6. Fix any build/test errors
7. Update package.json version to 3.0.0
8. Create branch, commit all changes, verify

## Codebase Key Patterns
- Entry: src/index.ts, Client: src/canvas-client.ts (1,043 lines)
- Utils: src/utils.ts (367 lines), Types: src/types/canvas.ts (779 lines)
- 21 tool files in src/tools/, all use: `server.tool(name, desc, zodSchema, handler)`
- Error: `formatError(context, error)`, Success: `formatSuccess(data)`
- Client singleton: `getCanvasClient()`
- Build: `npm run build`, Test: `npm run test`, Lint: `npm run lint`
- ESM project (type: module), TypeScript strict mode

## Changes Already Made (for git diff reference)
### src/tools/files.ts
- Changed `import { join } from 'path'` → `import path from 'node:path'` + `import os from 'node:os'`
- Added $HOME validation for target_path before mkdir
- Added path.basename() sanitization for filenames
- Added resolved path guard to prevent writing outside target dir

### src/tools/semester.ts
- Added $HOME validation for resolvedBasePath after line 54

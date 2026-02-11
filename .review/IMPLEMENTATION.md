# Canvas MCP v3.0 -- Implementation List

**Red Team Lead Final Review**
**Date:** 2026-02-10
**Input:** 5 analysis reports (SWOT, Security, UX, Architecture, Vision)
**Scope:** Phase 4 only -- what ships in v3.0

---

## Scoring Methodology

Every recommendation from all 5 teams was scored:
- **Impact** (1-5): How much does this improve the student experience?
- **Feasibility** (1-5): How easy to implement correctly?
- **Risk** (1-5, inverted): 5=safe, 1=likely to break things
- **Score** = Impact x Feasibility x Risk (max 125)

Items scoring 60+ made Tier 1. Items 30-59 made Tier 2. Items 15-29 made Tier 3. Below 15 or failing the filtering criteria: cut.

---

## TIER 1: MUST DO (Security + Critical UX)

These are non-negotiable. Security fixes ship first. Critical UX improvements have the highest student-experience ROI.

### 1. Fix path traversal in `download_file` (SEC-01)

- **What**: Sanitize Canvas-provided filenames before writing to disk. Validate resolved path stays inside target directory.
- **Where**: `/Users/theo/canvas-mcp/src/tools/files.ts`, lines 362-364
- **Why**: A crafted filename like `../../.bashrc` would write outside the target directory. This is the most dangerous bug in the codebase.
- **How**: Replace `const localPath = join(target_path, file.filename)` with:
  1. `const safeName = path.basename(file.filename).replace(/[/\\]/g, '_')`
  2. `const localPath = path.join(target_path, safeName)`
  3. `const resolved = path.resolve(localPath)`
  4. Guard: `if (!resolved.startsWith(path.resolve(target_path))) throw`
- **Effort**: S (< 30 min)
- **Source**: Team B (SEC-01)
- **Score**: Impact=5 x Feasibility=5 x Risk=5 = **125**

### 2. Add origin validation to `uploadFileToUrl` (SEC-02)

- **What**: Validate that the upload URL points to Canvas or known S3 domains before sending student file content. Add a timeout.
- **Where**: `/Users/theo/canvas-mcp/src/canvas-client.ts`, lines 465-503
- **Why**: A tampered Canvas response could exfiltrate student work to an attacker-controlled server. The missing timeout can hang the server indefinitely.
- **How**:
  1. Extract the hostname from `uploadUrl`
  2. Check against an allowlist: Canvas origin, `*.s3.amazonaws.com`, `*.s3.*.amazonaws.com`, `instructure-uploads.s3.amazonaws.com`
  3. Add `signal: this.createTimeoutSignal(60_000)` to the fetch call
- **Effort**: S (< 30 min)
- **Source**: Team B (SEC-02)
- **Score**: Impact=5 x Feasibility=4 x Risk=5 = **100**

### 3. Add domain validation to `downloadFile` (SEC-03)

- **What**: Validate download URL hostname against Canvas origin and known CDN/S3 domains before following redirects.
- **Where**: `/Users/theo/canvas-mcp/src/canvas-client.ts`, lines 519-533
- **Why**: SSRF vector -- the server follows redirects to arbitrary internal network addresses.
- **How**:
  1. Parse URL hostname from `downloadUrl`
  2. Validate against same allowlist as SEC-02 (Canvas origin + S3 patterns)
  3. Reject if hostname does not match
  4. Keep existing 60s timeout and `redirect: 'follow'` (redirect hops stay within S3)
- **Effort**: S (< 30 min)
- **Source**: Team B (SEC-03)
- **Score**: Impact=5 x Feasibility=4 x Risk=5 = **100**

### 4. Add LRU eviction to in-memory cache (SEC-04)

- **What**: Cap the cache at 500 entries with LRU eviction. Add periodic expired-entry sweep.
- **Where**: `/Users/theo/canvas-mcp/src/canvas-client.ts`, line 56 (cache declaration)
- **Why**: Long-running sessions with many unique API calls cause unbounded memory growth. The server could crash.
- **How**:
  1. Track insertion order (or access order) in the Map
  2. On `set`, if `cache.size >= 500`, delete the oldest entry
  3. Add a `sweepExpired()` method called on every `get` (or on a 60s interval via `setInterval`)
  4. Alternative: use a lightweight LRU library, but a manual approach in ~20 lines is simpler
- **Effort**: M (30-60 min)
- **Source**: Team B (SEC-04), Team D (R3 partial)
- **Score**: Impact=4 x Feasibility=4 x Risk=5 = **80**

### 5. Validate `target_path` and `base_path` for filesystem writes (SEC-05)

- **What**: Restrict `target_path` (download_file) and `base_path` (setup_semester) to paths under `$HOME`. Validate resolved paths.
- **Where**:
  - `/Users/theo/canvas-mcp/src/tools/files.ts`, line 356 (`mkdir` call)
  - `/Users/theo/canvas-mcp/src/tools/semester.ts`, lines 105-117
- **Why**: Prompt injection could craft a malicious path and create directories or files anywhere on the filesystem.
- **How**:
  1. `const resolved = path.resolve(expandedPath)`
  2. `if (!resolved.startsWith(os.homedir())) throw new Error('Path must be under home directory')`
  3. Apply to both `target_path` in download_file and `base_path` in setup_semester
- **Effort**: S (< 30 min)
- **Source**: Team B (SEC-05)
- **Score**: Impact=4 x Feasibility=5 x Risk=5 = **100**

### 6. Merge `find_syllabus` into `get_course_syllabus` -- eliminate duplicate tool

- **What**: Delete `find_syllabus` entirely. Move its one extra keyword (`'course schedule'`) into `get_course_syllabus`. Update tool description to note the deep-search behavior.
- **Where**: `/Users/theo/canvas-mcp/src/tools/courses.ts`, lines 144-220 (delete), lines 74-141 (enhance)
- **Why**: Two tools doing the same thing confuses Claude's tool selection. Students get slower responses when Claude tries both sequentially. This also removes ~80 lines of duplicated fallback logic.
- **How**:
  1. Add `'course schedule'` to the keyword list in `get_course_syllabus`
  2. Delete the entire `find_syllabus` tool registration block
  3. Update the description of `get_course_syllabus` to mention it searches modules, pages, and files
- **Effort**: S (< 30 min)
- **Source**: Team A (W7), Team C (Problem 1), Team D (3.4/R8)
- **Score**: Impact=4 x Feasibility=5 x Risk=4 = **80**

### 7. Extract shared grade deflation logic into `services/grade-utils.ts`

- **What**: Extract the duplicated "future zero" deflation detection into a single shared function. Import in `grades.ts`, `dashboard.ts`, and `grade-analysis.ts`.
- **Where**:
  - `/Users/theo/canvas-mcp/src/tools/grades.ts`, lines 56-109
  - `/Users/theo/canvas-mcp/src/tools/dashboard.ts`, lines 436-475
  - `/Users/theo/canvas-mcp/src/tools/grade-analysis.ts`, lines 36-66
  - New file: `/Users/theo/canvas-mcp/src/services/grade-utils.ts`
- **Why**: The grade deflation logic is the single largest piece of business logic duplication (3 copies, ~120 lines). A bug fix in one copy would be missed in the others. This is the #1 maintenance risk.
- **How**:
  1. Create `src/services/grade-utils.ts` with `detectGradeDeflation(assignmentGroups, now)` returning `{ totalEarned, totalPossible, futureZeroPossible, adjustedScore, deflationWarning }`
  2. Replace the inline logic in all three tool files with calls to the shared function
  3. Add unit tests in `tests/grade-utils.test.ts`
- **Effort**: M (30-60 min)
- **Source**: Team D (3.1/R1)
- **Score**: Impact=4 x Feasibility=4 x Risk=4 = **64**

### 8. Unify date parsing into `utils.ts`

- **What**: Move `extractDateFromText()` and `parseMonthName()` from `untracked.ts` (the superset version) into `utils.ts`. Delete the duplicate in `dashboard.ts`.
- **Where**:
  - `/Users/theo/canvas-mcp/src/tools/dashboard.ts`, lines 16-48 (delete)
  - `/Users/theo/canvas-mcp/src/tools/untracked.ts`, lines 46-107 (move)
  - `/Users/theo/canvas-mcp/src/utils.ts` (add)
- **Why**: Two independent implementations of the same date parser, with the `dashboard.ts` version being a subset. Inconsistent behavior between daily_briefing and scan_untracked_work.
- **How**:
  1. Move the `untracked.ts` version of `extractDateFromText()` and `parseMonthName()` to `utils.ts`
  2. Export from `utils.ts`
  3. Import in both `dashboard.ts` and `untracked.ts`
  4. Delete the `dashboard.ts` inline versions and the `untracked.ts` local definitions
- **Effort**: S (< 30 min)
- **Source**: Team D (3.2/R2)
- **Score**: Impact=3 x Feasibility=5 x Risk=4 = **60**

### 9. Add caching to `listModules`, `listAssignments`, and `listAssignmentGroups`

- **What**: Add TTL-based caching (3-minute TTL) to these three frequently-called methods in the Canvas client, using the same pattern already used for `listCourses`.
- **Where**: `/Users/theo/canvas-mcp/src/canvas-client.ts` -- the `listModules()`, `listAssignments()`, and `listAssignmentGroups()` methods
- **Why**: These are called by 6+, 5+, and 4 tools respectively, but are uncached. A `daily_briefing` -> `get_grade_breakdown` -> `scan_untracked_work` flow fetches the same module data 3 times. Caching reduces API calls by 40-60% in typical sessions.
- **How**:
  1. Add cache key construction (e.g., `modules:${courseId}:${JSON.stringify(params)}`)
  2. Check cache before API call, return cached if valid
  3. Store result with 3-minute TTL
  4. Follow existing pattern from `listCourses()` caching
- **Effort**: S (< 30 min)
- **Source**: Team D (5.4/R3), Team A (T3/T7)
- **Score**: Impact=4 x Feasibility=5 x Risk=4 = **80**

### 10. Restructure `get_my_submission_status` -- summary first, trim submitted list

- **What**: Move `total_missing` and `total_points_at_risk` to the top of the response. Replace the full `submitted` array with `submitted_count` per course. Keep only `missing` and `not_yet_due` arrays in detail.
- **Where**: `/Users/theo/canvas-mcp/src/tools/grades.ts`, `get_my_submission_status` handler (lines ~140-240)
- **Why**: The tool returns ALL submitted assignments (potentially 100+) when the student only asked "what am I missing?" The useful data (missing assignments) is buried at the bottom. This is the most common example of the "information overload" problem.
- **How**:
  1. Compute `total_points_at_risk = sum of points_possible for all missing items`
  2. Structure response as: `{ total_missing, total_points_at_risk, courses: [{ name, missing: [...], not_yet_due: [...], submitted_count }] }`
  3. Remove the per-item `submitted` array (replace with count)
- **Effort**: M (30-60 min)
- **Source**: Team C (P1 #4)
- **Score**: Impact=4 x Feasibility=4 x Risk=4 = **64**

### 11. Move `analysis` to top of `get_grade_breakdown` response; make syllabus optional

- **What**: Restructure the response so `analysis` (strongest/weakest group, grade projections) appears first, followed by assignment group details. Make syllabus text inclusion opt-in via a `include_syllabus` parameter (default false).
- **Where**: `/Users/theo/canvas-mcp/src/tools/grade-analysis.ts`, `get_grade_breakdown` handler
- **Why**: The most actionable information (grade projections, weak areas) is buried below hundreds of lines of per-assignment data. The embedded syllabus text wastes thousands of tokens when the student already has it or does not need it.
- **How**:
  1. Add `include_syllabus` boolean parameter (default false)
  2. Build response object with `analysis` as the first key
  3. Only include `syllabus_text` when `include_syllabus=true`
  4. Suppress `drop_lowest: null` and `drop_highest: null` when they are 0 or null
- **Effort**: M (30-60 min)
- **Source**: Team C (P1 #5)
- **Score**: Impact=4 x Feasibility=4 x Risk=4 = **64**

---

## TIER 2: SHOULD DO (High-impact improvements)

These significantly improve quality and maintainability but are not blockers.

### 12. Standardize Zod ID validation across all tool files

- **What**: Replace all bare `z.number()` ID fields with `z.number().int().positive()`. Optionally create a shared `const canvasId = z.number().int().positive()` in a `schemas.ts` file.
- **Where**:
  - `/Users/theo/canvas-mcp/src/tools/pages.ts` (lines 12, 70)
  - `/Users/theo/canvas-mcp/src/tools/folders.ts` (lines 13, 45)
  - `/Users/theo/canvas-mcp/src/tools/files.ts` (lines 37, 254, 282)
  - `/Users/theo/canvas-mcp/src/tools/feedback.ts` (course_id)
  - `/Users/theo/canvas-mcp/src/tools/conversations.ts` (line 60)
- **Why**: Inconsistent validation lets negative numbers and floats through, producing confusing Canvas API errors instead of clear validation messages.
- **How**: Find-and-replace `z.number().describe` with `z.number().int().positive().describe` in the affected files. Or create `src/schemas.ts` with reusable ID schema and import everywhere.
- **Effort**: S (< 30 min)
- **Source**: Team B (QUA-11), Team D (4.8/R7)
- **Score**: Impact=3 x Feasibility=5 x Risk=5 = **75**

### 13. Remove dead type definitions from `types/canvas.ts`

- **What**: Delete `UserPreferences`, `ContextNote`, `ContextData`, and `PaginatedResponse<T>` from `types/canvas.ts`. These are never imported; the real definitions live in `services/preferences.ts`.
- **Where**: `/Users/theo/canvas-mcp/src/types/canvas.ts`, lines 402-411 (PaginatedResponse) and lines 761-779 (preference types)
- **Why**: Dead code that risks definition drift and confuses contributors.
- **How**: Delete the type blocks. Run `tsc --noEmit` to verify nothing breaks.
- **Effort**: S (< 30 min)
- **Source**: Team B (QUA-16), Team D (4.1/R5)
- **Score**: Impact=2 x Feasibility=5 x Risk=5 = **50**

### 14. Fix dynamic import of `utils.js` in `canvas-client.ts`

- **What**: Replace `await import('./utils.js')` with a static import at the top of the file. The "circular dependency" comment is incorrect -- no circular dependency exists.
- **Where**: `/Users/theo/canvas-mcp/src/canvas-client.ts`, line 346
- **Why**: Unnecessary async overhead on every `getCourseSyllabus` call. Misleading comment.
- **How**: Add `import { stripHtmlTags } from './utils.js'` at the top. Remove the dynamic import. Delete the circular dependency comment.
- **Effort**: S (< 30 min)
- **Source**: Team D (4.6/R12)
- **Score**: Impact=2 x Feasibility=5 x Risk=5 = **50**

### 15. Unify untracked work classification logic

- **What**: Delete `classifyUntrackedType()` from `dashboard.ts`. Import and use the more complete `classifySubHeader()` from `untracked.ts` (or from a new shared location after item #8 moves date parsing to utils).
- **Where**:
  - `/Users/theo/canvas-mcp/src/tools/dashboard.ts`, lines 53-59 (delete)
  - `/Users/theo/canvas-mcp/src/tools/untracked.ts`, lines 31-41 (export, or move to utils)
- **Why**: Two keyword lists with different coverage produce inconsistent classification between daily_briefing and scan_untracked_work.
- **How**:
  1. Export `classifySubHeader` from `untracked.ts`
  2. Import in `dashboard.ts`, replace `classifyUntrackedType`
  3. Delete the `classifyUntrackedType` function and the inline `untrackedKeywords` array from `dashboard.ts`
- **Effort**: S (< 30 min)
- **Source**: Team D (3.8), Team B (QUA-15)
- **Score**: Impact=3 x Feasibility=5 x Risk=4 = **60**

### 16. Sanitize HTML in write tools before sending to Canvas

- **What**: Strip `<script>`, `<iframe>`, `onclick`/`onerror` event handlers, and `javascript:` URLs from the `message` parameter in `post_discussion_entry`, `reply_to_discussion`, and the `body` parameter in `submit_assignment`.
- **Where**:
  - `/Users/theo/canvas-mcp/src/tools/discussions.ts`, lines 118-144, 146-178
  - `/Users/theo/canvas-mcp/src/tools/submissions.ts`, submit_assignment handler
- **Why**: Prompt injection could trick Claude into posting malicious HTML to class discussions visible to all students.
- **How**:
  1. Create a `sanitizeHtmlForSubmission(html: string): string` function in `utils.ts`
  2. Strip `<script>`, `<iframe>`, `<object>`, `<embed>` tags
  3. Remove event handler attributes (`on*=`)
  4. Remove `javascript:` URLs
  5. Call this function on `message`/`body` before sending to Canvas API
- **Effort**: M (30-60 min)
- **Source**: Team B (SEC-06)
- **Score**: Impact=4 x Feasibility=3 x Risk=4 = **48**

### 17. Suppress null values in tool responses

- **What**: Add a `stripNulls(obj)` utility that recursively removes keys with `null`, `undefined`, or `false` values from response objects. Apply in `formatSuccess()`.
- **Where**: `/Users/theo/canvas-mcp/src/utils.ts`, `formatSuccess()` at line 119
- **Why**: Nearly every tool response includes 5-15 null fields (`lock_explanation: null`, `all_day_date: null`, `completed_at: null`, etc.) that consume tokens and add visual noise. Across a session with 10+ tool calls, this wastes significant context window.
- **How**:
  1. Create `function stripNulls(obj: unknown): unknown` that recursively removes null/undefined values from objects and arrays
  2. Apply inside `formatSuccess`: `text: JSON.stringify(stripNulls(data), null, 2)`
  3. Be careful: do NOT strip `0`, empty strings, or `false` when they are semantically meaningful (e.g., `score: 0`). Only strip `null` and `undefined`.
- **Effort**: M (30-60 min)
- **Source**: Team C (7.2)
- **Score**: Impact=3 x Feasibility=4 x Risk=3 = **36** (risk=3 because stripping could break Claude parsing expectations)

### 18. Remove `get_rubric` standalone tool

- **What**: Delete the `get_rubric` tool. `get_assignment` already returns rubric data by default via `include_rubric=true`. Add a note to `get_assignment`'s description: "Includes rubric criteria and ratings by default."
- **Where**: `/Users/theo/canvas-mcp/src/tools/assignments.ts`, lines 126-163
- **Why**: Reduces tool count by 1, eliminates duplicate rubric formatting code, removes one more tool from Claude's selection space.
- **How**: Delete the `get_rubric` server.tool() block. Enhance `get_assignment` description.
- **Effort**: S (< 30 min)
- **Source**: Team C (Problem 2), Team D (3.7)
- **Score**: Impact=3 x Feasibility=5 x Risk=4 = **60**

### 19. Fix `get_recent_feedback` course name bug

- **What**: When `course_id` is provided, resolve the actual course name instead of displaying `"Course ${course_id}"`.
- **Where**: `/Users/theo/canvas-mcp/src/tools/feedback.ts`, approximately line 30-40
- **Why**: This is a confirmed bug. Students see "Course 486245" instead of "FINANCE 300" when filtering feedback to a specific course.
- **How**: When `course_id` is provided, call `client.getCourse(course_id)` and use `course.name` or `course.course_code` in the response.
- **Effort**: S (< 30 min)
- **Source**: Team C (3.13)
- **Score**: Impact=3 x Feasibility=5 x Risk=5 = **75**

### 20. Add human-friendly date display alongside ISO dates

- **What**: Create a `formatDateDisplay(isoString: string): string` utility that returns `"Wed, Feb 15 at 11:59 PM"`. Add a `due_display` field alongside `due_at` in the 5 highest-traffic tools.
- **Where**:
  - New utility in `/Users/theo/canvas-mcp/src/utils.ts`
  - Apply in: `daily_briefing`, `get_all_upcoming_work`, `get_my_submission_status`, `list_assignments`, `get_planner_items`
- **Why**: Every tool returns raw ISO 8601 dates (`2026-02-15T23:59:00Z`) that require Claude to reformat. Pre-formatted dates reduce tokens and ensure consistent presentation.
- **How**:
  1. Create `formatDateDisplay(iso: string, userTimezone?: string): string` using `Intl.DateTimeFormat`
  2. Add `due_display` field in the response mapping of each tool (alongside existing `due_at`)
  3. Consider also adding `days_until` for upcoming items
- **Effort**: M (30-60 min)
- **Source**: Team C (7.1), Team C (P1 #2)
- **Score**: Impact=4 x Feasibility=3 x Risk=4 = **48**

### 21. Create `getActiveCourses()` convenience method

- **What**: Add `async getActiveCourses()` and `async getActiveCourseContextCodes()` methods to the Canvas client. Replace the 7+ inline copies of `client.listCourses({ enrollment_state: 'active', state: ['available'] })`.
- **Where**:
  - `/Users/theo/canvas-mcp/src/canvas-client.ts` (add methods)
  - 7 tool files: `modules.ts`, `calendar.ts`, `search.ts`, `dashboard.ts`, `feedback.ts`, `grades.ts`, `semester.ts`
- **Why**: Reduces boilerplate across 7+ files, ensures consistent course filtering, single place to change if filtering logic evolves.
- **How**:
  1. Add `async getActiveCourses(): Promise<Course[]>` that wraps the common pattern
  2. Add `async getActiveCourseContextCodes(): Promise<string[]>` that maps to `course_${id}` format
  3. Search-and-replace the pattern in all 7 files
- **Effort**: M (30-60 min)
- **Source**: Team D (3.6/R11)
- **Score**: Impact=2 x Feasibility=5 x Risk=4 = **40**

### 22. Improve error messages with Canvas API error code mapping

- **What**: Map common Canvas HTTP error codes to student-friendly messages with recovery suggestions.
- **Where**: `/Users/theo/canvas-mcp/src/utils.ts`, `formatError()` function at line 102
- **Why**: Current errors are terse (`"Error listing assignments: 403"`). Students and Claude get no recovery guidance.
- **How**:
  1. Parse the HTTP status code from the error message (Canvas client already includes it)
  2. Map to actionable messages:
     - 401: "Authentication failed. Your Canvas API token may have expired."
     - 403: "Access denied. This course may restrict API access. Try using list_modules to find the content through module items instead."
     - 404: "Not found. This item may have been deleted or unpublished by the instructor."
     - 429: "Canvas is rate-limiting requests. Please wait a moment and try again."
     - 500+: "Canvas server error. This is temporary -- try again in a minute."
  3. Keep the original error message as a `detail` field for debugging
- **Effort**: S (< 30 min)
- **Source**: Team C (7.6/P3 #25)
- **Score**: Impact=3 x Feasibility=5 x Risk=5 = **75**

---

## TIER 3: NICE TO HAVE (Polish)

These improve quality but are not critical for v3.0 launch.

### 23. Add generic date sort utility to `utils.ts`

- **What**: Create `sortByDate<T>(items: T[], getDate: (item: T) => string | null, order?: 'asc' | 'desc'): T[]` to replace ~8 inline sorting implementations.
- **Where**: `/Users/theo/canvas-mcp/src/utils.ts` (new export)
- **Why**: Same date sorting pattern repeated 8 times with different field names across `dashboard.ts`, `resources.ts`, `calendar.ts`, `conversations.ts`, `activity.ts`.
- **How**: Generic function with a date accessor callback. Replace inline sorts one file at a time.
- **Effort**: S (< 30 min)
- **Source**: Team D (3.5/R10)
- **Score**: Impact=2 x Feasibility=5 x Risk=4 = **40**

### 24. Enable `noUnusedLocals` and `noUnusedParameters` in tsconfig

- **What**: Set both to `true`, fix resulting compiler errors (prefix unused params with `_`).
- **Where**: `/Users/theo/canvas-mcp/tsconfig.json`, lines 16-17
- **Why**: Surfaces dead code and unused imports that have accumulated during rapid Phase 3 development.
- **How**: Flip flags, run `tsc --noEmit`, fix errors.
- **Effort**: M (30-60 min, depending on number of errors)
- **Source**: Team B (QUA-10), Team D (4.2/R6)
- **Score**: Impact=2 x Feasibility=4 x Risk=4 = **32**

### 25. Fix `allowed_attempts: -1` display in `get_assignment`

- **What**: Map `allowed_attempts: -1` to `"unlimited"` in the response.
- **Where**: `/Users/theo/canvas-mcp/src/tools/assignments.ts`, `get_assignment` handler
- **Why**: `-1` is a Canvas API internal representation. Students seeing "attempts: -1" is confusing.
- **How**: `allowed_attempts: assignment.allowed_attempts === -1 ? 'unlimited' : assignment.allowed_attempts`
- **Effort**: S (< 30 min)
- **Source**: Team C (P2 #14)
- **Score**: Impact=2 x Feasibility=5 x Risk=5 = **50**

### 26. Remove noise fields from `list_assignments` output

- **What**: Remove `published` (always true for visible assignments), remove `locked_for_user` when false, map `submission_types` to student-friendly labels.
- **Where**: `/Users/theo/canvas-mcp/src/tools/assignments.ts`, `list_assignments` response mapping
- **Why**: Every assignment includes 2-3 always-true/false fields and technical strings like `"online_text_entry"` that waste tokens.
- **How**:
  1. Remove `published` field from response
  2. Only include `locked_for_user` and `lock_explanation` when `locked_for_user === true`
  3. Map submission types: `online_upload` -> "File Upload", `online_text_entry` -> "Text Entry", `online_quiz` -> "Quiz", `online_url` -> "URL"
- **Effort**: S (< 30 min)
- **Source**: Team C (P2 #13)
- **Score**: Impact=2 x Feasibility=5 x Risk=4 = **40**

### 27. Fix cache key determinism

- **What**: Sort object keys before `JSON.stringify` in cache key construction.
- **Where**: `/Users/theo/canvas-mcp/src/canvas-client.ts`, line 314 and similar cache key lines
- **Why**: `JSON.stringify` does not guarantee property order, so semantically identical params may miss cache.
- **How**: Create a `stableStringify(obj)` helper that sorts keys, use for all cache key construction.
- **Effort**: S (< 30 min)
- **Source**: Team B (QUA-25)
- **Score**: Impact=2 x Feasibility=5 x Risk=5 = **50**

### 28. Remove `source.item_type: 'SubHeader'` from `scan_untracked_work` output

- **What**: Remove or rename `item_type: 'SubHeader'` from the untracked work response to avoid leaking Canvas API internals.
- **Where**: `/Users/theo/canvas-mcp/src/tools/untracked.ts`
- **Why**: Students should not see Canvas API terminology. "SubHeader" is meaningless to them.
- **How**: Remove `item_type` from the `source` object in the response, or replace with `source_type: 'module_heading'`.
- **Effort**: S (< 30 min)
- **Source**: Team C (P2 #16)
- **Score**: Impact=2 x Feasibility=5 x Risk=5 = **50**

### 29. URL-encode page slugs in `getPage`

- **What**: Apply `encodeURIComponent()` to the `pageUrlOrId` parameter.
- **Where**: `/Users/theo/canvas-mcp/src/canvas-client.ts`, line 546
- **Why**: Defense-in-depth against path injection via crafted page slugs.
- **How**: `return this.request<Page>(\`/courses/${courseId}/pages/${encodeURIComponent(pageUrlOrId)}\`);`
- **Effort**: S (< 30 min)
- **Source**: Team B (QUA-22)
- **Score**: Impact=2 x Feasibility=5 x Risk=5 = **50**

### 30. Add "when to use" guidance to overlapping tool descriptions

- **What**: Add `"Use this when..."` clauses to tool descriptions for tools with overlapping purposes.
- **Where**:
  - `get_all_upcoming_work` in `search.ts`: "Use this for a quick deadline overview across all courses."
  - `get_planner_items` in `planner.ts`: "Use this for detailed planner data with date filtering and type filtering."
  - `list_pages` in `pages.ts`: "Use this when you need wiki pages specifically. For general content, use list_modules."
  - `get_activity_stream` in `activity.ts`: "Use this for a chronological feed of recent activity. For a structured daily overview, use daily_briefing."
- **Why**: Reduces Claude's tool selection ambiguity, which is the #1 UX issue with 58 tools.
- **How**: Update the description string in each `server.tool()` call.
- **Effort**: S (< 30 min)
- **Source**: Team C (4.3), Team A (W7/T10)
- **Score**: Impact=3 x Feasibility=5 x Risk=5 = **75**

### 31. Fix `any` type casts

- **What**: Replace the 3 remaining `any` casts with proper types.
- **Where**:
  - `/Users/theo/canvas-mcp/src/tools/planner.ts`, line 148: use `Partial<CreatePlannerNoteParams>` instead of `params as any`
  - `/Users/theo/canvas-mcp/src/tools/feedback.ts`, line 66: type the `PromiseFulfilledResult` properly
  - `/Users/theo/canvas-mcp/src/canvas-client.ts`, line 899: define a `PartialCanvasFile` type for the search fallback
- **Why**: These `any` casts bypass TypeScript safety and could hide runtime errors.
- **How**: Define proper partial/narrow types and replace the casts.
- **Effort**: S (< 30 min)
- **Source**: Team B (QUA-09), Team D (4.5)
- **Score**: Impact=2 x Feasibility=4 x Risk=5 = **40**

### 32. Add `score_display` computed field for scores

- **What**: Wherever scores appear (grades, submissions, feedback), add a pre-computed `score_display: "42/50 (84%)"` string.
- **Where**: Apply in `get_my_grades`, `get_grade_breakdown`, `get_recent_feedback`, `get_submission`
- **Why**: Students must mentally divide `score` by `points_possible` and convert to percentage. Pre-computing this reduces Claude's formatting burden and ensures consistency.
- **How**: `score_display: \`${score}/${possible} (${((score/possible)*100).toFixed(1)}%)\``
- **Effort**: S (< 30 min)
- **Source**: Team C (7.3)
- **Score**: Impact=3 x Feasibility=5 x Risk=5 = **75**

### 33. Sanitize filesystem paths in error messages

- **What**: Strip absolute paths from error messages before returning them to the LLM.
- **Where**: `/Users/theo/canvas-mcp/src/utils.ts`, `formatError()` function
- **Why**: File system errors can expose usernames and directory structures (e.g., `/Users/theo/Canvas/...`).
- **How**: Add a regex replacement: `message.replace(/\/Users\/[^\s:]+/g, '<path>')` or more generically replace any absolute path.
- **Effort**: S (< 30 min)
- **Source**: Team B (QUA-13)
- **Score**: Impact=2 x Feasibility=5 x Risk=4 = **40**

---

## CUT LIST (Rejected recommendations with reasons)

### From Team A (SWOT)

| Recommendation | Reason for Cut |
|---|---|
| **G1/G2: Send/Reply to Conversation** | High value but HIGH risk. Write operations to other humans (professors, classmates) require extreme care. A prompt injection sending an embarrassing email to a professor is catastrophic. Defer to Phase 5 after the safety architecture is hardened. |
| **G3/G4: Calendar Event Creation** | This is a Canvas calendar write. Google Calendar MCP already handles personal calendar creation. Adding Canvas calendar writes duplicates functionality and adds API write risk. |
| **G5/G6: Quiz Details / Quiz Submissions** | Classic Quizzes API is being deprecated. UW-Madison may already be on New Quizzes. Building on a dying API is wasted effort. Revisit when New Quizzes API stabilizes. |
| **G7: List Groups** | Low student value (3/5). Most students know their groups already. Not worth the tool count increase. |
| **G8: Student Analytics** | Interesting but niche. "Am I participating enough?" is rarely asked. Low impact for the effort. |
| **G9: Peer Review List** | Only relevant to courses using peer review. Too narrow. |
| **G10: Enrollment/Classmate Info** | Privacy concerns with exposing classmate information. Instructor/TA listing is useful but can wait until the messaging tools (Phase 5) justify it. |

### From Team C (UX)

| Recommendation | Reason for Cut |
|---|---|
| **P0: Convert top 5 tools to markdown output** | Over-engineered. Claude already reformats JSON into readable prose/tables. Converting to markdown adds a parallel formatting system to maintain. The real wins come from trimming JSON (null removal, noise field removal) not replacing it. The effort (L for each tool) does not justify the marginal improvement. |
| **P2 #11: Course ID fuzzy matching** | Risky. "Finance" could match multiple courses. Claude already handles the `list_courses` -> ID resolution flow well. Adding fuzzy matching to every tool handler is high effort and could cause wrong-course bugs. |
| **P2 #12: Move `list_announcements` to its own file** | Pure code organization. Does not affect any student experience. The tool works fine in `modules.ts`. |
| **P2 #17: Add `suggested_actions` to tool outputs** | Prompt templates already guide Claude on follow-up actions. Adding next-step suggestions to every tool response adds token overhead and maintenance burden. |
| **P2 #19: Add compact mode to `list_modules`** | The existing `include_items=false` parameter already provides this. Not needed. |
| **P3 #22: Standardize `get_my_*` naming prefix** | Renaming tools is a breaking change for any saved prompts or workflows. The inconsistency is minor and does not affect functionality. |
| **P3 #26: Filter past courses in `canvas://courses/active` resource** | Resources are rarely used compared to tools. Low impact. |
| **P3 #27: Add `include_tools` to `get_course`** | Over-optimization. Claude can call `get_course_tools` when needed. One extra tool call is not a significant burden. |

### From Team D (Architecture)

| Recommendation | Reason for Cut |
|---|---|
| **R4: Decompose daily_briefing into service functions** | The right long-term move, but effort=L and high risk of introducing regressions in the most critical tool with 0% test coverage. Do items #7 (grade utils), #8 (date parsing), and #15 (classification) FIRST -- these extract the duplicated pieces. The remaining daily_briefing will be ~350 lines, which is manageable. Full decomposition can happen in Phase 5 after tests are written. |
| **R9: Add test coverage for critical logic** | Correct recommendation but out of scope for v3.0 implementation sprint. Tests should be written alongside the code changes but are not a standalone deliverable for this list. (Note: item #7 includes a test file for grade-utils.) |
| **4.7: Make hard-coded values configurable via env vars** | Over-engineering. The 5-minute cache TTL, 30s timeout, and 3 max retries are all reasonable defaults. Adding env var configuration for each adds complexity without clear student benefit. The semester start dates (Jan 20/Aug 28) are the one exception, but that is a niche edge case. |

### From Team E (Vision)

| Recommendation | Reason for Cut |
|---|---|
| **ALL Phase 5-8 items** | Out of scope. We are implementing Phase 4 (v3.0) NOW. This includes: all export tools, sync state service, cross-MCP prompt templates, Todoist/Notion integration, GPA simulator, workload analyzer, weekly report generator, course comparison tool, exam materials gatherer. These are good ideas for the future but are not v3.0. |
| **`get_course_people` tool** | Requires Canvas Enrollments API which may have institutional restrictions (4/5 courses already restrict Pages/Files). High risk of "access denied" errors. Defer until messaging tools justify the need. |
| **`check_grade_changes` with snapshot file** | Interesting concept but adds persistent state complexity. The preferences system already stores data; adding another JSON file for grade snapshots increases the surface area for bugs. Can be revisited in Phase 5. |
| **`simulate_gpa` tool** | Requires credit hours data that Canvas may not reliably provide. The UW-Madison GPA scale (A/AB/B/BC/C/D/F) is institution-specific. High effort, medium value. Defer. |
| **`analyze_workload` tool** | The heuristic for "submission type weight" is arbitrary (why is online_upload 3x and online_quiz 2x?). Without validation, the scores would mislead students. Needs research before implementation. |
| **Cross-MCP prompt templates** | These do not modify Canvas MCP code. They can be added to `prompts.ts` at any time independently. Not blocked by v3.0. |

### From Team B (Security) -- Already Addressed or Low Priority

| Recommendation | Reason for Cut |
|---|---|
| **QUA-07: Race condition in `runWithConcurrency`** | Not actually a bug. JavaScript is single-threaded; the post-increment is safe. The code is "fragile-looking" but correct. Rewriting it adds risk of introducing a real bug. |
| **SEC-08: Token in process.env** | This is inherent to environment variable-based auth. Reading from a file instead adds complexity. The token in MEMORY.md is a separate concern outside the codebase. Documented, not actionable in code. |
| **SEC-14: pdf-parse/officeparser untrusted content** | Sandboxing document parsers in child processes is a significant architectural change. The existing 30s timeout and 25MB file size limit are reasonable mitigations. Defer to a future security hardening sprint. |
| **QUA-12: Proactive rate limiting** | The existing retry/backoff for 429s works well. A token bucket adds complexity. Item #9 (caching) reduces API calls at the source, which is the better fix. |
| **QUA-18: Source maps in production** | This is a locally-run MCP server, not a deployed web app. Source maps have zero security impact. |
| **QUA-24: skipLibCheck** | Standard TypeScript configuration. No actionable change needed. |

---

## Implementation Order

The items should be implemented in this sequence to minimize risk:

**Day 1 -- Security fixes (items 1-5):** All path traversal and SSRF fixes. These are small, isolated changes that do not affect tool behavior.

**Day 2 -- Code deduplication (items 6-8, 13-15, 18):** Merge tools, extract shared logic, remove dead code. These reduce the codebase size and create the foundation for cleaner changes.

**Day 3 -- Performance and data quality (items 9-11, 17, 20):** Add caching, restructure responses, improve output quality. These change tool response shapes, so test manually.

**Day 4 -- Validation and polish (items 12, 16, 19, 21-22, 25-33):** Standardize schemas, fix bugs, add quality-of-life improvements. These are all small, independent changes.

---

## Summary

| Tier | Items | Total Effort | Focus |
|------|-------|-------------|-------|
| TIER 1 (Must Do) | 11 items | 4S + 7M = ~6-8 hours | Security fixes, critical deduplication, response restructuring |
| TIER 2 (Should Do) | 11 items | 7S + 4M = ~5-7 hours | Validation, more deduplication, UX improvements |
| TIER 3 (Nice to Have) | 11 items | 9S + 2M = ~4-5 hours | Polish, type safety, minor UX |
| **TOTAL** | **33 items** | | **~15-20 hours** |
| CUT | 30+ recommendations | -- | Over-engineered, out of scope, or low impact |

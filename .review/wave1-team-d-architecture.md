# Wave 1 - Team D: Architecture & Tech Debt Analysis

**Project:** Canvas MCP Server v2.4.0
**Analyst:** Team D - Architecture & Tech Debt
**Date:** 2026-02-10
**Scope:** All 27 source files, ~8,400 lines of TypeScript

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Assessment](#2-architecture-assessment)
3. [Code Duplication Analysis](#3-code-duplication-analysis)
4. [Tech Debt Inventory](#4-tech-debt-inventory)
5. [Performance Concerns](#5-performance-concerns)
6. [Recommendations](#6-recommendations)

---

## 1. Executive Summary

The Canvas MCP codebase is well-structured for a project that grew organically through three development phases. The core architecture follows a clean layered pattern: **Canvas API -> CanvasClient -> Tool Handlers -> MCP Protocol**. The code is readable, the error handling is consistent, and the fallback patterns (pages->modules, files->modules) are thoughtfully implemented.

However, the rapid Phase 3 development introduced significant code duplication, particularly in date-parsing logic, grade-deflation analysis, module-scanning patterns, and sorting/formatting utilities. The `daily_briefing` tool at 537 lines is the most complex single function in the codebase and duplicates logic from at least 5 other tools. Test coverage is minimal (only `utils.ts` and `canvas-client.ts` have tests). TypeScript strictness is intentionally relaxed (`noUnusedLocals: false`, `noUnusedParameters: false`), masking dead code.

**Top 5 Issues by Impact:**
1. Massive code duplication between `dashboard.ts`, `untracked.ts`, `grades.ts`, and `grade-analysis.ts` (grade deflation logic duplicated 3x, date parsing duplicated 2x)
2. `daily_briefing` is a 537-line god function making 6+ parallel API call waves
3. Zero test coverage for all 21 tool files, prompts, resources, and preferences service
4. Duplicate type definitions: `UserPreferences`, `ContextNote`, `ContextData` defined identically in both `types/canvas.ts` and `services/preferences.ts`
5. No caching on most expensive operations (grade breakdown, daily briefing)

---

## 2. Architecture Assessment

### 2.1 Overall Structure

```
src/
  index.ts              -- Entry point, tool registration (163 lines)
  canvas-client.ts      -- API client singleton (1,044 lines)
  utils.ts              -- Shared utilities (367 lines)
  types/canvas.ts       -- Type definitions (780 lines)
  prompts.ts            -- MCP prompt templates (389 lines)
  resources.ts          -- MCP resource handlers (544 lines)
  services/
    preferences.ts      -- File-based preferences (155 lines)
  tools/
    21 files             -- Tool handlers (~5,100 lines total)
```

**Verdict: Good layered architecture.** The separation of concerns is clean:
- `canvas-client.ts` owns all Canvas API communication
- `utils.ts` provides cross-cutting formatting utilities
- Each tool file registers its own tools with the MCP server
- `services/preferences.ts` handles persistent user state

### 2.2 Data Flow

```
User (Claude Desktop) --> MCP Protocol --> Tool Handler
    --> getCanvasClient() --> Canvas API
    --> formatSuccess(data) or formatError(context, error)
    --> MCP Protocol --> User
```

The data flow is linear and easy to follow. Every tool handler follows the same pattern:
1. Get `client` from `getCanvasClient()`
2. Call one or more client methods
3. Format and transform the response
4. Return via `formatSuccess()` or `formatError()`

### 2.3 Dependency Graph

```
index.ts
  -> tools/* (21 files, each independent)
      -> canvas-client.ts (singleton)
      -> utils.ts (pure functions)
      -> types/canvas.ts (type-only import)
      -> services/preferences.ts (only preferences.ts, semester.ts)
  -> prompts.ts (no runtime deps on tools)
  -> resources.ts (depends on canvas-client, utils, services/preferences)
```

**No circular dependencies detected.** All dependencies flow downward. Tool files never import from each other. The `canvas-client.ts` has one dynamic import (`utils.js` for `stripHtmlTags` in `getCourseSyllabus`) to avoid circular deps, which is noted with a comment.

### 2.4 Singleton Pattern

`getCanvasClient()` returns a module-level singleton. This works well for a single-user MCP server but would need refactoring if the server ever supported multiple users or connections simultaneously. The singleton also holds a mutable in-memory cache (`Map<string, { data: unknown; expiresAt: number }>`) and user timezone state.

### 2.5 Tool Registration Pattern

Every tool file exports `registerXTools(server: McpServer)` and internally calls `const client = getCanvasClient()`. This is called once at startup for all 21 files. The pattern is consistent and easy to follow, though it means all tools eagerly instantiate the client reference even if write tools are gated by `ENABLE_WRITE_TOOLS`.

### 2.6 Error Handling

Consistent across the codebase:
- All tool handlers use `try/catch` at the top level
- Errors are formatted with `formatError(context, error)`, producing `{ content: [{ type: 'text', text: '...' }], isError: true }`
- The CanvasClient sanitizes error messages to prevent token leakage
- Inner fallback patterns use nested try/catch (e.g., `courses.ts` syllabus fallback, `pages.ts` modules fallback, `files.ts` API fallback)

**Minor issue:** Some error catches are bare `catch { }` with no logging, making debugging difficult. Found in: `courses.ts` (lines 108, 128, 186, 206), `files.ts` (line 92, 164), `pages.ts` (line 36).

---

## 3. Code Duplication Analysis

### 3.1 CRITICAL: Grade Deflation Logic (3x duplicated)

The "future-dated assignments graded as 0" detection logic appears in three places:

| Location | Lines | Context |
|----------|-------|---------|
| `src/tools/grades.ts` lines 56-109 | ~53 lines | `get_my_grades` tool |
| `src/tools/dashboard.ts` lines 436-475 | ~39 lines | `daily_briefing` grades section |
| `src/tools/grade-analysis.ts` lines 36-66 | ~30 lines | Helper functions used by `get_grade_breakdown` |

All three compute `totalEarned`, `totalPossible`, `futureZeroPossible`, iterate over assignment groups, check `sub.score === 0 && assignment.due_at && new Date(assignment.due_at) > now`, and compute an `adjustedScore`. The logic should be extracted into a single shared function in `utils.ts` or a new `services/grade-utils.ts`.

### 3.2 CRITICAL: Date Parsing / Extraction (2x duplicated)

`extractDateFromText()` is implemented **independently** in two files:

| Location | Lines | Pattern Support |
|----------|-------|----------------|
| `src/tools/dashboard.ts` lines 16-48 | 32 lines | Month-Day, MM/DD |
| `src/tools/untracked.ts` lines 69-107 | 38 lines | DOW+Month-Day, Month-Day, MM/DD |

The `untracked.ts` version is a superset (includes day-of-week parsing). Both also independently define `parseMonthName()` logic with identical month lookup tables:

- `dashboard.ts` inlines the month map at line 17-22
- `untracked.ts` has `parseMonthName()` at lines 46-63

These should be unified into `utils.ts`.

### 3.3 HIGH: Module-Scanning Fallback Pattern (4x duplicated)

The pattern of "try direct API, catch -> scan modules for items of type X" appears in:

| File | API Attempted | Fallback Strategy |
|------|--------------|-------------------|
| `pages.ts` lines 21-53 | Pages API | Modules -> filter `type === 'Page'` |
| `files.ts` lines 99-224 | Files API | Modules -> filter `type === 'File'` |
| `courses.ts` lines 87-131 | `syllabus_body` | Modules -> items matching syllabus keywords |
| `courses.ts` lines 162-209 | `syllabus_body` | Modules -> items matching syllabus keywords (find_syllabus, nearly identical) |

### 3.4 HIGH: Syllabus Search Logic (2x duplicated)

`get_course_syllabus` (lines 74-141) and `find_syllabus` (lines 150-220) in `courses.ts` share ~80% identical logic:
- Both call `client.getCourseSyllabus(course_id)` first
- Both scan modules for syllabus-like items with the same keyword list
- Both handle Page and File types identically
- Both use `extractTextFromFile` for file content

The only difference: `find_syllabus` includes `'course schedule'` as an extra keyword and returns `module` in the response. These two tools should be merged or `find_syllabus` should delegate to `get_course_syllabus`.

### 3.5 MEDIUM: Sorting by Date (inline repeated ~8x)

The pattern `items.sort((a, b) => { if (!a.date) return 1; if (!b.date) return -1; return new Date(a.date).getTime() - new Date(b.date).getTime(); })` is implemented inline in:
- `dashboard.ts` (lines 237-241, 288-292, 302-306, 396-400)
- `resources.ts` (lines 291-294)
- `calendar.ts` (lines 75-79)
- `conversations.ts` (lines 40-44)
- `activity.ts` (lines 41-43)

While `utils.ts` exports `sortByDueDate()` for items with a `due_at` field, it is only used in `search.ts` and `planner.ts`. The dashboard and other files re-implement this with different field names (`start_at`, `last_message_at`, `posted_at`, etc.). A generic sort utility taking a date accessor function would eliminate this.

### 3.6 MEDIUM: "List All Active Courses" Pattern (7x repeated)

The pattern of fetching courses then building `context_codes` appears in:
- `modules.ts` lines 83-92 (`list_announcements`)
- `calendar.ts` lines 27-35 (`list_calendar_events`)
- `search.ts` lines 196-208 (`search_all_courses`)
- `dashboard.ts` lines 84-96 (wave 1)
- `feedback.ts` lines 20-28 (`get_recent_feedback`)
- `grades.ts` lines 153-158 (`get_my_submission_status`)
- `semester.ts` lines 57-68 (`setup_semester`)

Each fetches `client.listCourses({ enrollment_state: 'active', state: ['available'] })` and maps to `course_${c.id}`. A helper function like `getActiveCourseCodes()` or caching this in the client would reduce repetition.

### 3.7 MEDIUM: Rubric Formatting (2x duplicated)

Rubric criteria are formatted identically in two places in `assignments.ts`:
- `get_assignment` (lines 105-116)
- `get_rubric` (lines 146-158)

Both map `assignment.rubric` with the exact same structure: `{ id, description, long_description, points, ratings: [{ description, long_description, points }] }`.

### 3.8 LOW: Untracked Work Classification (2x)

`classifyUntrackedType()` in `dashboard.ts` (lines 53-59) and `classifySubHeader()` in `untracked.ts` (lines 31-41) serve the same purpose but with slightly different keyword lists:
- `dashboard.ts`: `['read', 'reading', 'chapter']`, `['prepare', 'before class']`, `['homework', 'practice']`
- `untracked.ts`: `readingKeywords`, `prepKeywords`, `homeworkKeywords`, `discussionKeywords` (expanded)

The `untracked.ts` version is more comprehensive and should be the canonical implementation.

### 3.9 LOW: Assignment Formatting

Multiple tools format assignments slightly differently:
- `assignments.ts` `list_assignments`: `{ id, name, due_at, points_possible, submission_types, published, ... }`
- `search.ts` `find_assignments_by_due_date`: `{ id, name, due_at, points_possible, submission_types, has_submitted, html_url }`
- `search.ts` `search_course_content`: `{ id, name, due_at, points_possible, html_url }`
- `dashboard.ts` `daily_briefing`: `{ name, course, due_at, days_until_due, points_possible, ... }`

---

## 4. Tech Debt Inventory

### 4.1 Duplicate Type Definitions

**Files:** `src/types/canvas.ts` (lines 761-779) and `src/services/preferences.ts` (lines 18-24, 88-98)

Both define:
```typescript
interface UserPreferences { display, priorities, behavior, courses, last_updated? }
interface ContextNote { timestamp, note, source }
interface ContextData { workflow_patterns, conversation_notes, preferences_applied }
```

The `types/canvas.ts` versions are **never imported** by any file. All code imports from `services/preferences.ts`. The `types/canvas.ts` versions are dead code.

**Impact:** Confusing for contributors, risk of drift between definitions.
**Fix:** Remove duplicate definitions from `types/canvas.ts`.
**Effort:** S

### 4.2 `noUnusedLocals: false` and `noUnusedParameters: false` in tsconfig

**File:** `tsconfig.json` lines 16-17

These settings were likely set to `false` during rapid development to avoid compiler errors from unused variables. With the codebase now at v2.4.0 and development paused, enabling these would surface dead code and unused imports.

**Impact:** Dead code accumulates silently; imports that should be removed stay.
**Fix:** Set both to `true`, fix resulting errors, then keep strict.
**Effort:** M (may surface 10-30 unused variables across the codebase)

### 4.3 Missing Tests for Tool Files

**Current coverage:**
- `tests/utils.test.ts` -- 422 lines, covers utils functions well
- `tests/canvas-client.test.ts` -- 517 lines, covers client basics

**Not tested (0 coverage):**
- All 21 tool files in `src/tools/` (the bulk of the codebase, ~5,100 lines)
- `src/prompts.ts` (389 lines)
- `src/resources.ts` (544 lines)
- `src/services/preferences.ts` (155 lines)

The tool handlers contain significant business logic (grade calculations, date parsing, module fallbacks, untracked work classification) that is not unit-tested. The grade-analysis file alone has ~300 lines of algorithmic logic (drop rules, weighted grade computation, binary search for target grade) with zero tests.

**Impact:** Regressions can go undetected; refactoring is risky without test coverage.
**Fix:** Prioritize tests for `grade-analysis.ts` (algorithmic logic), `untracked.ts` (date parsing), and `services/preferences.ts` (file I/O).
**Effort:** L (significant but high-value)

### 4.4 `daily_briefing` is a 537-line God Function

**File:** `src/tools/dashboard.ts` lines 64-537

This single tool handler:
- Makes 2 waves of parallel API calls (8+ endpoints total)
- Implements its own grade deflation analysis (duplicating `grades.ts`)
- Implements its own untracked work scanning (duplicating `untracked.ts`)
- Implements its own date parsing (duplicating `untracked.ts`)
- Has 11 distinct output sections
- Contains 3 inline helper functions defined at module scope (`extractDateFromText`, `classifyUntrackedType`, `examPattern`)

**Impact:** Hard to maintain, hard to test, easy to introduce bugs.
**Fix:** Extract each section into a service function, compose in the handler.
**Effort:** L

### 4.5 `any` Type Usage

Found in:
- `planner.ts` line 148: `params as any` -- bypasses type checking for update params
- `feedback.ts` line 66: `PromiseFulfilledResult<any>` -- loses type information
- `grade-analysis.ts` line 37: `groupResult` typed with `typeof` chains that are fragile

**Impact:** Reduces type safety, potential runtime errors.
**Fix:** Define proper types for these parameters.
**Effort:** S

### 4.6 Dynamic Import of `utils.js` in `canvas-client.ts`

**File:** `src/canvas-client.ts` line 346

```typescript
const { stripHtmlTags } = await import('./utils.js');
```

This is done to avoid a circular dependency. However, `canvas-client.ts` doesn't import from `utils.ts` at the top level anywhere else, and `utils.ts` doesn't import from `canvas-client.ts`. The comment says "avoid circular deps" but there is no actual circular dependency risk. `stripHtmlTags` could be imported statically.

**Impact:** Unnecessary async overhead on first call to `getCourseSyllabus`.
**Fix:** Move to a static import at the top of the file.
**Effort:** S

### 4.7 Hard-Coded Values

| Value | Location | Should Be |
|-------|----------|-----------|
| `5` (minute cache TTL) | `canvas-client.ts` line 59 | Configurable env var |
| `30_000` (request timeout) | `canvas-client.ts` line 61 | Configurable env var |
| `3` (max retries) | `canvas-client.ts` line 63 | Configurable env var |
| `100` (max pages) | `canvas-client.ts` line 65 | Configurable env var |
| `10_000` (max paginated items) | `canvas-client.ts` line 67 | Configurable env var |
| `50000` (default max text length) | `utils.ts` line 339 | Already exported as constant, good |
| `25 * 1024 * 1024` (max file size) | `utils.ts` line 336 | Already exported as constant, good |
| `200` (max context notes) | `services/preferences.ts` line 8 | Configurable or at least in a constants file |
| `['lectures', 'assignments', 'readings', 'exams', 'notes']` | `semester.ts` line 22 | Configurable |
| Semester start dates (Jan 20, Aug 28) | `untracked.ts` lines 122-127 | School-specific, should be configurable |
| `14` days (exam alert window) | `dashboard.ts` line 79 | Configurable |

**Impact:** Difficult to adapt for different Canvas instances or user preferences.
**Fix:** Group configurable values into a constants file or read from env vars.
**Effort:** S-M

### 4.8 Missing Input Validation

Several tools accept `z.number()` without `.int().positive()`:
- `pages.ts` line 12: `course_id: z.number()` (not `.int().positive()`)
- `pages.ts` line 70: `course_id: z.number()`
- `files.ts` line 37: `course_id: z.number()`
- `files.ts` line 254: `file_id: z.number()`
- `files.ts` line 282: `file_id: z.number()`
- `folders.ts` lines 13, 45: `z.number()` without `.int().positive()`
- `conversations.ts` line 60: `z.number()` without `.int().positive()`

Other tool files correctly use `z.number().int().positive()`. The inconsistency means some tools accept negative numbers or floats as IDs.

**Impact:** Unexpected API errors from invalid IDs passed to Canvas.
**Fix:** Standardize all ID fields to `z.number().int().positive()`.
**Effort:** S

### 4.9 `PaginatedResponse<T>` is Unused

**File:** `src/types/canvas.ts` lines 402-411

```typescript
export interface PaginatedResponse<T> {
  data: T[];
  link?: { current?, next?, prev?, first?, last? };
}
```

This type is never imported or used anywhere in the codebase. The actual pagination is handled via `Link` header parsing in `canvas-client.ts`.

**Impact:** Dead code, misleading for contributors.
**Fix:** Remove.
**Effort:** S

### 4.10 Inconsistent Error Handling in Resources

In `resources.ts`, every resource handler catches errors and returns them as part of the response content (not thrown). This is a good practice for resources. However, the error format varies:
- Some include `fetched_at` in the error response (lines 60-64, 106-110)
- Some don't (lines 134-136, 354)
- The `user-preferences` handler catches but returns a hardcoded default (lines 429-440)

**Impact:** Inconsistent error responses for resource consumers.
**Fix:** Standardize error responses in a helper function.
**Effort:** S

### 4.11 `process.env.ENABLE_WRITE_TOOLS` Check at Registration Time

**Files:** `src/tools/submissions.ts` line 78, `src/tools/discussions.ts` line 117

Write tools are conditionally registered based on `process.env.ENABLE_WRITE_TOOLS === 'true'` at startup. This means changing the env var requires restarting the server. This is actually fine for a single-user MCP server and is a reasonable security pattern. Not a real issue -- just documenting the design choice.

---

## 5. Performance Concerns

### 5.1 CRITICAL: `daily_briefing` API Call Volume

The `daily_briefing` tool makes **two waves** of API calls:

**Wave 1 (3 parallel calls):**
- `listCourses` (paginated)
- `getTodoItems` (paginated)
- `listPlannerItems` (paginated)

**Wave 2 (4 parallel calls, but 2 are batched across all courses):**
- `listCalendarEvents` (1 call)
- `listAnnouncements` (1 call)
- `listModules` for EACH course (5 courses x 1 call each = 5 calls, concurrency 3)
- `listAssignments` for EACH course (5 courses x 1 call each = 5 calls, concurrency 3)

**Total: ~14+ API calls per briefing**, plus pagination may double some. With 5 courses, each module call may involve pagination, resulting in 20-30+ HTTP requests total.

**Recommendation:** The client has a 5-minute cache, but `daily_briefing` doesn't explicitly leverage it. The module data and assignment data fetched here could be cached and reused by subsequent tool calls (e.g., `scan_untracked_work` re-fetches the same modules). Consider:
1. Adding caching to `listModules` and `listAssignments` calls
2. Creating a "briefing cache" that pre-warms data for the session

### 5.2 HIGH: `search_all_courses` Scales Poorly

**File:** `src/tools/search.ts` lines 182-309

This tool:
1. Fetches all active courses
2. For EACH course, calls `searchCourseContent()` which internally makes 5 parallel API calls
3. Concurrency limit of 3 courses at a time

With 5 courses: `5 courses x 5 API calls = 25 API calls`. With 10 courses: 50 API calls. The `searchCourseContent` method in `canvas-client.ts` always fetches ALL modules with items (even for a search), which is expensive.

**Recommendation:** Add caching to `searchCourseContent`, or allow the tool to accept a `content_types` parameter that only fetches relevant endpoints.

### 5.3 HIGH: `get_my_grades` Fetches Assignment Groups for Every Course

**File:** `src/tools/grades.ts` lines 26-33

Fetches assignment groups (with all assignments and submissions) for every active course, just to detect grade deflation. Each `listAssignmentGroups` call with `include: ['assignments', 'submission']` can return thousands of assignments across all groups.

**Recommendation:** Cache the assignment group data, or make deflation detection opt-in.

### 5.4 MEDIUM: No Caching on Assignment Group Fetches

`canvas-client.ts` caches `listCourses`, `getCourseSyllabus`, `listCourseTabs`, and `getUserProfile`. However, it does NOT cache:
- `listAssignmentGroups` -- called by `get_my_grades`, `get_grade_breakdown`, `calculate_what_if_grade`, `calculate_target_grade`
- `listModules` -- called by `daily_briefing`, `scan_untracked_work`, `list_course_files`, `list_pages`, `find_syllabus`, `get_course_syllabus`
- `listAssignments` -- called by `daily_briefing`, `get_my_submission_status`, `get_recent_feedback`

These are the most frequently called and most expensive operations. Adding even a short TTL cache (2-3 minutes) would significantly reduce API calls during a conversation session where multiple tools are invoked in sequence.

### 5.5 MEDIUM: `scan_untracked_work` Re-fetches Module Data

**File:** `src/tools/untracked.ts` lines 326-331

If `daily_briefing` was called before `scan_untracked_work` in the same session, the module data is fetched twice. There is no shared cache for module data outside the client's cache map, and `listModules` is not cached in the client.

### 5.6 LOW: Sequential File Operations in Module Item Content

**File:** `src/tools/modules.ts` `get_module_item_content` (lines 123-247)

When reading a file module item:
1. Fetches module items list (to find the item)
2. Fetches file metadata
3. Downloads the file
4. Extracts text

Steps 2-4 are sequential and could be slow for large files. This is inherent to the Canvas API design and not easily optimizable, but worth noting.

### 5.7 LOW: `formatSuccess` Uses `JSON.stringify` with Indent

**File:** `src/utils.ts` line 125

```typescript
text: JSON.stringify(data, null, 2),
```

Every tool response is pretty-printed with 2-space indentation. For large responses (e.g., `daily_briefing` with all 11 sections), this adds ~30-40% overhead in response size. For MCP communication where the LLM consumes the text, compact JSON would be equally readable.

---

## 6. Recommendations

### R1: Extract Grade Utilities into a Shared Module
- **Current state:** Grade deflation analysis logic duplicated 3x across `grades.ts`, `dashboard.ts`, and `grade-analysis.ts`.
- **Proposed fix:** Create `src/services/grade-utils.ts` with functions like `detectGradeDeflation(assignments, now)`, `computeWeightedGrade(groups, usesWeights)`. Import in all three locations.
- **Impact:** Eliminates ~120 lines of duplication, single point of truth for grade logic, easier to test.
- **Effort:** M

### R2: Unify Date Parsing into utils.ts
- **Current state:** `extractDateFromText()` implemented independently in `dashboard.ts` and `untracked.ts` with different capabilities; `parseMonthName()` duplicated.
- **Proposed fix:** Move the `untracked.ts` version (superset) to `utils.ts`. Export and reuse in both `dashboard.ts` and `untracked.ts`.
- **Impact:** Eliminates ~70 lines of duplication, fixes potential inconsistencies.
- **Effort:** S

### R3: Add Caching to Expensive Client Methods
- **Current state:** `listModules`, `listAssignments`, `listAssignmentGroups` are uncached despite being called repeatedly across tools.
- **Proposed fix:** Add TTL-based caching (2-3 minute TTL) to these methods in `canvas-client.ts`, using the same pattern already used for `listCourses` and `getCourseSyllabus`.
- **Impact:** Reduces API calls by 40-60% in typical conversation flows (daily briefing -> grade check -> untracked work scan).
- **Effort:** S

### R4: Decompose `daily_briefing` into Service Functions
- **Current state:** 537-line monolithic function with 11 sections, 2 API call waves, and duplicated logic from other tools.
- **Proposed fix:** Extract each section into a composable service function:
  - `fetchUrgencyData(assignmentData, now)`
  - `fetchExamAlerts(assignmentData, now, window)`
  - `fetchUntrackedWorkSummary(moduleData, now, daysAhead)` (reuse untracked.ts logic)
  - `fetchGradeSummary(courses, assignmentData)` (reuse grade-utils)
  - `buildWeekAheadPreview(assignmentData, client)`
- **Impact:** Testable units, eliminates internal duplication, function drops from 537 to ~100 lines.
- **Effort:** L

### R5: Remove Dead Type Definitions
- **Current state:** `UserPreferences`, `ContextNote`, `ContextData` in `types/canvas.ts` are never imported. `PaginatedResponse<T>` is unused.
- **Proposed fix:** Delete the 4 unused types from `types/canvas.ts`.
- **Impact:** Reduces confusion, prevents definition drift.
- **Effort:** S

### R6: Enable `noUnusedLocals` and `noUnusedParameters`
- **Current state:** Both set to `false` in `tsconfig.json`, masking dead code.
- **Proposed fix:** Set to `true`, fix resulting compiler errors, keep strict going forward.
- **Impact:** Surfaces dead code, improves code hygiene.
- **Effort:** S-M

### R7: Standardize Zod Schema Validation
- **Current state:** 6 tool files use `z.number()` for IDs instead of `z.number().int().positive()`.
- **Proposed fix:** Create a shared `schemas.ts` with `const courseId = z.number().int().positive().describe('The Canvas course ID')` etc. Import in all tool files.
- **Impact:** Consistent validation, less duplication of schema definitions.
- **Effort:** S

### R8: Merge `get_course_syllabus` and `find_syllabus`
- **Current state:** Nearly identical tools in `courses.ts` (~80% shared logic).
- **Proposed fix:** Make `find_syllabus` call `get_course_syllabus` internally, or merge into one tool with an optional `deep_search` parameter.
- **Impact:** Eliminates ~80 lines of duplication.
- **Effort:** S

### R9: Add Test Coverage for Critical Logic
- **Current state:** 0% test coverage on all tool files, prompts, resources, preferences.
- **Proposed fix (prioritized):**
  1. `grade-analysis.ts` -- algorithmic logic (drop rules, weighted grades, binary search)
  2. `untracked.ts` -- date parsing, classification, deduplication
  3. `services/preferences.ts` -- file I/O, JSON parsing edge cases
  4. Integration test for `daily_briefing` with mocked client
- **Impact:** Safe refactoring, regression prevention.
- **Effort:** L

### R10: Create a Generic Date Sort Utility
- **Current state:** Date sorting pattern repeated ~8 times inline with different field names.
- **Proposed fix:** Add to `utils.ts`:
  ```typescript
  export function sortByDate<T>(items: T[], getDate: (item: T) => string | null, order: 'asc' | 'desc' = 'asc'): T[]
  ```
- **Impact:** Eliminates 8 instances of inline sorting logic.
- **Effort:** S

### R11: Create Active Courses Helper
- **Current state:** `client.listCourses({ enrollment_state: 'active', state: ['available'] })` repeated 7+ times, often followed by course_id mapping.
- **Proposed fix:** Add a convenience method to the client: `async getActiveCourses()` and `async getActiveCourseContextCodes()`.
- **Impact:** Reduces boilerplate in 7+ tool files.
- **Effort:** S

### R12: Fix Dynamic Import in canvas-client.ts
- **Current state:** `await import('./utils.js')` used unnecessarily to avoid a circular dependency that doesn't exist.
- **Proposed fix:** Add static `import { stripHtmlTags } from './utils.js'` at the top of the file.
- **Impact:** Removes unnecessary async overhead, cleaner code.
- **Effort:** S

---

## Appendix A: File Size Distribution

| File | Lines | Category |
|------|-------|----------|
| `canvas-client.ts` | 1,044 | Core - API client |
| `types/canvas.ts` | 780 | Core - Types |
| `grade-analysis.ts` | 617 | Tool - Complex |
| `dashboard.ts` | 563 | Tool - Complex |
| `resources.ts` | 544 | Core - Resources |
| `untracked.ts` | 421 | Tool - Complex |
| `search.ts` | 388 | Tool - Complex |
| `prompts.ts` | 389 | Core - Prompts |
| `files.ts` | 380 | Tool - Medium |
| `utils.ts` | 367 | Core - Utilities |
| `courses.ts` | 326 | Tool - Medium |
| `modules.ts` | 249 | Tool - Medium |
| `grades.ts` | 241 | Tool - Medium |
| `planner.ts` | 225 | Tool - Medium |
| `preferences.ts (tools)` | 207 | Tool - Medium |
| `semester.ts` | 204 | Tool - Medium |
| `submissions.ts` | 195 | Tool - Medium |
| `discussions.ts` | 181 | Tool - Medium |
| `assignments.ts` | 165 | Tool - Medium |
| `index.ts` | 163 | Core - Entry |
| `preferences.ts (service)` | 155 | Service |
| `activity.ts` | 109 | Tool - Small |
| `conversations.ts` | 95 | Tool - Small |
| `folders.ts` | 95 | Tool - Small |
| `pages.ts` | 94 | Tool - Small |
| `calendar.ts` | 91 | Tool - Small |
| `feedback.ts` | 83 | Tool - Small |
| `todos.ts` | 36 | Tool - Tiny |

## Appendix B: Tool Count by File

| File | Tools Registered |
|------|-----------------|
| `courses.ts` | 5 (list_courses, get_course_syllabus, find_syllabus, get_course_tools, get_course) |
| `assignments.ts` | 3 (list_assignments, get_assignment, get_rubric) |
| `modules.ts` | 3 (list_modules, list_announcements, get_module_item_content) |
| `search.ts` | 4 (find_assignments_by_due_date, search_course_content, search_all_courses, get_all_upcoming_work) |
| `grades.ts` | 2 (get_my_grades, get_my_submission_status) |
| `grade-analysis.ts` | 3 (get_grade_breakdown, calculate_what_if_grade, calculate_target_grade) |
| `planner.ts` | 5 (get_planner_items, get_planner_notes, create_planner_note, update_planner_note, mark_planner_item_done, delete_planner_note) |
| `preferences.ts` | 6 (save_preference, list_preferences, delete_preference, save_context_note, list_context_notes, clear_old_context) |
| `files.ts` | 4 (list_course_files, get_file_info, read_file_content, download_file) |
| `discussions.ts` | 2-4 (list_discussions, get_discussion_entries, +2 write tools) |
| `submissions.ts` | 1-3 (get_submission, +2 write tools) |
| `dashboard.ts` | 2 (daily_briefing, get_my_profile) |
| `calendar.ts` | 1 (list_calendar_events) |
| `conversations.ts` | 2 (list_conversations, get_conversation) |
| `folders.ts` | 2 (list_course_folders, browse_folder) |
| `activity.ts` | 2 (get_activity_stream, get_activity_summary) |
| `feedback.ts` | 1 (get_recent_feedback) |
| `untracked.ts` | 1 (scan_untracked_work) |
| `semester.ts` | 1 (setup_semester) |
| `todos.ts` | 1 (get_my_todo_items) |
| `pages.ts` | 2 (list_pages, get_page_content) |

**Total: 51+ tools** (exact count depends on ENABLE_WRITE_TOOLS)

## Appendix C: Caching Status

| Method | Cached? | TTL | Notes |
|--------|---------|-----|-------|
| `listCourses` | Yes | 5 min | Key includes params |
| `getCourseSyllabus` | Yes | 10 min | Caches null results too |
| `listCourseTabs` | Yes | 5 min | Per-course |
| `getUserProfile` | Yes | 5 min | Single user |
| `getUserTimezone` | Yes | Permanent | In-memory field |
| `listAssignments` | **No** | -- | High impact, called by 5+ tools |
| `listModules` | **No** | -- | High impact, called by 6+ tools |
| `listAssignmentGroups` | **No** | -- | High impact, called by 4 tools |
| `listPlannerItems` | **No** | -- | Medium impact |
| `listCalendarEvents` | **No** | -- | Low-medium impact |
| `listAnnouncements` | **No** | -- | Low impact |
| `listConversations` | **No** | -- | Low impact |
| All other methods | **No** | -- | -- |

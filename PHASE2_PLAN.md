# Phase 2 Implementation Plan — Canvas MCP Resilience Upgrade

## Status: READY TO IMPLEMENT (Phase 1 audit complete, codebase explored)

## Context
Phase 1 audit found that UW-Madison professors structure Canvas differently than the MCP assumes. The MCP's `get_course_syllabus`, `list_pages`, `list_course_files`, and `search_course_content` tools break or return empty for most real courses. This phase fixes that.

## Change 1: Smart Syllabus Finder
**File:** `src/tools/courses.ts`
**What:** Add new tool `find_syllabus` that searches multiple locations:
1. Check `syllabus_body` field (current approach — always empty at UW)
2. Scan modules for items with "syllabus" in title (File or Page type)
3. If found as Page → `client.getPage()` and return stripped HTML
4. If found as File → `client.getFile()` + `client.downloadFile()` + `extractTextFromFile()`
5. Also check for "course information", "course overview" page titles

**Also:** Update `get_course_syllabus` to call this new logic as fallback when syllabus_body is null.

## Change 2: Pages Fallback via Modules
**File:** `src/tools/pages.ts`
**What:** In `list_pages`, wrap the `client.listPages()` call in try-catch. On failure (403 or "disabled" error), fall back to:
```
const modules = await client.listModules(course_id, { include: ['items'] });
const pageItems = modules.flatMap(m => m.items?.filter(i => i.type === 'Page') ?? []);
```
Return formatted page-like objects from module items.

## Change 3: Files Fallback via Modules
**File:** `src/tools/files.ts`
**What:** In `list_course_files`, wrap the `client.listCourseFiles()` call in try-catch. On failure (403/unauthorized), fall back to:
```
const modules = await client.listModules(course_id, { include: ['items'] });
const fileItems = modules.flatMap(m => m.items?.filter(i => i.type === 'File') ?? []);
// For each file item with content_id, optionally fetch file metadata
```

## Change 4: External Tool Detection
**File:** `src/canvas-client.ts` — Add new method:
```typescript
async listCourseTabs(courseId: number): Promise<Tab[]> {
  return this.request<Tab[]>(`/courses/${courseId}/tabs`);
}
```
**File:** `src/types/canvas.ts` — Add Tab interface:
```typescript
export interface Tab {
  id: string;
  label: string;
  type: string;
  position: number;
  hidden?: boolean;
  url?: string;
}
```
**File:** `src/tools/courses.ts` — Add new tool `get_course_tools`:
- Calls `listCourseTabs()`, filters for `context_external_tool_*` IDs
- Maps known tools to categories (grading, participation, proctoring, textbook)

## Change 5: Search Resilience
**File:** `src/canvas-client.ts` — In `searchCourseContent()`:
- The `Promise.allSettled` already handles failures, but the pages/files results return empty arrays on error. This is actually already working correctly.
- However, should also search module items by title when pages/files fail — add module item title search as additional results.

## Change 6: New client method for Tabs
**File:** `src/canvas-client.ts`
Add `listCourseTabs` method (see Change 4).

## Verification
After implementing:
1. `npm run build` — must compile cleanly
2. `npm test` — all tests must pass
3. Manual testing: Use Canvas API to verify each tool works with real course data
   - `find_syllabus` for course 486567 (MHR 300 — has syllabus as file in module)
   - `list_pages` for course 486245 (FINANCE 300 — pages disabled, should fallback)
   - `list_course_files` for course 486567 (MHR 300 — files unauthorized, should fallback)
   - `get_course_tools` for course 498423 (GENBUS 307 — has many external tools)

## File Modification Summary
| File | Changes |
|------|---------|
| `src/canvas-client.ts` | Add `listCourseTabs()` method |
| `src/types/canvas.ts` | Add `Tab` interface |
| `src/tools/courses.ts` | Add `find_syllabus` tool, add `get_course_tools` tool, update `get_course_syllabus` fallback |
| `src/tools/pages.ts` | Add module-based fallback to `list_pages` |
| `src/tools/files.ts` | Add module-based fallback to `list_course_files` |
| `src/index.ts` | No changes needed (courses.ts already registered) |

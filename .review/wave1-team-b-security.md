# Wave 1 - Team B: Code Quality & Security Audit

**Project:** Canvas MCP Server v2.4.0
**Audit Date:** 2026-02-10
**Auditor:** Team B - Code Quality & Security
**Scope:** All 28 source files in `src/` and `src/tools/` (~8,400 lines)

---

## Executive Summary

The Canvas MCP codebase demonstrates strong security fundamentals for an MCP server: SSRF protection, token redaction in error messages, proper retry/backoff, pagination guards, and a gated write-tool model. However, the audit identified **3 critical**, **5 high**, **9 medium**, and **8 low** severity findings that should be addressed before any public release.

The most urgent issues are: (1) the `download_file` tool's path traversal vulnerability via unsanitized filenames, (2) the `uploadFileToUrl` method sending requests to arbitrary URLs without origin validation, and (3) the unbounded in-memory cache with no eviction policy that could lead to memory exhaustion.

| Severity | Count |
|----------|-------|
| CRITICAL | 3     |
| HIGH     | 5     |
| MEDIUM   | 9     |
| LOW      | 8     |
| **Total** | **25** |

---

## CRITICAL Findings

### SEC-01: Path Traversal in `download_file` Tool (CRITICAL)

**File:** `/Users/theo/canvas-mcp/src/tools/files.ts`, lines 329-378
**Category:** Security - Path Traversal

The `download_file` tool writes files to disk using the Canvas-provided `file.filename` without any sanitization:

```typescript
const localPath = join(target_path, file.filename);
await writeFile(localPath, buffer);
```

If a Canvas file has a filename containing path traversal sequences (e.g., `../../etc/cron.d/malicious`), the `path.join()` call will resolve the path outside the target directory. While Canvas is unlikely to serve such filenames maliciously, a compromised or misconfigured Canvas instance could exploit this.

**Impact:** An attacker who can control file metadata on Canvas could write arbitrary files to the local filesystem.

**Recommendation:** Sanitize the filename by stripping directory separators and path traversal sequences. Validate that the resolved path starts with the target directory:
```typescript
const safeName = path.basename(file.filename).replace(/[/\\]/g, '_');
const localPath = path.join(target_path, safeName);
const resolvedPath = path.resolve(localPath);
if (!resolvedPath.startsWith(path.resolve(target_path))) {
  throw new Error('Invalid filename: path traversal detected');
}
```

---

### SEC-02: No Origin Validation on File Upload URL (CRITICAL)

**File:** `/Users/theo/canvas-mcp/src/canvas-client.ts`, lines 465-503
**Category:** Security - SSRF

The `uploadFileToUrl` method sends a POST request to `uploadUrl` without any origin validation:

```typescript
async uploadFileToUrl(
  uploadUrl: string,
  uploadParams: Record<string, string>,
  fileContent: Uint8Array | string,
  fileName: string,
  contentType: string
): Promise<{ id: number; url: string }> {
  // ...
  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
  });
```

The `uploadUrl` comes from the Canvas API response in `initiateFileUpload`. If a compromised Canvas server or a man-in-the-middle attack returns a malicious upload URL, the file content (which could include student work) would be sent to an arbitrary server.

Additionally, this method uses raw `fetch` without the `fetchWithRetry` wrapper, so it has **no timeout** protection, meaning it could hang indefinitely.

**Impact:** Student file content could be exfiltrated to an attacker-controlled server. The missing timeout could cause the server to hang.

**Recommendation:** Validate the upload URL against a known list of allowed domains (Canvas and common S3 regions). Add a timeout to the fetch call.

---

### SEC-03: `downloadFile` Skips Origin Validation (CRITICAL)

**File:** `/Users/theo/canvas-mcp/src/canvas-client.ts`, lines 519-533
**Category:** Security - SSRF

The `downloadFile` method explicitly skips origin validation with a comment explaining that S3 URLs have different origins:

```typescript
async downloadFile(downloadUrl: string): Promise<ArrayBuffer> {
  // Canvas file URLs redirect to pre-signed S3 URLs.
  // We must NOT send the Bearer token on the redirect.
  // Note: S3 URLs have a different origin, so we don't validate origin here.
  const response = await fetch(downloadUrl, {
    redirect: 'follow',
    signal: this.createTimeoutSignal(60_000),
  });
```

The `downloadUrl` comes from the `url` field of a Canvas `CanvasFile` object. While the initial file metadata fetch goes through `request()` (which validates origin), the download URL itself could point anywhere if the Canvas API response is tampered with. This creates an SSRF vector where the server follows redirects to arbitrary internal network addresses.

**Impact:** Could be used for SSRF attacks to probe internal network services. The `redirect: 'follow'` means the server will follow redirects without checking intermediate URLs.

**Recommendation:** Validate that the download URL points to an expected domain (Canvas origin or known CDN/S3 domains). Consider using `redirect: 'manual'` and validating each redirect hop.

---

## HIGH Findings

### SEC-04: Unbounded In-Memory Cache Without Eviction (HIGH)

**File:** `/Users/theo/canvas-mcp/src/canvas-client.ts`, lines 56-59
**Category:** Reliability - Memory Exhaustion

The cache uses a plain `Map` with no size limits:

```typescript
private cache = new Map<string, { data: unknown; expiresAt: number }>();
```

Cache entries are only removed on TTL expiry (checked lazily on read) or explicit `clearCache()` calls. If many unique endpoints are queried, the cache grows without bound. For a long-running MCP server session, this could lead to memory exhaustion, especially with large payloads (e.g., full course module trees, assignment lists).

**Impact:** Memory usage grows continuously. In a long session with many tool calls, the server could run out of memory and crash.

**Recommendation:** Add a maximum cache size (e.g., 500 entries) with LRU eviction. Periodically sweep expired entries.

---

### SEC-05: `setup_semester` Creates Directories from Untrusted Input (HIGH)

**File:** `/Users/theo/canvas-mcp/src/tools/semester.ts`, lines 28-35, 105-117
**Category:** Security - Path Traversal

The `setup_semester` tool creates local directories using course codes from Canvas:

```typescript
function safeFolderName(courseCode: string): string {
  return courseCode
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();
}
```

While the `safeFolderName` function sanitizes special characters, the `base_path` parameter from the user is only minimally validated (tilde expansion). Combined with `mkdir({ recursive: true })`, this could create directories in unexpected locations.

Additionally, the `target_path` parameter in `download_file` has no validation at all and is directly passed to `mkdir`:

```typescript
await mkdir(target_path, { recursive: true });
```

**Impact:** An MCP client (Claude) could be tricked into creating directories anywhere on the filesystem, or a prompt injection could craft a malicious `base_path`.

**Recommendation:** Restrict `base_path` and `target_path` to safe locations (e.g., under `$HOME`). Validate resolved paths don't escape intended boundaries.

---

### SEC-06: HTML Content Passed Unsanitized to Write Tools (HIGH)

**File:** `/Users/theo/canvas-mcp/src/tools/discussions.ts`, lines 118-144, 146-178
**Category:** Security - Injection

The `post_discussion_entry` and `reply_to_discussion` tools accept a `message` parameter described as supporting HTML and pass it directly to the Canvas API:

```typescript
message: z.string().min(1).describe('The message to post (supports HTML)'),
```

While Canvas itself has XSS protections, the MCP server acts as an intermediary. If Claude is tricked via prompt injection into posting malicious HTML, the server faithfully relays it. The `submit_assignment` tool has a similar issue with the `body` parameter.

**Impact:** A prompt injection attack could cause Claude to post malicious content (XSS, phishing links) to Canvas discussions visible to the entire class.

**Recommendation:** Either sanitize HTML content before sending to Canvas (strip script tags, event handlers), or change the description to indicate plain text only. Consider adding a confirmation step for write operations.

---

### QUA-07: Race Condition in `runWithConcurrency` (HIGH)

**File:** `/Users/theo/canvas-mcp/src/utils.ts`, lines 345-366
**Category:** Code Quality - Race Condition

The `runWithConcurrency` function has a race condition on the `nextIndex` variable:

```typescript
let nextIndex = 0;
async function worker() {
  while (nextIndex < tasks.length) {
    const index = nextIndex++;
    // ...
  }
}
```

While JavaScript is single-threaded, the `nextIndex++` is not atomic with respect to the `while` condition check when `await` yields control. Two workers could read the same `nextIndex` value between yields, though the post-increment should prevent actual duplication. However, the pattern is fragile and non-obvious.

**Impact:** In theory, the pattern works correctly in single-threaded JavaScript due to the post-increment. But the code is misleadingly written and could break if ported to a multi-threaded context or if the runtime changes.

**Recommendation:** Use a more explicit task queue pattern (e.g., pop from array) that is obviously correct regardless of execution model.

---

### SEC-08: Token Exposed in Process Environment (HIGH)

**File:** `/Users/theo/canvas-mcp/src/index.ts`, line 133
**Category:** Security - Information Disclosure

The server logs the `CANVAS_BASE_URL` to stderr on startup:

```typescript
console.error(`Connected to: ${process.env.CANVAS_BASE_URL}`);
```

While the URL itself is not sensitive, the API token is stored in `process.env.CANVAS_API_TOKEN` and would be visible to any process that can read `/proc/<pid>/environ` on Linux, or any crash dump that includes the environment. The token is also accessible to any child process spawned by the server (e.g., via `pdf-parse` or `officeparser` which may spawn subprocesses).

Additionally, the MEMORY.md file in the Claude project context contains the actual API token in plaintext, which could be committed to version control or exposed to other tools.

**Impact:** The API token could be leaked via process environment inspection, crash dumps, or child process inheritance.

**Recommendation:** Consider reading the token from a file rather than an environment variable. Clear the token from `process.env` after reading it. Ensure child processes don't inherit the environment with the token.

---

## MEDIUM Findings

### QUA-09: `any` Type Casts Bypass Type Safety (MEDIUM)

**Files:**
- `/Users/theo/canvas-mcp/src/tools/planner.ts`, line 148: `params as any`
- `/Users/theo/canvas-mcp/src/tools/feedback.ts`, line 66: `PromiseFulfilledResult<any>`
- `/Users/theo/canvas-mcp/src/canvas-client.ts`, line 899: `as unknown as CanvasFile`

**Category:** Code Quality - Type Safety

Three instances of `any` casts and one double cast (`as unknown as`) weaken TypeScript's type safety:

```typescript
// planner.ts:148 - bypasses type checking entirely
const note = await client.updatePlannerNote(note_id, params as any);

// feedback.ts:66 - loses type information
.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')

// canvas-client.ts:899 - double cast to force incompatible type
} as unknown as CanvasFile);
```

**Impact:** Type errors at runtime instead of compile time. The `as unknown as CanvasFile` in the search fallback creates objects missing most CanvasFile fields, which could cause runtime errors if downstream code accesses those fields.

**Recommendation:** Define proper partial types for the fallback case. Use `Partial<CreatePlannerNoteParams>` instead of `any`. Define an explicit result type for the feedback tool.

---

### QUA-10: `noUnusedLocals` and `noUnusedParameters` Disabled (MEDIUM)

**File:** `/Users/theo/canvas-mcp/tsconfig.json`, lines 16-17
**Category:** Code Quality - Dead Code Detection

```json
"noUnusedLocals": false,
"noUnusedParameters": false,
```

These compiler options are disabled, meaning unused variables and parameters go undetected. This allows dead code to accumulate silently.

**Impact:** Dead code remains in the codebase, increasing cognitive load and maintenance burden. Unused imports may unnecessarily increase bundle size.

**Recommendation:** Enable both options. Add underscore prefixes to intentionally unused parameters (e.g., `_match`).

---

### QUA-11: Inconsistent Zod Schema Validation for IDs (MEDIUM)

**Files:** Multiple tool files
**Category:** Code Quality - Input Validation

Most tools validate IDs with `z.number().int().positive()`, but some use only `z.number()`:

```typescript
// pages.ts - missing .int().positive()
course_id: z.number().describe('The Canvas course ID'),

// folders.ts - missing .int().positive()
folder_id: z.number().describe('The Canvas folder ID'),
course_id: z.number().describe('The Canvas course ID'),
```

This means non-integer or negative IDs would be accepted, leading to invalid API calls.

**Impact:** Malformed inputs pass validation and produce confusing Canvas API errors instead of clear validation errors.

**Recommendation:** Standardize all ID fields to use `z.number().int().positive()` consistently across all tool files.

**Affected files:**
- `/Users/theo/canvas-mcp/src/tools/pages.ts` (both `course_id` fields)
- `/Users/theo/canvas-mcp/src/tools/folders.ts` (`course_id` and `folder_id`)
- `/Users/theo/canvas-mcp/src/tools/files.ts` (`course_id` in `list_course_files`, `file_id` in `get_file_info` and `read_file_content`)
- `/Users/theo/canvas-mcp/src/tools/feedback.ts` (`course_id`)

---

### QUA-12: No Rate Limiting Protection Beyond Retry (MEDIUM)

**File:** `/Users/theo/canvas-mcp/src/canvas-client.ts`
**Category:** Reliability - Rate Limiting

The client handles 429 responses with retry logic (exponential backoff + `Retry-After` header), which is good. However, there is no proactive rate limiting:

1. No request throttle to stay under Canvas API limits (typically 700 requests per 10-minute window).
2. The `daily_briefing` tool makes 2 waves of parallel requests, each wave including concurrent requests across all courses. For 5 courses, this is easily 15-20+ API calls in a single tool invocation.
3. The `search_all_courses` tool fires 5 parallel API calls per course, times 3 concurrent courses = 15 calls rapidly.
4. The `get_my_grades` tool fetches assignment groups with submissions for every course concurrently.

**Impact:** Heavy use of aggregate tools (daily_briefing, search_all_courses, get_my_grades) could trigger Canvas rate limiting, causing cascading 429 retries and slow responses. In extreme cases, the Canvas API could temporarily block the token.

**Recommendation:** Implement a request-level throttle (e.g., token bucket) that proactively limits the request rate. Consider adding `X-Rate-Limit-Remaining` header parsing to preemptively slow down before hitting limits.

---

### QUA-13: Error Messages May Leak Internal Structure (MEDIUM)

**File:** `/Users/theo/canvas-mcp/src/utils.ts`, lines 102-114
**Category:** Security - Information Disclosure

The `formatError` function includes the raw error message:

```typescript
export function formatError(context: string, error: unknown): {
  content: [{ type: 'text'; text: string }];
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Error ${context}: ${message}` }],
    isError: true,
  };
}
```

While the Canvas client's `sanitizeErrorMessage` strips tokens from API errors, errors from other sources (e.g., file system operations, JSON parsing, pdf-parse) could expose internal paths, file names, or system information.

For example, a file download failure might expose: `Error downloading file: ENOENT: no such file or directory, '/Users/theo/Canvas/...'`

**Impact:** Internal filesystem paths, system usernames, and directory structures could be exposed to the LLM (and potentially to the user).

**Recommendation:** Sanitize all error messages to remove absolute file paths and system-specific information before returning them in MCP responses.

---

### SEC-14: `pdf-parse` and `officeparser` Process Untrusted Content (MEDIUM)

**File:** `/Users/theo/canvas-mcp/src/utils.ts`, lines 7-46
**Category:** Security - Untrusted Input Processing

The `parsePdf` and `parseOfficeDocument` functions process potentially untrusted content downloaded from Canvas:

```typescript
export async function parsePdf(buffer: Buffer): Promise<...> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const parsed = await parser.getText();
```

Both `pdf-parse` and `officeparser` are complex parsers that process binary formats. Historically, PDF and Office document parsers have been targets for:
- Denial of service via crafted files (zip bombs, recursive structures)
- Memory exhaustion via large embedded objects
- Potentially arbitrary code execution in underlying native dependencies

The 30-second timeout is a good mitigation, but doesn't prevent memory exhaustion within that window.

**Impact:** A maliciously crafted file uploaded to Canvas could cause the MCP server to crash, consume excessive memory, or potentially execute arbitrary code.

**Recommendation:** Process untrusted files in a sandboxed subprocess with memory limits. Consider using `--max-old-space-size` for child processes. Monitor for known CVEs in `pdf-parse` and `officeparser`.

---

### QUA-15: Duplicate Code Between `dashboard.ts` and `untracked.ts` (MEDIUM)

**Files:**
- `/Users/theo/canvas-mcp/src/tools/dashboard.ts`, lines 6-59
- `/Users/theo/canvas-mcp/src/tools/untracked.ts`, lines 8-157

**Category:** Code Quality - Duplication

Both files implement nearly identical functionality:
- Keyword-based classification of SubHeader items (`classifyUntrackedType` / `classifySubHeader`)
- Date extraction from text (`extractDateFromText` in both)
- Module scanning for untracked work
- Month name parsing

The `dashboard.ts` version is a simplified inline version, while `untracked.ts` has the more complete implementation with confidence tracking. This duplication means bug fixes need to be applied in two places.

**Impact:** Inconsistent behavior between the two implementations. Maintenance burden from keeping two copies in sync.

**Recommendation:** Extract the shared logic into a common module (e.g., `src/services/untracked-scanner.ts`) and have both tools use it.

---

### QUA-16: Duplicate Type Definitions Across Files (MEDIUM)

**Files:**
- `/Users/theo/canvas-mcp/src/types/canvas.ts`, lines 761-779
- `/Users/theo/canvas-mcp/src/services/preferences.ts`, lines 18-24, 88-98

**Category:** Code Quality - Duplication

`UserPreferences`, `ContextNote`, and `ContextData` interfaces are defined in both `types/canvas.ts` and `services/preferences.ts`. The two definitions are identical but independent, meaning changes to one won't be reflected in the other.

**Impact:** Type drift if one definition is updated but not the other. Confusing for developers who might import from either location.

**Recommendation:** Define these types in one canonical location and re-export from the other.

---

### QUA-17: `search_course_content` Client-Side Filtering Has Performance Issues (MEDIUM)

**File:** `/Users/theo/canvas-mcp/src/canvas-client.ts`, lines 825-912
**Category:** Code Quality - Performance

The `searchCourseContent` method fetches ALL modules with items, ALL assignments, and ALL discussion topics for a course, then filters client-side:

```typescript
const [modules, assignments, pages, files, discussions] = await Promise.allSettled([
  this.listModules(courseId, { include: ['items'] }),
  this.listAssignments(courseId, { search_term: searchTerm }),
  this.listPages(courseId, { search_term: searchTerm }),
  this.listCourseFiles(courseId, { search_term: searchTerm }),
  this.listDiscussionTopics(courseId),
]);
```

For modules and discussions, the entire collection is fetched and filtered client-side. This is especially problematic when used in `search_all_courses`, which calls this for every course.

**Impact:** Excessive API calls and memory usage for courses with many modules or discussions. Slow search responses.

**Recommendation:** Add `search_term` to module and discussion API calls where Canvas supports it. Cache module lists with items to avoid re-fetching.

---

## LOW Findings

### QUA-18: `sourceMap: true` in Production Build (LOW)

**File:** `/Users/theo/canvas-mcp/tsconfig.json`, line 12
**Category:** Security - Information Disclosure

```json
"sourceMap": true,
"declarationMap": true,
```

Source maps expose the original TypeScript source code in the `dist/` directory. While this is not a direct vulnerability (the server runs locally), it increases the information available if the dist folder is inadvertently shared.

**Impact:** Minimal for a locally-run MCP server. Could expose source code structure if the built artifacts are distributed.

**Recommendation:** Disable source maps for production builds, or ensure they are stripped before distribution.

---

### QUA-19: Inconsistent Error Handling in Fallback Paths (LOW)

**Files:** Multiple tool files
**Category:** Code Quality - Error Handling

Many tools use a try/catch fallback pattern where the inner catch is silently swallowed:

```typescript
// courses.ts:108
try {
  const page = await client.getPage(course_id, item.page_url);
  // ...
} catch { /* continue searching */ }
```

This appears in: `courses.ts` (lines 97-108, 112-129), `files.ts` (line 92, 164), `pages.ts` (line 36), `resources.ts` (lines 134, 199). While the comment explains the intent, swallowing all errors (including network failures, auth issues) makes debugging difficult.

**Impact:** Legitimate errors (expired token, network issues) are silently swallowed in fallback paths, making it hard to diagnose issues.

**Recommendation:** Log swallowed errors to stderr at debug level, or at minimum distinguish expected errors (403/404) from unexpected ones (network failures).

---

### QUA-20: Missing Validation for Date String Parameters (LOW)

**Files:** Multiple tool files
**Category:** Code Quality - Input Validation

Several tools accept date strings but use different validation approaches:

- `find_assignments_by_due_date` validates dates explicitly with `isNaN(new Date(...).getTime())`
- `list_calendar_events` validates dates
- `get_planner_items`, `get_planner_notes`, `list_announcements` pass dates directly without validation
- `create_planner_note` accepts `todo_date` without format validation

**Impact:** Invalid date strings silently produce unexpected Canvas API behavior (empty results or errors).

**Recommendation:** Add a shared date validation helper and apply it consistently. Consider using a Zod regex pattern for ISO date strings.

---

### QUA-21: Inconsistent Response Formatting (LOW)

**Files:** Multiple tool files
**Category:** Code Quality - Consistency

Most tools return structured data via `formatSuccess()`, but the structure varies:
- Some include a `count` field, others don't
- Some include `course_id` in the response, others don't
- Error objects sometimes include `error` field, sometimes `message`
- The `read_file_content` tool returns an `error` key inside a success response for "file too large"

**Impact:** Inconsistent response shapes make it harder for Claude to reliably parse responses.

**Recommendation:** Define standard response envelopes (success with count, error with code) and apply consistently.

---

### QUA-22: `getPage` Accepts Unsanitized URL Slug (LOW)

**File:** `/Users/theo/canvas-mcp/src/canvas-client.ts`, line 546
**Category:** Security - Input Validation

```typescript
async getPage(courseId: number, pageUrlOrId: string): Promise<Page> {
  return this.request<Page>(`/courses/${courseId}/pages/${pageUrlOrId}`);
}
```

The `pageUrlOrId` is directly interpolated into the URL path. While Canvas API pages are accessed by slug, a malicious slug containing `../` sequences could potentially access unintended API endpoints (though the Canvas API would likely reject such paths).

**Impact:** Low risk since the Canvas API itself validates the path. But defense-in-depth suggests sanitizing.

**Recommendation:** URL-encode the `pageUrlOrId` parameter: `encodeURIComponent(pageUrlOrId)`.

---

### QUA-23: `conversation_id` in `get_conversation` Missing `.int().positive()` (LOW)

**File:** `/Users/theo/canvas-mcp/src/tools/conversations.ts`, line 61
**Category:** Code Quality - Input Validation

```typescript
conversation_id: z.number()
  .describe('The ID of the conversation to retrieve.'),
```

Missing `.int().positive()` allows floating-point and negative values.

**Impact:** Invalid IDs produce Canvas API errors instead of clear validation errors.

**Recommendation:** Add `.int().positive()` for consistency with other ID fields.

---

### QUA-24: `skipLibCheck: true` Disables Type Checking of Dependencies (LOW)

**File:** `/Users/theo/canvas-mcp/tsconfig.json`, line 14
**Category:** Code Quality - Type Safety

```json
"skipLibCheck": true
```

This disables type checking of `.d.ts` files from dependencies, which could hide type incompatibilities between packages.

**Impact:** Type errors in dependency interactions may not be caught at compile time.

**Recommendation:** This is a common and generally acceptable configuration. Consider enabling periodically as a health check.

---

### QUA-25: Cache Keys Use JSON.stringify Without Sorting (LOW)

**File:** `/Users/theo/canvas-mcp/src/canvas-client.ts`, line 314
**Category:** Code Quality - Correctness

```typescript
const cacheKey = `courses:${JSON.stringify(params)}`;
```

`JSON.stringify` does not guarantee property order. The same parameters in a different property order would produce different cache keys, leading to cache misses:

```typescript
// These produce different cache keys but should be equivalent:
{ enrollment_state: 'active', state: ['available'] }
{ state: ['available'], enrollment_state: 'active' }
```

**Impact:** Potential cache misses for semantically identical requests. Minor performance impact.

**Recommendation:** Sort keys before stringifying, or use a deterministic serialization method.

---

## Dependency Analysis

### Package Versions and Known Issues

| Package | Version | Notes |
|---------|---------|-------|
| `@modelcontextprotocol/sdk` | ^1.0.0 | Core MCP SDK. No known issues. |
| `dotenv` | ^16.4.5 | Widely used, no known vulnerabilities. |
| `pdf-parse` | ^2.4.5 | v2 is a rewrite. Historical issues with prototype pollution in v1. The v2 API is used correctly with class-based approach. |
| `officeparser` | ^6.0.4 | Parses Office documents. Ensure it doesn't decompress zip bombs (Office formats are ZIP-based). No size limit before passing to parser. |
| `zod` | ^3.23.8 | Schema validation library. No known vulnerabilities. |

**Recommendation:** Run `npm audit` regularly. Consider adding Snyk or Dependabot for automated vulnerability scanning.

---

## Positive Security Findings

The audit also identified several security-positive patterns that should be maintained:

1. **SSRF Protection (canvas-client.ts:84-89):** The `isAllowedUrl` method validates that URLs match the configured Canvas origin before making requests. Pagination links are also validated.

2. **Token Redaction (canvas-client.ts:102-112):** The `sanitizeErrorMessage` method strips Bearer tokens and access_token parameters from error bodies.

3. **Request Timeouts (canvas-client.ts:95-97):** All requests have a 30-second timeout via `AbortSignal.timeout()`. File downloads get 60 seconds.

4. **Pagination Guards (canvas-client.ts:240-279):** Paginated requests have both a max page limit (100) and max item limit (10,000) to prevent infinite pagination loops.

5. **Write Tool Gating (submissions.ts, discussions.ts):** Destructive tools (submit_assignment, upload_file, post_discussion_entry, reply_to_discussion) are only registered when `ENABLE_WRITE_TOOLS=true`.

6. **Retry with Backoff (canvas-client.ts:141-185):** Transient errors (429, 5xx) are retried with exponential backoff and `Retry-After` header support. Maximum 3 retries.

7. **File Size Limits (utils.ts:336):** A 25 MB limit is enforced before attempting file downloads and text extraction.

8. **Preference File Permissions (services/preferences.ts:12,46,124):** Data directory created with mode 0o700, files with 0o600 (owner read/write only).

9. **Context Note Limits (services/preferences.ts:8,120-123):** Context notes are capped at 200 per category to prevent unbounded growth.

10. **Concurrency Limiting (utils.ts:345-366):** The `runWithConcurrency` utility limits parallel API calls to prevent overwhelming the Canvas server.

11. **PDF/Office Parsing Timeouts (utils.ts:10-21, 36-40):** 30-second timeouts on document parsing prevent hangs on malformed files.

12. **Environment Variable Validation (index.ts:41-58):** Required environment variables are validated at startup with clear error messages.

---

## Summary of Recommendations by Priority

### Immediate (Before Release)
1. Fix path traversal in `download_file` (SEC-01)
2. Add origin validation to `uploadFileToUrl` (SEC-02)
3. Add domain validation to `downloadFile` (SEC-03)

### Short-Term (Next Sprint)
4. Add cache size limits and LRU eviction (SEC-04)
5. Validate `base_path`/`target_path` in file operations (SEC-05)
6. Sanitize HTML in write tools (SEC-06)
7. Address `any` type casts (QUA-09)
8. Add proactive rate limiting (QUA-12)
9. Sanitize error messages for internal paths (QUA-13)

### Medium-Term (Next Release)
10. Standardize ID validation across all tools (QUA-11)
11. Extract shared untracked work scanning logic (QUA-15)
12. Deduplicate type definitions (QUA-16)
13. Improve date validation consistency (QUA-20)
14. Standardize response formats (QUA-21)

### Low Priority (Backlog)
15. Enable `noUnusedLocals`/`noUnusedParameters` (QUA-10)
16. Improve error logging in fallback paths (QUA-19)
17. URL-encode page slugs (QUA-22)
18. Fix cache key determinism (QUA-25)

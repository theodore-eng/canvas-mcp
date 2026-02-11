# Wave 1 Review: Team C -- UX & Output Quality

**Reviewer:** Team C -- UX & Output Quality Reviewer
**Date:** 2026-02-10
**Codebase:** Canvas MCP v2.4.0, 51+ tools, ~8,400 lines
**Files reviewed:** All 21 files in `src/tools/`, plus `src/prompts.ts`, `src/resources.ts`, `src/utils.ts`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Critical Finding: All Output Is Raw JSON](#2-critical-finding-all-output-is-raw-json)
3. [Tool-by-Tool Output Formatting Audit](#3-tool-by-tool-output-formatting-audit)
4. [Tool Naming & Discoverability Analysis](#4-tool-naming--discoverability-analysis)
5. [Student Experience Scenario Walkthroughs](#5-student-experience-scenario-walkthroughs)
6. [Prompts & Resources Review](#6-prompts--resources-review)
7. [Cross-Cutting UX Issues](#7-cross-cutting-ux-issues)
8. [Prioritized Recommendations](#8-prioritized-recommendations)

---

## 1. Executive Summary

The Canvas MCP server has an impressive breadth of functionality -- 51+ tools covering grades, assignments, modules, files, search, calendars, discussions, planner, untracked work, and more. The tool descriptions are generally well-written and student-oriented. The prompt templates are thoughtful and cover real student workflows.

However, **the single biggest UX problem is that every tool returns raw JSON via `formatSuccess(data)`.** This means Claude must interpret a JSON blob and re-format it into a human-readable response. While Claude is generally good at this, the raw JSON approach creates several compounding problems:

1. **Excessive token consumption** -- large JSON payloads eat into context windows
2. **Information overload** -- tools like `daily_briefing` return massive nested JSON with 11 sections
3. **No visual hierarchy** -- no markdown formatting, headers, or visual cues in the raw data
4. **Dates remain as ISO 8601** -- `2026-02-15T23:59:00Z` instead of "Saturday, Feb 15 at 11:59 PM"
5. **Scores lack context** -- `score: 42, points_possible: 50` instead of "42/50 (84%)"

The tool naming is generally strong, with a few notable problems around overlap and discoverability. The prompt templates are well-designed and partially compensate for the raw JSON output by guiding Claude on how to present the data.

### Severity Scale
- **P0 (Critical):** Directly harms the student experience in common workflows
- **P1 (High):** Significant quality-of-life issue affecting many use cases
- **P2 (Medium):** Noticeable issue that affects some workflows
- **P3 (Low):** Minor polish issue

---

## 2. Critical Finding: All Output Is Raw JSON

**Severity: P0**

**Location:** `src/utils.ts`, lines 119-128

```typescript
export function formatSuccess(data: unknown): {
  content: [{ type: 'text'; text: string }];
} {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(data, null, 2),
    }],
  };
}
```

Every single tool in the codebase calls `formatSuccess(someObject)`, which serializes the response as pretty-printed JSON. This is the root cause of most output quality issues.

### Why This Matters

MCP tool responses are text that Claude Desktop renders. The model sees a JSON blob and must decide how to present it. For simple responses, this works fine. But for complex responses like `daily_briefing` (which returns ~11 nested sections) or `get_grade_breakdown` (which returns all assignment groups with individual scores), the JSON becomes:

- **Hundreds of lines long**, burning through context window
- **Structurally flat** -- no visual hierarchy to guide scanning
- **Filled with null values** -- many fields return `null` when not applicable, adding noise
- **Inconsistent in date formatting** -- some dates are ISO 8601, some are YYYY-MM-DD strings

### Recommended Approach

Consider a dual-output strategy:
1. Keep the JSON output for programmatic use
2. Add a `formatMarkdown()` helper for key high-traffic tools that returns pre-formatted markdown

The highest-impact tools to convert to markdown output would be:
- `daily_briefing` -- the most commonly used tool, returns the most data
- `get_my_grades` -- students check grades constantly
- `get_grade_breakdown` -- complex nested data
- `get_all_upcoming_work` -- time-sensitive, scannable data
- `get_my_submission_status` -- urgent information about missing work

Example of what `daily_briefing` could return instead of JSON:

```markdown
# Daily Briefing -- Monday, Feb 10

## Urgency Alerts
- 2 assignments due TODAY
- 1 OVERDUE (MHR 300: Case Study 4 -- 3 days late)

## Exam Warnings
- FINANCE 300 Midterm -- in 5 days (Feb 15, 100 pts)

## Today's Schedule
- 10:00 AM -- GENBUS 307 Lecture (Grainger 1100)
- 2:30 PM -- FINANCE 300 Discussion (Van Vleck B102)

## Upcoming This Week
| Assignment | Course | Due | Points | Status |
|...|...|...|...|...|

## Grades at a Glance
| Course | Score | Grade |
|...|...|...|
```

---

## 3. Tool-by-Tool Output Formatting Audit

### 3.1 Dashboard Tools (`dashboard.ts`)

#### `daily_briefing`
- **Severity:** P0
- **Issue:** Returns a massive JSON object with 11 top-level sections: `urgency`, `exam_alerts`, `todays_events`, `action_items`, `upcoming_assignments`, `untracked_work`, `grades`, `announcements`, `week_ahead_preview`, plus `date` and `warnings`. This is the most data-heavy tool in the entire codebase.
- **Specific problems:**
  - `week_ahead_preview` is an array of 7 objects, each with `date`, `count`, and `items[]` -- very verbose for a simple calendar view
  - `urgency` section uses count fields (`overdue_count`, `due_today_count`, etc.) that could be a single sentence
  - `grades` array includes `adjusted_score` and `grade_alert` as optional fields -- the conditional presence of fields makes the JSON structure inconsistent
  - Announcement `preview` truncated to 200 chars but no indication of truncation
  - `untracked_work` items include `inferred_date: null` for undated items -- null noise
- **Recommendation:** This tool is the "front door" to the MCP. It deserves a markdown-formatted output. Pre-format dates as human-readable. Use tables for grades and upcoming work. Use alert markers (bold, uppercase) for urgency items.

#### `get_my_profile`
- **Severity:** P3
- **Issue:** Returns raw JSON for simple profile data. Minor -- this tool is rarely called.
- **Note:** The output is clean and minimal. No changes needed.

### 3.2 Grade Tools (`grades.ts`)

#### `get_my_grades`
- **Severity:** P1
- **Issues:**
  - Returns `current_score: 87.5` instead of `87.5%` or `87.5% (B+)` -- score and grade are in separate fields
  - `adjusted_score` only appears conditionally, which is good for JSON size but makes it harder for Claude to notice the deflation
  - `deflation_warning` is a long sentence embedded in JSON -- this should be presented prominently
  - `final_score_note` is another embedded sentence -- these text warnings buried in JSON are easy to miss
  - `apply_assignment_group_weights: true/false` is included for every course -- not useful to the student
- **Recommendation:** Pre-compute a percentage string like `"87.5% (B+)"`. Surface deflation warnings as a separate top-level `alerts` array. Remove `apply_assignment_group_weights` from student-facing output (it is an implementation detail).

#### `get_my_submission_status`
- **Severity:** P1
- **Issues:**
  - The `submitted` array for each course lists ALL submitted assignments with their grades. For a course with 40 graded assignments, this is enormous and not what the student asked for (they asked what they HAVEN'T submitted)
  - `days_overdue` is a number but not labeled. `days_overdue: 3` could mean "3 days overdue" or "overdue for 3 days"
  - `total_missing` is at the bottom of the response after all the per-course data. Should be at the top for immediate urgency signaling
- **Recommendation:** Move `total_missing` to the top. Consider omitting or drastically summarizing the `submitted` array (maybe just `submitted_count` per course). Add a `total_points_at_risk` sum across missing assignments.

### 3.3 Grade Analysis Tools (`grade-analysis.ts`)

#### `get_grade_breakdown`
- **Severity:** P1
- **Issues:**
  - This tool returns the entire course syllabus text embedded in the JSON response. For courses with long syllabi, this can be thousands of words of text inside a JSON string field. This is both wasteful (the syllabus may have already been fetched) and structurally awkward
  - The `analysis` section at the bottom includes excellent computed data (`strongest_group`, `weakest_group`, `grade_if_perfect`, `grade_if_80pct`, `grade_if_60pct`) -- but it is buried below potentially hundreds of lines of per-assignment data
  - Individual assignment details include `score_statistics: { mean, min, max }` which is great for context but adds 3 fields per graded assignment
  - `drop_lowest: null` and `drop_highest: null` appear for every group even when there are no drop rules
- **Recommendation:** Move `analysis` to the top of the response (summary-first pattern). Make the syllabus inclusion optional (it is already available via `get_course_syllabus`). Suppress null values for `drop_lowest`/`drop_highest` when they are 0/null.

#### `calculate_what_if_grade`
- **Severity:** P2
- **Issues:**
  - `change` field is a formatted string like `"+2.5"` which is good, but it is the only pre-formatted field in the entire codebase, creating inconsistency
  - `group_impacts` is a nice addition showing per-group effects
  - Response structure is clean and focused
- **Recommendation:** This is one of the better-formatted tools. Consider adding a one-sentence summary like `"If you score 85/100 on Final Exam, your grade would go from 82.3% to 84.8% (+2.5)"`.

#### `calculate_target_grade`
- **Severity:** P2
- **Issues:**
  - Response is well-structured with clear fields: `needed_score`, `needed_percentage`, `achievable`
  - The `note` field for unachievable targets is well-written
  - Missing: no mention of the letter grade threshold that the target maps to (e.g., "90% is an A" based on syllabus)
- **Recommendation:** Consider adding `target_letter_grade` field if the syllabus is available.

### 3.4 Assignment Tools (`assignments.ts`)

#### `list_assignments`
- **Severity:** P2
- **Issues:**
  - Output includes `published: true` for every assignment -- students only see published assignments, so this field is noise
  - `locked_for_user: false` for every unlocked assignment -- negative information that adds no value
  - `submission_types: ["online_upload"]` is an array of technical strings. Students do not think in terms of `online_text_entry` -- they think "type a response" or "upload a file"
  - `has_submitted` is a boolean alongside `submission_status` and `grade` -- redundant
- **Recommendation:** Remove `published` (always true for visible assignments). Remove `locked_for_user` when false. Map `submission_types` to student-friendly labels. Remove `has_submitted` (redundant with `submission_status`).

#### `get_assignment`
- **Severity:** P2
- **Issues:**
  - Good use of `stripHtmlTags` for the description
  - `allowed_attempts: -1` for unlimited attempts is confusing -- should be `"unlimited"` or `null`
  - `lock_explanation` is included even when null
  - Rubric data is deeply nested: `rubric.criteria[].ratings[]` -- good structure but verbose
- **Recommendation:** Map `allowed_attempts: -1` to `"unlimited"`. Suppress null fields.

#### `get_rubric`
- **Severity:** P3
- **Issue:** Essentially duplicates rubric data from `get_assignment` when `include_rubric=true`. This tool could be merged.
- **Recommendation:** See naming/discoverability section below.

### 3.5 Module Tools (`modules.ts`)

#### `list_modules`
- **Severity:** P2
- **Issues:**
  - `require_sequential_progress: false` is noise for most modules
  - `completed_at: null` for every incomplete module
  - Module items include `content_id`, `page_url`, `external_url`, and `completion_requirement` -- these are useful for follow-up tool calls but not for the student's eyes
  - No summary counts (e.g., "22 modules, 156 items total")
- **Recommendation:** Add summary counts. Suppress false/null fields. Consider a "compact" mode that shows just module names and item titles without IDs.

#### `list_announcements`
- **Severity:** P3
- **Issue:** Placed in `modules.ts` which is architecturally confusing (announcements are not modules). The output is clean. `context_code` like `course_486245` is not human-readable -- should use the course name.
- **Recommendation:** Move to its own file or to `activity.ts`. Replace `context_code` with course name (the data is available).

#### `get_module_item_content`
- **Severity:** P2
- **Issues:**
  - This is the KEY content reading tool and it works well for most item types
  - For `ExternalTool` items, the message `"External tool -- open in browser to access"` is correct but could be more helpful (e.g., which tool it is)
  - For `Quiz` items, `"Quiz content must be accessed in Canvas directly"` is a dead end with no link to open it
  - `html_url` is returned for Quiz items but not for other types -- inconsistent
- **Recommendation:** Include `html_url` consistently across all item types. For ExternalTool, try to identify the tool name from the URL or title.

### 3.6 File Tools (`files.ts`)

#### `list_course_files`
- **Severity:** P2
- **Issues:**
  - Good feature: `categorize` mode groups files by type (lecture, reading, exam_prep, etc.)
  - Good feature: `include_hidden` finds files not in the Files API
  - `source` field (`files_api` or `module`) is an implementation detail that leaks to the student
  - `mime_class` is a Canvas-internal classification -- not useful to students
  - `categories_summary` is a nice touch when categorize is enabled
- **Recommendation:** Remove `mime_class`. Rename `source` to something like `access_method` or remove it. Add file extension information for easy identification.

#### `get_file_info`
- **Severity:** P3
- **Issue:** Clean output. `locked_for_user` is useful context. No issues.

#### `read_file_content`
- **Severity:** P2
- **Issues:**
  - Good: includes page count for PDFs, truncation notice, and max_length parameter
  - The error response for "file too large" uses `error: 'File too large'` as a field inside a success response (via `formatSuccess`). This is semantically confusing -- it is a successful tool call that reports an error condition
  - Same issue for "unsupported content type" -- uses `message` field inside success
- **Recommendation:** Use `formatError` for actual error conditions, or at minimum use a consistent `status` field.

#### `download_file`
- **Severity:** P3
- **Issue:** When `target_path` is omitted, the tool returns file metadata with a message asking for `target_path`. This is a reasonable UX flow but could be clearer -- the tool description says "Returns the local file path after download" which implies it always downloads.
- **Recommendation:** Clarify the description: "Download a file from Canvas to a local folder. If target_path is omitted, returns file metadata and download URL instead."

### 3.7 Search Tools (`search.ts`)

#### `find_assignments_by_due_date`
- **Severity:** P2
- **Issues:**
  - The date range examples in parameter descriptions use `2024-01-01` which is in the past -- should use a recent/relative example
  - Good: date validation with helpful error message
  - Results include `has_submitted` boolean -- decent but `submission_status` would be more informative
- **Recommendation:** Update example dates in descriptions. Add `submission_status` field.

#### `search_course_content`
- **Severity:** P1
- **Issues:**
  - Good: supports pagination and content type filtering
  - Results are a flat array of `{type, data}` objects where `data` has different shapes depending on `type`. This is structurally inconsistent -- a module_item has `module_id` and `module_name` while a page has `page_id` and `url`
  - No relevance ranking -- results appear in arbitrary order
  - `module_item` as a type is confusing because the student searched for content, not for "module items"
- **Recommendation:** Normalize result shapes to have consistent fields (`id`, `title`, `url`, `context`). Consider grouping results by type in the output.

#### `search_all_courses`
- **Severity:** P1
- **Issues:**
  - Fires 5 API calls per course, multiplied by number of courses (5 courses = 25 API calls). This is documented in code comments but the student has no visibility into the latency this creates
  - Results include `type: "module_item (File)"` -- mixing type and subtype in a string is awkward for both display and filtering
  - Good: includes `course_name` in each result for cross-course context
- **Recommendation:** Add a `searching_courses` progress indicator or warning about potential latency. Separate `type` and `subtype` fields.

#### `get_all_upcoming_work`
- **Severity:** P2
- **Issues:**
  - Good: `by_course` summary dict at the top
  - Good: `overdue` flag when `include_overdue=true`
  - `looking_ahead_days` in the response echoes back the input parameter -- not useful
  - `submitted: false` and `completed: false` appear for every incomplete item -- negative noise
- **Recommendation:** Remove echo-back fields. Suppress false booleans.

### 3.8 Planner Tools (`planner.ts`)

#### `get_planner_items`
- **Severity:** P2
- **Issues:**
  - Uses `formatPlannerItem` helper which produces consistent output -- good
  - `plannable_type` values like `assignment`, `discussion_topic`, `quiz` are somewhat technical
  - `days_until_due` is a nice computed field
- **Recommendation:** Map `plannable_type` to friendlier names: `discussion_topic` -> `Discussion`, `wiki_page` -> `Page`.

#### `get_planner_notes`, `create_planner_note`, `update_planner_note`, `delete_planner_note`, `mark_planner_item_done`
- **Severity:** P3
- **Issue:** These write tools have clean, minimal outputs with success messages. Well-designed.
- **Note:** The description for `mark_planner_item_done` correctly warns that it "does NOT submit anything" -- good safety communication.

### 3.9 Calendar Tools (`calendar.ts`)

#### `list_calendar_events`
- **Severity:** P2
- **Issues:**
  - `context` field uses `event.context_name ?? event.context_code` -- good fallback
  - `all_day: false` appears for every timed event -- unnecessary
  - `all_day_date: null` appears for every non-all-day event -- null noise
  - No time zone context in the output
- **Recommendation:** Suppress `all_day`/`all_day_date` when not applicable. Add a `time_zone` field from the user profile.

### 3.10 Discussion Tools (`discussions.ts`)

#### `list_discussions`
- **Severity:** P2
- **Issues:**
  - Good: includes `unread_count` and `read_state` for tracking what is new
  - `published: true` and `locked: false` are noise for most discussions
  - `subscribed: true/false` is useful context
  - `assignment_id` is null for non-graded discussions -- null noise
- **Recommendation:** Suppress always-true fields. Only include `assignment_id` when non-null.

#### `get_discussion_entries`
- **Severity:** P2
- **Issues:**
  - Good: pagination support with offset/limit
  - Good: sort_order parameter (asc/desc)
  - `read_state` per entry is useful
  - Nested `replies` array within each entry -- correct structure but can be deeply nested
  - `has_more_replies` flag is helpful
- **Recommendation:** Output is reasonable. Consider adding a total reply count per entry.

### 3.11 Conversation Tools (`conversations.ts`)

#### `list_conversations`, `get_conversation`
- **Severity:** P3
- **Issues:**
  - Clean output structure
  - `workflow_state` values like `read`, `unread`, `archived` are somewhat technical but understandable
  - `context_name: null` for conversations not tied to a course -- could default to "Personal"
  - Message `body` is stripped of HTML -- good
- **Recommendation:** Map null `context_name` to "Personal" or "Direct Message".

### 3.12 Activity Tools (`activity.ts`)

#### `get_activity_stream`
- **Severity:** P2
- **Issues:**
  - `message_preview` truncated to 200 chars -- good
  - `read: true/false` (mapped from `read_state`) is useful
  - `course_id: null` for non-course activity -- inconsistent with other tools that use course name
  - Score/grade only included for Submission type -- correct conditional inclusion
- **Recommendation:** Resolve `course_id` to course name where possible.

#### `get_activity_summary`
- **Severity:** P3
- **Issue:** Very clean output. `total_unread` at the top is useful. Good tool.

### 3.13 Feedback Tools (`feedback.ts`)

#### `get_recent_feedback`
- **Severity:** P2
- **Issues:**
  - Good: computes `percentage` for each graded item
  - Good: includes `late` flag and `points_deducted`
  - When filtering to a specific `course_id`, the response uses `Course ${course_id}` as the course name instead of fetching the actual name. This is a bug.
  - `html_url` for each assignment is useful for follow-up
- **Recommendation:** Fix the course name resolution when `course_id` is provided. Add a `highest_score` and `lowest_score` summary.

### 3.14 Remaining Tools

#### `get_my_todo_items` (`todos.ts`)
- **Severity:** P3
- **Issue:** Clean, minimal output. Uses fallback `'Unknown'` for items without a name -- could be better.

#### `list_course_folders`, `browse_folder` (`folders.ts`)
- **Severity:** P3
- **Issue:** Clean output. `full_name` for folder path is useful. `formatFileSize` used for file sizes -- good.

#### `save_preference`, `list_preferences`, `delete_preference` (`preferences.ts`)
- **Severity:** P3
- **Issue:** Clean output. These are system tools, not student-facing in the same way.

#### `save_context_note`, `list_context_notes`, `clear_old_context` (`preferences.ts`)
- **Severity:** P3
- **Issue:** System tools with appropriate output. `clear_old_context` returns the count of cleared notes -- good.

#### `scan_untracked_work` (`untracked.ts`)
- **Severity:** P2
- **Issues:**
  - Excellent concept -- finding work that is not on the Canvas calendar
  - `confidence` field (high/medium/low) for inferred dates is well-designed
  - The `note` at the bottom explains what these items are -- good UX
  - `source.item_type: 'SubHeader'` leaks Canvas API internals to the student
- **Recommendation:** Remove `source.item_type` or map it to something friendlier. Consider adding a brief instruction like "Check these with your course modules to confirm".

#### `setup_semester` (`semester.ts`)
- **Severity:** P2
- **Issues:**
  - `next_steps` array with actionable suggestions is excellent UX
  - Returns both course summaries AND folder creation results -- good comprehensive view
  - `external_tools_detected` as a top-level summary is useful
  - `folder_errors` only appears when there are errors -- good conditional inclusion
- **Recommendation:** This is one of the better-formatted tools. Consider adding total point values per course.

---

## 4. Tool Naming & Discoverability Analysis

### 4.1 Naming Strengths

The tool naming is generally intuitive and follows consistent patterns:
- `list_*` for listing collections (courses, assignments, modules, etc.)
- `get_*` for fetching specific items or computed data
- `search_*` for search operations
- Action verbs for mutations: `create_planner_note`, `mark_planner_item_done`, `submit_assignment`

The descriptions are well-written and student-oriented. Standouts:
- `daily_briefing`: "Your morning command center" -- evocative and clear
- `get_course_syllabus`: "The syllabus is the source of truth for grading policies..." -- teaches the student when to use it
- `get_module_item_content`: "Read the actual content of a module item" -- the word "actual" clarifies what it does vs. metadata tools
- `mark_planner_item_done`: "Only affects your personal view -- does NOT submit anything" -- critical safety clarification

### 4.2 Naming Problems

#### Problem 1: `get_course_syllabus` vs. `find_syllabus` -- Redundant Tools (P1)

**Files:** `src/tools/courses.ts`, lines 68-142 and 144-220

These two tools do essentially the same thing. Both:
1. Try `client.getCourseSyllabus(course_id)` first
2. Fall back to scanning modules for syllabus-like items
3. Try pages and files in modules

The `find_syllabus` description says "Use this when get_course_syllabus returns empty" but `get_course_syllabus` already implements the same fallback logic. Having both tools:
- Confuses Claude about which to call
- Wastes API calls if Claude tries both sequentially
- Has slightly different keyword lists (find_syllabus adds "course schedule")

**Recommendation:** Merge into a single `get_course_syllabus` that includes all the fallback logic from `find_syllabus`. Delete `find_syllabus`.

#### Problem 2: `get_rubric` is Redundant with `get_assignment` (P2)

**File:** `src/tools/assignments.ts`, lines 126-163

`get_assignment` already includes rubric data when `include_rubric=true` (which is the default). `get_rubric` does exactly the same API call but returns only the rubric. There is no scenario where a student needs the rubric without the assignment context.

**Recommendation:** Remove `get_rubric` as a standalone tool. The rubric data is already available via `get_assignment`. If needed, add a note to `get_assignment`'s description mentioning rubric inclusion.

#### Problem 3: `get_all_upcoming_work` vs. `get_planner_items` -- Overlapping Purposes (P2)

**Files:** `src/tools/search.ts` (lines 311-387) and `src/tools/planner.ts` (lines 11-45)

Both tools answer "what work is coming up?" with slightly different approaches:
- `get_all_upcoming_work` uses the Planner API with `incomplete_items` filter, adds an overdue flag, groups by course
- `get_planner_items` uses the same Planner API with more filter options

A student asking "what's due this week?" could trigger either tool, and Claude may not know which is better.

**Recommendation:** Rename `get_all_upcoming_work` to something more distinctive like `upcoming_deadlines` or `whats_due_soon`. Add a clearer differentiator in the description: "Use this for a quick deadline overview. Use get_planner_items for full planner data with filters."

#### Problem 4: `list_announcements` is in `modules.ts` (P2)

**File:** `src/tools/modules.ts`, lines 68-121

Announcements have nothing to do with modules. This tool is misplaced, making the codebase harder to navigate and potentially confusing for contributors.

**Recommendation:** Move to its own file (`announcements.ts`) or to `activity.ts`.

#### Problem 5: Inconsistent `get_my_*` vs. `get_*` Naming (P3)

Some tools use `get_my_*` (implying "my data"):
- `get_my_grades`
- `get_my_submission_status`
- `get_my_todo_items`
- `get_my_profile`

Others that also return the user's own data use plain `get_*`:
- `get_submission` (returns YOUR submission)
- `get_recent_feedback` (YOUR recent feedback)
- `get_activity_stream` (YOUR activity)
- `get_planner_items` (YOUR planner)

This inconsistency is minor but creates a discoverability issue -- a student looking for "my" data might not find tools without the `my_` prefix.

**Recommendation:** Either consistently use `get_my_*` for all personal data tools, or drop the `my_` prefix entirely (since everything is scoped to the authenticated user anyway). The latter is simpler.

#### Problem 6: `get_course` vs. `get_course_syllabus` vs. `get_course_tools` -- Fragmented Course Info (P3)

**File:** `src/tools/courses.ts`

Three tools all provide different slices of course information:
- `get_course` -- basic course info with optional syllabus
- `get_course_syllabus` -- syllabus with fallback scanning
- `get_course_tools` -- external tool detection

A student asking "tell me about my Finance class" might need all three called. Consider whether `get_course` should be enriched to include tool detection and syllabus summary, reducing the need for three separate calls.

**Recommendation:** Add an `include_tools` parameter to `get_course` that optionally includes external tool info. This keeps the focused tools available but provides a one-stop-shop option.

### 4.3 Description Quality Issues

#### Missing "When to Use" Guidance (P2)

Several tool descriptions explain WHAT the tool does but not WHEN to use it:
- `list_pages`: "List wiki/content pages in a course" -- when would a student want this vs. `list_modules`?
- `list_course_folders`: "List all folders in a course" -- when is this useful vs. `list_course_files`?
- `get_activity_stream`: "Get recent activity across all your courses" -- how does this differ from `daily_briefing`?

**Recommendation:** Add "Use this when..." clauses to descriptions of tools that overlap with others.

#### Technical Jargon in Descriptions (P3)

- `find_assignments_by_due_date`: "ISO 8601 format" -- students may not know this format
- `search_course_content`: "Supports content-type filtering and pagination" -- pagination is an implementation detail
- `get_module_item_content`: "fetches page text, file content (including PDFs), assignment descriptions, or discussion posts" -- correct but dense

**Recommendation:** Use plain language. "Use date format like 2026-02-15" instead of "ISO 8601 format".

---

## 5. Student Experience Scenario Walkthroughs

### Scenario 1: "What's due this week?"

**Expected tools:** `get_all_upcoming_work` or `daily_briefing` or `get_planner_items`
**Problem:** Three tools could answer this question. Claude must choose.

**Flow evaluation:**
1. Claude likely calls `get_all_upcoming_work` with `days_ahead=7`
2. Response is JSON with items sorted by due date -- good
3. `by_course` summary is useful for Claude to organize the response
4. Each item has `days_until_due` -- useful computed field

**Issues:**
- If Claude calls `daily_briefing` instead, the student gets far more data than they asked for
- The response includes `submitted: false`, `completed: false`, `missing: false` for every incomplete item -- 3 fields of "no" per item
- Dates are ISO 8601: `"2026-02-12T23:59:00Z"` instead of "Wednesday at 11:59 PM"
- No differentiation between a 5-point homework and a 100-point exam in the visual hierarchy

**Rating: B-** -- Functional but noisy. The right data is there but buried in JSON verbosity.

### Scenario 2: "How am I doing in Finance?"

**Expected tools:** `get_grade_breakdown` for course 486245
**Problem:** Student says "Finance" -- Claude needs to resolve this to course ID 486245.

**Flow evaluation:**
1. Claude calls `list_courses` to find "FINANCE 300" and get its ID
2. Claude calls `get_grade_breakdown` with `course_id=486245`
3. Response includes assignment groups, individual scores, syllabus, and analysis

**Issues:**
- Two API calls required just to answer a simple question (list courses + grade breakdown)
- The `get_grade_breakdown` response embeds the entire syllabus text, which could be 2000+ words of content irrelevant to the grade question
- The `analysis` section with strongest/weakest groups and grade projections is at the BOTTOM of the response, after potentially hundreds of lines of per-assignment data
- `score_statistics` (mean, min, max) per assignment is great for context but adds 3 fields per assignment

**Rating: B** -- Comprehensive data but poor information hierarchy. The most actionable information (analysis, projections) is buried.

### Scenario 3: "Show me the module content for MHR"

**Expected tools:** `list_modules` for course 486567, then `get_module_item_content` for specific items

**Flow evaluation:**
1. Claude calls `list_courses` to resolve "MHR" to course 486567
2. Claude calls `list_modules` with `course_id=486567`
3. Response includes 20 modules with all their items -- potentially hundreds of items
4. Student picks a module item, Claude calls `get_module_item_content`

**Issues:**
- `list_modules` returns ALL 20 modules with ALL items by default. For MHR 300 with 20 modules, this could be a massive response
- No way to request just module names without items (have to set `include_items=false`, but then you cannot drill in)
- `get_module_item_content` requires three IDs: `course_id`, `module_id`, and `item_id`. Claude must correctly relay all three from the module listing
- For File items, the content extraction is excellent (PDF text, Office docs, etc.)

**Rating: B+** -- Good once you get to the content, but the module listing can be overwhelming.

### Scenario 4: "I need to find a specific file"

**Expected tools:** `search_course_content` or `list_course_files` with `search_term`

**Flow evaluation:**
1. If student specifies a course: `search_course_content` or `list_course_files` with search term
2. If student does not specify a course: `search_all_courses` with search term

**Issues:**
- `search_all_courses` is expensive (5 API calls per course x 5 courses = 25 calls). The student may wait 10+ seconds
- No feedback to the student about search progress
- Search results do not include file content previews -- just names and metadata
- `list_course_files` has `search_term` parameter but only searches file names, not content
- Finding a file and reading its content requires two steps: search -> `read_file_content`

**Rating: B-** -- Functional but slow for cross-course search. Good file reading once found.

### Scenario 5: "Give me my daily briefing"

**Expected tools:** `daily_briefing`

**Flow evaluation:**
1. Claude calls `daily_briefing` with default `days_ahead=7`
2. Tool makes 2 waves of API calls (courses/todos/planner, then events/announcements/modules/assignments)
3. Returns massive JSON with 11 sections

**Issues:**
- This is the most data-heavy tool. The raw JSON response for 5 courses could easily be 500+ lines
- Claude must parse all 11 sections and decide how to present them
- The `urgency` section is good for quick triage but is mixed in with verbose data
- `week_ahead_preview` with 7 days of item lists is useful but verbose
- `untracked_work` is a unique and valuable section but may be confusing if the student does not know what "untracked" means
- The tool makes ~20+ API calls internally, which could take several seconds

**Rating: B** -- Excellent data breadth, but the raw JSON format undermines the "command center" vision. This tool would be dramatically better with markdown formatting.

### Scenario 6: "What assignments am I missing?"

**Expected tools:** `get_my_submission_status` or `scan_untracked_work`

**Flow evaluation:**
1. For Canvas-tracked assignments: `get_my_submission_status`
2. For readings/prep not on Canvas: `scan_untracked_work`

**Issues:**
- `get_my_submission_status` returns ALL submitted assignments alongside missing ones. For 5 courses with 125 total assignments, the submitted list dominates the response
- `scan_untracked_work` is a separate tool with a different purpose, but a student asking "what am I missing?" might mean both tracked and untracked work
- `days_overdue` in `get_my_submission_status` is useful for urgency but there is no aggregate "total points at risk"
- `scan_untracked_work` includes `confidence` levels for inferred dates -- good transparency but may confuse students

**Rating: B-** -- The tools provide the data but require two separate calls and return too much irrelevant data (submitted assignments).

---

## 6. Prompts & Resources Review

### 6.1 Prompt Templates (`prompts.ts`)

**Overall: Well-designed, 10 prompts covering real student workflows.**

Strengths:
- `weekly_review` with focus parameter (deadlines/grades/everything) -- flexible
- `quick_check` -- concise, focused, references user preferences
- `grade_analysis` -- comprehensive instructions for deep grade review
- `catch_up` with configurable days lookback -- practical
- `submission_review` -- unique pre-submission workflow
- All prompts reference specific tool names, guiding Claude on what to call

Issues:
- **P2:** `study_plan` prompt asks for `course_id` as a string parameter, not a number. The tools expect numeric course IDs. If a student enters "FINANCE 300", the tool call will fail.
- **P2:** `assignment_helper` and `submission_review` both ask for `course_id` and `assignment_id` as strings, same issue.
- **P3:** `end_of_semester` prompt instructs Claude to call `get_grade_breakdown` for "each course" -- this could be 5 sequential tool calls, creating significant latency.
- **P3:** `catch_up` calls 7 tools, which is a lot of sequential/parallel API traffic.
- **P3:** Several prompts reference `canvas://user/preferences` but this resource may not be automatically included in the context.

### 6.2 Resources (`resources.ts`)

**Overall: Good selection of 8 resources providing background context.**

Strengths:
- `canvas://grades/summary` -- quick grade reference
- `canvas://deadlines/upcoming` -- rolling 7-day deadline view
- `canvas://user/preferences` -- personalization context
- `canvas://user/context` -- learned patterns
- Dynamic templates for per-course data (syllabus, assignments, modules)
- All resources include `fetched_at` timestamps -- good for cache freshness awareness

Issues:
- **P2:** `canvas://inbox/unread` returns up to 10 messages. If there are more, there is no indication of truncation.
- **P3:** `canvas://courses/active` does not filter by term end date like `list_courses` does. Could show stale courses.
- **P3:** Resource error handling returns error messages as content text rather than using a structured error format.

---

## 7. Cross-Cutting UX Issues

### 7.1 Date Formatting (P1)

Every tool returns dates as raw ISO 8601 strings: `"2026-02-15T23:59:00Z"`. This is technically correct but unfriendly. Students think in terms of:
- "Wednesday at 11:59 PM"
- "Feb 15"
- "in 3 days"
- "tomorrow"

While Claude will reformat these, having pre-formatted dates would:
- Reduce token count (shorter strings)
- Ensure consistent formatting across tools
- Make the raw output readable even without Claude reformatting

**Recommendation:** Add a `formatDate(iso: string)` utility that returns `"Wed, Feb 15 at 11:59 PM"` alongside the ISO string. Or add a `due_date_display` field.

### 7.2 Null Value Proliferation (P2)

Nearly every tool includes fields with `null` values when data is not applicable:
- `lock_explanation: null`
- `all_day_date: null`
- `assignment_id: null`
- `completed_at: null`
- `external_url: null`

These add visual noise to the JSON and consume tokens. While JSON.stringify handles them fine, they make the output harder to scan.

**Recommendation:** Add a `stripNulls()` utility that removes null/undefined/false fields from objects before serialization. Apply it in `formatSuccess`.

### 7.3 Score Presentation (P2)

Scores are consistently presented as separate fields:
```json
"score": 42,
"points_possible": 50
```

Students think: "42 out of 50" or "84%". Having to mentally combine these fields adds cognitive load. Some tools compute `percentage` (like `get_recent_feedback`) but most do not.

**Recommendation:** Add a `score_display: "42/50 (84%)"` computed field wherever scores appear.

### 7.4 Course ID Resolution (P2)

Many tools require `course_id` as a numeric parameter. Students think in terms of "Finance" or "MHR 300", not `486245`. This means nearly every workflow starts with a `list_courses` call just to get the ID.

**Recommendation:** Consider accepting course codes or name fragments in addition to numeric IDs. A fuzzy-match lookup in the tool handler could resolve "finance" to course 486245 automatically.

### 7.5 Missing "What Can I Do Next?" Guidance (P2)

Most tool responses are data-only with no guidance on follow-up actions. The `setup_semester` tool is an exception -- it includes a `next_steps` array. This pattern should be more widely adopted.

For example:
- `list_modules` could suggest: "Use get_module_item_content to read specific items"
- `get_my_grades` could suggest: "Use get_grade_breakdown for a detailed view of any course"
- `search_all_courses` results could include: "Use read_file_content to read file contents"

**Recommendation:** Add `suggested_actions` or `next_steps` arrays to high-traffic tools.

### 7.6 Error Messages are Terse (P3)

`formatError` produces: `"Error listing assignments: <message>"`. This is clear but does not help the student recover. For common errors (unauthorized, rate limited, not found), more specific guidance would help.

**Recommendation:** Map common Canvas API error codes to student-friendly messages:
- 401/403: "You don't have access to this course's files. Try using list_modules to find the content through module items instead."
- 404: "This assignment/module was not found. It may have been deleted or unpublished."
- 429: "Canvas is rate-limiting requests. Please wait a moment and try again."

---

## 8. Prioritized Recommendations

### P0 -- Critical (Biggest impact, do first)

| # | Issue | Location | Recommendation |
|---|-------|----------|----------------|
| 1 | All output is raw JSON | `src/utils.ts` `formatSuccess()` | Add markdown-formatted output for top 5 tools: `daily_briefing`, `get_my_grades`, `get_grade_breakdown`, `get_all_upcoming_work`, `get_my_submission_status` |

### P1 -- High Priority

| # | Issue | Location | Recommendation |
|---|-------|----------|----------------|
| 2 | ISO 8601 dates everywhere | All tools | Add `formatDate()` utility returning human-friendly date strings. Include both raw and display values |
| 3 | `get_course_syllabus` and `find_syllabus` are redundant | `src/tools/courses.ts` | Merge into single tool with all fallback logic |
| 4 | `get_my_submission_status` returns too much data | `src/tools/grades.ts` | Move `total_missing` to top. Omit or summarize the `submitted` array. Add `total_points_at_risk` |
| 5 | `get_grade_breakdown` buries analysis at bottom | `src/tools/grade-analysis.ts` | Move `analysis` to the top of the response. Make syllabus inclusion optional |
| 6 | `search_course_content` result shapes are inconsistent | `src/tools/search.ts` | Normalize result objects to have consistent fields |
| 7 | `get_all_upcoming_work` vs `get_planner_items` overlap | `search.ts` / `planner.ts` | Rename `get_all_upcoming_work` and add "Use this when..." to both descriptions |
| 8 | Prompt parameters are strings but tools expect numbers | `src/prompts.ts` | Change `course_id` and `assignment_id` prompt parameters to accept numbers or add parseInt in the prompt text |

### P2 -- Medium Priority

| # | Issue | Location | Recommendation |
|---|-------|----------|----------------|
| 9 | Null value proliferation in responses | All tools | Add `stripNulls()` utility, apply before serialization |
| 10 | Scores presented as separate fields | All tools with grades | Add `score_display: "42/50 (84%)"` computed field |
| 11 | Course ID required but students think in names | All tools with `course_id` | Consider fuzzy name-to-ID resolution or accept course codes |
| 12 | `list_announcements` is in `modules.ts` | `src/tools/modules.ts` | Move to `announcements.ts` or `activity.ts` |
| 13 | `list_assignments` includes noise fields | `src/tools/assignments.ts` | Remove `published` (always true), `locked_for_user` when false, map `submission_types` to friendly labels |
| 14 | `get_assignment` `allowed_attempts: -1` | `src/tools/assignments.ts` | Map -1 to `"unlimited"` |
| 15 | `get_recent_feedback` wrong course name | `src/tools/feedback.ts` | Fetch actual course name when `course_id` is provided |
| 16 | `scan_untracked_work` leaks API internals | `src/tools/untracked.ts` | Remove `source.item_type: 'SubHeader'` from output |
| 17 | Missing "next steps" guidance in tool output | Most tools | Add `suggested_actions` array to high-traffic tools |
| 18 | `read_file_content` success/error confusion | `src/tools/files.ts` | Use proper error responses for error conditions |
| 19 | `list_modules` returns all items by default | `src/tools/modules.ts` | Add compact mode or module-level summary counts |
| 20 | Technical jargon in parameter descriptions | Various | Replace "ISO 8601" with "YYYY-MM-DD format" and examples |

### P3 -- Low Priority (Polish)

| # | Issue | Location | Recommendation |
|---|-------|----------|----------------|
| 21 | `get_rubric` redundant with `get_assignment` | `src/tools/assignments.ts` | Remove standalone `get_rubric` tool |
| 22 | Inconsistent `get_my_*` naming prefix | Various | Standardize to either always or never use `my_` prefix |
| 23 | `list_conversations` null `context_name` | `src/tools/conversations.ts` | Default to "Personal" or "Direct Message" |
| 24 | `list_calendar_events` null noise | `src/tools/calendar.ts` | Suppress `all_day`/`all_day_date` when not applicable |
| 25 | Error messages lack recovery guidance | `src/utils.ts` `formatError()` | Map common API error codes to helpful messages |
| 26 | `canvas://courses/active` resource does not filter past courses | `src/resources.ts` | Apply same term-end filtering as `list_courses` |
| 27 | `get_course` fragmented from `get_course_tools` | `src/tools/courses.ts` | Add `include_tools` parameter to `get_course` |
| 28 | Activity stream uses `course_id` instead of name | `src/tools/activity.ts` | Resolve course_id to name in output |

---

## Summary Statistics

- **Total tools reviewed:** 51 (21 read-only, 7 write, 7 preference/context, 16 other)
- **Total issues found:** 28
- **P0 (Critical):** 1 (raw JSON output)
- **P1 (High):** 7
- **P2 (Medium):** 12
- **P3 (Low):** 8
- **Prompts reviewed:** 10 (all well-designed, 2 have parameter type issues)
- **Resources reviewed:** 8 (all functional, minor issues)

The codebase demonstrates strong engineering with thoughtful tool design, comprehensive fallback patterns, and good safety controls on write operations. The primary UX bottleneck is the output formatting layer -- addressing the raw JSON issue and date formatting would dramatically improve the student experience across all 51+ tools.

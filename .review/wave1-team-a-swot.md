# Wave 1 -- Team A: Feature & Coverage SWOT Analysis

**Project:** Canvas MCP Server v2.4.0
**Scope:** 51+ tools across 21 tool files, ~8,400 lines of TypeScript
**Target:** UW-Madison students via `canvas.wisc.edu`
**Analysis Date:** 2026-02-10

---

## Table of Contents

1. [Tool Inventory](#1-tool-inventory)
2. [Canvas API Coverage Audit](#2-canvas-api-coverage-audit)
3. [SWOT Analysis](#3-swot-analysis)
4. [Feature Gap List](#4-feature-gap-list)
5. [Cross-MCP Integration Vision](#5-cross-mcp-integration-vision)

---

## 1. Tool Inventory

### Complete Tool List (51+ tools across 21 files)

| # | File | Tool Name | Category | Read/Write |
|---|------|-----------|----------|------------|
| 1 | `courses.ts` | `list_courses` | Courses | Read |
| 2 | `courses.ts` | `get_course` | Courses | Read |
| 3 | `courses.ts` | `get_course_syllabus` | Courses | Read |
| 4 | `courses.ts` | `find_syllabus` | Courses | Read |
| 5 | `courses.ts` | `get_course_tools` | Courses | Read |
| 6 | `assignments.ts` | `list_assignments` | Assignments | Read |
| 7 | `assignments.ts` | `get_assignment` | Assignments | Read |
| 8 | `assignments.ts` | `get_rubric` | Assignments | Read |
| 9 | `submissions.ts` | `get_submission` | Submissions | Read |
| 10 | `submissions.ts` | `submit_assignment` | Submissions | Write (gated) |
| 11 | `submissions.ts` | `upload_file` | Submissions | Write (gated) |
| 12 | `modules.ts` | `list_modules` | Modules | Read |
| 13 | `modules.ts` | `list_announcements` | Announcements | Read |
| 14 | `modules.ts` | `get_module_item_content` | Modules | Read |
| 15 | `grades.ts` | `get_my_grades` | Grades | Read |
| 16 | `grades.ts` | `get_my_submission_status` | Grades | Read |
| 17 | `grade-analysis.ts` | `get_grade_breakdown` | Grade Analysis | Read |
| 18 | `grade-analysis.ts` | `calculate_what_if_grade` | Grade Analysis | Read |
| 19 | `grade-analysis.ts` | `calculate_target_grade` | Grade Analysis | Read |
| 20 | `discussions.ts` | `list_discussions` | Discussions | Read |
| 21 | `discussions.ts` | `get_discussion_entries` | Discussions | Read |
| 22 | `discussions.ts` | `post_discussion_entry` | Discussions | Write (gated) |
| 23 | `discussions.ts` | `reply_to_discussion` | Discussions | Write (gated) |
| 24 | `calendar.ts` | `list_calendar_events` | Calendar | Read |
| 25 | `planner.ts` | `get_planner_items` | Planner | Read |
| 26 | `planner.ts` | `get_planner_notes` | Planner | Read |
| 27 | `planner.ts` | `create_planner_note` | Planner | Write (safe) |
| 28 | `planner.ts` | `update_planner_note` | Planner | Write (safe) |
| 29 | `planner.ts` | `delete_planner_note` | Planner | Write (safe) |
| 30 | `planner.ts` | `mark_planner_item_done` | Planner | Write (safe) |
| 31 | `todos.ts` | `get_my_todo_items` | Todos | Read |
| 32 | `conversations.ts` | `list_conversations` | Conversations | Read |
| 33 | `conversations.ts` | `get_conversation` | Conversations | Read |
| 34 | `files.ts` | `list_course_files` | Files | Read |
| 35 | `files.ts` | `get_file_info` | Files | Read |
| 36 | `files.ts` | `read_file_content` | Files | Read |
| 37 | `files.ts` | `download_file` | Files | Read (disk write) |
| 38 | `folders.ts` | `list_course_folders` | Folders | Read |
| 39 | `folders.ts` | `browse_folder` | Folders | Read |
| 40 | `pages.ts` | `list_pages` | Pages | Read |
| 41 | `pages.ts` | `get_page_content` | Pages | Read |
| 42 | `search.ts` | `find_assignments_by_due_date` | Search | Read |
| 43 | `search.ts` | `search_course_content` | Search | Read |
| 44 | `search.ts` | `search_all_courses` | Search | Read |
| 45 | `search.ts` | `get_all_upcoming_work` | Search | Read |
| 46 | `activity.ts` | `get_activity_stream` | Activity | Read |
| 47 | `activity.ts` | `get_activity_summary` | Activity | Read |
| 48 | `feedback.ts` | `get_recent_feedback` | Feedback | Read |
| 49 | `preferences.ts` | `save_preference` | Preferences | Write (local) |
| 50 | `preferences.ts` | `list_preferences` | Preferences | Read (local) |
| 51 | `preferences.ts` | `delete_preference` | Preferences | Write (local) |
| 52 | `preferences.ts` | `save_context_note` | Preferences | Write (local) |
| 53 | `preferences.ts` | `list_context_notes` | Preferences | Read (local) |
| 54 | `preferences.ts` | `clear_old_context` | Preferences | Write (local) |
| 55 | `dashboard.ts` | `daily_briefing` | Dashboard | Read |
| 56 | `dashboard.ts` | `get_my_profile` | Dashboard | Read |
| 57 | `untracked.ts` | `scan_untracked_work` | Untracked | Read |
| 58 | `semester.ts` | `setup_semester` | Semester | Write (local + prefs) |

**Total: 58 registered tools** (some conditional on `ENABLE_WRITE_TOOLS`).

### Tool Categories by Purpose

- **Core Data Access (22 tools):** Courses, assignments, modules, submissions, files, pages, folders, discussions, conversations
- **Grade Intelligence (5 tools):** Grades overview, grade breakdown, what-if calculations, target grade, submission status
- **Planning & Organization (8 tools):** Planner items/notes, todo items, calendar events, upcoming work
- **Search & Discovery (4 tools):** Course content search, cross-course search, date-range assignment finder
- **Monitoring & Awareness (4 tools):** Activity stream, activity summary, recent feedback, announcements
- **Productivity & Meta (9 tools):** Daily briefing, profile, untracked work scanner, semester setup, preferences, context notes
- **Write Operations (6 tools, gated):** Submit assignment, upload file, post/reply discussion, planner notes CRUD

---

## 2. Canvas API Coverage Audit

### Covered Canvas API Areas

| Canvas API Area | Coverage Level | Tools Using It | Notes |
|-----------------|---------------|----------------|-------|
| **Courses** | Excellent | 5 tools | List, get, syllabus, tabs detection |
| **Assignments** | Excellent | 6 tools | Full CRUD, rubrics, date filtering, buckets |
| **Assignment Groups** | Excellent | 3 tools | Weights, drop rules, grade calculations |
| **Submissions** | Very Good | 5 tools | Get, submit text/url/file, feedback |
| **Modules** | Excellent | 3+ tools | THE primary navigation, content extraction |
| **Module Items** | Excellent | `get_module_item_content` | Handles all 8 item types with fallbacks |
| **Pages** | Good | 2 tools | List + content, with module fallback |
| **Files** | Excellent | 4 tools | List, info, read content, download to disk, categorize, hidden file detection |
| **Folders** | Good | 2 tools | List tree, browse contents |
| **Discussions** | Excellent | 4 tools | List, read entries with pagination, post, reply |
| **Announcements** | Very Good | 1 tool + briefing | Multi-course, date filtering |
| **Calendar Events** | Good | 1 tool + briefing | Event listing, date ranges |
| **Planner** | Excellent | 6 tools | Items, notes CRUD, overrides, completions |
| **Todo Items** | Good | 1 tool + briefing | Basic listing |
| **Conversations (Inbox)** | Partial | 2 tools | Read-only: list and read threads |
| **User Profile** | Good | 1 tool | Name, email, timezone, avatar |
| **Activity Stream** | Good | 2 tools | Stream items + summary counts |
| **Rubrics** | Good | 2 tools | Via assignment rubric + standalone get |
| **Score Statistics** | Partial | In grade-analysis | Mean/min/max from assignment groups |

### Missing/Uncovered Canvas API Areas

| Canvas API Area | Coverage | Priority | Notes |
|-----------------|----------|----------|-------|
| **Quizzes (Classic)** | None | Medium | Read quiz details, questions, submissions; mostly moved to New Quizzes |
| **New Quizzes** | None | Medium | Separate API (`/api/quiz/v1/`); different auth model |
| **Enrollments** | None (direct) | Low | Indirectly accessed via course enrollments include |
| **Groups** | None | Medium | Student groups for projects, group assignments |
| **Outcomes** | None | Low | Learning outcomes mastery tracking |
| **Conferences** | None | Low | BigBlueButton/Zoom integration info |
| **Collaborations** | None | Low | Google Docs/O365 collaborations |
| **Communication Channels** | None | Low | Notification preferences |
| **Notifications** | None | Low | Push/email notification settings |
| **Course Analytics** | None | Medium | Student participation, page views, assignment stats |
| **User Analytics** | None | Medium | Per-course activity data |
| **Peer Reviews** | None | Medium | Assessment requests, peer review assignments |
| **Grading Periods** | Partial | Low | Accessible via include but no dedicated tool |
| **Course Pace Plans** | None | Low | Self-paced course progress |
| **Blueprint Courses** | None | N/A | Instructor feature, not student-facing |
| **Custom Data** | None | Low | User custom data storage |
| **User Favorites** | None | Low | Favorite courses, groups |
| **Bookmarks** | None | Low | User bookmarks |
| **Content Exports** | None | Low | Export course content |
| **Calendar Event Creation** | None | Medium | Creating personal calendar events |
| **Conversation Creation** | None | High | Sending messages to instructors/TAs |
| **Grades History** | None | Medium | Historical grade changes |

---

## 3. SWOT Analysis

### Strengths

**S1. Module-First Architecture**
The single most important design decision. Canvas at UW-Madison relies heavily on modules as the primary navigation structure. The MCP correctly treats modules as the backbone, with `get_module_item_content` handling all 8 item types (Page, File, Assignment, Discussion, Quiz, ExternalUrl, ExternalTool, SubHeader). When direct APIs fail (Pages disabled in 4/5 courses, Files unauthorized in 3/5), the system falls back to module scanning. This is not a workaround -- it is the correct architecture for this institution.

**S2. Grade Intelligence Suite**
The grade analysis system is the most sophisticated feature:
- `get_grade_breakdown` cross-references Canvas data with the syllabus text
- `calculate_what_if_grade` supports hypothetical scenario planning
- `calculate_target_grade` uses binary search to find needed scores
- Drop rule application (`applyDropRules`) correctly handles Canvas's lowest/highest drop logic
- Future-zero deflation detection identifies and warns about scores artificially lowered by ungraded future assignments
- Weighted vs. unweighted grade calculation with proper normalization

This goes far beyond what Canvas's own gradebook shows students.

**S3. Daily Briefing as a Single Entry Point**
The 11-section `daily_briefing` tool is a thoughtful orchestration layer that:
- Runs parallel API waves (courses/todos/planner, then events/announcements/modules/assignments)
- Computes urgency alerts (critical/warning/normal)
- Detects upcoming exams within a 14-day window
- Scans for untracked work (readings, prep) hidden in module SubHeaders
- Shows grade status with deflation warnings
- Provides a 7-day week-ahead preview

This eliminates the "open 5 tabs to understand what's due" problem.

**S4. Robust Error Handling and API Resilience**
- SSRF protection via origin validation on all URLs
- Retry with exponential backoff (honors `Retry-After` header)
- Request timeout (30s default, 60s for file downloads)
- Pagination safety guards (max 100 pages, max 10,000 items)
- Token sanitization in error messages
- `Promise.allSettled` used throughout for graceful degradation
- Concurrency limiting via `runWithConcurrency` (typically 3 parallel)

**S5. Intelligent Fallback Chains**
Every tool that accesses Pages, Files, or syllabus content has a multi-level fallback:
1. Try direct API endpoint
2. Catch failure, scan modules for matching items
3. For syllabi: check `syllabus_body`, then module pages with keyword matching, then module files with text extraction

**S6. File Content Intelligence**
Text extraction from PDFs (via `pdf-parse`), Office documents (DOCX/PPTX/XLSX via `officeparser`), HTML, CSV, Markdown, and plain text. Files over 50MB are rejected gracefully. This means students can read lecture slides and readings directly in Claude.

**S7. Write Safety Architecture**
Clean separation between safe writes (planner notes, overrides -- personal only), gated writes (`ENABLE_WRITE_TOOLS` env var for submissions and discussion posts), and local-only writes (preferences, context notes). This prevents accidental submission while allowing useful personal organization.

**S8. Untracked Work Detection**
A genuinely novel feature. `scan_untracked_work` and the briefing's untracked section parse module SubHeaders for readings and prep tasks that Canvas does not surface in calendars or planners. Uses date extraction (month-day patterns, MM/DD, "Week N" heuristics) and confidence scoring (high/medium/low).

**S9. Caching and Performance**
In-memory cache with 5-minute default TTL (10 minutes for syllabi). Course lists, tabs, and user profiles are cached. Pagination uses `per_page=100` for efficiency.

**S10. Learning and Personalization System**
The preferences and context notes system (`preferences.ts`, `services/preferences.js`) allows Claude to remember user patterns across sessions -- display preferences, course-specific notes, workflow patterns. This is unusual for an MCP server and adds real value.

---

### Weaknesses

**W1. No Message Sending Capability**
Students can read conversations but cannot send messages, reply, or forward. This is arguably the most impactful missing write operation. A student asking "email my professor about the extension" gets stuck.

**W2. No Quiz Support**
Neither Classic Quizzes nor New Quizzes have dedicated tools. While quiz assignments appear in assignment listings and `get_module_item_content` returns "Quiz content must be accessed in Canvas directly," there is no way to view quiz details, available attempts, time limits, or past quiz submissions. Given that quizzes are a major assessment type, this is a meaningful gap.

**W3. No Calendar Event Creation**
Students can read calendar events but cannot create personal events (study sessions, office hours blocks, review sessions). The planner note system partially compensates, but planner notes do not appear on the Canvas calendar or have start/end times.

**W4. Read-Only Conversations**
`list_conversations` and `get_conversation` are read-only. Cannot compose, reply, archive, star, or manage conversations. This is the inbox equivalent of having email where you can only read.

**W5. No Group Awareness**
Canvas groups (project teams, lab sections, study groups) are completely invisible. Group assignments, group discussions, and group files cannot be accessed. For collaborative coursework, this is a blind spot.

**W6. No Course Analytics**
Canvas provides student analytics (assignment submission history, page view counts, participation metrics) and course-level analytics. None of this is surfaced. A student asking "am I falling behind compared to the class?" has no data.

**W7. Duplicate/Overlapping Tools**
Some tools have significant functional overlap:
- `get_course_syllabus` and `find_syllabus` do nearly identical things
- `get_my_todo_items` partially duplicates `get_planner_items`
- `get_all_upcoming_work` partially duplicates `daily_briefing`'s upcoming section
- `list_announcements` is in `modules.ts` rather than its own file

This creates tool selection ambiguity for the LLM.

**W8. No Enrollment Details**
Cannot list classmates, instructors, or TAs for a course. Cannot check enrollment dates or section information. This makes "who is my TA?" or "what section am I in?" unanswerable.

**W9. Incomplete Score Statistics**
Score statistics (class mean, min, max) are fetched via assignment groups but not consistently surfaced. No way to ask "how did the class do on the midterm?" without using `get_grade_breakdown` and manually finding the right assignment.

**W10. External Tool Opacity**
While `get_course_tools` detects external tools (Gradescope, McGraw-Hill, etc.), the MCP cannot interact with them. LTI tool URLs are identified but content behind them is inaccessible. This is a fundamental limitation of the Canvas API, but for courses heavily reliant on external tools (4/5 courses use them), much of the course workflow is invisible.

---

### Opportunities

**O1. Conversation Composition (High Impact)**
Adding `send_conversation`, `reply_to_conversation`, and `archive_conversation` tools would complete the messaging loop. The Canvas Conversations API supports all of these. A student could dictate "draft a message to Professor Smith about extending the homework deadline" and have Claude compose and send it.

**O2. Calendar Event Creation**
The Canvas Calendar Events API supports `POST /calendar_events` for personal events. Adding `create_calendar_event` and `update_calendar_event` would enable study scheduling directly in Canvas. Combined with the briefing data, Claude could suggest and create study blocks.

**O3. Quiz Details Tool**
A `get_quiz_details` tool using `/courses/:id/quizzes/:id` could show:
- Time limit, allowed attempts, quiz type
- Available/due/lock dates
- Past quiz submissions and scores
- Question count (not questions themselves, for academic integrity)

**O4. Group Support**
`/courses/:id/groups` and `/groups/:id` APIs could power:
- `list_my_groups` -- see project teams and study groups
- `get_group_members` -- know who is in your group
- Group file and discussion access

**O5. Student Analytics**
`/courses/:id/analytics/student_summaries` and `/courses/:id/analytics/users/:id/activity` could power a `get_my_analytics` tool showing participation metrics, page views, and submission patterns. This enables self-awareness prompts.

**O6. Peer Review Management**
Canvas's Assessment Requests API could power a tool to list pending peer reviews, view peer submissions, and submit reviews. Many UW-Madison courses use peer review.

**O7. Grade Trend Tracking**
By periodically capturing grade snapshots and storing them locally (similar to the preferences system), the MCP could show grade trajectory over time. "Am I trending up or down in Finance 300?" becomes answerable.

**O8. Smart Content Summarization Pipelines**
The file reading infrastructure is already excellent. Adding a `summarize_module` tool that reads all items in a module and produces a consolidated summary would be powerful for exam review.

**O9. ICS Calendar Feed Integration**
Canvas provides ICS URLs per course (`course.calendar.ics`). Parsing these would give a second source of truth for deadlines independent of the API, and could be used for cross-referencing.

**O10. Office Hours Discovery**
By combining `get_course_tools` (Zoom detection), `list_calendar_events` (recurring events), and syllabus parsing, a dedicated `find_office_hours` tool could aggregate office hours across all courses into one view.

---

### Threats

**T1. Canvas API Deprecation/Changes**
Canvas regularly deprecates API endpoints. The Classic Quizzes API is being phased out in favor of New Quizzes (different API entirely). The MCP must track Canvas's API changelog.

**T2. Institutional API Restrictions**
UW-Madison already restricts Pages API (4/5 courses), Files API (3/5 courses), and has null syllabus_body everywhere. Further institutional lockdown could render more tools non-functional. The fallback architecture mitigates this, but there is a floor below which module scanning cannot help.

**T3. Rate Limiting at Scale**
The `daily_briefing` makes ~20+ API calls per invocation (courses, todos, planner, events, announcements, modules for each course, assignments for each course). With 5 courses, that is ~15 parallel requests. Canvas rate limits at 700 requests per 10 minutes per user. Heavy usage patterns (running briefing repeatedly, searching across courses) could hit limits. The retry/backoff logic handles 429s, but degraded performance is possible.

**T4. External Tool Lock-In**
4 of 5 courses use external tools (McGraw-Hill, Top Hat, MindTap, Gradescope) for significant coursework. Work done in these platforms is invisible to the MCP. As instructors move more content behind LTI tools, the MCP's visibility shrinks.

**T5. Token Exposure Risk**
The API token is stored in `claude_desktop_config.json` and passed as an environment variable. While error messages sanitize the token, a misconfigured system or leaked config file would expose full API access to the student's Canvas account. There is no token rotation or scoping mechanism.

**T6. New Quizzes Migration**
Canvas is migrating from Classic Quizzes to New Quizzes, which uses a completely separate API (`/api/quiz/v1/`). When UW-Madison completes this migration, any future quiz tools built on the classic API will break.

**T7. Cache Staleness**
The 5-minute default cache TTL means that after a grade is posted, a student might see stale data for up to 5 minutes. For the `daily_briefing` which is likely run once per day this is fine, but for rapid-fire grade checking it could cause confusion. There is `clearCache()` but no tool exposes it.

**T8. Semester Transition Fragility**
The `setup_semester` tool and course filtering by term end date assume a standard semester structure. Non-standard terms (summer sessions, J-term, modular courses) may behave unexpectedly. The semester start date heuristic in `weekNumberToDate()` is hardcoded (Jan 20 for spring, Aug 28 for fall).

**T9. Scaling Beyond One Student**
The MCP is architected as a single-user tool (singleton client, `users/self` everywhere). While appropriate for the current use case, this makes it unsuitable for instructor use, TA use, or any multi-user scenario without significant refactoring.

**T10. LLM Tool Selection Overload**
With 58 tools, the LLM must choose correctly among overlapping options. Tool descriptions are generally excellent, but the overlap between `get_course_syllabus`/`find_syllabus`, `get_my_todo_items`/`get_planner_items`/`get_all_upcoming_work`/`daily_briefing` creates ambiguity. Poor tool selection degrades user experience without any code bugs.

---

## 4. Feature Gap List

### Priority 1 -- High Value, Achievable

| # | Feature | Canvas API Endpoints | Student Value (1-5) | Effort |
|---|---------|---------------------|---------------------|--------|
| G1 | **Send Conversation** | `POST /conversations` | 5 | S |
| G2 | **Reply to Conversation** | `POST /conversations/:id/add_message` | 5 | S |
| G3 | **Create Calendar Event** | `POST /calendar_events` | 4 | S |
| G4 | **Update/Delete Calendar Event** | `PUT/DELETE /calendar_events/:id` | 3 | S |
| G5 | **Get Quiz Details** | `GET /courses/:id/quizzes/:id` | 4 | S |
| G6 | **List Quiz Submissions** | `GET /courses/:id/quizzes/:id/submissions` | 4 | M |

**G1 -- Send Conversation**
- Compose and send a Canvas inbox message to instructors, TAs, or classmates
- `POST /conversations` with recipients[], subject, body, context_code
- Critical for the "ask my professor" use case
- Must be gated behind `ENABLE_WRITE_TOOLS` with confirmation prompts

**G2 -- Reply to Conversation**
- Add a message to an existing conversation thread
- `POST /conversations/:id/add_message` with body, included_messages[]
- Completes the conversation read/write loop
- Gated behind `ENABLE_WRITE_TOOLS`

**G3 -- Create Calendar Event**
- Create personal calendar events (study sessions, office hours, review blocks)
- `POST /calendar_events` with calendar_event[context_code, title, start_at, end_at, description]
- Enables "block out 2 hours to study for the midterm on Thursday"
- Safe personal write (personal calendar namespace only)

**G5 -- Get Quiz Details**
- View quiz metadata: time limit, allowed attempts, question count, quiz type, IP filter, access code requirement
- `GET /courses/:id/quizzes/:id` with detailed include
- Answers "how long is the quiz?" and "how many attempts do I get?"
- Read-only, no academic integrity concerns

### Priority 2 -- Medium Value

| # | Feature | Canvas API Endpoints | Student Value (1-5) | Effort |
|---|---------|---------------------|---------------------|--------|
| G7 | **List Groups** | `GET /users/self/groups`, `GET /groups/:id/users` | 3 | S |
| G8 | **Student Analytics** | `GET /courses/:id/analytics/users/:id/activity` | 3 | M |
| G9 | **Peer Review List** | `GET /courses/:id/assignments/:id/peer_reviews` | 3 | S |
| G10 | **Enrollment/Classmate Info** | `GET /courses/:id/enrollments` | 3 | S |
| G11 | **Grade History** | `GET /courses/:id/gradebook_history/feed` | 3 | M |
| G12 | **Archive/Star Conversation** | `PUT /conversations/:id` | 2 | S |
| G13 | **User Favorites** | `GET /users/self/favorites/courses` | 2 | S |
| G14 | **Course Notifications** | `GET /users/self/communication_channels` | 2 | M |

**G7 -- List Groups**
- See project teams, lab sections, and study groups
- `GET /users/self/groups` for group list, `GET /groups/:id/users` for members
- Enables "who is in my project group for GENBUS 307?"

**G8 -- Student Analytics**
- View personal participation metrics: page views, participation score, on-time submission rate
- `GET /courses/:id/analytics/users/self/activity` and `../assignments`
- Enables self-reflection: "am I participating enough?"

**G10 -- Enrollment/Classmate Info**
- List instructors, TAs, and section-mates for a course
- `GET /courses/:id/enrollments` filtered by type
- Answers "who is my TA?" and "who teaches this section?"
- Should filter to only show instructors/TAs by default (privacy)

### Priority 3 -- Nice to Have

| # | Feature | Canvas API Endpoints | Student Value (1-5) | Effort |
|---|---------|---------------------|---------------------|--------|
| G15 | **Outcome Mastery** | `GET /courses/:id/outcome_results` | 2 | M |
| G16 | **Content Exports** | `POST /courses/:id/content_exports` | 1 | L |
| G17 | **Bookmarks** | `GET/POST /users/self/bookmarks` | 1 | S |
| G18 | **Conference Info** | `GET /courses/:id/conferences` | 1 | S |
| G19 | **Grading Periods** | `GET /courses/:id/grading_periods` | 2 | S |
| G20 | **Mark Announcement Read** | `PUT /courses/:id/discussion_topics/:id/read` | 2 | S |

---

## 5. Cross-MCP Integration Vision

### Gmail MCP Integration

**Data Flows:**
```
Canvas MCP                          Gmail MCP
-----------                         ----------
daily_briefing.urgency      --->    draft_email("Reminder: HW due tomorrow")
get_recent_feedback          --->    send_email("Grade posted: 92% on Midterm")
list_announcements           --->    send_email("New announcement in FINANCE 300")
get_conversation (from prof) --->    draft_email(reply from Canvas thread)
```

**Concrete Use Cases:**
1. **Assignment Reminder Emails:** After `daily_briefing`, automatically draft emails to self with tomorrow's deadlines. "Email me a summary of what's due this week."
2. **Grade Notification Forwarding:** When `get_recent_feedback` detects new grades, forward a formatted grade summary to personal email.
3. **Instructor Communication Bridge:** Read a Canvas conversation, compose a more detailed reply via email. Some professors prefer email over Canvas inbox.
4. **Absence Notification:** "Email my FINANCE 300 professor that I'll miss class tomorrow" -- uses Canvas enrollment data to find the instructor email, then Gmail to send.

### Google Calendar MCP Integration

**Data Flows:**
```
Canvas MCP                          Google Calendar MCP
-----------                         --------------------
list_calendar_events         --->    create_event(Canvas events mirrored)
list_assignments (upcoming)  --->    create_event(due date reminders)
scan_untracked_work          --->    create_event(reading/prep blocks)
daily_briefing.exam_alerts   --->    create_event(study session blocks)
get_grade_breakdown          --->    create_event(review sessions for weak groups)
```

**Concrete Use Cases:**
1. **Deadline Sync:** "Sync all my Canvas deadlines to Google Calendar." Iterate through upcoming assignments, create calendar events at due times with course and point values in the description.
2. **Study Block Scheduling:** After identifying an upcoming exam via `daily_briefing`, use Google Calendar's free/busy API to find open slots and create study blocks. "Schedule 3 hours of FINANCE 300 study before the midterm."
3. **Untracked Work Reminders:** `scan_untracked_work` finds a reading due for Tuesday's class. Create a Google Calendar event on Monday evening: "Read Chapter 7 for FINANCE 300."
4. **Smart Review Scheduling:** `get_grade_breakdown` shows the weakest assignment group is "Quizzes" at 72%. Schedule weekly quiz review sessions.

### Outlook MCP Integration

**Data Flows:** Mirror of Gmail and Google Calendar flows, but targeting students using Microsoft 365. UW-Madison provides both Google Workspace and Microsoft 365, so student preference varies.

**Concrete Use Cases:**
1. Same as Gmail flows but via Outlook send/draft
2. Same as Google Calendar flows but via Outlook Calendar
3. **Teams Integration:** If Outlook MCP supports Teams, post Canvas announcements to a personal Teams channel for notification aggregation

### Todoist MCP Integration

**Data Flows:**
```
Canvas MCP                          Todoist MCP
-----------                         -----------
list_assignments (upcoming)  --->    create_task(assignment as task)
scan_untracked_work          --->    create_task(reading/prep as task)
daily_briefing               --->    create_project("Week of Feb 10")
get_my_submission_status     --->    complete_task(submitted assignments)
mark_planner_item_done       --->    complete_task(sync completion)
```

**Concrete Use Cases:**
1. **Assignment-to-Task Pipeline:** "Add all my upcoming assignments to Todoist." Each assignment becomes a Todoist task with due date, course as project, and points as priority signal.
2. **Weekly Task Generation:** `daily_briefing` runs Monday morning. All upcoming work (assignments + untracked readings + exam prep) generates Todoist tasks organized by date and course.
3. **Completion Sync:** When a student marks a task complete in Todoist, the Canvas planner override can be updated. Or vice versa: `mark_planner_item_done` triggers Todoist task completion.
4. **Untracked Work as Tasks:** `scan_untracked_work` finds "Read Chapter 12 pp. 340-365" -- this becomes a Todoist task with the estimated date as the due date and "reading" as the label.
5. **Grade-Triggered Study Tasks:** `get_grade_breakdown` reveals the "Homework" group is at 68%. Automatically create a Todoist task: "Review homework solutions for REAL EST 410 -- grade is low (68%)."

### Multi-MCP Orchestration Patterns

**Morning Routine:**
```
1. Canvas: daily_briefing() --> urgency, exams, grades, untracked work
2. Todoist: sync new tasks from Canvas assignments + untracked work
3. Google Calendar: check today's schedule for conflicts
4. Google Calendar: create study blocks for upcoming exams
5. Gmail: send self a morning summary email
```

**Grade Alert Pipeline:**
```
1. Canvas: get_recent_feedback() --> new grade on Midterm: 78%
2. Canvas: get_grade_breakdown() --> overall grade dropped from B+ to B
3. Canvas: calculate_target_grade() --> need 92% on final for A-
4. Todoist: create_task("Study plan for FINANCE 300 final")
5. Google Calendar: schedule study blocks
6. Gmail: draft_email("Office hours request to Prof. Smith re: midterm review")
```

**Weekly Review:**
```
1. Canvas: get_my_grades() --> all course grades
2. Canvas: get_my_submission_status() --> any missing work?
3. Canvas: scan_untracked_work(days_ahead=7) --> upcoming readings
4. Todoist: reconcile tasks (complete submitted, add new)
5. Google Calendar: plan next week's study sessions
6. Gmail: weekly summary email
```

---

## Summary

### Key Metrics

| Metric | Value |
|--------|-------|
| Total tools | 58 |
| Canvas API areas covered | 19/30+ |
| Canvas API areas partially covered | 3 |
| Canvas API areas missing | 10+ |
| High-priority gaps | 6 (messaging, calendar creation, quizzes) |
| Medium-priority gaps | 8 |
| Critical strengths | Module-first architecture, grade intelligence, daily briefing |
| Critical threats | Institutional API restrictions, external tool lock-in, quiz API migration |

### Top 5 Recommendations

1. **Add conversation sending** (G1/G2) -- highest student impact, small effort, completes the messaging loop
2. **Add calendar event creation** (G3/G4) -- enables study scheduling, the most natural integration point with Google Calendar and Outlook MCPs
3. **Add quiz details tool** (G5/G6) -- fills the biggest content gap, read-only and safe
4. **Consolidate overlapping tools** (W7) -- reduce LLM confusion by merging `find_syllabus` into `get_course_syllabus`, clarifying tool descriptions
5. **Add instructor/TA listing** (G10) -- small effort, answers a very common question, enables the "email my professor" workflow when combined with G1

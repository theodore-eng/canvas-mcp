# Wave 1 Review: Team E -- Future Vision & Integration Strategy

**Date**: 2026-02-10
**Reviewer**: Team E (Future Vision & Integration Strategist)
**Codebase**: Canvas MCP v2.4.0 | 51+ tools | ~8,400 lines | TypeScript

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Assessment](#2-current-state-assessment)
3. [Cross-MCP Integration Architecture](#3-cross-mcp-integration-architecture)
4. [Canvas MCP Feature Expansion](#4-canvas-mcp-feature-expansion)
5. [Data Flow Architecture](#5-data-flow-architecture)
6. [Phased Roadmap](#6-phased-roadmap)
7. [Technical Implementation Details](#7-technical-implementation-details)
8. [Risk Assessment & Mitigations](#8-risk-assessment--mitigations)

---

## 1. Executive Summary

Canvas MCP v2.4.0 is a mature, well-architected MCP server with 51+ tools across 21 tool modules, 10 prompt templates, and 9 resources. It provides comprehensive read access to Canvas LMS and limited safe write capabilities (planner notes, preferences). The codebase demonstrates strong patterns: graceful fallbacks (Pages/Files API -> Modules), concurrent fetching with `runWithConcurrency`, grade deflation detection, and untracked work scanning.

The user's environment also includes Gmail, Google Calendar, Outlook, and Todoist MCPs. **The single biggest opportunity is transforming Canvas MCP from a standalone Canvas reader into the hub of a cross-MCP student productivity ecosystem.** Claude Desktop already orchestrates all these MCPs in a single conversation -- the key insight is that Claude itself is the integration layer. We do not need MCP-to-MCP communication; we need each MCP to expose the right data in the right format for Claude to orchestrate workflows across them.

**Top 3 strategic priorities:**
1. **Cross-MCP workflow prompts** -- New prompt templates that instruct Claude to call Canvas MCP + Gmail/Calendar/Todoist in sequence to execute complete workflows (e.g., "sync all deadlines to calendar")
2. **Structured data export tools** -- New Canvas tools that output data in formats optimized for consumption by other MCPs (iCalendar events, task lists, email drafts)
3. **Smart analysis tools** -- GPA simulator, workload predictor, study plan generator that leverage the rich data Canvas MCP already collects

---

## 2. Current State Assessment

### 2.1 Tool Inventory (21 modules, 51+ tools)

| Module | Tools | Category |
|--------|-------|----------|
| `dashboard.ts` | `daily_briefing`, `get_my_profile` | Aggregation |
| `courses.ts` | `list_courses`, `get_course`, `get_course_syllabus`, `find_syllabus`, `get_course_tools` | Course info |
| `assignments.ts` | `list_assignments`, `get_assignment`, `get_rubric` | Assignments |
| `submissions.ts` | `get_submission`, `submit_assignment`, `upload_file` | Submissions (write-gated) |
| `modules.ts` | `list_modules`, `list_announcements`, `get_module_item_content` | Content |
| `grades.ts` | `get_my_grades`, `get_my_submission_status` | Grades |
| `grade-analysis.ts` | `get_grade_breakdown`, `calculate_what_if_grade`, `calculate_target_grade` | Grade analysis |
| `planner.ts` | `get_planner_items`, `get_planner_notes`, `create_planner_note`, `update_planner_note`, `mark_planner_item_done`, `delete_planner_note` | Planner (read+write) |
| `calendar.ts` | `list_calendar_events` | Calendar |
| `files.ts` | `list_course_files`, `get_file_info`, `read_file_content`, `download_file` | Files |
| `untracked.ts` | `scan_untracked_work` | Smart scanning |
| `semester.ts` | `setup_semester` | Onboarding |
| `conversations.ts` | `list_conversations`, `get_conversation` | Messaging |
| `discussions.ts` | `list_discussion_topics`, `get_discussion_topic`, `get_discussion_entries`, `post_discussion_entry`, `reply_to_discussion` | Discussions (partially write-gated) |
| `todos.ts` | `get_my_todo_items`, `get_all_upcoming_work` | Todo items |
| `pages.ts` | `get_page_content`, `list_course_pages` | Wiki pages |
| `folders.ts` | `list_course_folders`, `list_folder_files` | File browsing |
| `activity.ts` | `get_activity_stream`, `get_activity_summary` | Activity |
| `search.ts` | `search_course_content` | Search |
| `preferences.ts` | `save_preference`, `save_context_note` | Learning system |
| `feedback.ts` | `get_submission_feedback` | Feedback |

### 2.2 Key Strengths

- **Daily briefing** is an 11-section aggregated view (urgency, exams, events, assignments, untracked work, grades, announcements, week-ahead) -- this is the natural hub for cross-MCP workflows
- **Grade analysis** is sophisticated: weighted groups, drop rules, what-if scenarios, target grade calculator, deflation detection
- **Untracked work scanner** fills a genuine gap in Canvas's API -- finds readings/prep hidden in SubHeaders
- **Fallback architecture** handles Canvas's inconsistent API permissions gracefully
- **Prompt templates** (10 prompts) already demonstrate the multi-tool orchestration pattern that cross-MCP integration needs

### 2.3 Key Gaps (Opportunities)

- No tools to **export** Canvas data in formats consumable by Calendar/Todoist/Gmail MCPs
- No **GPA simulation** (semester-level what-if across courses)
- No **workload analysis** (hours per week estimation, busy-week detection)
- No **study material aggregation** (gather all materials for a topic/exam)
- Canvas inbox messages are read-only -- no `send_message` tool
- No awareness of the **academic calendar** (add/drop deadlines, finals schedule, breaks)
- `daily_briefing` returns raw JSON -- no structured recommendations or priority scoring

---

## 3. Cross-MCP Integration Architecture

### 3.1 Architecture Principle: Claude as the Integration Layer

The MCPs available in the user's Claude Desktop environment are:
- **Canvas MCP** (this project)
- **Gmail MCP** (`mcp__gmail__*` -- send, draft, read, search, labels, filters)
- **Google Calendar MCP** (`mcp__google-calendar__*` -- list/create/update/delete events, freebusy, colors)
- **Outlook MCP** (`mcp__outlook__*` -- mail messages, attachments, drafts, forwarding)
- **Todoist MCP** (`mcp__todoist__*` -- tasks, projects, labels)
- **Notion MCP** (`mcp__notion__*` -- pages, blocks, databases, comments)

These MCPs cannot call each other directly. Claude is the orchestrator: it calls Canvas MCP to read data, then calls Gmail/Calendar/Todoist MCPs to act on it. **The integration happens through prompt templates and structured output formats.**

```
                    +-------------------+
                    |    Claude (LLM)   |
                    |   Orchestrator    |
                    +---+---+---+---+--+
                        |   |   |   |
               +--------+   |   |   +--------+
               |             |   |            |
        +------+---+   +----+---+--+   +-----+----+
        | Canvas   |   | Google   |   | Todoist  |
        | MCP      |   | Calendar |   | MCP      |
        +----------+   | MCP      |   +----------+
                        +----------+
                                        +----------+
                        +----------+    | Notion   |
                        | Gmail    |    | MCP      |
                        | MCP      |    +----------+
                        +----------+
```

### 3.2 Gmail Integration Points

#### 3.2.1 Assignment Due Date Reminders -> Email Alerts

**Workflow**: Canvas `daily_briefing` or `get_all_upcoming_work` -> Claude extracts assignments due within N days -> Gmail `send_email` or `draft_email` to self

**Implementation -- New Prompt Template `email_deadline_digest`:**
```
Prompt instructs Claude to:
1. Call daily_briefing (Canvas MCP)
2. Extract assignments with urgency level
3. Format as email with sections: Urgent (due today), Warning (due tomorrow), This Week
4. Call mcp__gmail__send_email to self with formatted digest
```

**New Canvas Tool Needed**: `export_deadline_digest`
- Takes `days_ahead`, `format` (`email_html`, `plain_text`, `structured`)
- Returns pre-formatted content optimized for email body
- Includes course names, due dates, point values, submission status
- Urgency color coding in HTML format

#### 3.2.2 Instructor Announcement Summaries -> Email Digest

**Workflow**: Canvas `list_announcements` -> Claude summarizes -> Gmail `send_email`

**New Canvas Tool**: `export_announcement_digest`
- Aggregates announcements across courses for a date range
- Returns structured data with course grouping and message previews
- Claude summarizes and emails to user

#### 3.2.3 Grade Change Notifications -> Email Alerts

**Workflow**: Canvas `get_my_grades` -> compare with stored previous grades (preferences) -> if changed, Gmail `send_email`

**New Canvas Tool**: `check_grade_changes`
- Compares current grades against last-known grades stored in `~/.canvas-mcp/grade_snapshot.json`
- Returns only courses with grade changes, including delta and direction
- Updates snapshot after check

#### 3.2.4 Finding Instructor Emails -> Compose in Gmail

**Workflow**: Canvas course enrollment data -> extract instructor info -> Gmail `draft_email`

**New Canvas Tool**: `get_course_people` (or enhance existing)
- Extract instructor/TA names and emails from Canvas enrollment API
- Returns structured `{ name, email, role }` for each instructor
- Claude can then pre-populate Gmail draft with `To:` field

#### 3.2.5 Canvas Inbox -> Gmail Forwarding

**Workflow**: Canvas `list_conversations` (unread) -> Claude reads full threads -> Gmail `draft_email` as forwarded copies

**New Prompt Template `forward_canvas_messages`:**
```
1. Call list_conversations with scope="unread"
2. For important-looking messages, call get_conversation
3. Draft email summaries of Canvas messages in Gmail for record-keeping
```

### 3.3 Google Calendar Integration Points

#### 3.3.1 Assignment Deadlines -> Calendar Events

**This is the highest-value integration.** Students often miss deadlines because Canvas deadlines are not in their personal calendar.

**Workflow**: Canvas `get_all_upcoming_work` or `list_assignments` -> Claude extracts deadlines -> Google Calendar `create-event` for each

**New Canvas Tool**: `export_deadlines_for_calendar`
- Takes `course_ids` (optional), `days_ahead` (default 30)
- Returns array of calendar-ready event objects:
  ```json
  {
    "title": "FINANCE 300: Homework 5",
    "start": "2026-02-15T23:59:00",
    "end": "2026-02-15T23:59:00",
    "description": "Points: 50 | Submission: online_upload | Status: not_submitted",
    "color_id": "11",
    "reminders": [{"method": "popup", "minutes": 1440}, {"method": "popup", "minutes": 60}]
  }
  ```
- Deduplication: includes Canvas assignment ID in description for Claude to check existing events
- Color coding: different colors for different courses (maps to Google Calendar color IDs 1-11)

**New Prompt Template `sync_deadlines_to_calendar`:**
```
1. Call export_deadlines_for_calendar (Canvas)
2. Call mcp__google-calendar__list-events to check for existing synced events
3. For each new deadline, call mcp__google-calendar__create-event
4. For changed deadlines, call mcp__google-calendar__update-event
5. Report what was synced
```

#### 3.3.2 Exam Dates -> Calendar Blocks with Study Prep

**Workflow**: Canvas exam detection (from `daily_briefing` exam_alerts) -> Create exam event + study block events in preceding days

**New Canvas Tool**: `export_exam_schedule`
- Scans all courses for exam/quiz/midterm/final assignments
- Returns exam events with metadata: points, percentage of grade, course
- Suggests study block sizes based on exam weight (e.g., 100pt final -> 3-hour blocks for 5 days before)

**New Prompt Template `create_exam_study_plan`:**
```
1. Call export_exam_schedule (Canvas)
2. Call mcp__google-calendar__get-freebusy for the week before each exam
3. Schedule study blocks in available time slots
4. Create calendar events for each study block with topic suggestions
```

#### 3.3.3 Office Hours -> Recurring Calendar Events

**Workflow**: Canvas syllabus parsing -> extract office hours -> Calendar recurring events

**New Canvas Tool**: `extract_office_hours`
- Parses syllabus text for office hours patterns (e.g., "Mon/Wed 2-4pm, Room 123")
- Returns structured `{ instructor, day_of_week, start_time, end_time, location, recurrence }`
- Falls back to checking course "Front Page" or module content

#### 3.3.4 Class Schedule -> Calendar Events

**Workflow**: Canvas course data + UW-Madison class schedule -> Calendar events

**Note**: Canvas API does not expose class meeting times. This would require:
- Parsing syllabus for schedule info
- Or integrating with the university's Course Search & Enroll API (out of scope for Canvas MCP, but noted as future opportunity)

#### 3.3.5 Workload-Aware Scheduling

**New Canvas Tool**: `analyze_weekly_workload`
- For each day in the next N days, counts:
  - Assignments due (weighted by points)
  - Untracked work items
  - Exam proximity score
- Returns a "busyness score" per day (1-10 scale)
- Claude can use this with `mcp__google-calendar__get-freebusy` to suggest when to schedule study time

### 3.4 Outlook Integration Points

The Outlook MCP mirrors Gmail/Calendar functionality for Microsoft ecosystem users:

- **Same email workflows** as Gmail (3.2.x) but using `mcp__outlook__create-draft-email`, `mcp__outlook__send-mail`
- **Same calendar workflows** as Google Calendar (3.3.x) via Outlook's calendar endpoints
- **Additional**: Forwarding Canvas messages via `mcp__outlook__forward-mail-message`

**Implementation approach**: Create integration prompt templates with a `provider` parameter that selects Gmail vs Outlook tool calls. The Canvas-side tools (`export_deadline_digest`, etc.) are provider-agnostic.

### 3.5 Todoist Integration Points

#### 3.5.1 Assignments -> Tasks with Due Dates and Priorities

**Workflow**: Canvas `get_all_upcoming_work` -> Claude creates Todoist tasks

**New Canvas Tool**: `export_assignments_as_tasks`
- Takes `course_ids` (optional), `days_ahead`, `include_submitted` (default false)
- Returns task-ready objects:
  ```json
  {
    "content": "FINANCE 300: Homework 5 (50 pts)",
    "description": "Submission type: online_upload\nCanvas link: https://canvas.wisc.edu/...",
    "due_date": "2026-02-15",
    "priority": 3,
    "labels": ["canvas", "finance-300"]
  }
  ```
- Priority mapping:
  - P1 (urgent): overdue or due today
  - P2 (high): due tomorrow, or high-point exams within 7 days
  - P3 (medium): due this week
  - P4 (low): due later

**New Prompt Template `sync_canvas_to_todoist`:**
```
1. Call export_assignments_as_tasks (Canvas)
2. Call mcp__todoist__todoist_list_projects to find or create "Canvas" project
3. Call mcp__todoist__todoist_list_tasks to check for existing synced tasks
4. For each new assignment, call mcp__todoist__todoist_create_task
5. For completed/submitted assignments, call mcp__todoist__todoist_complete_task
6. Report sync summary
```

#### 3.5.2 Module Items -> Subtask Checklists

**Workflow**: Canvas `list_modules` with items -> Create Todoist project with tasks per module, subtasks per item

**New Prompt Template `create_course_project`:**
```
1. Call list_modules for a specific course (Canvas)
2. Create a Todoist project named after the course
3. For each module, create a parent task (section)
4. For each module item, create a subtask
5. Set due dates from content_details where available
```

#### 3.5.3 Reading Assignments -> Tasks with Time Estimates

**Workflow**: Canvas `scan_untracked_work` -> Create Todoist tasks for readings with estimated duration

**New Canvas Tool Enhancement**: Add `estimated_duration_minutes` to `scan_untracked_work` output
- Heuristic: "Read Chapter 5" -> 45 min, "Review pp. 100-110" -> 20 min, "Prepare for discussion" -> 30 min
- Based on keyword analysis of the SubHeader title

#### 3.5.4 Study Plans -> Todoist Projects with Ordered Tasks

**Workflow**: Canvas grade analysis + upcoming exams -> Claude generates study plan -> Todoist project

**New Prompt Template `generate_study_plan_todoist`:**
```
1. Call get_grade_breakdown for a course (Canvas)
2. Call list_modules to see course structure (Canvas)
3. Identify weak areas from grade analysis
4. Call mcp__todoist__todoist_create_project ("Study Plan: FINANCE 300 Midterm")
5. Create ordered tasks: review notes, practice problems, review weak areas, mock exam
6. Set due dates leading up to exam
```

### 3.6 Notion Integration Points

#### 3.6.1 Course Knowledge Base

**Workflow**: Canvas course materials -> Notion pages for organized notes

**New Prompt Template `build_course_notion`:**
```
1. Call list_modules for a course (Canvas)
2. Create a Notion database for the course with columns: Module, Topic, Type, Date, Notes
3. For each module, create a Notion page with module content
4. Link assignments, readings, and lecture materials
```

#### 3.6.2 Semester Dashboard in Notion

**Workflow**: Canvas `daily_briefing` data -> Notion page that serves as a persistent dashboard

**New Prompt Template `update_notion_dashboard`:**
```
1. Call daily_briefing (Canvas)
2. Search Notion for existing "Semester Dashboard" page
3. Update with current grades, upcoming deadlines, recent announcements
4. Maintain a running changelog of grade updates
```

---

## 4. Canvas MCP Feature Expansion

### 4.1 New Tools -- High Priority

#### 4.1.1 `simulate_gpa` -- GPA Simulator

**Purpose**: What-if scenarios across ALL courses, not just one. "What GPA do I get if I get an A in Finance, B in GenBus, and A in Real Estate?"

**Input**: Array of `{ course_id, assumed_final_grade: "A" | "AB" | "B" | ... }`
**Logic**:
1. Map letter grades to GPA points (UW-Madison scale: A=4.0, AB=3.5, B=3.0, BC=2.5, C=2.0, D=1.0, F=0.0)
2. Get credit hours per course (from Canvas API or user input)
3. Calculate weighted GPA
4. Compare with current GPA if stored

**Output**: Projected semester GPA, cumulative GPA impact estimate

#### 4.1.2 `analyze_workload` -- Workload Analyzer

**Purpose**: Answer "which weeks are going to be the busiest?" and "how much work do I have per course?"

**Input**: `days_ahead` (default 30)
**Logic**:
1. Fetch all assignments across all courses
2. Fetch untracked work items
3. Group by week/day
4. Score each day: sum(points_due * submission_type_weight)
   - `online_upload` (essays/projects) weight = 3
   - `online_quiz` weight = 2
   - `online_text_entry` weight = 1.5
   - Other = 1
5. Detect "crunch weeks" where score exceeds threshold

**Output**: Per-day/week scores, crunch week warnings, per-course workload distribution

#### 4.1.3 `gather_exam_materials` -- Exam Preparation Assistant

**Purpose**: Automatically gather all relevant materials for an upcoming exam.

**Input**: `course_id`, `exam_assignment_id` (optional), `topic_keywords` (optional)
**Logic**:
1. Get the exam assignment details (date, description, rubric)
2. Scan syllabus for exam coverage hints
3. List modules leading up to the exam date
4. Collect all files (lecture slides, readings) from those modules
5. Collect related discussion topics
6. Extract file links from module items and page content

**Output**: Organized list of study materials with:
- Lecture files (with read_file_content availability)
- Reading assignments (from untracked scanner)
- Discussion topics for review
- Key dates and rubric info

#### 4.1.4 `get_course_people` -- Course People Directory

**Purpose**: Find instructor/TA names and emails for communication workflows.

**Input**: `course_id`, `role_filter` (optional: `teacher`, `ta`, `student`)
**Logic**: Canvas Users API for course enrollments
**Output**: `{ id, name, email, role, avatar_url }`

#### 4.1.5 `check_grade_changes` -- Grade Change Detector

**Purpose**: Detect grade changes since last check for notification workflows.

**Input**: None (compares against snapshot)
**Logic**:
1. Call `get_my_grades`
2. Load previous snapshot from `~/.canvas-mcp/grade_snapshot.json`
3. Diff: find courses where score changed
4. Save new snapshot
**Output**: Array of `{ course, old_score, new_score, delta, direction: "up" | "down" }`

### 4.2 New Tools -- Medium Priority

#### 4.2.1 `generate_weekly_report` -- Weekly Progress Report

**Purpose**: Persistent weekly report that tracks progress over time.

**Input**: `week_of` (YYYY-MM-DD, defaults to current week)
**Logic**:
1. Assignments completed this week (from submissions)
2. Grades received this week (from activity stream)
3. Upcoming work for next week
4. Grade trajectory per course
5. Save to `~/.canvas-mcp/reports/week-YYYY-MM-DD.json`
**Output**: Structured report with historical comparison

#### 4.2.2 `compare_courses` -- Course Comparison

**Purpose**: Compare workload, grade distribution, and structure across courses.

**Input**: `course_ids` (array, optional -- defaults to all active)
**Logic**: For each course, compute:
- Total assignments and points
- Submission type distribution
- Average assignment frequency (assignments per week)
- Current grade and grade distribution across assignment groups
- External tool count
**Output**: Side-by-side comparison table

#### 4.2.3 `draft_instructor_message` -- Professor Communication Helper

**Purpose**: Help draft a context-aware message to an instructor using Canvas inbox.

**Input**: `course_id`, `topic` (e.g., "late submission", "grade question", "office hours")
**Logic**:
1. Get course context (instructor name, current grade, relevant assignments)
2. Get student submission status for context
3. Return a structured prompt for Claude to draft an appropriate message
**Output**: Context bundle for Claude to compose the message, then send via Canvas `create_conversation` (new write tool)

#### 4.2.4 `export_calendar_feed` -- iCalendar Export

**Purpose**: Generate iCalendar (.ics) formatted events from Canvas data.

**Input**: `course_ids` (optional), `days_ahead` (default 30), `include_untracked` (default true)
**Logic**: Convert assignments + calendar events + untracked work to iCalendar VEVENT format
**Output**: iCalendar text that could be saved to a file or imported

### 4.3 New Tools -- Lower Priority (Phase 7+)

- `detect_study_groups` -- Analyze discussion activity to find active classmates
- `track_time_spent` -- Manual time tracking per course, stored in preferences
- `suggest_office_hours_visit` -- Based on grade drops, suggest visiting office hours
- `summarize_discussion` -- AI-powered summary of long discussion threads
- `check_academic_calendar` -- UW-Madison academic calendar awareness (would need web scraping or static data)

### 4.4 New Prompt Templates

| Prompt | Description | MCPs Used |
|--------|-------------|-----------|
| `sync_deadlines_to_calendar` | Sync all Canvas deadlines to Google Calendar | Canvas + Google Calendar |
| `sync_canvas_to_todoist` | Create Todoist tasks for all upcoming Canvas work | Canvas + Todoist |
| `email_deadline_digest` | Email yourself a daily/weekly deadline digest | Canvas + Gmail |
| `create_exam_study_plan` | Generate a calendar-integrated study plan for an exam | Canvas + Google Calendar + Todoist |
| `morning_routine` | Full morning workflow: briefing + calendar check + task review | Canvas + Google Calendar + Todoist |
| `forward_canvas_messages` | Forward important Canvas inbox messages to email | Canvas + Gmail/Outlook |
| `weekly_sync` | Weekly full sync: update calendar, update tasks, email report | Canvas + all MCPs |
| `semester_kickoff` | Complete semester setup: folders + calendar + projects | Canvas + Google Calendar + Todoist + Notion |

---

## 5. Data Flow Architecture

### 5.1 Data Exposed by Canvas MCP (Producers)

Canvas MCP is primarily a **data producer**. Other MCPs consume its output:

| Data Type | Source Tool | Consumers |
|-----------|-----------|-----------|
| Assignment deadlines | `daily_briefing`, `get_all_upcoming_work`, `export_deadlines_for_calendar` | Google Calendar, Todoist, Gmail |
| Exam dates | `daily_briefing` (exam_alerts), `export_exam_schedule` | Google Calendar, Todoist |
| Grade data | `get_my_grades`, `get_grade_breakdown`, `check_grade_changes` | Gmail (notifications), Notion (dashboard) |
| Announcements | `list_announcements`, `export_announcement_digest` | Gmail, Notion |
| Untracked work | `scan_untracked_work` | Todoist, Google Calendar |
| Course materials | `list_course_files`, `read_file_content` | Notion (knowledge base) |
| Canvas messages | `list_conversations`, `get_conversation` | Gmail/Outlook (forwarding) |
| Instructor info | `get_course_people` (new) | Gmail (compose), Outlook |
| Workload analysis | `analyze_workload` (new) | Google Calendar (scheduling), Todoist (priorities) |

### 5.2 Data Canvas MCP Would Consume (from other MCPs)

Canvas MCP could benefit from reading data from other MCPs, though this is lower priority:

| External Data | Source MCP | Canvas MCP Use |
|--------------|-----------|----------------|
| Calendar free/busy | Google Calendar | Workload analysis, study plan timing |
| Existing calendar events | Google Calendar | Deduplication when syncing deadlines |
| Task completion status | Todoist | Update planner item completion status |
| Email threads with instructors | Gmail | Context for `draft_instructor_message` |

**Key insight**: Canvas MCP does NOT need to directly call other MCPs. Claude orchestrates all cross-MCP flows. Canvas MCP just needs to output data in useful formats.

### 5.3 Data Layer Architecture

```
+---------------------------+
|  ~/.canvas-mcp/           |  Persistent local storage
|  +-- preferences.json     |  User preferences (existing)
|  +-- context.json         |  Learned patterns (existing)
|  +-- grade_snapshot.json  |  Last-known grades (new)
|  +-- sync_state.json      |  Cross-MCP sync tracking (new)
|  +-- reports/             |  Weekly reports archive (new)
+---------------------------+

+---------------------------+
|  ~/Canvas/                |  Course files (existing, from setup_semester)
|  +-- FINANCE-300/         |
|  +-- GENBUS-307/          |
|  +-- ...                  |
+---------------------------+
```

#### 5.3.1 Sync State Tracking (`sync_state.json`)

To avoid duplicating calendar events or Todoist tasks on repeated syncs, Canvas MCP should maintain a sync state file:

```json
{
  "last_calendar_sync": "2026-02-10T08:00:00Z",
  "synced_assignments": {
    "12345": {
      "google_calendar_event_id": "abc123",
      "todoist_task_id": "456789",
      "last_synced_due_at": "2026-02-15T23:59:00Z"
    }
  },
  "last_grade_snapshot": "2026-02-10T08:00:00Z"
}
```

**New Tool**: `get_sync_state` -- Returns current sync state for Claude to use when deciding what to create/update in external MCPs.

**New Tool**: `update_sync_state` -- Records external IDs after Claude creates events/tasks in other MCPs.

### 5.4 Authentication Across MCPs

Each MCP handles its own authentication independently:
- **Canvas MCP**: `CANVAS_API_TOKEN` environment variable
- **Gmail/Calendar**: OAuth2 via Google's MCP server
- **Outlook**: OAuth2 via Microsoft's MCP server
- **Todoist**: API token via Todoist's MCP server

**No cross-MCP auth is needed.** Claude calls each MCP with its own credentials. The only coordination needed is the sync state file, which Canvas MCP owns locally.

---

## 6. Phased Roadmap

### Phase 4: Canvas MCP v3.0 -- Internal Improvements (Weeks 1-3)

**Goal**: Improve the foundation before adding integration features.

| Item | Priority | Effort | Description |
|------|----------|--------|-------------|
| `simulate_gpa` tool | High | Medium | Semester-level what-if GPA calculator |
| `analyze_workload` tool | High | Medium | Weekly workload scoring and crunch-week detection |
| `get_course_people` tool | High | Low | Instructor/TA directory with emails |
| `check_grade_changes` tool | High | Low | Grade change detection with snapshots |
| `generate_weekly_report` tool | Medium | Medium | Persistent weekly progress reports |
| `compare_courses` tool | Medium | Low | Side-by-side course comparison |
| Enhance `scan_untracked_work` | Medium | Low | Add duration estimates to reading items |
| Enhance `daily_briefing` | Medium | Low | Add priority scoring (1-10) to each item |
| Add `create_conversation` write tool | Medium | Medium | Send Canvas inbox messages (write-gated) |
| Improve error messages | Low | Low | More actionable error messages across all tools |

**Estimated total**: ~800-1200 new lines of code.

### Phase 5: Cross-MCP Integration Prep (Weeks 3-5)

**Goal**: Add export tools and sync state management that enable cross-MCP workflows.

| Item | Priority | Effort | Description |
|------|----------|--------|-------------|
| `export_deadlines_for_calendar` tool | High | Medium | Calendar-ready event objects from assignments |
| `export_assignments_as_tasks` tool | High | Medium | Todoist-ready task objects from assignments |
| `export_exam_schedule` tool | High | Low | Exam events with study time suggestions |
| `export_announcement_digest` tool | Medium | Low | Email-ready announcement summaries |
| `extract_office_hours` tool | Medium | Medium | Parse syllabi for office hours info |
| `get_sync_state` / `update_sync_state` tools | High | Low | Sync deduplication state management |
| Sync state JSON file system | High | Low | `~/.canvas-mcp/sync_state.json` persistence |

**Estimated total**: ~600-900 new lines of code.

### Phase 6: Gmail/Calendar Deep Integration (Weeks 5-8)

**Goal**: Add prompt templates that orchestrate Canvas + Gmail + Google Calendar.

| Item | Priority | Effort | Description |
|------|----------|--------|-------------|
| `sync_deadlines_to_calendar` prompt | High | Low | Full deadline sync workflow |
| `create_exam_study_plan` prompt | High | Medium | Exam prep with calendar scheduling |
| `email_deadline_digest` prompt | Medium | Low | Self-email deadline summary |
| `forward_canvas_messages` prompt | Medium | Low | Canvas inbox -> Gmail forwarding |
| `morning_routine` prompt | High | Medium | Full morning workflow across MCPs |
| Outlook equivalents | Low | Low | Mirror prompts for Outlook MCP |

**Note**: Prompts are relatively low-effort since they are text templates instructing Claude. The heavy lifting is in the Phase 5 export tools.

### Phase 7: Todoist/Task Management Integration (Weeks 8-10)

**Goal**: Add prompt templates for Todoist integration.

| Item | Priority | Effort | Description |
|------|----------|--------|-------------|
| `sync_canvas_to_todoist` prompt | High | Medium | Full task sync workflow |
| `create_course_project` prompt | Medium | Low | Course -> Todoist project structure |
| `generate_study_plan_todoist` prompt | Medium | Medium | Study plan as Todoist project |
| `weekly_sync` prompt | High | Medium | Complete weekly sync across all MCPs |

### Phase 8: Full Student Assistant Ecosystem (Weeks 10-14)

**Goal**: Polish, advanced features, and Notion integration.

| Item | Priority | Effort | Description |
|------|----------|--------|-------------|
| `semester_kickoff` prompt | High | Medium | Complete semester setup across all MCPs |
| `build_course_notion` prompt | Medium | Medium | Course knowledge base in Notion |
| `update_notion_dashboard` prompt | Medium | Medium | Persistent Notion semester dashboard |
| `draft_instructor_message` tool + prompt | Medium | Medium | Context-aware instructor messaging |
| `gather_exam_materials` tool | Medium | Medium | Exam material aggregator |
| Academic calendar awareness | Low | High | UW-Madison calendar data integration |
| Natural language date parsing | Low | Medium | "next Friday" -> date in tool inputs |
| Smart notification scheduling | Low | High | Context-aware notification timing |

### Version Map

| Version | Phase | Key Features |
|---------|-------|-------------|
| v3.0.0 | Phase 4 | GPA sim, workload analysis, grade changes, course people |
| v3.1.0 | Phase 5 | Export tools, sync state, calendar/task-ready outputs |
| v3.2.0 | Phase 6 | Gmail + Calendar integration prompts |
| v3.3.0 | Phase 7 | Todoist integration prompts |
| v4.0.0 | Phase 8 | Full ecosystem: Notion, advanced analysis, semester orchestration |

---

## 7. Technical Implementation Details

### 7.1 Export Tool Pattern

All export tools should follow a consistent pattern:

```typescript
// src/tools/exports.ts (new file)
export function registerExportTools(server: McpServer) {
  server.tool(
    'export_deadlines_for_calendar',
    'Export upcoming assignment deadlines in a format ready for calendar integration. Returns structured event objects with title, start time, description, and suggested reminders.',
    {
      course_ids: z.array(z.number().int().positive()).optional(),
      days_ahead: z.number().int().min(1).max(90).optional().default(30),
      include_submitted: z.boolean().optional().default(false),
    },
    async ({ course_ids, days_ahead, include_submitted }) => {
      // ... fetch assignments across courses
      // ... filter to upcoming, unsubmitted (unless include_submitted)
      // ... transform to calendar-event-ready objects
      // ... return formatSuccess({ events: [...], sync_metadata: {...} })
    }
  );
}
```

### 7.2 Sync State Service

```typescript
// src/services/sync-state.ts (new file)
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import os from 'os';

const SYNC_STATE_PATH = join(os.homedir(), '.canvas-mcp', 'sync_state.json');

interface SyncedAssignment {
  google_calendar_event_id?: string;
  todoist_task_id?: string;
  notion_page_id?: string;
  last_synced_due_at?: string;
  last_synced_at: string;
}

interface SyncState {
  last_calendar_sync?: string;
  last_todoist_sync?: string;
  last_grade_snapshot?: string;
  synced_assignments: Record<string, SyncedAssignment>;
}

export function loadSyncState(): SyncState { ... }
export function saveSyncState(state: SyncState): void { ... }
export function markAssignmentSynced(assignmentId: number, provider: string, externalId: string): void { ... }
```

### 7.3 Prompt Template Architecture for Cross-MCP Workflows

Cross-MCP prompts need to be carefully structured because Claude must call tools from multiple MCPs in sequence. The key design principles:

1. **Canvas tools first**: Always gather Canvas data before calling external MCPs
2. **Deduplication check**: Always check for existing synced items before creating new ones
3. **Error handling instructions**: Tell Claude what to do if an external MCP call fails
4. **Sync state update**: Always update sync state after successful external MCP calls

Example prompt structure:
```typescript
server.prompt(
  'sync_deadlines_to_calendar',
  'Sync all upcoming Canvas assignment deadlines to Google Calendar. Creates new events, updates changed ones, and reports what was synced.',
  {
    days_ahead: z.string().optional().describe('Days ahead to sync (default: 30)'),
    course_filter: z.string().optional().describe('Specific course name to sync'),
  },
  async ({ days_ahead, course_filter }) => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `Sync my Canvas assignment deadlines to Google Calendar for the next ${days_ahead || '30'} days.
${course_filter ? `Only sync for course: ${course_filter}` : 'Sync all active courses.'}

Follow these steps precisely:
1. Call export_deadlines_for_calendar with days_ahead=${days_ahead || 30}
2. Call get_sync_state to see what has already been synced
3. Call mcp__google-calendar__list-events for the same date range to check for existing events
4. For each deadline:
   a. If NOT in sync state AND NOT in calendar: call mcp__google-calendar__create-event
   b. If IN sync state but due date changed: call mcp__google-calendar__update-event
   c. If already synced and unchanged: skip
5. After all events are created/updated, call update_sync_state with the external event IDs
6. Report: N new events created, N updated, N skipped (already synced)

Event formatting rules:
- Title format: "COURSE_CODE: Assignment Name"
- Set as all-day event on the due date
- Description: include points, submission type, Canvas URL
- Set reminders: 1 day before and 1 hour before
- Use different colors per course

If any Google Calendar call fails, report the error but continue with remaining items.`,
      },
    }],
  })
);
```

### 7.4 Module Registration

New modules would be registered in `src/index.ts`:

```typescript
import { registerExportTools } from './tools/exports.js';
import { registerAnalysisTools } from './tools/analysis.js';
import { registerSyncTools } from './tools/sync.js';

// Phase 4: Analysis tools
registerAnalysisTools(server);  // simulate_gpa, analyze_workload, etc.

// Phase 5: Export & sync tools
registerExportTools(server);    // export_deadlines_for_calendar, etc.
registerSyncTools(server);      // get_sync_state, update_sync_state
```

---

## 8. Risk Assessment & Mitigations

### 8.1 Technical Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| MCP-to-MCP timing: Claude may make incorrect assumptions about external MCP data | Medium | Medium | Explicit instructions in prompts to verify before acting; sync state deduplication |
| Rate limiting across multiple MCPs | Medium | Low | Sequential (not parallel) calls to external MCPs; backoff instructions in prompts |
| Sync state corruption | Medium | Low | JSON schema validation; backup before writes; graceful handling of missing/corrupted state |
| Canvas API token expiry during long workflows | Low | Low | Already handled by existing error handling |
| Google Calendar event limit (per-day) | Low | Low | Batch operations; check existing events before creating |

### 8.2 UX Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Information overload: too many tools confuses Claude's tool selection | High | Medium | Group related tools under clear naming conventions; use prompt templates to guide workflows |
| Duplicate events/tasks from repeated syncs | High | High | Sync state tracking is mandatory; always check-before-create in prompts |
| Stale data: Canvas data changes between tool calls | Medium | Medium | Always fetch fresh data; never cache across tool calls; timestamp all outputs |
| Cross-MCP prompt complexity: prompts become too long for Claude | Medium | Low | Break complex workflows into smaller prompt steps; allow incremental execution |

### 8.3 Strategic Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| MCP protocol changes breaking tool registration | Medium | Low | Pin SDK version; monitor MCP spec updates |
| External MCP APIs changing | Medium | Medium | Isolate external MCP calls to prompt templates (easy to update); version-pin prompts |
| Over-engineering: building features nobody uses | Medium | Medium | Prioritize by direct user need (calendar sync >> Notion integration); gather feedback between phases |
| Canvas API permission changes | Low | Low | Existing fallback architecture handles this well |

---

## Summary of Deliverables by Phase

### Phase 4 (v3.0.0) -- 5 new tools, ~1000 LOC
- `simulate_gpa`, `analyze_workload`, `get_course_people`, `check_grade_changes`, `generate_weekly_report`

### Phase 5 (v3.1.0) -- 7 new tools, 1 new service, ~800 LOC
- `export_deadlines_for_calendar`, `export_assignments_as_tasks`, `export_exam_schedule`, `export_announcement_digest`, `extract_office_hours`, `get_sync_state`, `update_sync_state`
- New file: `src/services/sync-state.ts`

### Phase 6 (v3.2.0) -- 6 new prompts, ~300 LOC
- `sync_deadlines_to_calendar`, `create_exam_study_plan`, `email_deadline_digest`, `forward_canvas_messages`, `morning_routine`

### Phase 7 (v3.3.0) -- 4 new prompts, ~200 LOC
- `sync_canvas_to_todoist`, `create_course_project`, `generate_study_plan_todoist`, `weekly_sync`

### Phase 8 (v4.0.0) -- 4 new prompts, 2 new tools, ~800 LOC
- `semester_kickoff`, `build_course_notion`, `update_notion_dashboard`, `draft_instructor_message`, `gather_exam_materials`

**Total across all phases**: ~18 new tools, ~14 new prompts, ~3100 lines of new code

---

*This roadmap transforms Canvas MCP from a standalone Canvas reader into the academic hub of a multi-MCP student productivity ecosystem, with Claude as the intelligent orchestrator connecting Canvas, email, calendar, task management, and knowledge management into seamless workflows.*

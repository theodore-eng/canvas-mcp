# Next Steps — Canvas MCP Server

**Last updated**: 2026-02-10
**Current version**: v2.2

## Completed in v2.2

### New Tools (8 new tools)
- [x] `list_conversations` — Canvas inbox messages with scope filtering (unread, starred, sent, archived)
- [x] `get_conversation` — Full conversation thread with resolved author names
- [x] `list_course_folders` — Browse folder structure for any course
- [x] `browse_folder` — View folder contents (subfolders + files) with metadata
- [x] `get_activity_stream` — Recent activity across all courses (grades, announcements, discussions)
- [x] `get_activity_summary` — Unread counts by activity type
- [x] `save_preference` / `list_preferences` / `delete_preference` — Persistent user preference system
- [x] `save_context_note` / `list_context_notes` / `clear_old_context` — Learning/context memory system

### Learning System (new)
- [x] Persistent preference storage at `~/.canvas-mcp/preferences.json`
- [x] Context/learning notes at `~/.canvas-mcp/context.json`
- [x] Categories: display, priorities, behavior, per-course settings
- [x] Context categories: workflow_patterns, conversation_notes, preferences_applied
- [x] Auto-pruning of old context notes (configurable retention)
- [x] Secure file permissions (0o700 directory, 0o600 files)

### New Prompts (10 total, up from 8)
- [x] `inbox_review` — Check unread messages, prioritize by course importance
- [x] `whats_new` — Quick scan of recent activity, grades, announcements

### Enhanced Prompts
- [x] `quick_check` — now references activity stream, inbox, and user preferences
- [x] `catch_up` — now references activity stream, inbox, and user preferences

### New Resources (9 total, up from 6)
- [x] `canvas://user/preferences` — Auto-surfaces user preferences to Claude for personalization
- [x] `canvas://user/context` — Auto-surfaces learned patterns and observations
- [x] `canvas://inbox/unread` — Quick view of unread inbox messages

### Infrastructure
- [x] Canvas client methods for Conversations, Folders, Activity Stream APIs
- [x] Full TypeScript types for all new API entities
- [x] Startup logging updated with all new features

## Completed in v2.1

### Infrastructure
- [x] Retry logic with exponential backoff (429/5xx, honors Retry-After header)
- [x] User timezone support (cached from profile, used for date calculations)
- [x] Course context cache with 5-minute TTL (listCourses, getUserProfile)
- [x] PDF parsing timeout (30-second guard against corrupted PDFs)
- [x] DOCX/PPTX/XLSX text extraction via officeparser
- [x] HTML entity numeric range validation (fromCodePoint with 0x10FFFF guard)

### Bug Fixes
- [x] Buffer.from() for base64 decoding (replaces browser-only atob)
- [x] Date validation in calendar tool
- [x] Type casting fix in planner mark_planner_item_done
- [x] Version constant (no more hardcoded strings)
- [x] daily_briefing: submitted check includes needs_grading
- [x] daily_briefing: resolves context_code to course names
- [x] list_announcements: course_ids now optional (auto-fetches all courses)
- [x] mark_planner_item_done: handles existing overrides via fallback to update
- [x] get_all_upcoming_work: rewritten to use planner API (1 call instead of N+1)

### New Tools
- [x] `get_grade_breakdown` — assignment group weights, per-group analysis, grade projections
- [x] `calculate_what_if_grade` — hypothetical score scenarios
- [x] `get_recent_feedback` — recently graded assignments with scores and feedback
- [x] `update_planner_note` — edit existing planner notes
- [x] `search_all_courses` — cross-course content search
- [x] `create_planner_note` now supports linked_object_type/id

### Improved Tools
- [x] `get_my_grades` — now includes apply_assignment_group_weights
- [x] `get_my_submission_status` — now returns full submitted array (not just count)
- [x] `search_course_content` — now searches pages, files, and discussions (not just modules/assignments)
- [x] `get_all_upcoming_work` — includes quizzes, discussions; shows by_course grouping

### New Prompts (8 total, up from 4)
- [x] `grade_analysis` — course grade deep-dive
- [x] `catch_up` — "what did I miss?" recovery mode
- [x] `end_of_semester` — final grade projections
- [x] `submission_review` — rubric-based pre-submission review

### New Resources (6 total, up from 4)
- [x] `canvas://deadlines/upcoming` — rolling 7-day deadline view
- [x] `canvas://courses/{id}/modules` — course module structure

## Remaining Feature Ideas

### High Priority
- [ ] Consolidate overlapping upcoming-work tools (5 tools → 2-3)
- [ ] Score statistics in assignment data (class mean/min/max)
- [ ] Late penalty info surfaced (points_deducted, late_policy_status)

### Medium Priority
- [ ] Assignment group drop rules in grade calculations
- [ ] Course nickname mapping (student-defined aliases)
- [ ] Page body previews in list_pages
- [ ] Discussion full reply threading (fetch_all_replies option)
- [ ] Unread filtering for discussions and announcements
- [ ] Group/collaboration support (Canvas Groups API)

### Low Priority
- [ ] Pagination controls on list tools (limit/offset)
- [ ] GraphQL integration for more efficient queries
- [ ] Streaming for large file downloads
- [ ] Rate limiter (token bucket pattern) for proactive rate management

## Technical Debt
- [ ] Add unit tests (at least for utils.ts and canvas-client.ts)
- [ ] Add integration test for MCP protocol compliance
- [ ] Add ESLint configuration
- [ ] Add CI/CD pipeline
- [ ] Consider removing redundant get_rubric tool (get_assignment already includes rubric)

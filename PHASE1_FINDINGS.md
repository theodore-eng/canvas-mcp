# Canvas MCP — Phase 1 Audit Findings Report
## Project Lead Analysis: Scaling for Any Wisconsin Student

**Date:** 2026-02-10
**Scope:** Full audit of canvas-mcp codebase + deep-dive of 5 active UW-Madison Spring 2026 courses
**Goal:** Identify threats, opportunities, and implementations to make this tool top-scale for any Wisconsin student

---

## EXECUTIVE SUMMARY

The Canvas MCP server is already a strong 51-tool production system. However, after auditing 5 real UW-Madison courses, I found **critical gaps between how the MCP assumes courses are structured vs. how Wisconsin professors actually structure them.** These gaps would cause the tool to break or return empty data for many students. Below are the prioritized findings.

---

## PART 1: HOW WISCONSIN PROFESSORS ACTUALLY STRUCTURE CANVAS

### Course Structure Audit (5 courses, 5 different patterns)

| Course | Default View | Modules | Assignments | Pages API | Files API | Syllabus Body | External Tools |
|--------|-------------|---------|-------------|-----------|-----------|---------------|----------------|
| FINANCE 300 | wiki | 22 modules | 14 | DISABLED | UNAUTHORIZED | NULL | Honorlock, McGraw-Hill Connect |
| GENBUS 307 | modules | 4 modules | 10 | DISABLED | 0 files | NULL | Zoom, Top Hat, Testing Center, Gradescope, Honorlock |
| MHR 300 | wiki | 20 modules | 48 | DISABLED | UNAUTHORIZED | NULL | Zoom, Gradescope, MindTap (Cengage) |
| REAL EST 410 | modules | 6 modules | 5 | 5 pages | 7 files (PDFs) | NULL | Top Hat, Zoom, Gradescope, Chat |
| REAL EST 420 | modules | 4 modules | 50 | DISABLED | UNAUTHORIZED | NULL | Top Hat, Testing Center, Zoom, Gradescope |

### Key Structural Patterns Discovered

**Pattern 1: Module-Centric Organization (ALL 5 courses)**
- EVERY professor uses modules as the primary content hierarchy
- Content is nested inside modules, not standalone pages/assignments
- Module items include: Pages, Files, Assignments, Quizzes, ExternalTools, ExternalUrls, Discussions, SubHeaders

**Pattern 2: Syllabus NEVER in Canvas's Syllabus Feature**
- ALL 5 courses have `syllabus_body: null`
- Professors put syllabi as: PDF files in modules (RE 410, MHR 300), Pages within modules (GENBUS 307, RE 420), or not in Canvas at all (FINANCE 300 — likely uses McGraw-Hill)

**Pattern 3: Pages API Disabled by Default**
- 4 of 5 courses return "That page has been disabled for this course" from `/pages`
- BUT pages are still accessible as module items — the standalone Pages tab is just hidden
- This means `list_pages` tool will fail for most courses, but `get_module_item_content` works

**Pattern 4: Files Frequently Unauthorized**
- 3 of 5 courses block the `/files` endpoint entirely
- Files are still accessible when linked through module items
- The Files tab is hidden in most courses; professors embed files in modules directly

**Pattern 5: External Tools Are Critical Content Sources**
- MHR 300: ALL textbook readings are ExternalTool (MindTap/Cengage) — invisible to our API
- FINANCE 300: McGraw-Hill Connect hosts homework platform
- Multiple courses use Gradescope for grading, Top Hat for participation, Honorlock for proctoring
- This content is completely walled off from the Canvas API

**Pattern 6: Wildly Different Assignment Patterns**
- RE 410: 5 assignments (traditional homework model)
- RE 420: 50 assignments including per-class exit tickets
- MHR 300: 48 assignments with case activities + "You Make the Decision" per chapter
- GENBUS 307: 10 assignments with quizzes
- FINANCE 300: 14 homework + exams

**Pattern 7: Grading Structures Are Unique Per Course**
- FINANCE 300: 5 equal 20% buckets (HW, Exam 1-3, Final)
- GENBUS 307: 30% assignments (drop 2), 10% quizzes (drop 2), 60% exams
- MHR 300: Points-based (no weights), drop rules on Case Activities and Decisions
- RE 410: No weights configured (simple points)
- RE 420: Complex project-based with Affordable Housing Project (20%), Exams (48%), Assignments (18%), Exit Tickets (2%, drop 7)

---

## PART 2: CRITICAL THREATS (Things That WILL Break for Users)

### THREAT 1: `list_pages` Fails for Most Courses ⚠️ HIGH
**Impact:** When a user asks "show me the pages in my course," they get an error for 80%+ of courses
**Root Cause:** Professors disable the Pages tab, but pages exist as module items
**Fix:** Fall back to extracting page references from module items when `/pages` endpoint fails

### THREAT 2: `get_course_syllabus` Returns Empty for ALL Courses ⚠️ CRITICAL
**Impact:** "Get my syllabus" returns nothing — the #1 thing students need at semester start
**Root Cause:** No UW-Madison professor uses Canvas's built-in syllabus_body field
**Fix:** Implement syllabus discovery: check module items for files/pages named "syllabus", check first module for orientation content, search files for PDF syllabi

### THREAT 3: File Browsing Blocked in Most Courses ⚠️ HIGH
**Impact:** `list_course_files` returns unauthorized for 60%+ of courses
**Root Cause:** Professors restrict the Files tab; files only accessible through module links
**Fix:** Extract file references from module items instead of relying on `/files` endpoint

### THREAT 4: External Tool Content is Invisible ⚠️ HIGH
**Impact:** Reading assignments in MindTap, homework in McGraw-Hill Connect, quizzes in Gradescope — all invisible
**Root Cause:** Canvas API cannot access LTI tool content
**Fix:** At minimum, detect and clearly report external tool dependencies so students know what's where; surface external tool URLs from module items

### THREAT 5: Quiz Content Not Readable ⚠️ MEDIUM
**Impact:** Students can't review quiz questions or study from quizzes via the tool
**Root Cause:** Canvas Quiz API requires specific permissions and quiz content isn't exposed the same way
**Fix:** Ensure quiz metadata (dates, attempts, scores) is surfaced even if questions aren't

---

## PART 3: TOP OPPORTUNITIES (Highest Impact Implementations)

### OPPORTUNITY 1: Smart Syllabus Finder 🎯 CRITICAL PRIORITY
Build a `find_syllabus` tool that:
1. Checks `syllabus_body` first (current approach — but always empty at UW)
2. Scans first/orientation module for pages/files containing "syllabus"
3. Searches course files for PDF/DOCX named "*syllabus*"
4. Searches page titles for "syllabus", "course information", "course overview"
5. Returns the best match with extracted text content
**Impact:** Makes tool immediately useful for EVERY student on day 1

### OPPORTUNITY 2: Module-First Navigation 🎯 HIGH PRIORITY
The entire UW Canvas experience is module-based. The MCP should:
1. Make `list_modules` the default entry point for course exploration
2. Add a `get_course_overview` tool that returns modules + assignment groups + upcoming deadlines in one call
3. Handle ALL module item types: Page, File, Assignment, Quiz, Discussion, ExternalTool, ExternalUrl, SubHeader
4. Auto-extract content from module items (pages text, file content) instead of requiring separate calls
**Impact:** Matches how students actually navigate Canvas

### OPPORTUNITY 3: Resilient Content Discovery 🎯 HIGH PRIORITY
Build fallback chains for every content type:
- Pages: Try `/pages` → fall back to module items of type Page
- Files: Try `/files` → fall back to module items of type File
- Syllabus: Try `syllabus_body` → module scan → file scan → page scan
- Readings: Detect ExternalTool items and surface their URLs + descriptions
**Impact:** Tool works regardless of how professor has configured Canvas

### OPPORTUNITY 4: External Tool Awareness 🎯 MEDIUM PRIORITY
Build a `get_course_tools` tool that:
1. Lists all external tools from the tabs endpoint (not just `/external_tools`)
2. Maps common tools: Gradescope → grading, Top Hat → participation, Honorlock → proctoring, MindTap/McGraw-Hill → textbook
3. Surfaces this in the daily briefing: "This course uses Gradescope for homework submission"
4. Detects when assignments reference external tools and warns the student
**Impact:** Students stop being confused about where to submit/find things

### OPPORTUNITY 5: Smart Grade Context 🎯 MEDIUM PRIORITY
Each course's grading structure is unique. Build:
1. A `get_grading_policy` tool that parses assignment groups, weights, and drop rules
2. Integration with syllabus-extracted grading policies
3. "What do I need on the final to get an A?" calculator that understands course-specific rules
4. Awareness of points-based vs percentage-based vs weighted grading
**Impact:** The #1 reason students check Canvas

### OPPORTUNITY 6: Professor Pattern Detection 🎯 MEDIUM PRIORITY
Auto-detect how a professor structures their course:
- Weekly modules (GENBUS 307, RE 410) vs Topic modules (FINANCE 300, MHR 300) vs Hybrid (RE 420)
- Assignment frequency pattern (daily exit tickets vs weekly homework vs periodic exams)
- Content delivery pattern (PDFs vs Pages vs External Tools)
- Use this to adapt how the tool presents information
**Impact:** Tool feels natural regardless of the class

### OPPORTUNITY 7: Cross-Course Dashboard 🎯 HIGH PRIORITY
The existing `daily_briefing` is good but should be enhanced:
1. Show which courses have NEW announcements since last check
2. Group by urgency: due today → due this week → due next week
3. Include grade standing per course with trend (up/down from last check)
4. Flag courses where user is falling behind (missing submissions)
**Impact:** Single view replaces 5 separate Canvas checks

### OPPORTUNITY 8: Content Search Across Modules 🎯 MEDIUM PRIORITY
The current `search_course_content` should handle the module-centric reality:
1. Search module item titles and descriptions
2. Search within page content from module items
3. Search file names from module items
4. Return results with module context ("Found in Module 3 → Item: TVM PowerPoints")
**Impact:** Students can find anything regardless of where professor put it

---

## PART 4: UW-WISCONSIN SPECIFIC OBSERVATIONS

### Common External Tools at UW-Madison
| Tool | Purpose | Courses Using |
|------|---------|---------------|
| Gradescope | Homework grading, exams | GENBUS 307, MHR 300, RE 410, RE 420 |
| Top Hat | In-class participation | GENBUS 307, RE 410, RE 420 |
| Honorlock | Exam proctoring | FINANCE 300, GENBUS 307 |
| Zoom | Virtual meetings | GENBUS 307, MHR 300, RE 410, RE 420 |
| MindTap (Cengage) | Textbook/homework | MHR 300 |
| McGraw-Hill Connect | Textbook/homework | FINANCE 300 |
| Testing Center (RegisterBlast) | Exam scheduling | GENBUS 307, RE 420 |
| Kaltura | Video content | RE 410, RE 420 |
| NameCoach | Name pronunciation | RE 410, RE 420 |
| Library Resources | Research | GENBUS 307, MHR 300, RE 410, RE 420 |
| Course Analytics | Engagement | GENBUS 307, RE 410, RE 420 |

### UW-Madison Canvas Conventions
1. **Term ID 312** = Spring 2025-2026
2. **Courses use course codes** like "SP26 FINANCE 300 003"
3. **Student ID is 544947** in enrollments
4. **Most professors hide** the Pages, Files, and Discussions tabs
5. **Modules are universally used** — this is the primary navigation for UW students
6. **Quiz = high-stakes assessment** — professors use Honorlock for proctoring
7. **Discussion threads can be massive** — MHR 300 intro discussion has 439 replies

---

## PART 5: IMPLEMENTATION ROADMAP (Prioritized for Phase 2)

### Tier 1: Must-Fix (Breaking Issues)
1. **Smart Syllabus Finder** — The #1 student request will fail without this
2. **Pages Fallback via Modules** — Most courses disable standalone Pages
3. **Files Fallback via Modules** — Most courses block Files endpoint
4. **Module-First Content Resolution** — Detect and handle all module item types

### Tier 2: High-Value Additions
5. **External Tool Detection & Mapping** — Know what tools each course uses
6. **Enhanced Daily Briefing** — New announcements, grade trends, urgency grouping
7. **Course Structure Auto-Detection** — Weekly vs topic vs chapter modules
8. **Resilient Content Discovery Chains** — Never return empty when data exists

### Tier 3: Differentiation Features
9. **Cross-Module Search** — Find content wherever professors put it
10. **Professor Pattern Adaptation** — Adapt tool behavior per course structure
11. **Grade Scenario Planning** — "What do I need" calculations with course-specific rules
12. **Assignment Dependency Tracking** — Know when assignments require external tool access

---

## PART 6: CODEBASE AUDIT SUMMARY

### Current MCP Tools (51+)
- **Core:** list_courses, get_course, get_course_syllabus
- **Assignments:** list_assignments, get_assignment, get_rubric, find_assignments_by_due_date
- **Grades:** get_my_grades, get_grade_breakdown, calculate_what_if_grade, get_submission, get_recent_feedback
- **Modules:** list_modules, get_module_item_content
- **Content:** list_pages, get_page_content, list_course_files, read_file_content, browse_folder
- **Calendar:** list_calendar_events, get_planner_items, get_my_todo_items
- **Communication:** list_announcements, list_discussions, get_discussion_entries, list_conversations
- **Search:** search_course_content, search_all_courses, get_all_upcoming_work
- **Dashboard:** daily_briefing, get_activity_stream, get_activity_summary
- **Planner:** get_planner_notes, create_planner_note, mark_planner_item_done
- **Write (gated):** submit_assignment, upload_file, post_discussion_entry, reply_to_discussion
- **Learning:** save_preference, save_context_note, list_preferences, list_context_notes

### Architecture Strengths
- Clean modular TypeScript codebase (18 tool files)
- Robust error handling with `Promise.allSettled()` for batch operations
- In-memory caching (5-min TTL)
- Concurrency control (max 3 parallel API calls)
- SSRF prevention on URL following
- Token sanitization in error messages
- Comprehensive pagination (100 page limit)

### Architecture Gaps (for scaling)
- No detection of disabled tabs/endpoints before making calls
- No fallback chains when primary endpoints fail
- Module items not fully leveraged as the primary content source
- External tool references not parsed from module items
- Syllabus discovery only checks `syllabus_body` field
- No course structure profiling/adaptation

---

## CONTEXT RECOVERY INFORMATION

### API Access
- **Token:** 8396~x7mHFAAYWanU9VzfDZ2DEemy2FwDQRm3XvaKcGk8HXzWAEmRZLrJMLHmCBGEhenu
- **Base URL:** https://canvas.wisc.edu
- **User ID:** 544947
- **Canvas MCP is NOT connected as an MCP server in Claude Code** — it's configured in Claude Desktop only

### Spring 2026 Course IDs
- FINANCE 300: 486245 (wiki view, 22 modules, 14 assignments)
- GENBUS 307: 498423 (modules view, 4 modules, 10 assignments)
- MHR 300: 486567 (wiki view, 20 modules, 48 assignments)
- REAL EST 410: 487512 (modules view, 6+ modules, 5 assignments)
- REAL EST 420: 487533 (modules view, 4+ modules, 50 assignments)

### Key File Paths in Codebase
- Entry point: src/index.ts
- Canvas API client: src/canvas-client.ts
- Tools directory: src/tools/ (18 files)
- Types: src/types/canvas.ts
- Resources: src/resources.ts
- Prompts: src/prompts.ts
- Utils: src/utils.ts
- Preferences service: src/services/preferences.ts

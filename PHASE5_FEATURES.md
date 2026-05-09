# Phase 5: Next-Level Features

> Brainstormed 2026-02-10 | 15 ideas evaluated, top 5 selected
> Status: **Planning** | Target: v4.0.0

---

## Feature 1: `build_exam_study_guide` — Exam Prep Aggregator

**Priority: #1 | Wow: 5/5 | Complexity: High**

### What it does
Given a course ID and an upcoming exam (by assignment ID or keyword like "Midterm 2"), crawls backward through the course timeline to gather every relevant piece of content — lecture slides, readings, assignment descriptions, discussion topics, and prior quiz/exam content. Returns a structured study package: topic inventory, source map (which file/page covers which topic), full extracted text organized chronologically, and flags for topics where you scored below average (weak areas).

### Pain point
Students spend 30-60 minutes just *finding* what they need to study. They click through modules, scroll through announcements looking for "exam 2 covers chapters...", and dig up old assignments. This is especially painful in courses like MHR 300 (48 assignments, 20 modules) and FINANCE 300 (22 modules).

### Technical approach
- Fetch assignment details + rubric for the exam
- Infer coverage window: module boundaries between last exam and this one, or syllabus text, or user-provided date range
- Walk all modules in the coverage window via `list_modules` + `get_module_item_content`
- Extract text from all linked files via `read_file_content`
- Pull related assignment descriptions and your scores from `list_assignments` (with submissions)
- Cross-reference rubric criteria with module content for topic-to-source mapping
- Highlight weak areas using `score_statistics` or per-group averages
- New file: `src/tools/exam-prep.ts`

### Status
- [ ] Design coverage-window inference logic
- [ ] Implement module-range traversal
- [ ] Build topic-to-source mapping
- [ ] Add weak-area detection from past scores
- [ ] Test with FINANCE 300 and MHR 300

---

## Feature 2: `analyze_submission_patterns` — Personal Performance Forensics

**Priority: #2 | Wow: 5/5 | Complexity: Medium**

### What it does
Analyzes your complete submission history across all courses to surface hidden patterns: do you score worse on late submissions? Do grades trend up or down over the semester? Which day-of-week do you submit, and does it correlate with scores? How many total points lost to late penalties? Produces a data-driven "academic self-portrait" with specific, actionable findings.

### Pain point
Students have no way to see their own behavioral patterns. Canvas shows grade-by-grade but never says "you've lost 47 points to late penalties this semester" or "your scores on assignments submitted before 6pm are 12% higher than ones submitted after midnight." The pain point is invisible self-sabotage.

### Technical approach
- `GET /courses/:id/assignments?include[]=submission` across all courses — gives `submitted_at`, `due_at`, `score`, `late`, `points_deducted`, `missing`, `attempt`
- `GET /courses/:id/assignment_groups?include[]=assignments&include[]=submission` for weight context
- Compute submission-before-deadline margins from `submitted_at` vs `due_at`
- Group scores by day-of-week, time-of-day, early/on-time/late buckets
- Track per-course and per-assignment-group trends over time
- Calculate total late penalty points lost
- Use `score_statistics` include for percentile-relative analysis
- New file: `src/tools/submission-patterns.ts`

### Status
- [ ] Design pattern categories (timing, lateness, trends, etc.)
- [ ] Implement cross-course submission aggregation
- [ ] Build trend analysis (scores over time)
- [ ] Add late penalty accounting
- [ ] Test with real submission data across 5 courses

---

## Feature 3: `forecast_workload` — Cross-Course Collision Detector

**Priority: #3 | Wow: 4/5 | Complexity: Medium**

### What it does
Scans all enrolled courses for upcoming assignments within a configurable window (default 14 days), identifies "collision zones" where multiple high-stakes assignments stack up within 24 hours, and produces a day-by-day workload heatmap. Weighs assignments by points possible and submission type complexity. Outputs a prioritized triage plan: what to start first, what has the most grade impact, and where the breathing room is.

### Pain point
The #1 cause of academic meltdowns isn't one hard assignment — it's three medium ones due the same day across different courses. The existing `daily_briefing` shows upcoming work but doesn't do conflict analysis or tell you "Tuesday has 3 assignments worth 180 total points and Wednesday has zero; shift your effort."

### Technical approach
- `GET /courses/:id/assignments?include[]=submission&bucket=upcoming` across all courses
- `GET /calendar_events?context_codes[]=course_X&type=assignment` for cross-course calendar view
- Weight assignments by `points_possible`, `submission_types` complexity, and assignment group weight
- Cluster by due date, flag collision zones (3+ items within 24h, or 2+ high-stakes items)
- Generate work-back schedule with suggested start dates
- Estimate effort by assignment type: quiz=30min, essay=3hr, discussion=20min, file upload=2hr
- New file: `src/tools/forecast.ts`

### Status
- [ ] Design collision detection algorithm
- [ ] Implement cross-course assignment aggregation
- [ ] Build effort estimation heuristics
- [ ] Add work-back schedule generation
- [ ] Test during a busy midterm week

---

## Feature 4: `map_assignment_to_content` — "Which Lecture Was That?"

**Priority: #4 | Wow: 4/5 | Complexity: Medium-High**

### What it does
Given a specific assignment, reverse-engineers which course materials are relevant. Reads the assignment description, extracts key terms and concepts, then searches backward through modules to find matching lecture slides, readings, pages, and discussions. Returns a ranked list of related materials with relevance scores, direct file IDs for immediate access, and a summary of what each source covers.

### Pain point
Students constantly ask "what lectures do I need to review for this homework?" Professors rarely spell it out explicitly — the assignment says "apply the CAPM model" and the student has to remember which of 12 lecture decks covered CAPM. Especially painful in FINANCE 300 (22 modules) where content volume makes manual cross-referencing impractical.

### Technical approach
- `get_assignment` for description + rubric (key terms source)
- `list_modules` with items to get all module content titles
- Two-pass approach:
  - Pass 1: Match against titles and descriptions (cheap, fast)
  - Pass 2: `read_file_content` on top candidates for deep keyword matching
- `search_course_content` for initial keyword hits
- Leverage existing `extractLinkedFiles` for files already referenced in the assignment
- Score by: exact title match > description match > file content match
- New file: `src/tools/content-map.ts`

### Status
- [ ] Design keyword extraction from assignment descriptions
- [ ] Implement two-pass module content search
- [ ] Build relevance scoring algorithm
- [ ] Add rubric-criteria-to-content mapping
- [ ] Test with FINANCE 300 and REAL EST 410 assignments

---

## Feature 5: `analyze_feedback_patterns` — Instructor Feedback Intelligence

**Priority: #5 | Wow: 4/5 | Complexity: Medium**

### What it does
Pulls all submission comments and rubric assessments across a course's graded assignments, then analyzes them for recurring themes. Identifies which rubric criteria you consistently lose points on, what language instructors repeat in comments, your score trajectory per assignment group, and whether scores improve after receiving specific feedback types. Turns scattered per-assignment feedback into a consolidated "here's what your professors keep telling you" summary.

### Pain point
Students read feedback in isolation and forget it. They don't notice that three different assignments all said "your analysis is surface-level" because each comment is buried in a different submission page. Feedback fragmentation means the signal is there but never aggregated.

### Technical approach
- `GET /courses/:id/assignments/:id/submissions/self?include[]=submission_comments&include[]=rubric_assessment` — batch across all graded assignments
- Rubric assessments return per-criterion scores: `{ criterion_id: { points, comments, rating_id } }`
- Map criterion IDs back to assignment rubric definitions for human-readable labels
- Track per-criterion score trends over time
- Extract recurring keywords/phrases from `submission_comments[].comment`
- Use `runWithConcurrency` to batch-fetch submissions (limit=3)
- New file: `src/tools/feedback-analysis.ts`

### Status
- [ ] Design feedback aggregation schema
- [ ] Implement batch submission comment fetching
- [ ] Build rubric criterion trend tracking
- [ ] Add comment theme extraction
- [ ] Test with MHR 300 (48 assignments, likely rich rubric data)

---

## Honorable Mentions (Future Consideration)

| Feature | Description | Wow |
|---------|-------------|-----|
| `forecast_final_grades` | Semester-end grade simulator — projected final if you maintain current performance, grade ceiling/floor, minimum averages needed for A/B/C | 4/5 |
| `get_course_topic_index` | Auto-generated course index — every concept/term across all modules with source pointers | 4/5 |
| `detect_changes` | Cross-course change tracker — new announcements, grade postings, deadline changes, with weekly digest | 3/5 |
| `deep_search` | Unified semantic search across all content types in all courses simultaneously | 4/5 |
| `submit_assignment` | Full submission workflow — rubric pre-check, file validation, Canvas API submission | 4/5 |
| `analyze_discussion_participation` | Discussion participation report — post count, timing, graded discussions needing attention | 3/5 |
| `compare_courses_workload` | Cross-course workload analysis with "hell week" prediction | 3/5 |

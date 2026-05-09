# Research: What Would Make a Best-in-Class Canvas MCP

> Synthesis from 5 parallel research agents (importance detection, ungraded work, backend logic, Supabase, Canvas API). Use this as a product and architecture roadmap.

---

## Executive Summary

To make this Canvas MCP **unbelievably flushed out**, focus on:

1. **Importance & prioritization** — Weight by assignment-group %, due date, and late policy; tier by urgency then sort by grade impact; parse syllabus for fallback weights.
2. **“Should do” work** — Surface readings, participation, and module-required prep (not just submitted assignments) using Modules API completion requirements and syllabus language.
3. **Backend-derived state** — Work items with risk flags, workload per week, grade projections, syllabus→content links; tiered caching and write-through invalidation.
4. **Supabase** — Use for preferences/sync state and optional background jobs; **do not** store raw Canvas data or tokens; start with device-id, add optional auth only if you need cross-device.
5. **Canvas API strategy** — Planner for “upcoming work,” Assignments for detail and grading policy, Modules for progress and “what’s left”; respect rate limits and fallbacks for disabled pages/files.

---

## 1. Importance Detection & Prioritization

### Metrics to use

- **Assignment group weight** — When `apply_assignment_group_weights` is true: `(points_possible / group_total_points) × group_weight` = grade impact. Prefer this over raw points.
- **Points possible** — Normalize per course when weights aren’t used.
- **Rubric** — Use rubric total and criterion points for “within-assignment” importance and “what’s graded.”
- **Syllabus** — Parse “Homework 20%, Exams 50%” etc. as fallback or validation for group weights.
- **Late policy** — `GET /courses/:id/late_policy` and submission `late`, `points_deducted` to compute “effective max if I submit today” and to boost urgency for high-penalty work.

### Combining urgency and importance

- **Two factors:** importance (grade impact) and urgency (time to due / penalty).
- **Tiered sort (recommended):**  
  (1) Overdue / due in 24–48h → (2) Due this week → (3) Later. Within each tier, sort by importance.
- **Optional scalar:** `priority_score = importance × (1 + k / (days_until_due + 1))` for a single “what to do next” list.
- **Avoid** “due soonest first” only — it over-prioritizes low-value, soon-due work. Prefer “urgent and important” first (Eisenhower-style).

### Syllabus for importance

- Parse grade breakdown (regex + section headers: “Grading”, “Grade Breakdown”).
- Map parsed categories to assignment groups by name.
- Use for: fallback weight when API weights missing, validation, and user-facing copy (“20% of your grade per syllabus”).

### Concrete recommendations

1. **Importance score** — Grade impact from group weight (or syllabus %), respect `omit_from_final_grade` and drop rules.
2. **Urgency factor** — Days/hours until due; boost when late policy is strict.
3. **“What to do next”** — Tier by time, then by importance; return top N with labels (“Overdue,” “Due soon,” “High impact”) and a one-line reason.
4. **Syllabus-backed importance** — Parse syllabus; use parsed % when Canvas weights missing; expose “% of grade (syllabus)” in tools/resources.
5. **Late-policy-aware ordering** — Fetch late policy; boost priority for high per-day deduction; optionally show “effective max % if you submit today” for overdue items.

---

## 2. Detecting “Should Do” Work (Ungraded / Prep)

### Categories

- **Readings & view-only** — Module items with `must_view` (File, Page, ExternalUrl). No submission; “done” = viewed.
- **Discussion participation** — `must_contribute` or assignment with `submission_types: discussion_topic`; may be graded or ungraded.
- **Ungraded quizzes** — `grading_type: not_graded` or `omit_from_final_grade`; prep or participation.
- **Module-required prep** — Any item with `CompletionRequirement` (must_view, must_contribute, must_mark_done, etc.) that isn’t a graded assignment.
- **Syllabus-referenced** — “Read Ch. 3,” “complete before class” — inferred from syllabus text, matched to module items/files.

### Data sources

- **Modules API** — `include=items,content_details`, optionally `student_id` for progress. Use for completion_requirement, completed, sequence, prerequisites.
- **Assignments** — `grading_type`, `omit_from_final_grade`, `submission_types` to separate graded vs ungraded.
- **Planner** — Single timeline; enrich with “graded vs do” and workload class.
- **Syllabus** — Parse for “required reading,” “participation,” “before class,” “by Week X.”

### Recommendations

1. **Full workload feed** — Merge modules (items + completion_requirement), assignments, syllabus; classify: graded, ungraded, required view, required contribution, syllabus-only.
2. **Completion as signal** — Treat any item with `completion_requirement` as “should do” until completed; rank by incomplete > complete, then module order / unlock.
3. **Syllabus importance** — Match syllabus phrases to module items by title; boost syllabus-matched items; add “suggested by” date when possible.
4. **Prep vs graded** — Tag and expose “Prep & participation” (readings, must_view, must_contribute, ungraded quizzes) separately from “Graded work.”
5. **Unified view** — One “full workload” tool/resource: upcoming graded work + incomplete “should do” module items + syllabus-derived suggestions, with simple priority.

---

## 3. Backend Logic & Data Architecture

### Derived entities

- **Per-week workload** — Sum effort by type (quiz, essay, discussion), weighted by points/group weight; “hell weeks” and collision zones.
- **Unified deadline view** — Assignments + calendar + (where possible) external-tool dates, with course and risk context.
- **Grade projections & risk** — “Minimum needed on remaining for target grade,” ceiling/floor; risk flags: overdue, missing, due soon with no submission, high weight + low score.
- **Work item model** — Single entity with risk flags, assignment-group weight, related content links; used by briefings, search, reminders.
- **Academic self-portrait** — Submission patterns (late rate, typical lead time, points lost to penalties); recurring weak rubric criteria and comment themes.

### Syllabus + files integration

- **Course policy layer** — Parsed from syllabus: group weights, participation %, late policy, drop rules, key dates. “Participation 10%” → weight discussions in workload/grade views.
- **Syllabus → content links** — Match “read Ch. 3” to module items/files; store syllabus→module_item/file links for “readings for this week” and “content for this assignment.”
- **Assignment–content mapping** — Related content from: same module, keywords in description/rubric, syllabus schedule (e.g. “Week 5: CAPM” → link CAPM assignment to Week 5 materials). Expose as `related_readings` / `related_lectures`.
- **External tools** — Detect and label LTI items (Top Hat, MindTap) so workload and grade views don’t double-count or under-count.

### Caching & freshness

- **Stable (10–30 min):** Course list, assignment groups, syllabus, module structure.
- **Semi-dynamic (3–5 min):** Assignments, planner, calendar; or invalidate on “my activity.”
- **Volatile (1–3 min or on write):** Submissions, grades, comments.
- **Invalidation** — TTL + explicit invalidation on any write (submit, mark done, post). Per-key TTLs by tier. Request coalescing for identical in-flight requests to save quota.

### Personalization

- **Preferences** — Reminder lead time, quiet hours, default/priority courses, grade goals. Use in “what to show first,” “when to remind,” “on track vs at risk.”
- **Past behavior** — Use submission patterns to nudge (“you often submit the night before; due in 24h”), estimate completion, and feed “academic self-portrait” tools.

### Concrete recommendations

1. **Work item / deadline model** — Risk flags, group weight, related content; built in backend/tools; consumed by briefings, search, reminders.
2. **Course policy from syllabus** — Parsed weights, participation %, late policy, drop rules; link syllabus mentions to module items/files; weight discussions and drive “readings for this week.”
3. **Tiered cache + write-through** — Long TTL for syllabus/course/structure; medium for assignments/planner; short for submissions/grades; clear on write.
4. **Preferences** — Reminder lead time and (optional) target grade; single “reminder” and “on track” logic using same work-item and grade-projection data.
5. **Summary tools/resources** — e.g. “workload and risk this week,” “grade snapshot and projection”; run derived logic once, cache with short TTL, return structured summary so the model doesn’t chain many tools.

---

## 4. Supabase as Backend

### Good use cases

- **User preferences & context** — Cloud-backed prefs, cross-device sync, backup. Low risk; user-owned, non-sensitive.
- **Sync state** — Last-sync timestamps, cursors, “last seen” IDs per user/course for incremental pulls and rate-limit friendliness.
- **Optional analytics** — Opt-in, minimal PII, usage/errors/latency for product improvement.
- **Background jobs** — Job definitions and (optionally) results for periodic sync, digests; MCP stays request/response.

### What not to do (at first)

- **Don’t store raw Canvas payloads** — Freshness, FERPA, token safety. Revisit only for specific high-cost caches with short TTL and clear retention.
- **Never store Canvas token in Supabase** — Token in env or local secure storage only; Supabase sees only device/user id and synced metadata.

### Auth

- **Default: device id** — Stable id in `~/.canvas-mcp/` as Supabase “user” for prefs and metadata; no login.
- **Optional: Supabase Auth** — Only if you need cross-device (e.g. magic link); associate device with `auth.uid()`; RLS per user. Canvas token stays local.

### When to add Supabase

- **Add when:** Cloud prefs, sync state, scheduled/background work, or optional analytics.
- **Stay stateless when:** Single device is enough, local prefs suffice, no cross-device or background features.

### Recommendations

1. **Default stateless** — Canvas source of truth; token in env; prefs on disk. Add Supabase only for a clear feature (prefs sync, sync state, jobs, analytics).
2. **Supabase for optional features first** — Prefs and (optionally) sync state, keyed by device id or optional Supabase user id. No Canvas data in DB initially.
3. **Auth: device id now, optional login later** — Add Supabase Auth only when you need cross-device identity.
4. **Background work: separate worker** — Use Supabase as queue/results (e.g. pg_cron + Edge Functions); MCP still calls Canvas on demand; can read from Supabase for precomputed views later.
5. **No raw Canvas cache in v1** — Revisit only for specific high-cost operations, short TTL, clear retention, FERPA-aware.

---

## 5. Canvas API Strategy

### Roles

- **Planner** — Primary for “upcoming work” and “am I done?” Cross-course, incomplete/complete, student overrides. Use for one “what’s due” view.
- **Assignments (per course)** — Full detail, rubric, submission types, assignment-group and weight context. Use for course-specific and “what’s graded.”
- **Calendar** — Non-assignment events. Use when the question is “everything on my calendar.”
- **Modules** — Structure, completion_requirement, progress. Use for “what’s left,” “next item,” and fallbacks when Pages/Files are disabled.

### Underused areas

- Assignment groups with `group_weight` and drop rules — “what counts toward my grade.”
- Module item `content_details` and `completion_requirement` — due/unlock/lock, requirement type, completed.
- Rubric on assignment — always when explaining “what’s graded” and how to score well.

### Gotchas

- **Pagination** — `per_page=100`, follow `Link` for next, enforce max pages/items.
- **Rate limits** — Quota-based; use `X-Rate-Limit-Remaining`, back off on 403, batch and cache.
- **Missing data** — Pages/Files can be disabled; discover via module items and module-item content endpoint. Syllabus may be in a page/file, not `syllabus_body`. LTI content not in API — label and link out.

### Recommendations

1. **Planner = single source for “upcoming work”** — One tool returning incomplete planner items in date range; use assignments/calendar only for course-specific or event-specific questions.
2. **Grading policy view** — From assignment groups: names, weights, drop rules, weights on/off; combine with rubrics for “what’s graded” and “how much each category matters.”
3. **Progress from modules** — Modules with `items` and `content_details`; use completion_requirement and completed for “next item” and “what’s left.”
4. **Fallbacks for content** — If Pages/Files fail, resolve via module items and module-item content.
5. **Rate limits and pagination** — `per_page=100`, cap pages/items, retry with backoff on 403.

---

## Implementation Priority (Suggested)

| Priority | Area | First steps |
|----------|------|-------------|
| 1 | Importance & prioritization | Assignment-group weight + due-date tiering; one “what to do next” tool with reason; optional syllabus parsing for % |
| 2 | Work item / risk model | Single work-item shape with risk flags and grade impact; use in dashboard, search, reminders |
| 3 | “Should do” workload | Modules with completion_requirement; full workload feed (graded + prep); tag and expose “Prep & participation” |
| 4 | Syllabus + policy | Parse syllabus for grade breakdown and late policy; course policy layer; link syllabus to module items for readings |
| 5 | Caching | Tiered TTLs; invalidation on write; optional request coalescing |
| 6 | Summary tools | “Workload and risk this week,” “grade snapshot and projection” as tools/resources |
| 7 | Supabase (optional) | Prefs + sync state keyed by device id; optional auth and background jobs only if needed |

---

## Relation to Existing Work

- **PHASE5_FEATURES.md** — Exam study guide, submission patterns, etc. align with “academic self-portrait,” “related content,” and “workload/risk” from this research. Use this doc for *how* to weight, cache, and structure data; use Phase 5 for *which* features to ship first.
- **Current codebase** — Already has dashboard, planner, assignments, modules, grades, search, syllabus resources. This research says: add **derived** layer (importance, risk, workload, “should do”) and **syllabus+files** integration on top of existing tools.

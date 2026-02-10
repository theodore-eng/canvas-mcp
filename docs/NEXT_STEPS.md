# Next Steps — Canvas MCP Server

**Last updated**: 2026-02-10
**Current version**: v2.0

## Immediate Priorities

### 1. Retry Logic with Exponential Backoff
**Why**: Canvas API rate-limits at ~120 requests/minute. When daily_briefing or get_all_upcoming_work fires many parallel requests, some may get 429'd.

**Plan**:
- Add a `requestWithRetry()` wrapper in canvas-client.ts
- Retry on 429 (Too Many Requests) and 5xx errors
- Exponential backoff: 1s → 2s → 4s, max 3 retries
- Honor `Retry-After` header from Canvas

### 2. User Timezone Support
**Why**: Canvas stores dates in UTC. "Due today" calculations use server time, which may be wrong for the user.

**Plan**:
- Read user timezone from `getUserProfile()` on startup
- Cache it in the singleton client
- Use it for all "today/tomorrow" calculations in dashboard, planner, search
- Fall back to UTC if unavailable

### 3. Course Context Cache
**Why**: Many tools call `listCourses()` independently (dashboard, grades, search, calendar). This wastes API calls and slows everything down.

**Plan**:
- Add a simple in-memory cache in canvas-client.ts with TTL (5 minutes)
- Cache course list, user profile, and other stable data
- Invalidate on explicit refresh or TTL expiry
- Reduces API calls significantly for tools that run in sequence

## Feature Ideas

### 4. Conversation Memory / Learning
**Why**: Claude forgets your courses and preferences between conversations.

**Plan**:
- Create a `~/.canvas-mcp/preferences.json` file
- Store: frequently accessed courses, preferred timezone, common queries
- Load on startup and expose as an MCP resource (`canvas://preferences`)
- Update after each session with new patterns
- Lets Claude say "I see you usually check CS 400 and MATH 234" without asking

### 5. Grade Trend Tracking
**Why**: Students want to know if their grade is improving or dropping.

**Plan**:
- Store grade snapshots in `~/.canvas-mcp/grade-history.json`
- Record grades each time `get_my_grades` is called
- Add a `get_grade_trends` tool that shows change over time
- "Your CS 400 grade went from 87% to 91% over the last 2 weeks"

### 6. Smart Notifications / Digest
**Why**: Canvas has a lot of noise. Students want to know what actually matters.

**Plan**:
- Add a `get_whats_new` tool that compares current state to last-known state
- Track: new announcements, new grades posted, new assignments published
- Store last-seen timestamps in `~/.canvas-mcp/state.json`
- Returns only genuinely new items since last check

### 7. Assignment Content Preparation
**Why**: User wants Claude to help prepare assignment content without auto-submitting.

**Plan**:
- Add a `prepare_assignment_draft` tool
- Takes assignment details + user instructions
- Returns formatted content ready to submit
- User reviews in Claude, then explicitly asks to submit (if ENABLE_WRITE_TOOLS is on)
- Could also save drafts locally in `~/.canvas-mcp/drafts/`

### 8. Quiz/Exam Preparation Assistant
**Why**: Students want help studying for specific exams.

**Plan**:
- Enhance `study_plan` prompt to automatically gather all relevant materials
- Scan module items for the relevant date range
- Read lecture notes, assignment descriptions, and page content
- Generate practice questions based on course material
- Track study progress in local storage

### 9. Multi-Course Dashboard Comparison
**Why**: Students juggle 4-6 courses and need to prioritize.

**Plan**:
- Add a `course_priority_report` tool
- Factors: upcoming deadlines, missing work, grade trajectory, points at stake
- "Focus on BIO 152 — you have a 50-point lab report due tomorrow and your grade is at 78%"

### 10. Canvas GraphQL Integration
**Why**: Canvas is adding more GraphQL endpoints. Some queries are more efficient via GraphQL.

**Plan**:
- Add a GraphQL client alongside REST
- Use for queries that benefit from selective field fetching
- Particularly useful for dashboard (one query vs many REST calls)
- Canvas GraphQL is at `/api/graphql`

## Technical Debt

- [ ] Add unit tests (at least for utils.ts and canvas-client.ts)
- [ ] Add integration test that verifies MCP protocol compliance
- [ ] Consider streaming for large file downloads instead of buffering
- [ ] Add PDF parsing timeout (AbortController around pdf-parse)
- [ ] Validate HTML entity numeric ranges in stripHtmlTags
- [ ] Add search term length limits across all tools
- [ ] Consider rate limiter in canvas-client.ts (token bucket pattern)
- [ ] Update @modelcontextprotocol/sdk when v2 stabilizes (registerTool/registerResource/registerPrompt API)

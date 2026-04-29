# Canvas MCP — Connect Claude to Canvas LMS

An MCP server that gives Claude full access to your Canvas LMS coursework. Ask about grades, deadlines, feedback, and more through natural conversation.

**Works with any university that uses Canvas** (Instructure). Just plug in your API token and school URL.

**Ask Claude things like:**
- "Give me my daily briefing"
- "What assignments do I have due this week?"
- "What grade do I need on the final to get an A?"
- "What did my professor say in the feedback?"
- "What's my grade in each class?"
- "Add a reminder to my planner for Friday"

---

## Setup (3 minutes)

### 1. Get Your Canvas API Token

1. Log in to Canvas
2. Click your **profile picture** → **Settings**
3. Scroll to **Approved Integrations**
4. Click **+ New Access Token**
5. Name it (e.g., "Claude") and click **Generate Token**
6. **Copy the token** — you won't see it again!

### 2. Install

```bash
git clone https://github.com/lucanardinocchi/canvas-mcp.git
cd canvas-mcp
npm install
npm run build
```

### 3. Add to Claude Desktop

Open Claude Desktop's config file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add this (or merge into existing config). Use the server key **`canvas-lms`** and an **absolute** path to `dist/index.js`:

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "node",
      "args": ["/FULL/PATH/TO/canvas-mcp/dist/index.js"],
      "env": {
        "CANVAS_API_TOKEN": "YOUR_TOKEN_HERE",
        "CANVAS_BASE_URL": "https://your-school.instructure.com"
      }
    }
  }
}
```

**Quick start (detailed):** For a full step-by-step runbook and troubleshooting, see **[docs/RUNBOOK_CLAUDE_DESKTOP.md](docs/RUNBOOK_CLAUDE_DESKTOP.md)** or **[CLAUDE_DESKTOP_SETUP.md](CLAUDE_DESKTOP_SETUP.md)**.

**Replace:**
- `/FULL/PATH/TO/canvas-mcp` — the folder where you cloned this repo
- `YOUR_TOKEN_HERE` — your Canvas API token from step 1
- `https://your-school.instructure.com` — your school's Canvas URL (check your browser URL bar when logged in)

### 4. Restart Claude Desktop

Quit completely (Cmd+Q / Alt+F4) and reopen. You should see Canvas tools available.

---

## What Can It Do?

### Daily Briefing
One command to see everything: today's events, upcoming deadlines, recent grades, announcements, and todo items. Just ask *"Give me my daily briefing"*.

### Grade Intelligence
- Current grades across all courses with letter grade breakdowns
- "What-if" grade calculator — see how future scores affect your grade
- Target grade calculator — find out what score you need on an assignment to hit your goal
- Grade deflation detection via class statistics

### Planner & Deadlines
- View your Canvas planner with all items organized by date
- Create personal reminders and notes
- Get upcoming work across all courses in one view
- Scan for untracked work (readings, prep) that doesn't show up as assignments

### Content & Search
- Read module content, pages, files, and announcements
- Search across all courses at once
- Browse course files and extract text from PDFs, Word docs, etc.
- Read discussion boards and conversation threads

### Prompt Templates
Pre-built workflows available as slash commands in Claude:
- `/weekly_review` — Comprehensive weekly coursework review
- `/study_plan` — Create a study plan for an exam or topic
- `/assignment_helper` — Understand an assignment and how to approach it
- `/quick_check` — Fast scan of what needs attention right now
- `/grade_analysis` — Detailed grade pattern analysis
- `/catch_up` — Get up to speed after time away

---

## Safety & Write Permissions

### Always On (Safe)
- **All read operations** — courses, grades, assignments, files, etc.
- **Planner notes** — create/update/delete personal reminders (only visible to you)
- **Mark items complete** — personal planner tracking
- **Preferences** — save personal notes and context locally

### Opt-In Write Tools (ENABLE_WRITE_TOOLS=true)
Disabled by default. To enable, add to your config:
```json
"env": {
  "CANVAS_API_TOKEN": "...",
  "CANVAS_BASE_URL": "...",
  "ENABLE_WRITE_TOOLS": "true"
}
```

When enabled:
- `submit_assignment` — Submit text or URL to an assignment
- `upload_file` — Upload a file for submission
- `post_discussion_entry` — Post to a discussion
- `reply_to_discussion` — Reply to a discussion post

All write tools include explicit warnings so Claude knows these actions are visible to instructors.

---

## All 51 Tools

### Dashboard & Profile
| Tool | Description |
|------|-------------|
| `daily_briefing` | Complete daily overview — events, deadlines, grades, announcements, todos |
| `get_my_profile` | Your Canvas profile info |
| `setup_semester` | Initialize semester with organized folder structure |

### Courses
| Tool | Description |
|------|-------------|
| `list_courses` | List enrolled courses |
| `get_course` | Course details |
| `get_course_syllabus` | Course syllabus (with module-scanning fallback) |
| `get_course_tools` | External tools (McGraw-Hill, Gradescope, etc.) |

### Assignments & Submissions
| Tool | Description |
|------|-------------|
| `list_assignments` | List assignments with filters |
| `get_assignment` | Full assignment details + rubric |
| `get_submission` | Your submission and feedback |
| `submit_assignment` | Submit text or URL *(write tool)* |
| `upload_file` | Upload file for submission *(write tool)* |

### Grades & Analysis
| Tool | Description |
|------|-------------|
| `get_my_grades` | Grades across all courses |
| `get_grade_breakdown` | Detailed grade breakdown by assignment group with drop rules |
| `calculate_what_if_grade` | "What-if" — see how a future score affects your grade |
| `calculate_target_grade` | Find the score needed on an assignment to reach a target grade |
| `get_my_submission_status` | Missing/submitted work across all courses |
| `get_recent_feedback` | Recently graded work with scores and comments |

### Modules & Content
| Tool | Description |
|------|-------------|
| `list_modules` | Browse course modules |
| `get_module_item_content` | Read content of any module item (pages, files, assignments, etc.) |
| `list_announcements` | Course announcements |

### Pages
| Tool | Description |
|------|-------------|
| `list_pages` | List wiki pages |
| `get_page_content` | Read full page content |

### Files
| Tool | Description |
|------|-------------|
| `list_course_files` | Browse course files |
| `get_file_info` | File metadata |
| `read_file_content` | Extract text from PDFs, Word docs, etc. |
| `download_file` | Download a file to your computer |
| `list_course_folders` | Browse folder structure |
| `browse_folder` | Contents of a specific folder |

### Discussions
| Tool | Description |
|------|-------------|
| `list_discussions` | Discussion topics |
| `get_discussion_entries` | Read posts and replies |
| `post_discussion_entry` | Post to a discussion *(write tool)* |
| `reply_to_discussion` | Reply to a post *(write tool)* |

### Search
| Tool | Description |
|------|-------------|
| `find_assignments_by_due_date` | Assignments in a date range |
| `search_course_content` | Search modules and assignments |
| `search_all_courses` | Search across all courses |
| `get_all_upcoming_work` | Upcoming work across all courses |

### Planner
| Tool | Description |
|------|-------------|
| `get_planner_items` | Planner items organized by date |
| `get_planner_notes` | Your personal planner notes |
| `create_planner_note` | Create a personal reminder |
| `update_planner_note` | Update a planner note |
| `delete_planner_note` | Delete a planner note |
| `mark_planner_item_done` | Mark an item complete |

### Activity & Calendar
| Tool | Description |
|------|-------------|
| `get_activity_stream` | Chronological feed of recent activity |
| `get_activity_summary` | Activity counts by course |
| `list_calendar_events` | Calendar events across courses |
| `get_my_todo_items` | Canvas TODO list |

### Conversations
| Tool | Description |
|------|-------------|
| `list_conversations` | Inbox messages |
| `get_conversation` | Read a conversation thread |

### Untracked Work
| Tool | Description |
|------|-------------|
| `scan_untracked_work` | Find readings/prep work that aren't graded assignments |

### Preferences & Context
| Tool | Description |
|------|-------------|
| `save_preference` | Save a personal preference |
| `list_preferences` | View saved preferences |
| `delete_preference` | Remove a preference |
| `save_context_note` | Save a learning pattern note |
| `list_context_notes` | View context notes |
| `clear_old_context` | Clean up old context notes |

---

## Troubleshooting

### "Canvas tools not showing up"
1. Restart Claude Desktop completely (Cmd+Q / Alt+F4, then reopen)
2. Check that the path in your config points to `dist/index.js`
3. Verify `claude_desktop_config.json` is valid JSON (no trailing commas)

### "401 Unauthorized"
Your API token is invalid or expired. Generate a new one in Canvas Settings → Approved Integrations.

### "403 Forbidden"
You don't have access to that resource. Some courses restrict API access to files or pages — the server automatically falls back to module scanning when this happens.

### "Connection refused"
Check that `CANVAS_BASE_URL` is correct with no trailing slash.

---

## Security

**Keep your API token secret!**
- Never commit your token to git
- Don't share it with anyone
- Set an expiration date when creating tokens
- Revoke unused tokens in Canvas Settings → Approved Integrations

Your API token has the same access as your Canvas account.

---

## Development

```bash
npm install        # Install dependencies
npm run build      # Build once
npm run dev        # Watch mode (auto-rebuild)
npm run test       # Run tests
npm run lint       # Run linter
npm run check      # Lint + build + test
```

### Project Structure
```
canvas-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── canvas-client.ts      # Canvas API client (auth, pagination, caching, retries)
│   ├── utils.ts              # Formatting, HTML stripping, date parsing, file extraction
│   ├── prompts.ts            # MCP prompt templates (slash commands)
│   ├── resources.ts          # MCP resource definitions (canvas:// URIs)
│   ├── services/
│   │   ├── grade-utils.ts    # Grade deflation detection
│   │   └── preferences.ts    # User preference storage (~/.canvas-mcp/)
│   ├── tools/
│   │   ├── activity.ts       # Activity stream & summary
│   │   ├── assignments.ts    # Assignment listing & details
│   │   ├── calendar.ts       # Calendar events
│   │   ├── conversations.ts  # Inbox messages
│   │   ├── courses.ts        # Courses, syllabus, external tools
│   │   ├── dashboard.ts      # Daily briefing & profile
│   │   ├── discussions.ts    # Discussion boards
│   │   ├── feedback.ts       # Recent grading feedback
│   │   ├── files.ts          # File browsing & download
│   │   ├── folders.ts        # Folder browsing
│   │   ├── grade-analysis.ts # Grade breakdown, what-if, target grade
│   │   ├── grades.ts         # Grade overview & submission status
│   │   ├── modules.ts        # Module browsing & content reading
│   │   ├── pages.ts          # Wiki pages
│   │   ├── planner.ts        # Planner items & notes
│   │   ├── preferences.ts    # User preferences & context notes
│   │   ├── search.ts         # Cross-course search & upcoming work
│   │   ├── semester.ts       # Semester setup
│   │   ├── submissions.ts    # Submission viewing & submitting
│   │   ├── todos.ts          # Canvas TODO items
│   │   └── untracked.ts      # Untracked work scanner
│   └── types/
│       └── canvas.ts         # TypeScript types for Canvas API
├── tests/                    # Unit tests
├── dist/                     # Compiled output
├── package.json
└── tsconfig.json
```

---

## License

MIT

---

Built with [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) and [Canvas LMS REST API](https://canvas.instructure.com/doc/api/)

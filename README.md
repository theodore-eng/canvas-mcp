# Canvas LMS MCP Server for Claude

An MCP (Model Context Protocol) server that connects Claude to Canvas LMS, letting you manage your coursework through natural conversation.

**Ask Claude things like:**
- "Give me my daily briefing"
- "What assignments do I have due this week?"
- "Show me the rubric for my essay assignment"
- "What did my professor say in the feedback?"
- "Create a study plan for my biology exam"
- "What's my grade in each class?"
- "Add a reminder to my planner for Friday"

## Quick Start

### 1. Get Your Canvas API Token

1. Log in to Canvas
2. Click your **profile picture** → **Settings**
3. Scroll to **Approved Integrations**
4. Click **+ New Access Token**
5. Name it (e.g., "Claude") and click **Generate Token**
6. **Copy the token** - you won't see it again!

### 2. Install the MCP Server

```bash
# Clone this repository
git clone https://github.com/lucanardinocchi/canvas-mcp.git
cd canvas-mcp

# Install dependencies
npm install

# Build the project
npm run build
```

### 3. Configure Claude Desktop

Open Claude Desktop's config file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add (or merge) this configuration:

```json
{
  "mcpServers": {
    "canvas": {
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

**Replace:**
- `/FULL/PATH/TO/canvas-mcp` with the actual path where you cloned this repo
- `YOUR_TOKEN_HERE` with your Canvas API token
- `https://your-school.instructure.com` with your Canvas URL

**Common Canvas URLs:**
| University | Canvas URL |
|------------|------------|
| UW-Madison | `https://canvas.wisc.edu` |
| University of Sydney | `https://canvas.sydney.edu.au` |
| Generic Instructure | `https://canvas.instructure.com` |
| Your school | Check your browser when logged into Canvas |

### 4. Restart Claude Desktop

Quit Claude Desktop completely (Cmd+Q / Alt+F4) and reopen it.

You should now see Canvas tools available in Claude!

---

## What Can It Do?

### Daily Briefing (New!)
One command to see everything: today's events, upcoming deadlines, grades, announcements, and todo items. Just ask Claude *"Give me my daily briefing"*.

### Planner (New!)
- View your full Canvas planner with all items organized by date
- Create personal reminders and notes (only you can see these)
- Mark items as complete on your planner
- Filter by course, date range, or completion status

### Prompt Templates (New!)
Pre-built workflows available as slash commands in Claude:
- `/weekly_review` — Comprehensive weekly coursework review
- `/study_plan` — Create a study plan for an exam or topic
- `/assignment_helper` — Understand an assignment and how to approach it
- `/quick_check` — Fast scan of what needs attention right now

### Resources (New!)
Claude can reference your Canvas data as background context:
- `canvas://grades/summary` — Current grades across all courses
- `canvas://courses/active` — Your active courses
- `canvas://courses/{id}/syllabus` — Course syllabus
- `canvas://courses/{id}/assignments` — All assignments for a course

### Courses
- List all your enrolled courses
- Get course details and syllabi (auto-cleaned from HTML)

### Assignments
- List assignments (filter by upcoming, overdue, etc.)
- View full assignment details and instructions
- See rubrics and grading criteria
- Check your grades and submission status

### Discussions
- View discussion boards
- Read posts and replies (cleaned to readable text)
- Post new discussion entries (when write tools enabled)
- Reply to classmates (when write tools enabled)

### Submissions
- View instructor feedback and comments
- Submit text assignments directly (when write tools enabled)
- Upload files for submission (when write tools enabled)

### Search
- Find assignments by due date
- Search course content
- Get all upcoming work across all courses

### Files & Content
- Browse and search course files
- Read PDFs, text files, HTML, CSV, and Markdown directly
- Read module item content (pages, files, assignments, discussions)

---

## Safety & Write Permissions

The server has a tiered permission system:

### Always On (Safe)
- **All read operations** — viewing courses, grades, assignments, etc.
- **Planner notes** — create/delete personal reminders (only you see these)
- **Mark items complete** — personal planner tracking (doesn't submit anything)

### Opt-In (ENABLE_WRITE_TOOLS=true)
These are disabled by default. To enable, add to your config:
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

All write tool descriptions include explicit warnings so Claude knows these actions are visible to instructors/classmates.

---

## All Available Tools

### Core Tools
| Tool | What it does |
|------|--------------|
| `daily_briefing` | **Complete daily overview** — events, deadlines, grades, announcements, todos |
| `get_my_profile` | Your Canvas profile info |
| `list_courses` | List your enrolled courses |
| `get_course` | Get details about a specific course |
| `list_assignments` | List assignments (with filters) |
| `get_assignment` | Get full assignment details + rubric |
| `get_rubric` | Get grading rubric for an assignment |
| `get_submission` | View your submission and feedback |
| `get_my_grades` | Grades across all active courses |
| `get_my_submission_status` | Missing/submitted work across all courses |
| `list_modules` | Browse course modules |
| `get_module_item_content` | Read actual content of module items |
| `list_announcements` | Get course announcements |
| `list_pages` | List wiki/content pages |
| `get_page_content` | Read full page content (cleaned text) |
| `list_discussions` | View discussion topics |
| `get_discussion_entries` | Read discussion posts |
| `list_course_files` | Browse course files |
| `get_file_info` | Get file metadata |
| `read_file_content` | Extract text from files (PDFs, etc.) |
| `list_calendar_events` | Calendar events across courses |
| `get_my_todo_items` | Canvas TODO list |

### Planner Tools
| Tool | What it does |
|------|--------------|
| `get_planner_items` | View planner items organized by date |
| `get_planner_notes` | View your personal planner notes |
| `create_planner_note` | Create a personal reminder (safe) |
| `delete_planner_note` | Delete a personal note (safe) |
| `mark_planner_item_done` | Mark an item complete on your planner (safe) |

### Search Tools
| Tool | What it does |
|------|--------------|
| `find_assignments_by_due_date` | Find assignments in a date range |
| `get_upcoming_assignments` | Get work due in the next N days |
| `get_overdue_assignments` | Find past-due work |
| `search_course_content` | Search modules and assignments |
| `get_all_upcoming_work` | Upcoming work across ALL courses |

### Write Tools (opt-in)
| Tool | What it does |
|------|--------------|
| `submit_assignment` | Submit text or URL |
| `upload_file` | Upload a file for submission |
| `post_discussion_entry` | Post to a discussion |
| `reply_to_discussion` | Reply to a discussion post |

---

## Troubleshooting

### "Canvas tools not showing up"
1. Make sure you restarted Claude Desktop completely
2. Check that the path in your config is correct
3. Verify your `claude_desktop_config.json` is valid JSON

### "401 Unauthorized" errors
Your API token is invalid or expired. Generate a new one in Canvas settings.

### "403 Forbidden" errors
You don't have access to that resource. The course may have ended, or you're not enrolled.

### "Connection refused" or network errors
Check that your `CANVAS_BASE_URL` is correct (no trailing slash).

---

## Security Notes

⚠️ **Keep your API token secret!**
- Never commit your token to git
- Don't share your token with others
- Set an expiration date when creating tokens
- Revoke tokens you no longer use (Canvas Settings → Approved Integrations)

Your API token has the same access as your Canvas account - anyone with it can view your grades, submit assignments, etc.

---

## Development

```bash
# Install dependencies
npm install

# Build once
npm run build

# Watch mode (auto-rebuild on changes)
npm run dev
```

### Project Structure
```
canvas-mcp/
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── canvas-client.ts   # Canvas API wrapper
│   ├── utils.ts           # Shared utilities (HTML stripping, PDF parsing, etc.)
│   ├── prompts.ts         # MCP prompt templates
│   ├── resources.ts       # MCP resource definitions
│   ├── tools/             # Tool implementations
│   │   ├── assignments.ts
│   │   ├── calendar.ts
│   │   ├── courses.ts
│   │   ├── dashboard.ts   # Daily briefing & profile
│   │   ├── discussions.ts
│   │   ├── files.ts
│   │   ├── grades.ts
│   │   ├── modules.ts
│   │   ├── pages.ts
│   │   ├── planner.ts     # Planner items, notes, overrides
│   │   ├── search.ts
│   │   ├── submissions.ts
│   │   └── todos.ts
│   └── types/
│       └── canvas.ts      # TypeScript types
├── dist/                  # Compiled output
├── package.json
└── tsconfig.json
```

---

## Contributing

Contributions welcome! Feel free to:
- Report bugs
- Suggest new features
- Submit pull requests

---

## License

MIT - Use it however you want!

---

## Acknowledgments

Built with:
- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Canvas LMS REST API](https://canvas.instructure.com/doc/api/)

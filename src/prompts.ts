import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * Register MCP Prompt templates.
 *
 * Prompts are reusable interaction templates that Claude can use to provide
 * structured, high-quality responses for common student workflows.
 * They appear as slash commands in Claude Desktop.
 */
export function registerPrompts(server: McpServer) {

  // Weekly review prompt — gives Claude a structured approach to reviewing the week
  server.prompt(
    'weekly_review',
    'Get a comprehensive weekly review of all your coursework, deadlines, grades, and what to focus on',
    {
      focus: z.enum(['deadlines', 'grades', 'everything']).optional()
        .describe('What to focus on in the review'),
    },
    async ({ focus }) => {
      const focusInstruction = focus === 'deadlines'
        ? 'Focus primarily on upcoming deadlines and what needs to be submitted.'
        : focus === 'grades'
          ? 'Focus primarily on grades, scores, and feedback across courses.'
          : 'Give a complete overview covering deadlines, grades, announcements, and recommendations.';

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Please give me a thorough weekly review of my Canvas coursework. ${focusInstruction}

Use these tools to gather information:
1. Call daily_briefing first for a complete overview
2. Call get_my_grades for detailed grade information
3. Call get_my_submission_status to check for missing/overdue work
4. Call get_all_upcoming_work with days_ahead=14 for a two-week lookahead

Then organize your response into clear sections:
- **This Week's Priorities** — what needs attention right now
- **Upcoming Deadlines** — organized by date
- **Grade Summary** — current standing in each course
- **Missing/Overdue Work** — anything that needs to be addressed
- **Recommendations** — what to focus on and any time management tips

Be specific with dates, course names, and point values. If something is urgent, make it clear.`,
            },
          },
        ],
      };
    }
  );

  // Study planning prompt
  server.prompt(
    'study_plan',
    'Create a study plan for an upcoming exam or assignment based on course materials',
    {
      course_id: z.string().describe('The course ID to create a study plan for'),
      topic: z.string().optional().describe('Specific topic or exam to study for'),
    },
    async ({ course_id, topic }) => {
      const topicInstruction = topic
        ? `I need to study for: ${topic}`
        : 'Help me figure out what to study based on upcoming assignments and recent modules.';

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `I need help creating a study plan for course ${course_id}. ${topicInstruction}

Please:
1. Call list_modules for course ${course_id} to see the course structure
2. Call list_assignments for course ${course_id} with bucket "upcoming" to see what's coming
3. If there are specific modules or pages relevant to the topic, use get_module_item_content or get_page_content to review the material

Then create a study plan that includes:
- **What to study** — key topics and materials
- **Resources available** — relevant files, pages, and modules in Canvas
- **Suggested schedule** — how to break up the studying
- **Key concepts** — important things to focus on based on the course materials
- **Practice suggestions** — how to test understanding`,
            },
          },
        ],
      };
    }
  );

  // Assignment helper prompt
  server.prompt(
    'assignment_helper',
    'Get help understanding an assignment — what\'s expected, rubric breakdown, and how to approach it',
    {
      course_id: z.string().describe('The course ID'),
      assignment_id: z.string().describe('The assignment ID'),
    },
    async ({ course_id, assignment_id }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Help me understand and plan for assignment ${assignment_id} in course ${course_id}.

Please:
1. Call get_assignment for course ${course_id}, assignment ${assignment_id} with include_rubric=true
2. Call get_submission for course ${course_id}, assignment ${assignment_id} to check my current status
3. If it has a rubric, call get_rubric for a detailed breakdown

Then explain:
- **Assignment Overview** — what's being asked, in plain language
- **Key Requirements** — specific things I need to include or do
- **Rubric Breakdown** — if there's a rubric, explain each criterion and how to score well
- **Submission Details** — what format, any file requirements, attempt limits
- **Due Date & Status** — when it's due and whether I've started/submitted
- **Approach Suggestions** — tips for tackling this assignment effectively`,
            },
          },
        ],
      };
    }
  );

  // Quick check-in prompt
  server.prompt(
    'quick_check',
    'Fast check on what needs your attention right now — overdue items, due today, and new activity',
    {},
    async () => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Give me a quick check on what needs my attention right now.

Use these tools:
1. Call get_my_todo_items for urgent items
2. Call get_planner_items with filter="incomplete_items" for the next 3 days
3. Call get_all_upcoming_work with days_ahead=3
4. Call get_activity_summary to check for unread activity
5. Call list_conversations with scope="unread" to check for unread messages

Also check canvas://user/preferences to tailor this to my priorities and preferred format.

Give me a brief, scannable summary:
- Anything **overdue** that I need to deal with ASAP
- Anything **due today or tomorrow**
- **Unread messages** from professors or classmates
- Any **new activity** or announcements I should know about

Keep it concise — just the essentials. If I prefer brief summaries, keep it extra short.`,
            },
          },
        ],
      };
    }
  );

  // Grade analysis prompt
  server.prompt(
    'grade_analysis',
    'Analyze your grades in a specific course — category breakdown, weak spots, and what to focus on',
    {
      course_id: z.string().describe('The course ID to analyze'),
    },
    async ({ course_id }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Analyze my grades in course ${course_id} in detail.

Please:
1. Call get_grade_breakdown for course ${course_id} to see assignment group weights and individual scores
2. Call get_my_grades for overall context across all courses

Then provide:
- **Grade Breakdown by Category** — show each assignment group with its weight and my performance
- **Strongest & Weakest Areas** — where am I doing well vs struggling
- **Assignments That Hurt Most** — lowest scores relative to their weight
- **Remaining Opportunities** — ungraded work and its potential impact
- **What-If Scenarios** — what happens to my grade if I ace vs bomb the remaining work
- **Specific Recommendations** — actionable advice on what to focus on

Be specific with numbers and percentages. Show me exactly where my grade stands and what I can do about it.`,
            },
          },
        ],
      };
    }
  );

  // Catch up prompt
  server.prompt(
    'catch_up',
    'Catch up on everything you missed — new announcements, grades, assignments, and what needs attention',
    {
      days: z.string().optional().describe('Number of days to look back (default: 3)'),
    },
    async ({ days }) => {
      const lookback = days || '3';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `I need to catch up on what I missed in the last ${lookback} days.

Please:
1. Call get_activity_stream with limit=40 for a comprehensive activity feed
2. Call list_announcements (without course_ids to get all courses) for the last ${lookback} days
3. Call get_planner_items with start_date ${lookback} days ago and end_date today to see what was due
4. Call get_my_submission_status to check for missing/overdue work
5. Call list_conversations with scope="unread" for any messages I missed
6. Call get_all_upcoming_work with days_ahead=7 to see what's coming next
7. Call get_my_grades to check if any grades changed

Check canvas://user/preferences to tailor this to my priorities and preferred format.

Organize your response as:
- **What You Missed** — new announcements, new assignments posted, discussion activity
- **Unread Messages** — inbox messages from professors or classmates
- **Overdue/Missing Work** — anything past due that still needs attention, with links
- **New Grades** — any recent grades or feedback
- **Coming Up Next** — what's due in the next 7 days so you can plan ahead
- **Action Items** — prioritized list of what to do first

Be direct and prioritize urgency. If something is overdue, tell me clearly.`,
            },
          },
        ],
      };
    }
  );

  // End of semester prompt
  server.prompt(
    'end_of_semester',
    'End-of-semester review — final grade projections, remaining work, and what you need to finish strong',
    {},
    async () => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Help me plan for the end of the semester.

Please:
1. Call get_my_grades for current standings across all courses
2. For each course, call get_grade_breakdown to see remaining work and assignment group weights
3. Call get_all_upcoming_work with days_ahead=30 to see everything still coming

Then provide:
- **Current Standing** — grade in each course with letter grade
- **Remaining Work** — all upcoming assignments, exams, and projects with point values
- **Grade Projections** — for each course, show what my final grade would be at current pace, and what I'd need on remaining work for key letter grade thresholds (A, B, C)
- **Priority Ranking** — rank courses by where effort has the highest ROI (biggest grade improvement potential)
- **Specific Strategy** — for each course, one concrete recommendation

Focus on actionable advice. Be realistic about what's achievable.`,
            },
          },
        ],
      };
    }
  );

  // Inbox review prompt — check messages from professors
  server.prompt(
    'inbox_review',
    'Check your Canvas inbox for messages from professors and classmates — unread messages, recent threads',
    {},
    async () => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Check my Canvas inbox for messages I need to read or respond to.

Please:
1. Call list_conversations with scope="unread" to see unread messages first
2. If there are unread messages, call get_conversation on the most important-looking ones to read full threads
3. Call list_conversations with scope="inbox" to see recent threads overall
4. Check canvas://user/preferences to see if I have priority courses — focus on messages from those courses

Then organize your response as:
- **Unread Messages** — messages I haven't read yet, with sender and preview
- **Recent Threads** — last few conversations with context
- **Action Needed** — any messages that seem to need a reply or follow-up

Keep it scannable. Highlight messages from professors over messages from classmates.`,
            },
          },
        ],
      };
    }
  );

  // What happened / activity review prompt
  server.prompt(
    'whats_new',
    'See what\'s new across all your courses — recent grades, announcements, discussions, and activity',
    {
      since_days: z.string().optional().describe('Number of days to look back (default: 2)'),
    },
    async ({ since_days }) => {
      const days = since_days || '2';
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Show me what's new across my courses in the last ${days} days.

Please:
1. Call get_activity_stream with limit=30 to see recent activity
2. Call get_activity_summary to see unread counts by type
3. Call list_conversations with scope="unread" to check for new messages
4. Check canvas://user/preferences for my priority courses

Then organize by importance:
- **New Grades & Feedback** — any graded assignments with scores (most important)
- **Unread Messages** — inbox messages I haven't seen
- **Announcements** — new announcements from professors
- **Discussion Activity** — new discussion posts I might want to see
- **Other Activity** — anything else noteworthy

Highlight items from my priority courses. Be brief — this is a quick scan, not a deep dive.`,
            },
          },
        ],
      };
    }
  );

  // Submission review prompt
  server.prompt(
    'submission_review',
    'Review an assignment against its rubric before submitting — understand requirements and get feedback',
    {
      course_id: z.string().describe('The course ID'),
      assignment_id: z.string().describe('The assignment ID'),
    },
    async ({ course_id, assignment_id }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Help me review my work for assignment ${assignment_id} in course ${course_id} before I submit.

Please:
1. Call get_assignment for course ${course_id}, assignment ${assignment_id} with include_rubric=true to see requirements
2. Call get_submission for course ${course_id}, assignment ${assignment_id} to check current status

Then tell me:
- **Assignment Requirements** — what's expected, in plain language
- **Rubric Checklist** — for each rubric criterion, explain what's needed for full marks
- **Submission Format** — what file type/format, any restrictions, attempt limits
- **Due Date Status** — when it's due and how much time I have left

After reviewing the requirements, I'll share my work and you can evaluate it against the rubric criteria point by point.`,
            },
          },
        ],
      };
    }
  );
}

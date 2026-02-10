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

Give me a brief, scannable summary:
- Anything **overdue** that I need to deal with ASAP
- Anything **due today or tomorrow**
- Any **new activity** or announcements I should know about

Keep it concise — just the essentials.`,
            },
          },
        ],
      };
    }
  );
}

#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';

// Load environment variables from .env file if present
dotenv.config();

// Import tool registration functions
import { registerCourseTools } from './tools/courses.js';
import { registerAssignmentTools } from './tools/assignments.js';
import { registerSubmissionTools } from './tools/submissions.js';
import { registerModuleTools } from './tools/modules.js';
import { registerDiscussionTools } from './tools/discussions.js';
import { registerSearchTools } from './tools/search.js';
import { registerGradeTools } from './tools/grades.js';
import { registerTodoTools } from './tools/todos.js';
import { registerPageTools } from './tools/pages.js';
import { registerCalendarTools } from './tools/calendar.js';
import { registerFileTools } from './tools/files.js';
import { registerPlannerTools } from './tools/planner.js';
import { registerDashboardTools } from './tools/dashboard.js';

// Import prompt and resource registration
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';

// Validate required environment variables
function validateEnvironment(): void {
  const requiredVars = ['CANVAS_API_TOKEN', 'CANVAS_BASE_URL'];
  const missing = requiredVars.filter(v => !process.env[v]);

  if (missing.length > 0) {
    console.error(`Error: Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please set these variables in your environment or .env file.');
    console.error('');
    console.error('To get your Canvas API token:');
    console.error('1. Log in to Canvas');
    console.error('2. Go to Account > Settings');
    console.error('3. Scroll to "Approved Integrations"');
    console.error('4. Click "+ New Access Token"');
    console.error('');
    console.error('CANVAS_BASE_URL should be your Canvas instance URL, e.g.:');
    console.error('https://yourschool.instructure.com');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Validate environment before starting
  validateEnvironment();

  // Create the MCP server
  const server = new McpServer({
    name: 'canvas-lms',
    version: '2.0.0',
  });

  // ==================== TOOLS ====================

  // Core read tools (always active)
  registerCourseTools(server);
  registerAssignmentTools(server);
  registerModuleTools(server);
  registerSearchTools(server);
  registerGradeTools(server);
  registerTodoTools(server);
  registerPageTools(server);
  registerCalendarTools(server);
  registerFileTools(server);

  // Planner tools — read + safe personal writes (always active)
  registerPlannerTools(server);

  // Dashboard & profile tools (always active)
  registerDashboardTools(server);

  // Submission & discussion tools (write tools gated by ENABLE_WRITE_TOOLS)
  registerSubmissionTools(server);
  registerDiscussionTools(server);

  // ==================== PROMPTS ====================
  registerPrompts(server);

  // ==================== RESOURCES ====================
  registerResources(server);

  // Create stdio transport and connect
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log startup (to stderr to not interfere with MCP protocol on stdout)
  console.error('Canvas LMS MCP Server v2.0.0 started successfully');
  console.error(`Connected to: ${process.env.CANVAS_BASE_URL}`);
  console.error('');
  console.error('Active features:');
  console.error('  Tools:     courses, assignments, modules, search, grades, todos, pages,');
  console.error('             calendar, files, planner, dashboard, profile');
  console.error('  Prompts:   weekly_review, study_plan, assignment_helper, quick_check');
  console.error('  Resources: canvas://grades/summary, canvas://courses/active,');
  console.error('             canvas://courses/{id}/syllabus, canvas://courses/{id}/assignments');
  console.error('');
  console.error('Safe writes (always on): planner notes, mark items complete');
  if (process.env.ENABLE_WRITE_TOOLS === 'true') {
    console.error('Full writes:  ENABLED (submit_assignment, upload_file, post_discussion_entry, reply_to_discussion)');
  } else {
    console.error('Full writes:  DISABLED (set ENABLE_WRITE_TOOLS=true to enable submissions & discussion posts)');
  }
}

// Run the server
main().catch((error) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});

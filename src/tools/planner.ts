import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess } from '../utils.js';

export function registerPlannerTools(server: McpServer) {
  const client = getCanvasClient();

  // ==================== READ TOOLS (always on) ====================

  server.tool(
    'get_planner_items',
    'Get items from your Canvas planner — assignments, quizzes, discussions, and notes organized by date. This is the most complete view of what you need to do.',
    {
      start_date: z.string().optional()
        .describe('Start date (YYYY-MM-DD). Defaults to today.'),
      end_date: z.string().optional()
        .describe('End date (YYYY-MM-DD). Defaults to 14 days from start.'),
      course_ids: z.array(z.number()).optional()
        .describe('Filter to specific course IDs'),
      filter: z.enum(['new_activity', 'incomplete_items', 'complete_items']).optional()
        .describe('Filter: new_activity, incomplete_items, or complete_items'),
    },
    async ({ start_date, end_date, course_ids, filter }) => {
      try {
        const contextCodes = course_ids?.map(id => `course_${id}`);

        const items = await client.listPlannerItems({
          start_date: start_date ?? new Date().toISOString().split('T')[0],
          end_date: end_date ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          context_codes: contextCodes,
          filter,
        });

        const formattedItems = items.map(item => {
          const plannable = item.plannable;
          const dueDate = plannable.due_at || plannable.todo_date || null;

          return {
            type: item.plannable_type,
            title: plannable.title || plannable.name || 'Untitled',
            course: item.context_name ?? `course_${item.course_id}`,
            course_id: item.course_id,
            due_at: dueDate,
            days_until_due: dueDate
              ? Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              : null,
            points_possible: plannable.points_possible ?? null,
            completed: item.planner_override?.marked_complete ?? false,
            submissions: item.submissions || null,
            html_url: item.html_url,
            new_activity: item.new_activity ?? false,
          };
        });

        // Sort by due date
        formattedItems.sort((a, b) => {
          if (!a.due_at) return 1;
          if (!b.due_at) return -1;
          return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
        });

        return formatSuccess({
          count: formattedItems.length,
          items: formattedItems,
        });
      } catch (error) {
        return formatError('getting planner items', error);
      }
    }
  );

  server.tool(
    'get_planner_notes',
    'Get your personal planner notes and reminders',
    {
      start_date: z.string().optional()
        .describe('Start date (YYYY-MM-DD)'),
      end_date: z.string().optional()
        .describe('End date (YYYY-MM-DD)'),
    },
    async ({ start_date, end_date }) => {
      try {
        const notes = await client.listPlannerNotes({
          start_date,
          end_date,
        });

        const formattedNotes = notes.map(note => ({
          id: note.id,
          title: note.title,
          description: note.description,
          todo_date: note.todo_date,
          course_id: note.course_id,
          linked_object_type: note.linked_object_type,
          linked_object_id: note.linked_object_id,
        }));

        return formatSuccess({
          count: formattedNotes.length,
          notes: formattedNotes,
        });
      } catch (error) {
        return formatError('getting planner notes', error);
      }
    }
  );

  // ==================== SAFE WRITE TOOLS (always on — personal only) ====================
  // These only affect the user's personal planner view. No one else sees these.

  server.tool(
    'create_planner_note',
    'Create a personal reminder or note on your planner. Only you can see these — safe to use anytime.',
    {
      title: z.string().min(1).describe('Title for the note'),
      details: z.string().optional()
        .describe('Additional details or description'),
      todo_date: z.string()
        .describe('Date to show on planner (YYYY-MM-DD)'),
      course_id: z.number().optional()
        .describe('Associate with a specific course (optional)'),
    },
    async ({ title, details, todo_date, course_id }) => {
      try {
        const note = await client.createPlannerNote({
          title,
          details,
          todo_date,
          course_id,
        });

        return formatSuccess({
          success: true,
          message: 'Planner note created',
          note: {
            id: note.id,
            title: note.title,
            todo_date: note.todo_date,
            course_id: note.course_id,
          },
        });
      } catch (error) {
        return formatError('creating planner note', error);
      }
    }
  );

  server.tool(
    'mark_planner_item_done',
    'Mark an item as complete on your planner. Only affects your personal view — does NOT submit anything.',
    {
      plannable_type: z.enum([
        'announcement', 'assignment', 'discussion_topic', 'quiz',
        'wiki_page', 'planner_note', 'calendar_event',
      ]).describe('Type of the planner item'),
      plannable_id: z.number()
        .describe('ID of the planner item'),
      complete: z.boolean().optional().default(true)
        .describe('true to mark complete, false to mark incomplete'),
    },
    async ({ plannable_type, plannable_id, complete }) => {
      try {
        const override = await client.createPlannerOverride({
          plannable_type: plannable_type as 'assignment',
          plannable_id,
          marked_complete: complete,
        });

        return formatSuccess({
          success: true,
          message: complete
            ? 'Item marked as complete on your planner'
            : 'Item marked as incomplete on your planner',
          override: {
            id: override.id,
            plannable_type: override.plannable_type,
            plannable_id: override.plannable_id,
            marked_complete: override.marked_complete,
          },
        });
      } catch (error) {
        return formatError('updating planner item', error);
      }
    }
  );

  server.tool(
    'delete_planner_note',
    'Delete a personal planner note. Only affects your own notes.',
    {
      note_id: z.number().describe('The planner note ID to delete'),
    },
    async ({ note_id }) => {
      try {
        await client.deletePlannerNote(note_id);
        return formatSuccess({
          success: true,
          message: 'Planner note deleted',
        });
      } catch (error) {
        return formatError('deleting planner note', error);
      }
    }
  );
}

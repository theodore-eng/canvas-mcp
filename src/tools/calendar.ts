import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, stripHtmlTags } from '../utils.js';

export function registerCalendarTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'list_calendar_events',
    'List calendar events (exams, office hours, class sessions, etc.) across your courses',
    {
      course_ids: z.array(z.number()).optional()
        .describe('Filter to specific course IDs. If omitted, returns events from all courses.'),
      start_date: z.string().optional()
        .describe('Start date (YYYY-MM-DD). Defaults to today.'),
      end_date: z.string().optional()
        .describe('End date (YYYY-MM-DD). Defaults to 14 days from start.'),
      type: z.enum(['event', 'assignment']).optional()
        .describe('Filter by type: "event" for calendar events, "assignment" for assignment due dates'),
    },
    async ({ course_ids, start_date, end_date, type }) => {
      try {
        // Build context codes from course IDs, or get all courses
        let contextCodes: string[] | undefined;

        if (course_ids && course_ids.length > 0) {
          contextCodes = course_ids.map(id => `course_${id}`);
        } else {
          const courses = await client.listCourses({
            enrollment_state: 'active',
            state: ['available'],
          });
          contextCodes = courses.map(c => `course_${c.id}`);
        }

        const events = await client.listCalendarEvents({
          context_codes: contextCodes,
          start_date: start_date ?? new Date().toISOString().split('T')[0],
          end_date: end_date ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          type,
        });

        const formattedEvents = events.map(event => ({
          id: event.id,
          title: event.title,
          type: event.type,
          start_at: event.start_at,
          end_at: event.end_at,
          all_day: event.all_day,
          all_day_date: event.all_day_date,
          location: event.location_name,
          context: event.context_name ?? event.context_code,
          description: event.description ? stripHtmlTags(event.description) : null,
          html_url: event.html_url,
        }));

        // Sort by start date
        formattedEvents.sort((a, b) => {
          if (!a.start_at) return 1;
          if (!b.start_at) return -1;
          return new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
        });

        return formatSuccess({
          count: formattedEvents.length,
          events: formattedEvents,
        });
      } catch (error) {
        return formatError('listing calendar events', error);
      }
    }
  );
}

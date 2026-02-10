import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, runWithConcurrency, formatPlannerItem, sortByDueDate } from '../utils.js';

export function registerSearchTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'find_assignments_by_due_date',
    'Find assignments in a course that are due within a specific date range',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      start_date: z.string().describe('Start date (ISO 8601 format, e.g., 2024-01-01)'),
      end_date: z.string().describe('End date (ISO 8601 format, e.g., 2024-01-31)'),
    },
    async ({ course_id, start_date, end_date }) => {
      try {
        const startDateObj = new Date(start_date);
        const endDateObj = new Date(end_date);

        if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
          return formatError('finding assignments',
            new Error('Invalid date format. Please use ISO 8601 format (e.g., 2024-01-01)'));
        }

        if (startDateObj > endDateObj) {
          return formatError('finding assignments',
            new Error('start_date must be before end_date'));
        }

        const assignments = await client.getAssignmentsByDateRange(
          course_id,
          startDateObj,
          endDateObj
        );

        const formattedAssignments = assignments.map(a => ({
          id: a.id,
          name: a.name,
          due_at: a.due_at,
          points_possible: a.points_possible,
          submission_types: a.submission_types,
          has_submitted: a.submission?.workflow_state === 'submitted' || a.submission?.workflow_state === 'graded',
          html_url: a.html_url,
        }));

        return formatSuccess({
          date_range: { start: start_date, end: end_date },
          count: formattedAssignments.length,
          assignments: formattedAssignments,
        });
      } catch (error) {
        return formatError('finding assignments', error);
      }
    }
  );

  server.tool(
    'search_course_content',
    'Search through a course\'s modules, assignments, pages, files, and discussions by keyword. Searches across all content types for comprehensive results.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      search_term: z.string().min(1).describe('Search term to find in modules and assignments'),
    },
    async ({ course_id, search_term }) => {
      try {
        const results = await client.searchCourseContent(course_id, search_term);

        const formattedResults = {
          search_term,
          modules: results.modules.map(mod => ({
            id: mod.id,
            name: mod.name,
            items: mod.items?.filter(item =>
              item.title.toLowerCase().includes(search_term.toLowerCase())
            ).map(item => ({
              id: item.id,
              title: item.title,
              type: item.type,
              html_url: item.html_url,
            })),
          })).filter(mod => mod.items && mod.items.length > 0),
          assignments: results.assignments.map(a => ({
            id: a.id,
            name: a.name,
            due_at: a.due_at,
            points_possible: a.points_possible,
            html_url: a.html_url,
          })),
          pages: results.pages.map(p => ({
            page_id: p.page_id,
            title: p.title,
            url: p.url,
            updated_at: p.updated_at,
          })),
          files: results.files.map(f => ({
            id: f.id,
            display_name: f.display_name,
            content_type: f['content-type'],
            size: f.size,
          })),
          discussions: results.discussions.map(d => ({
            id: d.id,
            title: d.title,
            posted_at: d.posted_at,
            reply_count: d.discussion_subentry_count,
            html_url: d.html_url,
          })),
          total_results:
            (results.modules.length > 0 ? results.modules.reduce((sum, m) => sum + (m.items?.length ?? 0), 0) : 0) +
            results.assignments.length +
            results.pages.length +
            results.files.length +
            results.discussions.length,
        };

        return formatSuccess(formattedResults);
      } catch (error) {
        return formatError('searching course content', error);
      }
    }
  );

  server.tool(
    'search_all_courses',
    'Search for content across ALL your courses — finds matching assignments, pages, files, discussions, and modules everywhere. Use when you\'re not sure which course something is in.',
    {
      search_term: z.string().min(1).describe('Search term to find across all courses'),
      course_ids: z.array(z.number().int().positive()).optional()
        .describe('Limit search to specific course IDs. If omitted, searches all active courses.'),
    },
    async ({ search_term, course_ids }) => {
      try {
        let courses;
        if (course_ids && course_ids.length > 0) {
          // Fetch actual course names instead of using placeholders
          const allCourses = await client.listCourses({ enrollment_state: 'active', state: ['available'] });
          const courseMap = new Map(allCourses.map(c => [c.id, c.name]));
          courses = course_ids.map(id => ({ id, name: courseMap.get(id) ?? `Course ${id}` }));
        } else {
          const allCourses = await client.listCourses({
            enrollment_state: 'active',
            state: ['available'],
          });
          courses = allCourses.map(c => ({ id: c.id, name: c.name }));
        }

        const results = await runWithConcurrency(
          courses.map((course) => async () => {
            const searchResults = await client.searchCourseContent(course.id, search_term);
            return { course, results: searchResults };
          }),
          3 // max 3 courses concurrently, each internally runs 5 API calls
        );

        const allResults: Array<{
          course_id: number;
          course_name: string;
          type: string;
          title: string;
          id: number;
          html_url?: string;
          details?: Record<string, unknown>;
        }> = [];

        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          const { course, results: r } = result.value;

          for (const a of r.assignments) {
            allResults.push({
              course_id: course.id,
              course_name: course.name,
              type: 'assignment',
              title: a.name,
              id: a.id,
              html_url: a.html_url,
              details: { due_at: a.due_at, points_possible: a.points_possible },
            });
          }
          for (const p of r.pages) {
            allResults.push({
              course_id: course.id,
              course_name: course.name,
              type: 'page',
              title: p.title,
              id: p.page_id,
              details: { url: p.url },
            });
          }
          for (const f of r.files) {
            allResults.push({
              course_id: course.id,
              course_name: course.name,
              type: 'file',
              title: f.display_name,
              id: f.id,
              details: { content_type: f['content-type'], size: f.size },
            });
          }
          for (const d of r.discussions) {
            allResults.push({
              course_id: course.id,
              course_name: course.name,
              type: 'discussion',
              title: d.title,
              id: d.id,
              html_url: d.html_url,
            });
          }
          for (const m of r.modules) {
            const matchingItems = m.items?.filter(item =>
              item.title.toLowerCase().includes(search_term.toLowerCase())
            ) ?? [];
            for (const item of matchingItems) {
              allResults.push({
                course_id: course.id,
                course_name: course.name,
                type: `module_item (${item.type})`,
                title: item.title,
                id: item.id,
                html_url: item.html_url,
              });
            }
          }
        }

        return formatSuccess({
          search_term,
          total_results: allResults.length,
          courses_searched: courses.length,
          results: allResults,
        });
      } catch (error) {
        return formatError('searching all courses', error);
      }
    }
  );

  server.tool(
    'get_all_upcoming_work',
    'Get all upcoming (and optionally overdue) work across all courses or a specific course — assignments, quizzes, discussions, and more. The best single view of everything due soon. Replaces get_upcoming_assignments and get_overdue_assignments.',
    {
      days_ahead: z.number().optional().default(7)
        .describe('Number of days to look ahead (default: 7)'),
      course_id: z.number().int().positive().optional()
        .describe('Filter to a specific course (omit for all courses)'),
      include_overdue: z.boolean().optional().default(false)
        .describe('Also include overdue/missing items (default: false)'),
    },
    async ({ days_ahead, course_id, include_overdue }) => {
      try {
        const todayStr = client.getLocalDateString();
        const futureDate = new Date(Date.now() + days_ahead * 24 * 60 * 60 * 1000);
        const futureDateStr = client.getLocalDateString(futureDate);

        // Fetch upcoming items
        const plannerParams: Record<string, unknown> = {
          start_date: todayStr,
          end_date: futureDateStr,
          filter: 'incomplete_items',
        };
        if (course_id) {
          plannerParams.context_codes = [`course_${course_id}`];
        }

        const plannerItems = await client.listPlannerItems(plannerParams as import('../types/canvas.js').ListPlannerItemsParams);

        let allItems = plannerItems.map(item => formatPlannerItem(item));

        // Optionally fetch overdue items
        if (include_overdue) {
          const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // look back 30 days
          const pastDateStr = client.getLocalDateString(pastDate);
          const overdueParams: Record<string, unknown> = {
            start_date: pastDateStr,
            end_date: todayStr,
            filter: 'incomplete_items',
          };
          if (course_id) {
            overdueParams.context_codes = [`course_${course_id}`];
          }

          const overdueItems = await client.listPlannerItems(overdueParams as import('../types/canvas.js').ListPlannerItemsParams);
          const formattedOverdue = overdueItems
            .map(item => formatPlannerItem(item))
            .filter(item => item.due_at && new Date(item.due_at).getTime() < Date.now() && !item.submitted);

          // Mark overdue items
          const overdueWithFlag = formattedOverdue.map(item => ({ ...item, overdue: true }));
          const upcomingWithFlag = allItems.map(item => ({ ...item, overdue: false }));
          allItems = [...overdueWithFlag, ...upcomingWithFlag];
        }

        const sortedItems = sortByDueDate(allItems);

        // Group by course for summary
        const byCourse: Record<string, number> = {};
        for (const item of sortedItems) {
          byCourse[item.course] = (byCourse[item.course] || 0) + 1;
        }

        return formatSuccess({
          looking_ahead_days: days_ahead,
          ...(course_id ? { course_id } : {}),
          include_overdue,
          total_count: sortedItems.length,
          by_course: byCourse,
          items: sortedItems,
        });
      } catch (error) {
        return formatError('getting upcoming work', error);
      }
    }
  );
}

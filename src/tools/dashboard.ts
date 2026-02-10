import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, stripHtmlTags, formatPlannerItem, sortByDueDate } from '../utils.js';

export function registerDashboardTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'daily_briefing',
    'Get a complete daily overview: today\'s events, upcoming deadlines, recent grades, unread announcements, and todo items. The best way to start your day or check in on everything at once.',
    {
      days_ahead: z.number().optional().default(7)
        .describe('How many days ahead to look for upcoming work (default: 7)'),
    },
    async ({ days_ahead }) => {
      try {
        const todayStr = client.getLocalDateString();
        const futureDate = new Date(Date.now() + days_ahead * 24 * 60 * 60 * 1000);
        const futureDateStr = client.getLocalDateString(futureDate);

        // Fetch all data in parallel for speed — use allSettled so partial failures don't kill the briefing
        const [coursesResult, todosResult, plannerResult] = await Promise.allSettled([
          client.listCourses({
            enrollment_state: 'active',
            state: ['available'],
            include: ['total_scores', 'term'],
          }),
          client.getTodoItems(),
          client.listPlannerItems({
            start_date: todayStr,
            end_date: futureDateStr,
            filter: 'incomplete_items',
          }),
        ]);

        const courses = coursesResult.status === 'fulfilled' ? coursesResult.value : [];
        const todos = todosResult.status === 'fulfilled' ? todosResult.value : [];
        const plannerItems = plannerResult.status === 'fulfilled' ? plannerResult.value : [];

        // Build course name lookup for resolving context codes
        const courseNameMap = new Map(courses.map(c => [`course_${c.id}`, c.name]));

        const warnings: string[] = [];
        if (coursesResult.status === 'rejected') warnings.push('Could not load courses');
        if (todosResult.status === 'rejected') warnings.push('Could not load todo items');
        if (plannerResult.status === 'rejected') warnings.push('Could not load planner items');

        // Fetch calendar events and announcements (need course IDs first)
        const contextCodes = courses.map(c => `course_${c.id}`);
        const tomorrowStr = client.getLocalDateString(new Date(Date.now() + 24 * 60 * 60 * 1000));
        const weekAgoStr = client.getLocalDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

        const [eventsResult, announcementsResult] = await Promise.allSettled([
          contextCodes.length > 0
            ? client.listCalendarEvents({
                context_codes: contextCodes,
                start_date: todayStr,
                end_date: tomorrowStr,
              })
            : Promise.resolve([]),
          contextCodes.length > 0
            ? client.listAnnouncements({
                context_codes: contextCodes,
                start_date: weekAgoStr,
                end_date: todayStr,
                active_only: true,
              })
            : Promise.resolve([]),
        ]);

        const todayEvents = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
        const announcements = announcementsResult.status === 'fulfilled' ? announcementsResult.value : [];
        if (eventsResult.status === 'rejected') warnings.push('Could not load calendar events');
        if (announcementsResult.status === 'rejected') warnings.push('Could not load announcements');

        // Build grade summary
        const gradesSummary = courses
          .filter(c => c.enrollments && c.enrollments.length > 0)
          .map(c => {
            const enrollment = c.enrollments?.[0];
            return {
              course: c.name,
              course_code: c.course_code,
              current_score: enrollment?.computed_current_score ?? null,
              current_grade: enrollment?.computed_current_grade ?? null,
            };
          })
          .filter(g => g.current_score !== null);

        // Format today's events
        const todayEventsFormatted = todayEvents.map(event => ({
          title: event.title,
          type: event.type,
          start_at: event.start_at,
          end_at: event.end_at,
          location: event.location_name,
          context: event.context_name ?? event.context_code,
        })).sort((a, b) => {
          if (!a.start_at) return 1;
          if (!b.start_at) return -1;
          return new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
        });

        // Format upcoming planner items using shared utility
        const upcomingWork = sortByDueDate(plannerItems.map(item =>
          formatPlannerItem(item, courseNameMap.get(`course_${item.course_id}`))
        ));

        // Format todo items
        const todoItems = todos.map(item => ({
          name: item.assignment?.name ?? item.quiz?.title ?? 'Unknown',
          course: item.context_name,
          due_at: item.assignment?.due_at ?? null,
          points_possible: item.assignment?.points_possible ?? null,
        }));

        // Recent announcements (last 7 days)
        const recentAnnouncements = announcements.slice(0, 5).map(ann => ({
          title: ann.title,
          author: ann.user_name,
          posted_at: ann.posted_at,
          course: courseNameMap.get(ann.context_code) ?? ann.context_code,
          preview: stripHtmlTags(ann.message).substring(0, 200),
        }));

        // Calculate urgency summary
        const dueTodayCount = upcomingWork.filter(w =>
          w.days_until_due !== null && w.days_until_due <= 0
        ).length;
        const dueTomorrowCount = upcomingWork.filter(w =>
          w.days_until_due === 1
        ).length;
        const dueThisWeekCount = upcomingWork.filter(w =>
          w.days_until_due !== null && w.days_until_due > 1 && w.days_until_due <= 7
        ).length;
        const missingCount = upcomingWork.filter(w => w.missing).length;

        return formatSuccess({
          date: todayStr,
          ...(warnings.length > 0 ? { warnings } : {}),
          summary: {
            courses_active: courses.length,
            due_today: dueTodayCount,
            due_tomorrow: dueTomorrowCount,
            due_this_week: dueThisWeekCount,
            missing_assignments: missingCount,
            todo_items: todoItems.length,
            events_today: todayEventsFormatted.length,
            unread_announcements: recentAnnouncements.length,
          },
          todays_events: todayEventsFormatted,
          upcoming_work: upcomingWork,
          todo_items: todoItems,
          grades: gradesSummary,
          recent_announcements: recentAnnouncements,
        });
      } catch (error) {
        return formatError('getting daily briefing', error);
      }
    }
  );

  server.tool(
    'get_my_profile',
    'Get your Canvas user profile information',
    {},
    async () => {
      try {
        const profile = await client.getUserProfile();

        return formatSuccess({
          id: profile.id,
          name: profile.name,
          short_name: profile.short_name,
          email: profile.primary_email,
          time_zone: profile.time_zone,
          locale: profile.locale,
          bio: profile.bio,
          avatar_url: profile.avatar_url,
        });
      } catch (error) {
        return formatError('getting profile', error);
      }
    }
  );
}

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, stripHtmlTags } from '../utils.js';

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
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const futureDate = new Date(Date.now() + days_ahead * 24 * 60 * 60 * 1000);
        const futureDateStr = futureDate.toISOString().split('T')[0];

        // Fetch all data in parallel for speed
        const [courses, todos, plannerItems] = await Promise.all([
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

        // Fetch calendar events and announcements (need course IDs first)
        const contextCodes = courses.map(c => `course_${c.id}`);
        const tomorrowStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const weekAgoStr = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const [todayEvents, announcements] = await Promise.all([
          client.listCalendarEvents({
            context_codes: contextCodes,
            start_date: todayStr,
            end_date: tomorrowStr,
          }),
          client.listAnnouncements({
            context_codes: contextCodes,
            start_date: weekAgoStr,
            end_date: todayStr,
            active_only: true,
          }).catch(() => []), // Don't fail the whole briefing if announcements error
        ]);

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

        // Format upcoming planner items
        const upcomingWork = plannerItems.map(item => {
          const plannable = item.plannable;
          const dueDate = plannable.due_at || plannable.todo_date || null;
          return {
            type: item.plannable_type,
            title: plannable.title || plannable.name || 'Untitled',
            course: item.context_name ?? `course_${item.course_id}`,
            due_at: dueDate,
            days_until_due: dueDate
              ? Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              : null,
            points_possible: plannable.points_possible ?? null,
            submitted: item.submissions && typeof item.submissions === 'object'
              ? (item.submissions.graded || false)
              : false,
            missing: item.submissions && typeof item.submissions === 'object'
              ? item.submissions.missing
              : false,
          };
        }).sort((a, b) => {
          if (!a.due_at) return 1;
          if (!b.due_at) return -1;
          return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
        });

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
          course: ann.context_code,
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

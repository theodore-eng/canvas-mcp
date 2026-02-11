import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, stripHtmlTags } from '../utils.js';

export function registerActivityTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'get_activity_stream',
    'Get recent activity across all your courses — announcements, discussions, submissions, messages, and more. Use this for a chronological feed of recent activity. For a structured daily overview, use daily_briefing.',
    {
      limit: z.number().optional().default(20)
        .describe('Maximum number of items to return (default: 20, max: 50)'),
      type: z.enum(['Announcement', 'Discussion', 'Submission', 'Message', 'Conference', 'Collaboration']).optional()
        .describe('Filter to a specific activity type'),
      course_id: z.number().int().positive().optional()
        .describe('Filter to a specific course'),
    },
    async ({ limit, type, course_id }) => {
      try {
        const cappedLimit = Math.min(limit, 50);

        // Pass per_page to limit server-side instead of fetching everything
        const items = await client.getActivityStream({
          only_active_courses: true,
          per_page: cappedLimit,
        });

        // Apply type filter if provided
        let filtered = type
          ? items.filter(i => i.type === type)
          : items;

        // Apply course_id filter if provided
        if (course_id) {
          filtered = filtered.filter(i => i.course_id === course_id);
        }

        // Sort by created_at descending (most recent first)
        filtered.sort((a, b) => {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

        const sliced = filtered.slice(0, cappedLimit);

        const formattedItems = sliced.map(item => {
          const messagePreview = item.message
            ? stripHtmlTags(item.message).slice(0, 200)
            : null;

          const base: Record<string, unknown> = {
            type: item.type,
            title: item.title,
            message_preview: messagePreview,
            course_id: item.course_id ?? null,
            created_at: item.created_at,
            read: item.read_state,
            html_url: item.html_url,
          };

          if (item.type === 'Submission') {
            base.grade = item.grade ?? null;
            base.score = item.score ?? null;
          }

          return base;
        });

        return formatSuccess({
          count: formattedItems.length,
          ...(type ? { filtered_by_type: type } : {}),
          ...(course_id ? { filtered_by_course: course_id } : {}),
          items: formattedItems,
        });
      } catch (error) {
        return formatError('getting activity stream', error);
      }
    }
  );

  server.tool(
    'get_activity_summary',
    'Quick summary of unread activity counts by type — see at a glance how many announcements, discussions, submissions, and messages need attention.',
    {},
    async () => {
      try {
        const summary = await client.getActivityStreamSummary();

        const formattedSummary = summary.map(item => ({
          type: item.type,
          unread_count: item.unread_count,
          count: item.count,
        }));

        const totalUnread = summary.reduce((sum, item) => sum + item.unread_count, 0);

        return formatSuccess({
          total_unread: totalUnread,
          count: formattedSummary.length,
          summary: formattedSummary,
        });
      } catch (error) {
        return formatError('getting activity summary', error);
      }
    }
  );
}

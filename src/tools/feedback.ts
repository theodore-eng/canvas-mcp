import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, formatScoreDisplay } from '../utils.js';

export function registerFeedbackTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'get_recent_feedback',
    'Get recently graded assignments with scores, comments, and feedback across all courses. Great for checking what got graded overnight.',
    {
      days_back: z.number().optional().default(7)
        .describe('How many days back to look for graded work (default: 7)'),
      course_id: z.number().int().positive().optional()
        .describe('Filter to a specific course (optional)'),
    },
    async ({ days_back, course_id }) => {
      try {
        let courses;
        if (course_id) {
          const course = await client.getCourse(course_id);
          courses = [{ id: course_id, name: course.name, course_code: course.course_code }];
        } else {
          courses = await client.getActiveCourses();
        }

        const cutoffDate = new Date(Date.now() - days_back * 24 * 60 * 60 * 1000);

        const results = await Promise.allSettled(
          courses.map(async (course) => {
            const assignments = await client.listAssignments(course.id, {
              include: ['submission'],
            });

            const recentlyGraded = assignments.filter(a => {
              const sub = a.submission;
              if (!sub || !sub.graded_at) return false;
              return new Date(sub.graded_at) >= cutoffDate;
            });

            return {
              course_id: course.id,
              course_name: course.name,
              graded: recentlyGraded.map(a => ({
                assignment_name: a.name,
                assignment_id: a.id,
                score: a.submission?.score ?? null,
                points_possible: a.points_possible,
                score_display: formatScoreDisplay(a.submission?.score, a.points_possible),
                percentage: a.submission?.score != null && a.points_possible > 0
                  ? Math.round((a.submission.score / a.points_possible) * 1000) / 10
                  : null,
                grade: a.submission?.grade ?? null,
                graded_at: a.submission?.graded_at,
                late: a.submission?.late ?? false,
                points_deducted: a.submission?.points_deducted ?? null,
                html_url: a.html_url,
              })),
            };
          })
        );

        const courseResults = results
          .filter((r): r is PromiseFulfilledResult<{
            course_id: number;
            course_name: string;
            graded: Array<{
              assignment_name: string;
              assignment_id: number;
              score: number | null;
              points_possible: number;
              score_display: string | null;
              percentage: number | null;
              grade: string | null;
              graded_at: string | undefined;
              late: boolean;
              points_deducted: number | null;
              html_url: string;
            }>;
          }> => r.status === 'fulfilled')
          .map(r => r.value)
          .filter(r => r.graded.length > 0);

        const totalGraded = courseResults.reduce((sum, c) => sum + c.graded.length, 0);

        return formatSuccess({
          days_back,
          total_graded: totalGraded,
          courses: courseResults,
        });
      } catch (error) {
        return formatError('getting recent feedback', error);
      }
    }
  );
}

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess } from '../utils.js';

/**
 * Per-assignment analytics for the calling student. Surfaces signals
 * the regular submission API doesn't:
 *   - score percentile vs. cohort (median + quartiles)
 *   - on-time / late / missing status across the semester
 *   - days late when applicable
 *
 * Some Canvas instances disable analytics for students; the underlying
 * client returns [] in that case rather than throwing, so the LLM gets a
 * clean "no data" result.
 */
export function registerAnalyticsTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'get_my_assignment_analytics',
    "Get per-assignment timing + performance analytics for yourself in a course. Returns the cohort's median + quartile scores per assignment, your status (on_time / late / missing), days late if applicable, and your score. Use this to detect patterns like 'late on 4 of last 5 problem sets' or 'consistently below class median in case writeups'. Returns empty when the institution disables student analytics.",
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      include_floating: z.boolean().optional().default(false)
        .describe('Include assignments with status="floating" (no due date enforcement). Default false to focus on graded work.'),
    },
    async ({ course_id, include_floating }) => {
      try {
        const rows = await client.getMyAssignmentAnalytics(course_id);
        if (rows.length === 0) {
          return formatSuccess({
            course_id,
            available: false,
            count: 0,
            note: 'Analytics returned no rows. Some Canvas instances disable student-side analytics, or the course has no graded assignments yet.',
          });
        }

        const filtered = rows.filter((r) =>
          include_floating ? true : r.status !== 'floating',
        );

        // Compute simple aggregates the LLM would otherwise need to recompute
        let lateCount = 0;
        let missingCount = 0;
        let onTimeCount = 0;
        let belowMedianCount = 0;
        let scoredCount = 0;
        let totalDaysLate = 0;

        const formatted = filtered.map((r) => {
          const score = r.submission?.score ?? null;
          const median = r.median ?? null;
          const belowMedian = score !== null && median !== null && score < median;
          if (r.status === 'late') {
            lateCount++;
            totalDaysLate += r.late_days ?? 0;
          } else if (r.status === 'missing') {
            missingCount++;
          } else if (r.status === 'on_time') {
            onTimeCount++;
          }
          if (score !== null) scoredCount++;
          if (belowMedian) belowMedianCount++;

          return {
            assignment_id: r.assignment_id,
            course_id,
            title: r.title,
            points_possible: r.points_possible,
            due_at: r.due_at,
            status: r.status ?? null,
            late_days: r.late_days ?? null,
            score,
            submitted_at: r.submission?.submitted_at ?? null,
            cohort_min: r.min_score ?? null,
            cohort_first_quartile: r.first_quartile ?? null,
            cohort_median: median,
            cohort_third_quartile: r.third_quartile ?? null,
            cohort_max: r.max_score ?? null,
            below_median: belowMedian,
            excused: r.excused ?? false,
            module_ids: r.module_ids ?? [],
          };
        });

        return formatSuccess({
          course_id,
          available: true,
          count: formatted.length,
          summary: {
            on_time_count: onTimeCount,
            late_count: lateCount,
            missing_count: missingCount,
            avg_days_late: lateCount > 0 ? Math.round((totalDaysLate / lateCount) * 10) / 10 : null,
            below_median_count: belowMedianCount,
            scored_count: scoredCount,
          },
          assignments: formatted,
        });
      } catch (error) {
        return formatError('getting assignment analytics', error);
      }
    },
  );
}

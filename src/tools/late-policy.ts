import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess } from '../utils.js';

/**
 * Surface Canvas's per-course late and missing submission policy. The
 * existing `calculate_what_if_grade` tool can't model "−10%/day late"
 * because nothing was fetching this. Now there's a dedicated tool, AND
 * what-if surfaces the policy in its response so the LLM can apply it
 * to hypothetical scenarios.
 */
export function registerLatePolicyTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'get_course_late_policy',
    "Get a course's late + missing submission policy: how much Canvas deducts per day late, the floor below which deductions stop, and what missing submissions are scored. Returns has_policy=false when the course has no policy configured. Use this BEFORE calculate_what_if_grade so you can factor in late-day penalties for assignments you turn in late.",
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
    },
    async ({ course_id }) => {
      try {
        const policy = await client.getLatePolicy(course_id);
        if (!policy) {
          return formatSuccess({
            course_id,
            has_policy: false,
            note: 'No late policy configured for this course. Late submissions are not auto-deducted by Canvas.',
          });
        }

        const lateExample = policy.late_submission_deduction_enabled
          ? `Late submissions lose ${policy.late_submission_deduction}% per ${policy.late_submission_interval}, floor ${policy.late_submission_minimum_percent}% of total.`
          : 'Late deduction is disabled — late submissions are not auto-deducted.';
        const missingExample = policy.missing_submission_deduction_enabled
          ? `Missing submissions are scored ${100 - policy.missing_submission_deduction}% of total (deduction = ${policy.missing_submission_deduction}%).`
          : 'Missing-submission deduction is disabled — missing assignments are not auto-zeroed by this policy.';

        return formatSuccess({
          course_id,
          has_policy: true,
          late_deduction_enabled: policy.late_submission_deduction_enabled,
          late_deduction_pct: policy.late_submission_deduction,
          late_interval: policy.late_submission_interval,
          late_floor_pct: policy.late_submission_minimum_percent,
          missing_deduction_enabled: policy.missing_submission_deduction_enabled,
          missing_deduction_pct: policy.missing_submission_deduction,
          summary: `${lateExample} ${missingExample}`,
        });
      } catch (error) {
        return formatError('getting course late policy', error);
      }
    },
  );
}

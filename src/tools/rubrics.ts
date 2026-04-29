import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess } from '../utils.js';

/**
 * Two read-only tools that surface Canvas rubrics for an assignment and
 * the user's per-criterion assessment on a submission. Together they let
 * the LLM say "you lost 5.5 pts on Pitches and 3 pts on Citations" instead
 * of just "lost 8.5 pts" — direct study/improvement signal.
 */
export function registerRubricTools(server: McpServer) {
  const client = getCanvasClient();

  // ==================== get_assignment_rubric ====================

  server.tool(
    'get_assignment_rubric',
    'Get the rubric template attached to an assignment — criteria, point values per criterion, and rating tiers within each criterion. Useful for understanding how an assignment will be graded BEFORE you submit. Returns null if the assignment has no rubric.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      assignment_id: z.number().int().positive().describe('The Canvas assignment ID'),
    },
    async ({ course_id, assignment_id }) => {
      try {
        const assignment = await client.getAssignment(course_id, assignment_id);
        if (!assignment.rubric || assignment.rubric.length === 0) {
          return formatSuccess({
            course_id,
            assignment_id,
            assignment_name: assignment.name,
            has_rubric: false,
            rubric: null,
          });
        }

        const totalPossible = assignment.rubric.reduce((sum, c) => sum + (c.points ?? 0), 0);

        return formatSuccess({
          course_id,
          assignment_id,
          assignment_name: assignment.name,
          has_rubric: true,
          rubric_settings: assignment.rubric_settings ?? null,
          use_for_grading: assignment.use_rubric_for_grading ?? false,
          total_points_possible: totalPossible,
          criteria: assignment.rubric.map((c) => ({
            criterion_id: c.id,
            description: c.description,
            long_description: c.long_description ?? null,
            points: c.points,
            criterion_use_range: c.criterion_use_range,
            ignore_for_scoring: c.ignore_for_scoring ?? false,
            ratings: (c.ratings ?? []).map((r) => ({
              rating_id: r.id,
              description: r.description,
              long_description: r.long_description ?? null,
              points: r.points,
            })),
          })),
        });
      } catch (error) {
        return formatError('getting assignment rubric', error);
      }
    },
  );

  // ==================== get_submission_rubric ====================

  server.tool(
    'get_submission_rubric',
    'Get YOUR per-criterion rubric assessment on a submission, joined to the rubric template. Shows points awarded vs. possible per criterion + grader comments + which rating tier was selected. Use this AFTER an assignment is graded to see exactly where points were lost. Returns null if the submission has no rubric assessment yet.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      assignment_id: z.number().int().positive().describe('The Canvas assignment ID'),
    },
    async ({ course_id, assignment_id }) => {
      try {
        // Fetch in parallel — assignment for the rubric template, submission for
        // your assessment. Submission needs include[]=rubric_assessment.
        const [assignment, submission] = await Promise.all([
          client.getAssignment(course_id, assignment_id),
          client.getSubmission(course_id, assignment_id, 'self', [
            'rubric_assessment',
            'full_rubric_assessment',
            'submission_comments',
          ]),
        ]);

        const hasTemplate = (assignment.rubric?.length ?? 0) > 0;
        const hasAssessment = submission.rubric_assessment && Object.keys(submission.rubric_assessment).length > 0;

        if (!hasTemplate || !hasAssessment) {
          return formatSuccess({
            course_id,
            assignment_id,
            assignment_name: assignment.name,
            submission_id: submission.id,
            workflow_state: submission.workflow_state,
            has_rubric: hasTemplate,
            has_assessment: hasAssessment,
            assessment: null,
            note: !hasTemplate
              ? 'No rubric attached to this assignment.'
              : 'Submission has no rubric assessment yet (likely ungraded or grader did not use the rubric).',
          });
        }

        const ratingById = new Map<string, { description: string; points: number }>();
        for (const c of assignment.rubric ?? []) {
          for (const r of c.ratings ?? []) {
            ratingById.set(r.id, { description: r.description, points: r.points });
          }
        }

        // Join template criteria with the assessment.
        type Joined = {
          criterion_id: string;
          description: string;
          points_possible: number;
          points_awarded: number | null;
          points_lost: number | null;
          rating_id: string | null;
          rating_description: string | null;
          comments: string | null;
        };
        const joined: Joined[] = [];
        let totalPossible = 0;
        let totalAwarded = 0;
        for (const c of assignment.rubric ?? []) {
          if (c.ignore_for_scoring) continue;
          totalPossible += c.points;
          const entry = submission.rubric_assessment?.[c.id];
          const awarded = entry?.points ?? null;
          if (awarded !== null && awarded !== undefined) totalAwarded += awarded;
          const ratingId = entry?.rating_id ?? null;
          const ratingMeta = ratingId ? ratingById.get(ratingId) ?? null : null;
          joined.push({
            criterion_id: c.id,
            description: c.description,
            points_possible: c.points,
            points_awarded: awarded,
            points_lost: awarded !== null && awarded !== undefined ? c.points - awarded : null,
            rating_id: ratingId,
            rating_description: ratingMeta?.description ?? null,
            comments: entry?.comments ?? null,
          });
        }

        // Rank where points were lost — most-points-lost first; useful for
        // the rubric-loss-pattern coach later.
        const lossRanked = [...joined]
          .filter((j) => j.points_lost !== null && j.points_lost > 0)
          .sort((a, b) => (b.points_lost ?? 0) - (a.points_lost ?? 0));

        return formatSuccess({
          course_id,
          assignment_id,
          assignment_name: assignment.name,
          submission_id: submission.id,
          workflow_state: submission.workflow_state,
          has_rubric: true,
          has_assessment: true,
          score: submission.score,
          grade: submission.grade,
          total_points_possible: totalPossible,
          total_points_awarded: totalAwarded,
          total_points_lost: totalPossible - totalAwarded,
          criteria: joined,
          biggest_losses: lossRanked.slice(0, 3),
        });
      } catch (error) {
        return formatError('getting submission rubric', error);
      }
    },
  );
}

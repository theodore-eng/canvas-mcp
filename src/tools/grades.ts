import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, runWithConcurrency } from '../utils.js';
import { detectGradeDeflation, flattenAssignmentGroups } from '../services/grade-utils.js';

export function registerGradeTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'get_my_grades',
    'Get your current grades across all active courses. Shows current score, final score, letter grades, and detects grade deflation from future-dated assignments scored as 0.',
    {},
    async () => {
      try {
        // Use current-term filter so old/future-term enrollments don't
        // pollute the grades report.
        const courses = await client.getCurrentCourses(['total_scores']);

        const coursesWithEnrollments = courses.filter(
          course => course.enrollments && course.enrollments.length > 0
        );

        // Fetch assignment groups for each course to detect future-zero deflation
        const groupResults = await runWithConcurrency(
          coursesWithEnrollments.map((course) => async () => {
            const groups = await client.listAssignmentGroups(course.id, {
              include: ['assignments', 'submission'],
            });
            return { courseId: course.id, groups };
          }),
          3
        );

        // Build a lookup: courseId -> assignment groups
        const groupsByCourse = new Map<number, typeof groupResults[number]>();
        for (let i = 0; i < coursesWithEnrollments.length; i++) {
          const result = groupResults[i];
          if (result.status === 'fulfilled') {
            groupsByCourse.set(coursesWithEnrollments[i].id, result);
          }
        }

        const now = new Date();

        const grades = coursesWithEnrollments.map(course => {
          const enrollment = course.enrollments?.[0];
          const currentScore = enrollment?.computed_current_score ?? null;
          const finalScore = enrollment?.computed_final_score ?? null;
          const currentGrade = enrollment?.computed_current_grade ?? null;
          const finalGrade = enrollment?.computed_final_grade ?? null;

          // Analyze for future-zero deflation
          let adjustedScore: number | null = null;
          let deflationWarning: string | null = null;
          let futureZeroCount = 0;
          let finalScoreNote: string | null = null;

          const groupResult = groupsByCourse.get(course.id);
          if (groupResult && groupResult.status === 'fulfilled') {
            const { groups } = groupResult.value;
            const deflation = detectGradeDeflation(
              flattenAssignmentGroups(groups),
              now,
              currentScore,
            );
            adjustedScore = deflation.adjustedScore;
            deflationWarning = deflation.deflationWarning;
            futureZeroCount = deflation.futureZeroCount;
          }

          // Bug #13: Flag when final_score is wildly different from current_score
          if (
            finalScore !== null &&
            currentScore !== null &&
            Math.abs(finalScore - currentScore) > 10
          ) {
            finalScoreNote =
              'Final score treats unsubmitted work as 0. See adjusted_score for your actual performance.';
          }

          return {
            course_id: course.id,
            course_name: course.name,
            course_code: course.course_code,
            term: course.term?.name,
            current_score: currentScore,
            current_grade: currentGrade,
            final_score: finalScore,
            final_grade: finalGrade,
            adjusted_score: adjustedScore,
            ...(deflationWarning ? { deflation_warning: deflationWarning } : {}),
            ...(finalScoreNote ? { final_score_note: finalScoreNote } : {}),
            ...(futureZeroCount > 0 ? { future_zero_count: futureZeroCount } : {}),
            apply_assignment_group_weights: course.apply_assignment_group_weights,
          };
        });

        return formatSuccess({
          count: grades.length,
          grades,
        });
      } catch (error) {
        return formatError('getting grades', error);
      }
    }
  );

  server.tool(
    'get_my_submission_status',
    'Check what you have and haven\'t submitted across all courses. Returns three buckets: confirmed_submitted (workflow_state=submitted/graded), confirmed_missing (no submission, past due, regular assignment type), and indeterminate (past due but submission state may live elsewhere — quizzes, discussions, group assignments). NEVER treat indeterminate as missing without a follow-up check.',
    {},
    async () => {
      try {
        const courses = await client.getCurrentCourses();

        const results = await runWithConcurrency(
          courses.map((course) => async () => {
            const assignments = await client.listAssignments(course.id, {
              include: ['submission'],
            });

            const now = new Date();
            const confirmedMissing: Array<{
              assignment_id: number;
              course_id: number;
              name: string;
              due_at: string | null;
              points_possible: number;
              days_overdue: number | null;
              html_url: string;
            }> = [];
            const indeterminate: Array<{
              assignment_id: number;
              course_id: number;
              name: string;
              due_at: string | null;
              points_possible: number;
              days_overdue: number | null;
              html_url: string;
              reason: 'quiz' | 'discussion' | 'group';
              hint: string;
            }> = [];
            const notYetDue: Array<{
              assignment_id: number;
              course_id: number;
              name: string;
              due_at: string | null;
              points_possible: number;
              html_url: string;
            }> = [];
            let submittedCount = 0;

            for (const a of assignments) {
              if (!a.published) continue;
              const sub = a.submission;
              const isSubmitted = sub?.workflow_state === 'submitted' || sub?.workflow_state === 'graded';

              if (isSubmitted) {
                submittedCount++;
                continue;
              }

              if (a.due_at && new Date(a.due_at) >= now) {
                notYetDue.push({
                  assignment_id: a.id,
                  course_id: course.id,
                  name: a.name,
                  due_at: a.due_at,
                  points_possible: a.points_possible,
                  html_url: a.html_url,
                });
                continue;
              }

              if (!a.due_at || new Date(a.due_at) >= now) continue;

              // Past due, not submitted. Decide if this is truly "missing" or
              // if the submission state lives in an API we did not query
              // (quizzes, discussions, group assignments). Be conservative:
              // anything we cannot confirm goes into the indeterminate bucket
              // so the briefing never claims "you didn't do X" without proof.
              const types = a.submission_types ?? [];
              const isQuiz = types.includes('online_quiz');
              const isDiscussion = types.includes('discussion_topic');
              // Canvas exposes group_category_id on assignments; not yet in
              // our type — read defensively.
              const groupCategoryId = (a as unknown as { group_category_id?: number | null }).group_category_id ?? null;
              const isGroup = groupCategoryId != null;

              const daysOverdue = Math.floor((now.getTime() - new Date(a.due_at).getTime()) / (1000 * 60 * 60 * 24));
              const baseEntry = {
                assignment_id: a.id,
                course_id: course.id,
                name: a.name,
                due_at: a.due_at,
                points_possible: a.points_possible,
                days_overdue: daysOverdue,
                html_url: a.html_url,
              };

              if (isQuiz) {
                indeterminate.push({
                  ...baseEntry,
                  reason: 'quiz',
                  hint: 'Canvas Quizzes track submission state separately. Verify via the quizzes API or by visiting the assignment URL.',
                });
              } else if (isDiscussion) {
                indeterminate.push({
                  ...baseEntry,
                  reason: 'discussion',
                  hint: 'Discussion participation may not surface as a submission. Verify by listing discussion entries authored by self.',
                });
              } else if (isGroup) {
                indeterminate.push({
                  ...baseEntry,
                  reason: 'group',
                  hint: 'Group assignment — your teammate may have submitted on the group\'s behalf. Verify the group\'s submission record.',
                });
              } else {
                confirmedMissing.push(baseEntry);
              }
            }

            return {
              course_id: course.id,
              course_name: course.name,
              confirmed_missing: confirmedMissing.sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0)),
              indeterminate: indeterminate.sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0)),
              not_yet_due: notYetDue.sort((a, b) => {
                if (!a.due_at) return 1;
                if (!b.due_at) return -1;
                return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
              }),
              submitted_count: submittedCount,
              confirmed_missing_count: confirmedMissing.length,
              indeterminate_count: indeterminate.length,
            };
          })
        );

        const courseResults = results
          .filter((r): r is PromiseFulfilledResult<{
            course_id: number;
            course_name: string;
            confirmed_missing: Array<{ assignment_id: number; course_id: number; name: string; due_at: string | null; points_possible: number; days_overdue: number | null; html_url: string }>;
            indeterminate: Array<{ assignment_id: number; course_id: number; name: string; due_at: string | null; points_possible: number; days_overdue: number | null; html_url: string; reason: 'quiz' | 'discussion' | 'group'; hint: string }>;
            not_yet_due: Array<{ assignment_id: number; course_id: number; name: string; due_at: string | null; points_possible: number; html_url: string }>;
            submitted_count: number;
            confirmed_missing_count: number;
            indeterminate_count: number;
          }> => r.status === 'fulfilled')
          .map(r => r.value);

        const totalConfirmedMissing = courseResults.reduce((sum, c) => sum + c.confirmed_missing_count, 0);
        const totalIndeterminate = courseResults.reduce((sum, c) => sum + c.indeterminate_count, 0);
        const totalPointsAtRisk = courseResults.reduce((sum, c) =>
          sum + c.confirmed_missing.reduce((s, m) => s + m.points_possible, 0), 0);
        const totalIndeterminatePoints = courseResults.reduce((sum, c) =>
          sum + c.indeterminate.reduce((s, m) => s + m.points_possible, 0), 0);

        const failedCourses = results
          .map((r, i) => r.status === 'rejected' ? courses[i].name : null)
          .filter(Boolean);

        return formatSuccess({
          total_confirmed_missing: totalConfirmedMissing,
          total_indeterminate: totalIndeterminate,
          total_points_at_risk: totalPointsAtRisk,
          total_indeterminate_points: totalIndeterminatePoints,
          contract_note: 'Per the briefing contract, do NOT report indeterminate items as "missing" without further verification — they are quizzes / discussions / group assignments where submission state may live in another API.',
          courses: courseResults,
          ...(failedCourses.length > 0 ? { failed_courses: failedCourses } : {}),
        });
      } catch (error) {
        return formatError('getting submission status', error);
      }
    }
  );
}

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
        const courses = await client.listCourses({
          enrollment_state: 'active',
          state: ['available'],
          include: ['total_scores', 'current_grading_period_scores', 'term'],
        });

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
    'Check what you have and haven\'t submitted across all courses. Shows missing and not-yet-due assignments with points at risk. Use this to find overdue work.',
    {},
    async () => {
      try {
        const courses = await client.getActiveCourses();

        const results = await runWithConcurrency(
          courses.map((course) => async () => {
            const assignments = await client.listAssignments(course.id, {
              include: ['submission'],
            });

            const now = new Date();
            const missing: Array<{
              name: string;
              due_at: string | null;
              points_possible: number;
              days_overdue: number | null;
              html_url: string;
            }> = [];
            const notYetDue: Array<{
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
              } else if (a.due_at && new Date(a.due_at) < now) {
                missing.push({
                  name: a.name,
                  due_at: a.due_at,
                  points_possible: a.points_possible,
                  days_overdue: Math.floor((now.getTime() - new Date(a.due_at).getTime()) / (1000 * 60 * 60 * 24)),
                  html_url: a.html_url,
                });
              } else if (a.due_at && new Date(a.due_at) >= now) {
                notYetDue.push({
                  name: a.name,
                  due_at: a.due_at,
                  points_possible: a.points_possible,
                  html_url: a.html_url,
                });
              }
            }

            return {
              course_id: course.id,
              course_name: course.name,
              missing: missing.sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0)),
              not_yet_due: notYetDue.sort((a, b) => {
                if (!a.due_at) return 1;
                if (!b.due_at) return -1;
                return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
              }),
              submitted_count: submittedCount,
              missing_count: missing.length,
            };
          })
        );

        const courseResults = results
          .filter((r): r is PromiseFulfilledResult<{
            course_id: number;
            course_name: string;
            missing: Array<{ name: string; due_at: string | null; points_possible: number; days_overdue: number | null; html_url: string }>;
            not_yet_due: Array<{ name: string; due_at: string | null; points_possible: number; html_url: string }>;
            submitted_count: number;
            missing_count: number;
          }> => r.status === 'fulfilled')
          .map(r => r.value);

        const totalMissing = courseResults.reduce((sum, c) => sum + c.missing_count, 0);
        const totalPointsAtRisk = courseResults.reduce((sum, c) =>
          sum + c.missing.reduce((s, m) => s + m.points_possible, 0), 0);

        const failedCourses = results
          .map((r, i) => r.status === 'rejected' ? courses[i].name : null)
          .filter(Boolean);

        return formatSuccess({
          total_missing: totalMissing,
          total_points_at_risk: totalPointsAtRisk,
          courses: courseResults,
          ...(failedCourses.length > 0 ? { failed_courses: failedCourses } : {}),
        });
      } catch (error) {
        return formatError('getting submission status', error);
      }
    }
  );
}

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, runWithConcurrency } from '../utils.js';

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

            let totalEarned = 0;
            let totalPossible = 0;
            let futureZeroEarned = 0;
            let futureZeroPossible = 0;

            for (const group of groups) {
              for (const assignment of group.assignments ?? []) {
                if (!assignment.published || assignment.omit_from_final_grade) continue;

                const sub = assignment.submission;
                if (!sub || sub.workflow_state !== 'graded' || sub.score === null) continue;

                totalEarned += sub.score;
                totalPossible += assignment.points_possible;

                // Detect future-dated assignments graded as 0
                if (
                  sub.score === 0 &&
                  assignment.due_at &&
                  new Date(assignment.due_at) > now
                ) {
                  futureZeroCount++;
                  futureZeroEarned += sub.score;
                  futureZeroPossible += assignment.points_possible;
                }
              }
            }

            // Compute adjusted score excluding future zeros
            if (futureZeroCount > 0) {
              const adjEarned = totalEarned - futureZeroEarned;
              const adjPossible = totalPossible - futureZeroPossible;
              if (adjPossible > 0) {
                adjustedScore = Math.round((adjEarned / adjPossible) * 10000) / 100;
              }

              if (
                currentScore !== null &&
                adjustedScore !== null &&
                Math.abs(currentScore - adjustedScore) > 5
              ) {
                deflationWarning =
                  `${futureZeroCount} future-dated assignment(s) graded as 0 may be deflating your score. ` +
                  `Canvas shows ${currentScore}% but excluding future zeros gives ${adjustedScore}%.`;
              }
            }
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
    'Check what you have and haven\'t submitted across all courses. Shows overdue and missing assignments.',
    {},
    async () => {
      try {
        const courses = await client.listCourses({
          enrollment_state: 'active',
          state: ['available'],
        });

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
            const submitted: Array<{
              name: string;
              grade: string | null;
              score: number | null;
              points_possible: number;
            }> = [];

            for (const a of assignments) {
              if (!a.published) continue;
              const sub = a.submission;
              const isSubmitted = sub?.workflow_state === 'submitted' || sub?.workflow_state === 'graded';

              if (isSubmitted) {
                submitted.push({
                  name: a.name,
                  grade: sub?.grade ?? null,
                  score: sub?.score ?? null,
                  points_possible: a.points_possible,
                });
              } else if (a.due_at && new Date(a.due_at) < now) {
                missing.push({
                  name: a.name,
                  due_at: a.due_at,
                  points_possible: a.points_possible,
                  days_overdue: Math.floor((now.getTime() - new Date(a.due_at).getTime()) / (1000 * 60 * 60 * 24)),
                  html_url: a.html_url,
                });
              }
            }

            return {
              course_id: course.id,
              course_name: course.name,
              missing: missing.sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0)),
              submitted: submitted,
              submitted_count: submitted.length,
              missing_count: missing.length,
            };
          })
        );

        const courseResults = results
          .filter((r): r is PromiseFulfilledResult<{
            course_id: number;
            course_name: string;
            missing: Array<{ name: string; due_at: string | null; points_possible: number; days_overdue: number | null; html_url: string }>;
            submitted: Array<{ name: string; grade: string | null; score: number | null; points_possible: number }>;
            submitted_count: number;
            missing_count: number;
          }> => r.status === 'fulfilled')
          .map(r => r.value);

        const failedCourses = results
          .map((r, i) => r.status === 'rejected' ? courses[i].name : null)
          .filter(Boolean);

        return formatSuccess({
          courses: courseResults,
          total_missing: courseResults.reduce((sum, c) => sum + c.missing_count, 0),
          ...(failedCourses.length > 0 ? { failed_courses: failedCourses } : {}),
        });
      } catch (error) {
        return formatError('getting submission status', error);
      }
    }
  );
}

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';

export function registerGradeTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'get_my_grades',
    'Get your current grades across all active courses',
    {},
    async () => {
      try {
        const courses = await client.listCourses({
          enrollment_state: 'active',
          state: ['available'],
          include: ['total_scores', 'current_grading_period_scores', 'term'],
        });

        const grades = courses
          .filter(course => course.enrollments && course.enrollments.length > 0)
          .map(course => {
            const enrollment = course.enrollments![0];
            return {
              course_id: course.id,
              course_name: course.name,
              course_code: course.course_code,
              term: course.term?.name,
              current_score: enrollment.computed_current_score ?? null,
              current_grade: enrollment.computed_current_grade ?? null,
              final_score: enrollment.computed_final_score ?? null,
              final_grade: enrollment.computed_final_grade ?? null,
            };
          });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: grades.length,
              grades,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error getting grades: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
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

        const results = await Promise.allSettled(
          courses.map(async (course) => {
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
            submitted_count: number;
            missing_count: number;
          }> => r.status === 'fulfilled')
          .map(r => r.value);

        const failedCourses = results
          .map((r, i) => r.status === 'rejected' ? courses[i].name : null)
          .filter(Boolean);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              courses: courseResults,
              total_missing: courseResults.reduce((sum, c) => sum + c.missing_count, 0),
              ...(failedCourses.length > 0 ? { failed_courses: failedCourses } : {}),
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error getting submission status: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );
}

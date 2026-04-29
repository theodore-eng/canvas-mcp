import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess } from '../utils.js';

/**
 * Quiz tools — Canvas Quizzes live in a separate API tree from
 * assignments, which is why get_my_submission_status falls back to
 * "indeterminate" for them. These tools authoritatively answer
 * "did I take this quiz, and what did I score?"
 */

export function registerQuizTools(server: McpServer) {
  const client = getCanvasClient();

  // ==================== list_quizzes ====================

  server.tool(
    'list_quizzes',
    'List quizzes in a course with their due dates, attempt rules, and lock status. Quizzes are a separate Canvas object tree from assignments — use this when you need quiz-specific data (time limit, attempts allowed, scoring policy) that the assignment list does not expose.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      search_term: z.string().min(2).max(200).optional()
        .describe('Optional substring to filter quiz titles by.'),
    },
    async ({ course_id, search_term }) => {
      try {
        const quizzes = await client.listQuizzes(course_id, search_term ? { search_term } : {});
        const now = new Date();
        const formatted = quizzes
          .filter((q) => q.published)
          .map((q) => {
            const dueAt = q.due_at ? new Date(q.due_at) : null;
            const lockAt = q.lock_at ? new Date(q.lock_at) : null;
            return {
              quiz_id: q.id,
              course_id,
              title: q.title,
              quiz_type: q.quiz_type,
              points_possible: q.points_possible,
              question_count: q.question_count ?? null,
              allowed_attempts: q.allowed_attempts,
              time_limit_minutes: q.time_limit ?? null,
              scoring_policy: q.scoring_policy ?? null,
              due_at: q.due_at,
              lock_at: q.lock_at,
              unlock_at: q.unlock_at,
              days_until_due: dueAt
                ? Math.ceil((dueAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                : null,
              locked: q.locked_for_user ?? false,
              past_lock_at: lockAt ? lockAt < now : false,
              assignment_id: q.assignment_id ?? null,
              html_url: q.html_url,
            };
          })
          .sort((a, b) => {
            if (!a.due_at) return 1;
            if (!b.due_at) return -1;
            return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
          });

        return formatSuccess({
          course_id,
          count: formatted.length,
          quizzes: formatted,
        });
      } catch (error) {
        return formatError('listing quizzes', error);
      }
    },
  );

  // ==================== get_quiz ====================

  server.tool(
    'get_quiz',
    'Get full details for a single quiz: title, points possible, time limit, attempts allowed, scoring policy, lock/unlock windows. Use after list_quizzes when you need more depth than the listing.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      quiz_id: z.number().int().positive().describe('The Canvas quiz ID'),
    },
    async ({ course_id, quiz_id }) => {
      try {
        const q = await client.getQuiz(course_id, quiz_id);
        return formatSuccess({
          quiz_id: q.id,
          course_id,
          title: q.title,
          description_preview: q.description ? q.description.slice(0, 500) : null,
          quiz_type: q.quiz_type,
          points_possible: q.points_possible,
          question_count: q.question_count ?? null,
          allowed_attempts: q.allowed_attempts,
          time_limit_minutes: q.time_limit ?? null,
          scoring_policy: q.scoring_policy ?? null,
          shuffle_answers: q.shuffle_answers ?? false,
          one_question_at_a_time: q.one_question_at_a_time ?? false,
          cant_go_back: q.cant_go_back ?? false,
          due_at: q.due_at,
          lock_at: q.lock_at,
          unlock_at: q.unlock_at,
          published: q.published,
          locked_for_user: q.locked_for_user ?? false,
          show_correct_answers: q.show_correct_answers ?? false,
          show_correct_answers_at: q.show_correct_answers_at ?? null,
          assignment_id: q.assignment_id ?? null,
          html_url: q.html_url,
        });
      } catch (error) {
        return formatError('getting quiz', error);
      }
    },
  );

  // ==================== get_my_quiz_submission ====================

  server.tool(
    'get_my_quiz_submission',
    'Authoritatively check whether YOU took a quiz and what you scored. Returns workflow_state (untaken / complete / pending_review), kept_score (the score Canvas actually counts), per-attempt history, time_spent, and attempts_left. Use this to resolve the "indeterminate" path that get_my_submission_status returns for quizzes.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      quiz_id: z.number().int().positive().describe('The Canvas quiz ID'),
    },
    async ({ course_id, quiz_id }) => {
      try {
        const subs = await client.getMyQuizSubmissions(course_id, quiz_id);
        if (subs.length === 0) {
          return formatSuccess({
            course_id,
            quiz_id,
            taken: false,
            attempt_count: 0,
            kept_score: null,
            workflow_state: null,
            note: 'No quiz submissions on record — quiz has not been started.',
          });
        }

        // Latest attempt is most informative (kept_score is consistent across
        // attempts, but workflow_state and times reflect the latest one).
        const latest = subs.reduce((acc, s) => {
          if (!acc) return s;
          return (s.attempt ?? 0) > (acc.attempt ?? 0) ? s : acc;
        }, subs[0]);

        const taken = subs.some(
          (s) => s.workflow_state === 'complete' || s.workflow_state === 'pending_review',
        );

        return formatSuccess({
          course_id,
          quiz_id,
          taken,
          attempt_count: subs.length,
          kept_score: latest.kept_score,
          quiz_points_possible: latest.quiz_points_possible,
          score_pct: latest.kept_score !== null && latest.quiz_points_possible !== null && latest.quiz_points_possible > 0
            ? Math.round((latest.kept_score / latest.quiz_points_possible) * 1000) / 10
            : null,
          latest: {
            attempt: latest.attempt,
            workflow_state: latest.workflow_state,
            score: latest.score,
            started_at: latest.started_at,
            finished_at: latest.finished_at,
            time_spent_seconds: latest.time_spent ?? null,
            attempts_left: latest.attempts_left,
            submission_id: latest.submission_id ?? null,
            overdue_and_needs_submission: latest.overdue_and_needs_submission ?? false,
          },
          all_attempts: subs.map((s) => ({
            attempt: s.attempt,
            workflow_state: s.workflow_state,
            score: s.score,
            kept_score: s.kept_score,
            finished_at: s.finished_at,
          })),
        });
      } catch (error) {
        return formatError('getting quiz submission', error);
      }
    },
  );
}

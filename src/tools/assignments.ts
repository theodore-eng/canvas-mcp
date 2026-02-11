import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, formatFileSize, stripHtmlTags, extractLinkedFiles, runWithConcurrency } from '../utils.js';

export function registerAssignmentTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'list_assignments',
    'List assignments in a course with submission status and grades. Can filter by status bucket (upcoming, overdue, etc.)',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      bucket: z.enum(['past', 'overdue', 'undated', 'ungraded', 'unsubmitted', 'upcoming', 'future']).optional()
        .describe('Filter assignments by status/time bucket'),
      order_by: z.enum(['position', 'name', 'due_at']).optional()
        .describe('Order results by field'),
      include_submission: z.boolean().optional().default(true)
        .describe('Include current user submission status'),
    },
    async ({ course_id, bucket, order_by, include_submission }) => {
      try {
        const include: string[] = [];
        if (include_submission) {
          include.push('submission');
        }

        const assignments = await client.listAssignments(course_id, {
          bucket,
          order_by,
          include: include as ('submission')[],
        });

        const submissionTypeLabels: Record<string, string> = {
          online_upload: 'File Upload',
          online_text_entry: 'Text Entry',
          online_quiz: 'Quiz',
          online_url: 'URL',
          media_recording: 'Media Recording',
          external_tool: 'External Tool',
        };

        const formattedAssignments = assignments.map(a => ({
          id: a.id,
          name: a.name,
          due_at: a.due_at,
          points_possible: a.points_possible,
          submission_types: a.submission_types.map(t => submissionTypeLabels[t] ?? t),
          ...(a.locked_for_user ? { locked_for_user: true, lock_explanation: a.lock_explanation } : {}),
          has_submitted: a.submission?.workflow_state === 'submitted' || a.submission?.workflow_state === 'graded',
          submission_status: a.submission?.workflow_state,
          grade: a.submission?.grade,
          score: a.submission?.score,
          html_url: a.html_url,
        }));

        return formatSuccess({ count: formattedAssignments.length, assignments: formattedAssignments });
      } catch (error) {
        return formatError('listing assignments', error);
      }
    }
  );

  server.tool(
    'get_assignment',
    'Get full details about a specific assignment including description, rubric criteria and ratings, and your submission status. Includes rubric by default.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      assignment_id: z.number().int().positive().describe('The assignment ID'),
      include_rubric: z.boolean().optional().default(true)
        .describe('Include rubric criteria if available'),
    },
    async ({ course_id, assignment_id, include_rubric }) => {
      try {
        const include = ['submission'];

        const assignment = await client.getAssignment(course_id, assignment_id, include);

        // Extract file links before stripping HTML (stripHtmlTags destroys link info)
        const linked_files = assignment.description ? extractLinkedFiles(assignment.description) : [];

        const result: Record<string, unknown> = {
          id: assignment.id,
          name: assignment.name,
          description: assignment.description
            ? stripHtmlTags(assignment.description)
            : null,
          linked_files,
          due_at: assignment.due_at,
          unlock_at: assignment.unlock_at,
          lock_at: assignment.lock_at,
          points_possible: assignment.points_possible,
          grading_type: assignment.grading_type,
          submission_types: assignment.submission_types,
          allowed_extensions: assignment.allowed_extensions,
          allowed_attempts: assignment.allowed_attempts === -1 ? 'unlimited' : assignment.allowed_attempts,
          published: assignment.published,
          locked_for_user: assignment.locked_for_user,
          lock_explanation: assignment.lock_explanation,
          html_url: assignment.html_url,
          submission: assignment.submission ? {
            workflow_state: assignment.submission.workflow_state,
            submitted_at: assignment.submission.submitted_at,
            attempt: assignment.submission.attempt,
            grade: assignment.submission.grade,
            score: assignment.submission.score,
            late: assignment.submission.late,
            missing: assignment.submission.missing,
            excused: assignment.submission.excused,
          } : null,
        };

        if (include_rubric && assignment.rubric) {
          result.rubric = {
            settings: assignment.rubric_settings,
            use_for_grading: assignment.use_rubric_for_grading,
            criteria: assignment.rubric.map(criterion => ({
              id: criterion.id,
              description: criterion.description,
              long_description: criterion.long_description,
              points: criterion.points,
              ratings: criterion.ratings.map(rating => ({
                description: rating.description,
                long_description: rating.long_description,
                points: rating.points,
              })),
            })),
          };
        }

        return formatSuccess(result);
      } catch (error) {
        return formatError('getting assignment', error);
      }
    }
  );

  server.tool(
    'extract_assignment_files',
    'Extract and download all files linked in an assignment description. Finds Canvas file links (PDFs, docs, etc.) embedded in the assignment HTML and downloads them to a local folder.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      assignment_id: z.number().int().positive().describe('The assignment ID'),
      target_path: z.string().describe('Local directory to save files to (e.g., "~/Downloads/hw3")'),
    },
    async ({ course_id, assignment_id, target_path }) => {
      try {
        const assignment = await client.getAssignment(course_id, assignment_id);

        if (!assignment.description) {
          return formatSuccess({
            assignment_name: assignment.name,
            message: 'Assignment has no description — no linked files to extract.',
            files: [],
          });
        }

        const linkedFiles = extractLinkedFiles(assignment.description);

        if (linkedFiles.length === 0) {
          return formatSuccess({
            assignment_name: assignment.name,
            message: 'No Canvas file links found in the assignment description.',
            files: [],
          });
        }

        // Validate target_path is under $HOME
        const expandedPath = target_path.replace(/^~/, os.homedir());
        const resolvedTarget = path.resolve(expandedPath);
        if (!resolvedTarget.startsWith(os.homedir())) {
          throw new Error('Path must be under home directory');
        }

        await mkdir(resolvedTarget, { recursive: true });

        // Download each linked file (get metadata first, then download)
        const downloadTasks = linkedFiles
          .filter(lf => lf.file_id !== null)
          .map(lf => async () => {
            const file = await client.getFile(lf.file_id!);
            const arrayBuffer = await client.downloadFile(file.url);
            const buffer = Buffer.from(arrayBuffer);

            const safeName = path.basename(file.filename).replace(/[/\\]/g, '_');
            const localPath = path.join(resolvedTarget, safeName);
            const resolvedLocal = path.resolve(localPath);
            if (!resolvedLocal.startsWith(resolvedTarget)) {
              throw new Error('Filename would write outside target directory');
            }

            await writeFile(resolvedLocal, buffer);

            return {
              file_id: file.id,
              filename: safeName,
              content_type: file['content-type'],
              size: formatFileSize(file.size),
              local_path: resolvedLocal,
            };
          });

        const results = await runWithConcurrency(downloadTasks, 3);

        const downloaded: Array<Record<string, unknown>> = [];
        const errors: string[] = [];

        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === 'fulfilled') {
            downloaded.push(r.value);
          } else {
            const lf = linkedFiles.filter(f => f.file_id !== null)[i];
            errors.push(`${lf.filename} (file_id ${lf.file_id}): ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
          }
        }

        return formatSuccess({
          assignment_name: assignment.name,
          target_path: resolvedTarget,
          downloaded_count: downloaded.length,
          files: downloaded,
          ...(errors.length > 0 ? { errors } : {}),
        });
      } catch (error) {
        return formatError('extracting assignment files', error);
      }
    }
  );

}

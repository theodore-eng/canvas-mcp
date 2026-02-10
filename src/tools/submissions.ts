import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess } from '../utils.js';

export function registerSubmissionTools(server: McpServer) {
  const client = getCanvasClient();

  // Read tool — always registered
  server.tool(
    'get_submission',
    'Get your submission details for an assignment, including grade, score, feedback comments, and rubric assessment',
    {
      course_id: z.number().describe('The Canvas course ID'),
      assignment_id: z.number().describe('The assignment ID'),
      include_comments: z.boolean().optional().default(true)
        .describe('Include submission comments/feedback'),
    },
    async ({ course_id, assignment_id, include_comments }) => {
      try {
        const include = ['submission_comments', 'rubric_assessment'];

        const submission = await client.getSubmission(
          course_id,
          assignment_id,
          'self',
          include
        );

        const result: Record<string, unknown> = {
          id: submission.id,
          assignment_id: submission.assignment_id,
          user_id: submission.user_id,
          submitted_at: submission.submitted_at,
          attempt: submission.attempt,
          workflow_state: submission.workflow_state,
          grade: submission.grade,
          score: submission.score,
          graded_at: submission.graded_at,
          late: submission.late,
          missing: submission.missing,
          excused: submission.excused,
          points_deducted: submission.points_deducted,
          submission_type: submission.submission_type,
          body: submission.body,
          url: submission.url,
          preview_url: submission.preview_url,
        };

        if (submission.attachments && submission.attachments.length > 0) {
          result.attachments = submission.attachments.map(att => ({
            id: att.id,
            filename: att.filename,
            display_name: att.display_name,
            url: att.url,
            size: att.size,
            content_type: att.content_type,
          }));
        }

        if (include_comments && submission.submission_comments) {
          result.comments = submission.submission_comments.map(comment => ({
            id: comment.id,
            author_name: comment.author_name,
            comment: comment.comment,
            created_at: comment.created_at,
          }));
        }

        return formatSuccess(result);
      } catch (error) {
        return formatError('getting submission', error);
      }
    }
  );

  // Write tools — only registered when ENABLE_WRITE_TOOLS is set
  if (process.env.ENABLE_WRITE_TOOLS === 'true') {
    server.tool(
      'submit_assignment',
      'Submit an assignment with text content or a URL. WARNING: This actually submits to Canvas and is visible to your instructor. Only use when explicitly asked.',
      {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The assignment ID'),
        submission_type: z.enum(['online_text_entry', 'online_url']).describe('Type of submission'),
        body: z.string().optional().describe('Text content for online_text_entry submissions (supports HTML)'),
        url: z.string().optional().describe('URL for online_url submissions'),
      },
      async ({ course_id, assignment_id, submission_type, body, url }) => {
        try {
          if (submission_type === 'online_text_entry' && !body) {
            return formatError('submitting assignment',
              new Error('body is required for online_text_entry submissions'));
          }

          if (submission_type === 'online_url' && !url) {
            return formatError('submitting assignment',
              new Error('url is required for online_url submissions'));
          }

          const submission = await client.submitAssignment(course_id, assignment_id, {
            submission_type,
            body,
            url,
          });

          return formatSuccess({
            success: true,
            message: 'Assignment submitted successfully',
            submission: {
              id: submission.id,
              submitted_at: submission.submitted_at,
              attempt: submission.attempt,
              workflow_state: submission.workflow_state,
            },
          });
        } catch (error) {
          return formatError('submitting assignment', error);
        }
      }
    );

    server.tool(
      'upload_file',
      'Upload a file and optionally submit it for an assignment. WARNING: If submit_after_upload is true, this submits to Canvas.',
      {
        course_id: z.number().describe('The Canvas course ID'),
        assignment_id: z.number().describe('The assignment ID'),
        file_name: z.string().min(1).describe('Name of the file to upload'),
        file_content: z.string().describe('Base64 encoded file content'),
        content_type: z.string().describe('MIME type of the file (e.g., application/pdf, text/plain)'),
        submit_after_upload: z.boolean().optional().default(true)
          .describe('Automatically submit the assignment after uploading'),
      },
      async ({ course_id, assignment_id, file_name, file_content, content_type, submit_after_upload }) => {
        try {
          // Decode base64 with error handling
          let fileBuffer: Uint8Array;
          try {
            const binaryString = atob(file_content);
            fileBuffer = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              fileBuffer[i] = binaryString.charCodeAt(i);
            }
          } catch {
            return formatError('uploading file',
              new Error('Invalid base64 file content'));
          }

          const fileSize = fileBuffer.length;

          const uploadInfo = await client.initiateFileUpload(
            course_id,
            assignment_id,
            file_name,
            fileSize,
            content_type
          );

          const uploadResult = await client.uploadFileToUrl(
            uploadInfo.upload_url,
            uploadInfo.upload_params,
            fileBuffer,
            file_name,
            content_type
          );

          if (submit_after_upload) {
            const submission = await client.submitAssignment(course_id, assignment_id, {
              submission_type: 'online_upload',
              file_ids: [uploadResult.id],
            });

            return formatSuccess({
              success: true,
              message: 'File uploaded and assignment submitted successfully',
              file: { id: uploadResult.id, name: file_name },
              submission: {
                id: submission.id,
                submitted_at: submission.submitted_at,
                attempt: submission.attempt,
              },
            });
          }

          return formatSuccess({
            success: true,
            message: 'File uploaded successfully (not submitted yet)',
            file: { id: uploadResult.id, name: file_name },
            note: 'Use submit_assignment with file_ids to submit this file',
          });
        } catch (error) {
          return formatError('uploading file', error);
        }
      }
    );
  }
}

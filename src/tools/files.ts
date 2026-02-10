import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import {
  formatError,
  formatSuccess,
  formatFileSize,
  extractTextFromFile,
  MAX_FILE_SIZE,
  DEFAULT_MAX_TEXT_LENGTH,
} from '../utils.js';

export function registerFileTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'list_course_files',
    'Browse files in a course. Can filter by file type (e.g., PDFs only).',
    {
      course_id: z.number().describe('The Canvas course ID'),
      content_type: z.string().optional()
        .describe('Filter by MIME type (e.g., "application/pdf", "text/plain")'),
      search_term: z.string().optional()
        .describe('Search files by name'),
      sort: z.enum(['name', 'size', 'created_at', 'updated_at', 'content_type']).optional()
        .describe('Sort files by field'),
    },
    async ({ course_id, content_type, search_term, sort }) => {
      try {
        const files = await client.listCourseFiles(course_id, {
          content_types: content_type ? [content_type] : undefined,
          search_term,
          sort,
        });

        const formattedFiles = files.map(f => ({
          id: f.id,
          display_name: f.display_name,
          filename: f.filename,
          content_type: f['content-type'],
          size_bytes: f.size,
          size_human: formatFileSize(f.size),
          updated_at: f.updated_at,
          mime_class: f.mime_class,
        }));

        return formatSuccess({
          count: formattedFiles.length,
          files: formattedFiles,
        });
      } catch (error) {
        return formatError('listing files', error);
      }
    }
  );

  server.tool(
    'get_file_info',
    'Get metadata for a specific file including its download URL',
    {
      file_id: z.number().describe('The Canvas file ID'),
    },
    async ({ file_id }) => {
      try {
        const file = await client.getFile(file_id);

        return formatSuccess({
          id: file.id,
          display_name: file.display_name,
          filename: file.filename,
          content_type: file['content-type'],
          size_bytes: file.size,
          size_human: formatFileSize(file.size),
          url: file.url,
          updated_at: file.updated_at,
          locked_for_user: file.locked_for_user,
        });
      } catch (error) {
        return formatError('getting file info', error);
      }
    }
  );

  server.tool(
    'read_file_content',
    'Download a file from Canvas and extract its text content. Supports PDFs, plain text, HTML, CSV, and Markdown files. Use this to read lecture notes, slides, or handouts without having to download them manually.',
    {
      file_id: z.number().describe('The Canvas file ID (get this from list_course_files or list_modules)'),
      max_length: z.number().optional().default(DEFAULT_MAX_TEXT_LENGTH)
        .describe(`Maximum characters to return (default ${DEFAULT_MAX_TEXT_LENGTH}). Useful for very large files.`),
    },
    async ({ file_id, max_length }) => {
      try {
        const file = await client.getFile(file_id);
        const contentType = file['content-type'];

        if (file.size > MAX_FILE_SIZE) {
          return formatSuccess({
            error: 'File too large',
            file_name: file.display_name,
            size: formatFileSize(file.size),
            message: `This file is over ${formatFileSize(MAX_FILE_SIZE)}. Use get_file_info to get the download URL and open it directly.`,
          });
        }

        const arrayBuffer = await client.downloadFile(file.url);
        const buffer = Buffer.from(arrayBuffer);

        const result = await extractTextFromFile(buffer, contentType, max_length);

        if (!result) {
          return formatSuccess({
            file_name: file.display_name,
            content_type: contentType,
            size: formatFileSize(file.size),
            message: `Text extraction is not supported for ${contentType} files. Use get_file_info to get the download URL.`,
            url: file.url,
          });
        }

        return formatSuccess({
          file_name: file.display_name,
          content_type: contentType,
          size: formatFileSize(file.size),
          ...(result.pages !== undefined ? { pages: result.pages } : {}),
          truncated: result.truncated,
          ...(result.truncated ? { note: `Content truncated to ${max_length} characters. Increase max_length to see more.` } : {}),
          content: result.text,
        });
      } catch (error) {
        return formatError('reading file', error);
      }
    }
  );
}

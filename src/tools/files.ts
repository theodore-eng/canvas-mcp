import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';

// pdf-parse v2 uses a class-based API
async function parsePdf(buffer: Buffer): Promise<{ text: string; numpages: number }> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  const numpages = result.total;
  await parser.destroy();
  return { text: result.text, numpages };
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

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

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: formattedFiles.length,
              files: formattedFiles,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error listing files: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
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

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: file.id,
              display_name: file.display_name,
              filename: file.filename,
              content_type: file['content-type'],
              size_bytes: file.size,
              size_human: formatFileSize(file.size),
              url: file.url,
              updated_at: file.updated_at,
              locked_for_user: file.locked_for_user,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error getting file info: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'read_file_content',
    'Download a file from Canvas and extract its text content. Supports PDFs, plain text, HTML, CSV, and Markdown files. Use this to read lecture notes, slides, or handouts without having to download them manually.',
    {
      file_id: z.number().describe('The Canvas file ID (get this from list_course_files or list_modules)'),
      max_length: z.number().optional().default(50000)
        .describe('Maximum characters to return (default 50000). Useful for very large files.'),
    },
    async ({ file_id, max_length }) => {
      try {
        const file = await client.getFile(file_id);
        const contentType = file['content-type'];
        const sizeLimit = 25 * 1024 * 1024; // 25MB limit

        if (file.size > sizeLimit) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'File too large',
                file_name: file.display_name,
                size: formatFileSize(file.size),
                message: 'This file is over 25MB. Use get_file_info to get the download URL and open it directly.',
              }, null, 2),
            }],
            isError: true,
          };
        }

        const arrayBuffer = await client.downloadFile(file.url);
        const buffer = Buffer.from(arrayBuffer);
        let extractedText = '';

        if (contentType === 'application/pdf') {
          const pdfData = await parsePdf(buffer);
          extractedText = pdfData.text;
        } else if (contentType === 'text/html') {
          extractedText = stripHtmlTags(buffer.toString('utf-8'));
        } else if (
          contentType === 'text/plain' ||
          contentType === 'text/csv' ||
          contentType === 'text/markdown' ||
          contentType === 'application/json' ||
          contentType?.startsWith('text/')
        ) {
          extractedText = buffer.toString('utf-8');
        } else {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                file_name: file.display_name,
                content_type: contentType,
                size: formatFileSize(file.size),
                message: `Text extraction is not supported for ${contentType} files. Use get_file_info to get the download URL.`,
                url: file.url,
              }, null, 2),
            }],
          };
        }

        // Truncate if needed
        const truncated = extractedText.length > max_length;
        if (truncated) {
          extractedText = extractedText.substring(0, max_length);
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              file_name: file.display_name,
              content_type: contentType,
              size: formatFileSize(file.size),
              truncated,
              ...(truncated ? { note: `Content truncated to ${max_length} characters. Increase max_length to see more.` } : {}),
              content: extractedText,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

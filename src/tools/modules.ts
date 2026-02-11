import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import {
  formatError,
  formatSuccess,
  formatFileSize,
  extractTextFromFile,
  stripHtmlTags,
  MAX_FILE_SIZE,
} from '../utils.js';

export function registerModuleTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'list_modules',
    'List all modules in a course with their items (lectures, readings, assignments, etc.)',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      include_items: z.boolean().optional().default(true)
        .describe('Include module items in the response'),
      search_term: z.string().optional()
        .describe('Search term to filter modules'),
    },
    async ({ course_id, include_items, search_term }) => {
      try {
        const include: ('items' | 'content_details')[] = [];
        if (include_items) {
          include.push('items', 'content_details');
        }

        const modules = await client.listModules(course_id, {
          include,
          search_term,
        });

        const formattedModules = modules.map(mod => ({
          id: mod.id,
          name: mod.name,
          position: mod.position,
          unlock_at: mod.unlock_at,
          state: mod.state,
          completed_at: mod.completed_at,
          items_count: mod.items_count,
          require_sequential_progress: mod.require_sequential_progress,
          items: include_items && mod.items ? mod.items.map(item => ({
            id: item.id,
            title: item.title,
            type: item.type,
            position: item.position,
            html_url: item.html_url,
            content_id: item.content_id,
            page_url: item.page_url,
            external_url: item.external_url,
            completion_requirement: item.completion_requirement,
            content_details: item.content_details,
          })) : undefined,
        }));

        return formatSuccess({ count: formattedModules.length, modules: formattedModules });
      } catch (error) {
        return formatError('listing modules', error);
      }
    }
  );

  server.tool(
    'list_announcements',
    'List announcements from one or more courses',
    {
      course_ids: z.array(z.number().int().positive()).optional()
        .describe('Filter to specific course IDs. If omitted, returns announcements from all active courses.'),
      start_date: z.string().optional()
        .describe('Only return announcements posted after this date (ISO 8601 format)'),
      end_date: z.string().optional()
        .describe('Only return announcements posted before this date (ISO 8601 format)'),
      active_only: z.boolean().optional().default(true)
        .describe('Only return active announcements'),
    },
    async ({ course_ids, start_date, end_date, active_only }) => {
      try {
        let contextCodes: string[];
        if (course_ids && course_ids.length > 0) {
          contextCodes = course_ids.map(id => `course_${id}`);
        } else {
          contextCodes = await client.getActiveCourseContextCodes();
        }

        const announcements = await client.listAnnouncements({
          context_codes: contextCodes,
          start_date,
          end_date,
          active_only,
        });

        const formattedAnnouncements = announcements.map(ann => ({
          id: ann.id,
          title: ann.title,
          message: stripHtmlTags(ann.message),
          posted_at: ann.posted_at,
          author: ann.user_name,
          context_code: ann.context_code,
          html_url: ann.html_url,
          read_state: ann.read_state,
          attachments: ann.attachments?.map(att => ({
            filename: att.filename,
            url: att.url,
          })),
        }));

        return formatSuccess({ count: formattedAnnouncements.length, announcements: formattedAnnouncements });
      } catch (error) {
        return formatError('listing announcements', error);
      }
    }
  );

  server.tool(
    'get_module_item_content',
    'Read the actual content of a module item — fetches page text, file content (including PDFs), assignment descriptions, or discussion posts. Use this to read lecture notes, handouts, and readings without leaving Claude.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      module_id: z.number().int().positive().describe('The module ID'),
      item_id: z.number().int().positive().describe('The module item ID'),
    },
    async ({ course_id, module_id, item_id }) => {
      try {
        const items = await client.listModuleItems(course_id, module_id);
        const item = items.find(i => i.id === item_id);

        if (!item) {
          return formatError('getting module item content',
            new Error(`Module item with ID ${item_id} not found in module ${module_id}`));
        }

        const contentResult: Record<string, unknown> = {
          item_title: item.title,
          item_type: item.type,
        };

        switch (item.type) {
          case 'Page': {
            if (!item.page_url) {
              contentResult.error = 'No page URL available for this item';
              break;
            }
            const page = await client.getPage(course_id, item.page_url);
            contentResult.content = page.body ? stripHtmlTags(page.body) : '(empty page)';
            contentResult.updated_at = page.updated_at;
            break;
          }

          case 'File': {
            if (!item.content_id) {
              contentResult.error = 'No file ID available for this item';
              break;
            }
            const file = await client.getFile(item.content_id);
            const contentType = file['content-type'];

            if (file.size > MAX_FILE_SIZE) {
              contentResult.message = 'File too large for text extraction';
              contentResult.file_name = file.display_name;
              contentResult.size = formatFileSize(file.size);
              contentResult.url = file.url;
              break;
            }

            const arrayBuffer = await client.downloadFile(file.url);
            const buffer = Buffer.from(arrayBuffer);
            const extracted = await extractTextFromFile(buffer, contentType);

            if (extracted) {
              contentResult.content = extracted.text;
              if (extracted.pages !== undefined) contentResult.pages = extracted.pages;
              if (extracted.truncated) contentResult.truncated = true;
            } else {
              contentResult.message = `Cannot extract text from ${contentType} files`;
              contentResult.file_name = file.display_name;
              contentResult.url = file.url;
            }
            break;
          }

          case 'Assignment': {
            if (!item.content_id) {
              contentResult.error = 'No assignment ID available';
              break;
            }
            const assignment = await client.getAssignment(course_id, item.content_id, ['submission']);
            contentResult.description = assignment.description
              ? stripHtmlTags(assignment.description)
              : null;
            contentResult.due_at = assignment.due_at;
            contentResult.points_possible = assignment.points_possible;
            contentResult.submission_types = assignment.submission_types;
            contentResult.submission_status = assignment.submission?.workflow_state;
            break;
          }

          case 'Discussion': {
            if (!item.content_id) {
              contentResult.error = 'No discussion ID available';
              break;
            }
            const topic = await client.getDiscussionTopic(course_id, item.content_id);
            contentResult.message = topic.message ? stripHtmlTags(topic.message) : null;
            contentResult.author = topic.user_name;
            contentResult.posted_at = topic.posted_at;
            contentResult.reply_count = topic.discussion_subentry_count;
            break;
          }

          case 'ExternalUrl': {
            contentResult.url = item.external_url;
            break;
          }

          case 'ExternalTool': {
            contentResult.url = item.external_url;
            contentResult.message = 'External tool — open in browser to access';
            break;
          }

          case 'Quiz': {
            contentResult.html_url = item.html_url;
            contentResult.message = 'Quiz content must be accessed in Canvas directly';
            break;
          }

          case 'SubHeader': {
            contentResult.message = 'This is a section header with no content';
            break;
          }
        }

        return formatSuccess(contentResult);
      } catch (error) {
        return formatError('getting module item content', error);
      }
    }
  );
}

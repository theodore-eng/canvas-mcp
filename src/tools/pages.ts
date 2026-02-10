import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';

export function registerPageTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'list_pages',
    'List wiki/content pages in a course',
    {
      course_id: z.number().describe('The Canvas course ID'),
      search_term: z.string().optional().describe('Search term to filter pages by title'),
      sort: z.enum(['title', 'created_at', 'updated_at']).optional().describe('Sort pages by field'),
    },
    async ({ course_id, search_term, sort }) => {
      try {
        const pages = await client.listPages(course_id, {
          search_term,
          sort,
          published: true,
        });

        const formattedPages = pages.map(page => ({
          page_id: page.page_id,
          url: page.url,
          title: page.title,
          updated_at: page.updated_at,
          front_page: page.front_page,
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: formattedPages.length,
              pages: formattedPages,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error listing pages: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'get_page_content',
    'Read the full content of a course page. Returns the page body as HTML which can be summarized or searched.',
    {
      course_id: z.number().describe('The Canvas course ID'),
      page_url: z.string().describe('The page URL slug (e.g., "syllabus" or "week-3-notes") or page ID'),
    },
    async ({ course_id, page_url }) => {
      try {
        const page = await client.getPage(course_id, page_url);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              title: page.title,
              url: page.url,
              updated_at: page.updated_at,
              body: page.body ?? '(empty page)',
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error getting page content: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );
}

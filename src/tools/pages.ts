import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, stripHtmlTags, extractLinkedFiles, extractLinks } from '../utils.js';

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
        let pages: Array<{ page_id: number; url: string; title: string; updated_at: string; front_page: boolean }>;

        try {
          // Try the direct Pages API first
          const directPages = await client.listPages(course_id, {
            search_term,
            sort,
            published: true,
          });

          pages = directPages.map(page => ({
            page_id: page.page_id,
            url: page.url,
            title: page.title,
            updated_at: page.updated_at,
            front_page: page.front_page,
          }));
        } catch {
          // Pages API disabled — fall back to scanning modules for Page items
          const modules = await client.listModules(course_id, { include: ['items'] });
          const pageItems = modules.flatMap(m => m.items?.filter(i => i.type === 'Page') ?? []);

          // Apply search filter if provided
          const filtered = search_term
            ? pageItems.filter(i => i.title.toLowerCase().includes(search_term.toLowerCase()))
            : pageItems;

          pages = filtered.map(item => ({
            page_id: item.content_id ?? item.id,
            url: item.page_url ?? '',
            title: item.title,
            updated_at: '',
            front_page: false,
          }));
        }

        return formatSuccess({
          count: pages.length,
          pages,
        });
      } catch (error) {
        return formatError('listing pages', error);
      }
    }
  );

  server.tool(
    'get_page_content',
    'Read the full content of a course page as clean text. Great for reading syllabi, lecture notes, and course info pages.',
    {
      course_id: z.number().describe('The Canvas course ID'),
      page_url: z.string().describe('The page URL slug (e.g., "syllabus" or "week-3-notes") or page ID'),
    },
    async ({ course_id, page_url }) => {
      try {
        const page = await client.getPage(course_id, page_url);

        // Extract links before stripping HTML (stripHtmlTags destroys link info)
        const linked_files = page.body ? extractLinkedFiles(page.body) : [];
        const links = page.body ? extractLinks(page.body) : [];

        return formatSuccess({
          title: page.title,
          url: page.url,
          updated_at: page.updated_at,
          body: page.body ? stripHtmlTags(page.body) : '(empty page)',
          linked_files,
          links,
        });
      } catch (error) {
        return formatError('getting page content', error);
      }
    }
  );
}

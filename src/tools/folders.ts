import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, formatFileSize } from '../utils.js';

export function registerFolderTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'list_course_folders',
    'List all folders in a course, showing the full folder tree with file and subfolder counts for each folder.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
    },
    async ({ course_id }) => {
      try {
        const folders = await client.listCourseFolders(course_id);

        const formattedFolders = folders
          .map(folder => ({
            id: folder.id,
            name: folder.name,
            full_name: folder.full_name,
            parent_folder_id: folder.parent_folder_id,
            files_count: folder.files_count,
            folders_count: folder.folders_count,
          }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name));

        return formatSuccess({
          course_id,
          count: formattedFolders.length,
          folders: formattedFolders,
        });
      } catch (error) {
        return formatError('listing folders', error);
      }
    }
  );

  server.tool(
    'browse_folder',
    'Browse the contents of a specific folder — returns both subfolders and files within it. Use list_course_folders first to find folder IDs.',
    {
      folder_id: z.number().int().positive().describe('The Canvas folder ID'),
    },
    async ({ folder_id }) => {
      try {
        const [folderResult, subfoldersResult, filesResult] = await Promise.allSettled([
          client.getFolder(folder_id),
          client.listFolderSubfolders(folder_id),
          client.listFolderFiles(folder_id),
        ]);

        if (folderResult.status !== 'fulfilled') {
          return formatError('browsing folder', folderResult.reason);
        }

        const folder = folderResult.value;

        const subfolders = subfoldersResult.status === 'fulfilled'
          ? subfoldersResult.value.map(sf => ({
              id: sf.id,
              name: sf.name,
              files_count: sf.files_count,
              folders_count: sf.folders_count,
            }))
          : [];

        const files = filesResult.status === 'fulfilled'
          ? filesResult.value.map(f => ({
              id: f.id,
              display_name: f.display_name,
              size: formatFileSize(f.size),
              content_type: f['content-type'],
              updated_at: f.updated_at,
            }))
          : [];

        return formatSuccess({
          folder: {
            id: folder.id,
            name: folder.name,
            full_name: folder.full_name,
          },
          subfolders,
          files,
        });
      } catch (error) {
        return formatError('browsing folder', error);
      }
    }
  );
}

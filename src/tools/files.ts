import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import path from 'node:path';
import os from 'node:os';
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

/**
 * Categorize a file based on module name and item title keywords.
 * Returns a category string.
 */
function categorizeFile(moduleName: string, itemTitle: string, filename: string): string {
  const combined = `${moduleName} ${itemTitle}`.toLowerCase();

  if (/syllabus/i.test(filename)) return 'syllabus';
  if (/\b(lecture|slide|slides|class notes)\b/.test(combined)) return 'lecture';
  if (/\b(reading|textbook|chapter|article)\b/.test(combined)) return 'reading';
  if (/\b(exam|midterm|final|review|practice|study guide)\b/.test(combined)) return 'exam_prep';
  if (/\b(homework|assignment|problem set|worksheet)\b/.test(combined)) return 'assignment';
  return 'uncategorized';
}

export function registerFileTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'list_course_files',
    'Browse files in a course. Can filter by file type (e.g., PDFs only). Optionally categorize files by module context or include hidden files.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      content_type: z.string().optional()
        .describe('Filter by MIME type (e.g., "application/pdf", "text/plain")'),
      search_term: z.string().optional()
        .describe('Search files by name'),
      sort: z.enum(['name', 'size', 'created_at', 'updated_at', 'content_type']).optional()
        .describe('Sort files by field'),
      categorize: z.boolean().optional().default(false)
        .describe('When true, categorize files (lecture, reading, exam_prep, syllabus, assignment, uncategorized) based on module context'),
      include_hidden: z.boolean().optional().default(false)
        .describe('When true, also include hidden files by cross-referencing module items'),
    },
    async ({ course_id, content_type, search_term, sort, categorize, include_hidden }) => {
      try {
        let formattedFiles: Array<{
          id: number;
          display_name: string;
          filename: string;
          content_type?: string;
          size_bytes?: number;
          size_human?: string;
          updated_at?: string;
          mime_class?: string;
          source?: string;
          category?: string;
        }>;

        // We need modules if categorize or include_hidden is enabled
        const needModules = categorize || include_hidden;

        // Build a map of file_id -> { module_name, item_title } for categorization
        // and collect module file items for hidden file detection
        type ModuleFileInfo = { module_name: string; item_title: string; content_id: number; title: string };
        const moduleFileMap = new Map<number, ModuleFileInfo>();
        const moduleFileItems: ModuleFileInfo[] = [];

        if (needModules) {
          try {
            const modules = await client.listModules(course_id, { include: ['items'] });
            for (const mod of modules) {
              if (!mod.items) continue;
              for (const item of mod.items) {
                if (item.type === 'File') {
                  const fileId = item.content_id ?? item.id;
                  const info: ModuleFileInfo = {
                    module_name: mod.name,
                    item_title: item.title,
                    content_id: fileId,
                    title: item.title,
                  };
                  moduleFileMap.set(fileId, info);
                  moduleFileItems.push(info);
                }
              }
            }
          } catch {
            // If module fetch fails, continue without module data
          }
        }

        try {
          // Try the direct Files API first
          const files = await client.listCourseFiles(course_id, {
            content_types: content_type ? [content_type] : undefined,
            search_term,
            sort,
          });

          formattedFiles = files.map(f => {
            const fileId = f.id;
            const moduleInfo = moduleFileMap.get(fileId);
            const entry: typeof formattedFiles[number] = {
              id: f.id,
              display_name: f.display_name,
              filename: f.filename,
              content_type: f['content-type'],
              size_bytes: f.size,
              size_human: formatFileSize(f.size),
              updated_at: f.updated_at,
              mime_class: f.mime_class,
            };

            if (include_hidden) {
              entry.source = 'files_api';
            }

            if (categorize) {
              if (moduleInfo) {
                entry.category = categorizeFile(moduleInfo.module_name, moduleInfo.item_title, f.filename);
              } else {
                // No module context — try filename-only categorization
                entry.category = categorizeFile('', '', f.filename);
              }
            }

            return entry;
          });

          // If include_hidden is true, merge in module file items that are NOT in the API response
          if (include_hidden && moduleFileItems.length > 0) {
            const apiFileIds = new Set(files.map(f => f.id));
            for (const modFile of moduleFileItems) {
              if (!apiFileIds.has(modFile.content_id)) {
                // Apply search filter if provided
                if (search_term && !modFile.title.toLowerCase().includes(search_term.toLowerCase())) {
                  continue;
                }

                const entry: typeof formattedFiles[number] = {
                  id: modFile.content_id,
                  display_name: modFile.title,
                  filename: modFile.title,
                  source: 'module',
                };

                if (categorize) {
                  entry.category = categorizeFile(modFile.module_name, modFile.item_title, modFile.title);
                }

                formattedFiles.push(entry);
              }
            }
          }
        } catch {
          // Files API unauthorized — fall back to scanning modules for File items
          if (needModules && moduleFileItems.length > 0) {
            // We already have module file items from earlier fetch
            const filtered = search_term
              ? moduleFileItems.filter(i => i.title.toLowerCase().includes(search_term.toLowerCase()))
              : moduleFileItems;

            formattedFiles = filtered.map(item => {
              const entry: typeof formattedFiles[number] = {
                id: item.content_id,
                display_name: item.title,
                filename: item.title,
              };

              if (include_hidden) {
                entry.source = 'module';
              }

              if (categorize) {
                entry.category = categorizeFile(item.module_name, item.item_title, item.title);
              }

              return entry;
            });
          } else {
            // Need to fetch modules now for the fallback path
            const modules = await client.listModules(course_id, { include: ['items'] });
            const fileItems = modules.flatMap(m => {
              const items = m.items?.filter(i => i.type === 'File') ?? [];
              return items.map(i => ({
                content_id: i.content_id ?? i.id,
                title: i.title,
                module_name: m.name,
                item_title: i.title,
              }));
            });

            // Apply search filter if provided
            const filtered = search_term
              ? fileItems.filter(i => i.title.toLowerCase().includes(search_term.toLowerCase()))
              : fileItems;

            formattedFiles = filtered.map(item => {
              const entry: typeof formattedFiles[number] = {
                id: item.content_id,
                display_name: item.title,
                filename: item.title,
              };

              if (include_hidden) {
                entry.source = 'module';
              }

              if (categorize) {
                entry.category = categorizeFile(item.module_name, item.item_title, item.title);
              }

              return entry;
            });
          }
        }

        // Build response
        const response: Record<string, unknown> = {
          count: formattedFiles.length,
          files: formattedFiles,
        };

        // Add categories_summary when categorize is enabled
        if (categorize) {
          const summary: Record<string, number> = {};
          for (const f of formattedFiles) {
            const cat = f.category ?? 'uncategorized';
            summary[cat] = (summary[cat] ?? 0) + 1;
          }
          response.categories_summary = summary;
        }

        return formatSuccess(response);
      } catch (error) {
        return formatError('listing files', error);
      }
    }
  );

  server.tool(
    'get_file_info',
    'Get metadata for a specific file including its download URL',
    {
      file_id: z.number().int().positive().describe('The Canvas file ID'),
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
      file_id: z.number().int().positive().describe('The Canvas file ID (get this from list_course_files or list_modules)'),
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

  server.tool(
    'download_file',
    'Download a file from Canvas to a local folder. Returns the local file path after download.',
    {
      file_id: z.number().int().positive().describe('The Canvas file ID'),
      target_path: z.string().optional()
        .describe('Local directory to save the file to. If omitted, returns file info with download URL.'),
    },
    async ({ file_id, target_path }) => {
      try {
        const file = await client.getFile(file_id);

        // If no target_path, just return file metadata with download URL
        if (!target_path) {
          return formatSuccess({
            id: file.id,
            display_name: file.display_name,
            filename: file.filename,
            content_type: file['content-type'],
            size_bytes: file.size,
            size_human: formatFileSize(file.size),
            download_url: file.url,
            message: 'No target_path provided. Provide a target_path to download the file to disk.',
          });
        }

        // SEC-05: Validate target_path is under $HOME
        const expandedTargetPath = target_path.replace(/^~/, os.homedir());
        const resolvedTargetPath = path.resolve(expandedTargetPath);
        if (!resolvedTargetPath.startsWith(os.homedir())) {
          throw new Error('Path must be under home directory');
        }

        // Create target directory if it doesn't exist
        await mkdir(resolvedTargetPath, { recursive: true });

        // Download the file from Canvas
        const arrayBuffer = await client.downloadFile(file.url);
        const buffer = Buffer.from(arrayBuffer);

        // SEC-01: Sanitize filename to prevent path traversal
        const safeName = path.basename(file.filename).replace(/[/\\]/g, '_');
        const localPath = path.join(resolvedTargetPath, safeName);
        const resolvedLocalPath = path.resolve(localPath);
        if (!resolvedLocalPath.startsWith(resolvedTargetPath)) {
          throw new Error('Filename would write outside target directory');
        }

        await writeFile(resolvedLocalPath, buffer);

        return formatSuccess({
          id: file.id,
          filename: safeName,
          size_bytes: file.size,
          size_human: formatFileSize(file.size),
          local_path: resolvedLocalPath,
          message: `File downloaded successfully to ${resolvedLocalPath}`,
        });
      } catch (error) {
        return formatError('downloading file', error);
      }
    }
  );
}

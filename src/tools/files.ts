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
  runWithConcurrency,
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
      max_length: z.number().int().min(100).max(2_000_000).optional().default(DEFAULT_MAX_TEXT_LENGTH)
        .describe(`Maximum characters to return (default ${DEFAULT_MAX_TEXT_LENGTH}, hard cap 2,000,000). Useful for very large files.`),
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

  // ==================== download_course_files ====================
  // Bulk download by module pattern, file type, and/or updated-since filter.
  // Honors path-confinement and per-file size caps. Returns a manifest the
  // LLM can chain (every entry carries file_id + local_path).

  server.tool(
    'download_course_files',
    'Bulk download files from a course filtered by module name, file type, and/or updated-since timestamp. Saves into per-module subfolders under the target directory. Use dry_run=true to preview what WOULD be downloaded without writing anything.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      target_path: z.string().describe('Local base directory. Files land in <target>/<sanitized-module>/<filename>. Must be under your home directory.'),
      module_pattern: z.string().max(200).optional()
        .describe('Case-insensitive substring or /regex/ to match module names (e.g. "week 5", "/^Week (4|5)/"). Files outside matching modules are skipped.'),
      file_types: z.array(z.enum(['pdf', 'docx', 'pptx', 'xlsx', 'txt', 'md', 'csv', 'html'])).max(8).optional()
        .describe('Limit to these file extensions. Omit to allow all.'),
      since: z.string().datetime().optional()
        .describe('ISO 8601 timestamp; only download files with updated_at > since.'),
      max_files: z.number().int().min(1).max(200).optional().default(50)
        .describe('Hard cap on files to download in one call (default 50, max 200).'),
      dry_run: z.boolean().optional().default(false)
        .describe('When true, list what would be downloaded but do not write.'),
    },
    async ({ course_id, target_path, module_pattern, file_types, since, max_files, dry_run }) => {
      try {
        // Path resolution + confinement
        const expandedTarget = target_path.replace(/^~/, os.homedir());
        const resolvedTarget = path.resolve(expandedTarget);
        if (!resolvedTarget.startsWith(os.homedir())) {
          throw new Error('target_path must be under home directory');
        }

        // Build module name → matching items index (only if module_pattern set)
        // Otherwise, we list course files directly and use file metadata.
        const sanitizeFolder = (s: string): string =>
          s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled';

        let modulePatternRegex: RegExp | null = null;
        if (module_pattern) {
          const m = module_pattern.match(/^\/(.+)\/([gimuy]*)$/);
          modulePatternRegex = m
            ? new RegExp(m[1], m[2].includes('i') ? m[2] : m[2] + 'i')
            : new RegExp(module_pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }

        // Build candidate set: { file_id, name, content_type, size, updated_at, module_label }
        type Candidate = {
          file_id: number;
          name: string;
          content_type?: string;
          size: number;
          updated_at: string | undefined;
          module_label: string;
        };
        const candidates: Candidate[] = [];

        // Always fetch files (canonical list); also fetch modules if a pattern is provided.
        const files = await client.listCourseFiles(course_id);
        let fileIdToModule = new Map<number, string>();

        if (modulePatternRegex) {
          const modules = await client.listModules(course_id, { include: ['items'] });
          for (const mod of modules) {
            if (!modulePatternRegex.test(mod.name)) continue;
            for (const item of mod.items ?? []) {
              if (item.type !== 'File') continue;
              const fid = item.content_id ?? item.id;
              if (!fileIdToModule.has(fid)) fileIdToModule.set(fid, mod.name);
            }
          }
        }

        for (const f of files) {
          // If module_pattern was provided, drop files outside matching modules.
          if (modulePatternRegex && !fileIdToModule.has(f.id)) continue;

          // Filter by extension
          if (file_types && file_types.length > 0) {
            const ext = path.extname(f.filename).toLowerCase().replace(/^\./, '');
            if (!file_types.includes(ext as typeof file_types[number])) continue;
          }

          // Filter by updated_at
          if (since && f.updated_at && new Date(f.updated_at) <= new Date(since)) continue;

          candidates.push({
            file_id: f.id,
            name: f.display_name || f.filename,
            content_type: f['content-type'],
            size: f.size,
            updated_at: f.updated_at,
            module_label: fileIdToModule.get(f.id) ?? 'unsorted',
          });
        }

        // Apply max_files cap; surface truncation in result
        const truncated = candidates.length > max_files;
        const selected = candidates.slice(0, max_files);

        type Result = {
          file_id: number;
          name: string;
          size_bytes: number;
          size_human: string;
          local_path?: string;
          module_label: string;
          skipped_reason?: string;
        };

        if (dry_run) {
          const previewResults: Result[] = selected.map((c) => ({
            file_id: c.file_id,
            name: c.name,
            size_bytes: c.size,
            size_human: formatFileSize(c.size),
            module_label: c.module_label,
          }));
          return formatSuccess({
            course_id,
            dry_run: true,
            target_path: resolvedTarget,
            total_candidates: candidates.length,
            selected: selected.length,
            truncated,
            files: previewResults,
          });
        }

        // Real download: concurrency 3 (matches existing client patterns)
        const tasks = selected.map((c) => async (): Promise<Result> => {
          // Per-file size precheck — refuse files exceeding MAX_FILE_SIZE
          // before touching the network or buffering bytes.
          if (c.size > MAX_FILE_SIZE) {
            return {
              file_id: c.file_id,
              name: c.name,
              size_bytes: c.size,
              size_human: formatFileSize(c.size),
              module_label: c.module_label,
              skipped_reason: `File exceeds MAX_FILE_SIZE (${formatFileSize(MAX_FILE_SIZE)}); use download_file with explicit confirmation if needed.`,
            };
          }

          const fileMeta = await client.getFile(c.file_id);
          const moduleFolder = sanitizeFolder(c.module_label);
          const targetSubdir = path.join(resolvedTarget, moduleFolder);
          const resolvedSubdir = path.resolve(targetSubdir);
          if (!resolvedSubdir.startsWith(resolvedTarget)) {
            return {
              file_id: c.file_id,
              name: c.name,
              size_bytes: c.size,
              size_human: formatFileSize(c.size),
              module_label: c.module_label,
              skipped_reason: 'Path confinement check failed',
            };
          }
          await mkdir(resolvedSubdir, { recursive: true });

          const safeName = path.basename(fileMeta.filename).replace(/[/\\]/g, '_');
          const localPath = path.join(resolvedSubdir, safeName);
          const resolvedLocal = path.resolve(localPath);
          if (!resolvedLocal.startsWith(resolvedSubdir)) {
            return {
              file_id: c.file_id,
              name: c.name,
              size_bytes: c.size,
              size_human: formatFileSize(c.size),
              module_label: c.module_label,
              skipped_reason: 'Filename would write outside subdirectory',
            };
          }

          const arrayBuffer = await client.downloadFile(fileMeta.url);
          await writeFile(resolvedLocal, Buffer.from(arrayBuffer));

          return {
            file_id: c.file_id,
            name: c.name,
            size_bytes: c.size,
            size_human: formatFileSize(c.size),
            local_path: resolvedLocal,
            module_label: c.module_label,
          };
        });

        const settled = await runWithConcurrency(tasks, 3);
        const results: Result[] = [];
        const failures: Array<{ file_id: number; name: string; error: string }> = [];
        settled.forEach((s, i) => {
          if (s.status === 'fulfilled') {
            results.push(s.value);
          } else {
            const c = selected[i];
            failures.push({
              file_id: c.file_id,
              name: c.name,
              error: s.reason instanceof Error ? s.reason.message : String(s.reason),
            });
          }
        });

        const downloaded = results.filter((r) => !r.skipped_reason && r.local_path);
        const skipped = results.filter((r) => r.skipped_reason);

        return formatSuccess({
          course_id,
          target_path: resolvedTarget,
          total_candidates: candidates.length,
          downloaded_count: downloaded.length,
          skipped_count: skipped.length,
          failed_count: failures.length,
          truncated,
          downloaded,
          ...(skipped.length > 0 ? { skipped } : {}),
          ...(failures.length > 0 ? { failures } : {}),
        });
      } catch (error) {
        return formatError('bulk-downloading course files', error);
      }
    }
  );

  // ==================== search_course_files ====================
  // Substring search across the text content of course files. Downloads each
  // matching candidate into memory once (no disk write), extracts text via
  // the same pipeline as read_file_content, then ripgreps.

  server.tool(
    'search_course_files',
    'Search inside course files (PDF, DOCX, PPTX, XLSX, plain text) for a query string. Downloads each candidate file in memory, extracts text, and returns matching snippets. Useful for "where did the prof mention cap rate in lecture slides?" Capped to keep latency reasonable — narrow with file_types or module_pattern.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      query: z.string().min(2).max(200).describe('Substring or /regex/ to search for. Case-insensitive by default.'),
      file_types: z.array(z.enum(['pdf', 'docx', 'pptx', 'xlsx', 'txt', 'md', 'csv', 'html'])).max(8).optional()
        .describe('Limit to these file extensions. Defaults to PDF + DOCX + PPTX.'),
      module_pattern: z.string().max(200).optional()
        .describe('Restrict to files appearing in modules matching this name pattern.'),
      max_files: z.number().int().min(1).max(40).optional().default(15)
        .describe('Maximum number of files to fetch + scan (default 15, hard cap 40).'),
      max_hits_per_file: z.number().int().min(1).max(20).optional().default(5)
        .describe('Maximum snippets returned per file (default 5).'),
      snippet_chars: z.number().int().min(40).max(500).optional().default(160)
        .describe('Characters of context shown around each hit (default 160).'),
    },
    async ({ course_id, query, file_types, module_pattern, max_files, max_hits_per_file, snippet_chars }) => {
      try {
        const allowedExt = (file_types && file_types.length > 0)
          ? file_types
          : ['pdf', 'docx', 'pptx'] as const;

        // Compile query
        const regexMatch = query.match(/^\/(.+)\/([gimuy]*)$/);
        const queryRegex = regexMatch
          ? new RegExp(regexMatch[1], regexMatch[2].includes('i') ? regexMatch[2] : regexMatch[2] + 'i')
          : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

        let modulePatternRegex: RegExp | null = null;
        if (module_pattern) {
          const m = module_pattern.match(/^\/(.+)\/([gimuy]*)$/);
          modulePatternRegex = m
            ? new RegExp(m[1], m[2].includes('i') ? m[2] : m[2] + 'i')
            : new RegExp(module_pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        }

        const files = await client.listCourseFiles(course_id);
        let fileIdToModule = new Map<number, string>();
        if (modulePatternRegex) {
          const modules = await client.listModules(course_id, { include: ['items'] });
          for (const mod of modules) {
            if (!modulePatternRegex.test(mod.name)) continue;
            for (const item of mod.items ?? []) {
              if (item.type !== 'File') continue;
              const fid = item.content_id ?? item.id;
              if (!fileIdToModule.has(fid)) fileIdToModule.set(fid, mod.name);
            }
          }
        }

        type Candidate = { file_id: number; name: string; size: number; content_type?: string; module_label: string };
        const candidates: Candidate[] = [];
        for (const f of files) {
          if (modulePatternRegex && !fileIdToModule.has(f.id)) continue;
          const ext = path.extname(f.filename).toLowerCase().replace(/^\./, '');
          if (!(allowedExt as readonly string[]).includes(ext)) continue;
          if (f.size > MAX_FILE_SIZE) continue;
          candidates.push({
            file_id: f.id,
            name: f.display_name || f.filename,
            size: f.size,
            content_type: f['content-type'],
            module_label: fileIdToModule.get(f.id) ?? 'unsorted',
          });
        }

        const truncated = candidates.length > max_files;
        const selected = candidates.slice(0, max_files);

        type FileHit = {
          file_id: number;
          name: string;
          module_label: string;
          hits: Array<{ snippet: string; offset: number }>;
          error?: string;
        };

        const tasks = selected.map((c) => async (): Promise<FileHit> => {
          try {
            const fileMeta = await client.getFile(c.file_id);
            const buf = Buffer.from(await client.downloadFile(fileMeta.url));
            const extracted = await extractTextFromFile(
              buf,
              c.content_type ?? fileMeta['content-type'] ?? '',
              DEFAULT_MAX_TEXT_LENGTH * 4, // be generous for search
            );
            if (!extracted || !extracted.text) {
              return { file_id: c.file_id, name: c.name, module_label: c.module_label, hits: [] };
            }
            const text = extracted.text;
            // Reset lastIndex if the user-passed regex carries `g`.
            queryRegex.lastIndex = 0;
            const hits: Array<{ snippet: string; offset: number }> = [];
            let match: RegExpExecArray | null;
            while ((match = queryRegex.exec(text)) !== null && hits.length < max_hits_per_file) {
              const start = Math.max(0, match.index - Math.floor(snippet_chars / 2));
              const end = Math.min(text.length, match.index + match[0].length + Math.floor(snippet_chars / 2));
              const raw = text.slice(start, end).replace(/\s+/g, ' ').trim();
              hits.push({ snippet: raw, offset: match.index });
              // Avoid infinite loop on zero-width matches
              if (match.index === queryRegex.lastIndex) queryRegex.lastIndex++;
              // If the regex isn't global, exec returns same result — break.
              if (!queryRegex.global) break;
            }
            return { file_id: c.file_id, name: c.name, module_label: c.module_label, hits };
          } catch (e) {
            return {
              file_id: c.file_id,
              name: c.name,
              module_label: c.module_label,
              hits: [],
              error: e instanceof Error ? e.message : String(e),
            };
          }
        });

        const settled = await runWithConcurrency(tasks, 3);
        const fileResults: FileHit[] = [];
        for (const s of settled) {
          if (s.status === 'fulfilled') fileResults.push(s.value);
        }
        const totalHits = fileResults.reduce((sum, f) => sum + f.hits.length, 0);
        const filesWithHits = fileResults.filter((f) => f.hits.length > 0);

        return formatSuccess({
          course_id,
          query,
          files_scanned: selected.length,
          files_skipped: candidates.length - selected.length,
          truncated,
          total_hits: totalHits,
          files_with_hits: filesWithHits.length,
          results: filesWithHits,
          ...(fileResults.some((f) => f.error) ? { errors: fileResults.filter((f) => f.error) } : {}),
        });
      } catch (error) {
        return formatError('searching course files', error);
      }
    }
  );
}

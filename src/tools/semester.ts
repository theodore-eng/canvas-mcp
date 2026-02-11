import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, runWithConcurrency } from '../utils.js';
import { setPreference } from '../services/preferences.js';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import os from 'os';

/** Known external tool platforms to detect from course tab labels. */
const KNOWN_TOOLS: { pattern: RegExp; name: string }[] = [
  { pattern: /mcgraw|connect/i, name: 'McGraw-Hill Connect' },
  { pattern: /cengage|mindtap/i, name: 'Cengage MindTap' },
  { pattern: /top\s?hat/i, name: 'Top Hat' },
  { pattern: /gradescope/i, name: 'Gradescope' },
  { pattern: /pearson|mylab/i, name: 'Pearson MyLab' },
  { pattern: /wiley/i, name: 'Wiley' },
  { pattern: /packback/i, name: 'Packback' },
];

/** Subfolders to create inside each course folder. */
const SUBFOLDERS = ['lectures', 'assignments', 'readings', 'exams', 'notes'];

/**
 * Generate a filesystem-safe folder name from a course code.
 * Replaces spaces and special characters with hyphens and lowercases.
 */
function safeFolderName(courseCode: string): string {
  return courseCode
    .trim()
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();
}

export function registerSemesterTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'setup_semester',
    'One-command semester setup: discovers your courses, creates organized local folders, detects external tools (Connect, MindTap, etc.), and saves course mappings for the semester.',
    {
      base_path: z.string().optional()
        .describe('Local base directory for semester folders (default: ~/Canvas)'),
      include_external_tools: z.boolean().optional().default(true)
        .describe('Whether to detect external tools per course'),
    },
    async ({ base_path, include_external_tools }) => {
      try {
        // 1. Resolve base path
        const resolvedBasePath = base_path
          ? base_path.replace(/^~/, os.homedir())
          : join(os.homedir(), 'Canvas');

        // 2. Get active courses with term info
        const allCourses = await client.listCourses({
          enrollment_state: 'active',
          state: ['available'],
          include: ['total_scores', 'term'],
        });

        // 3. Filter to current/future courses (term end date > now, or no term end date)
        const now = new Date();
        const courses = allCourses.filter(course => {
          if (!course.term?.end_at) return true;
          return new Date(course.term.end_at) > now;
        });

        if (courses.length === 0) {
          return formatSuccess({
            message: 'No active courses found for the current or future terms.',
            courses_configured: 0,
          });
        }

        // 4. Determine the most common term name for the semester label
        const termCounts = new Map<string, number>();
        for (const course of courses) {
          const termName = course.term?.name ?? 'Unknown Term';
          termCounts.set(termName, (termCounts.get(termName) ?? 0) + 1);
        }
        let semesterName = 'Unknown Term';
        let maxCount = 0;
        for (const [name, count] of termCounts) {
          if (count > maxCount) {
            maxCount = count;
            semesterName = name;
          }
        }

        // 5. Create folder structure and collect course summaries
        let totalFoldersCreated = 0;
        const folderErrors: string[] = [];
        const courseSummaries: Array<{
          course_id: number;
          name: string;
          code: string;
          term: string | undefined;
          local_path: string;
          external_tools: string[];
          subfolders: string[];
        }> = [];

        for (const course of courses) {
          const folderName = safeFolderName(course.course_code);
          const courseFolderPath = join(resolvedBasePath, folderName);
          const createdSubfolders: string[] = [];

          // Create course folder and subfolders
          for (const subfolder of SUBFOLDERS) {
            const subfolderPath = join(courseFolderPath, subfolder);
            try {
              await mkdir(subfolderPath, { recursive: true });
              createdSubfolders.push(subfolder);
              totalFoldersCreated++;
            } catch (folderErr) {
              folderErrors.push(
                `Failed to create ${subfolderPath}: ${folderErr instanceof Error ? folderErr.message : String(folderErr)}`
              );
            }
          }

          courseSummaries.push({
            course_id: course.id,
            name: course.name,
            code: course.course_code,
            term: course.term?.name,
            local_path: courseFolderPath,
            external_tools: [], // populated below if include_external_tools
            subfolders: createdSubfolders,
          });
        }

        // 6. Detect external tools per course (concurrency limit 3)
        const allDetectedToolsSet = new Set<string>();

        if (include_external_tools) {
          const toolDetectionTasks = courses.map((course, idx) => async () => {
            const tabs = await client.listCourseTabs(course.id);
            const detected: string[] = [];
            for (const tab of tabs) {
              const label = tab.label ?? '';
              for (const known of KNOWN_TOOLS) {
                if (known.pattern.test(label)) {
                  detected.push(known.name);
                }
              }
            }
            return { index: idx, tools: [...new Set(detected)] };
          });

          const toolResults = await runWithConcurrency(toolDetectionTasks, 3);

          for (const result of toolResults) {
            if (result.status === 'fulfilled') {
              const { index, tools } = result.value;
              courseSummaries[index].external_tools = tools;
              for (const tool of tools) {
                allDetectedToolsSet.add(tool);
              }
            }
            // If rejected, we silently skip — tool detection failures should not block setup
          }
        }

        // 7. Save course mappings to preferences
        for (const summary of courseSummaries) {
          setPreference('courses', String(summary.course_id), {
            name: summary.name,
            code: summary.code,
            term: summary.term,
            local_path: summary.local_path,
            external_tools: summary.external_tools,
          });
        }

        // 8. Build and return the formatted summary
        const response: Record<string, unknown> = {
          semester: semesterName,
          base_path: resolvedBasePath,
          courses_configured: courses.length,
          courses: courseSummaries,
          folders_created: totalFoldersCreated,
          external_tools_detected: [...allDetectedToolsSet],
          next_steps: [
            'Use download_file with file_id and target_path to save files to your course folders',
            'Use list_course_files with categorize=true to see organized file lists',
            'Use scan_untracked_work to find readings and prep tasks hidden in modules',
          ],
        };

        if (folderErrors.length > 0) {
          response.folder_errors = folderErrors;
        }

        return formatSuccess(response);
      } catch (error) {
        return formatError('setting up semester', error);
      }
    }
  );
}

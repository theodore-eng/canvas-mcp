import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, stripHtmlTags } from '../utils.js';

export function registerCourseTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'list_courses',
    'List your current Canvas courses. By default only shows courses whose term has not ended. Set include_past=true to see old courses.',
    {
      enrollment_type: z.enum(['teacher', 'student', 'ta', 'observer', 'designer']).optional()
        .describe('Filter by enrollment type'),
      enrollment_state: z.enum(['active', 'invited_or_pending', 'completed']).optional()
        .describe('Filter by enrollment state'),
      include_syllabus: z.boolean().optional().default(false)
        .describe('Include syllabus body in response'),
      include_past: z.boolean().optional().default(false)
        .describe('Include courses from past terms (default: only current/future courses)'),
    },
    async ({ enrollment_type, enrollment_state, include_syllabus, include_past }) => {
      try {
        const include: string[] = ['term', 'total_students'];
        if (include_syllabus) {
          include.push('syllabus_body');
        }

        const courses = await client.listCourses({
          enrollment_type,
          enrollment_state,
          include: include as ('term' | 'total_students' | 'syllabus_body')[],
          state: ['available'],
        });

        // Filter out past courses unless explicitly requested
        const now = new Date();
        const filtered = include_past
          ? courses
          : courses.filter(course => {
              // Keep if term has no end date or end date is in the future
              const endDate = course.term?.end_at ?? course.end_at;
              if (!endDate) return true;
              return new Date(endDate) > now;
            });

        const formattedCourses = filtered.map(course => ({
          id: course.id,
          name: course.name,
          course_code: course.course_code,
          term: course.term?.name,
          total_students: course.total_students,
          start_date: course.start_at,
          end_date: course.end_at,
          default_view: course.default_view,
          syllabus: include_syllabus && course.syllabus_body
            ? stripHtmlTags(course.syllabus_body)
            : undefined,
        }));

        return formatSuccess({ count: formattedCourses.length, courses: formattedCourses });
      } catch (error) {
        return formatError('listing courses', error);
      }
    }
  );

  server.tool(
    'get_course_syllabus',
    'Get the full syllabus for a course. The syllabus is the source of truth for grading policies, letter grade scales, late penalties, drop rules, extra credit, office hours, course schedule, and exam dates. Always check the syllabus before answering questions about how a course works.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
    },
    async ({ course_id }) => {
      try {
        const result = await client.getCourseSyllabus(course_id);
        if (result) {
          return formatSuccess({
            course_id,
            course_name: result.course_name,
            syllabus_available: true,
            syllabus: result.text,
          });
        }

        // Fallback: scan modules for syllabus-like items
        const modules = await client.listModules(course_id, { include: ['items'] });
        const syllabusKeywords = ['syllabus', 'course information', 'course overview', 'course info'];

        for (const mod of modules) {
          if (!mod.items) continue;
          for (const item of mod.items) {
            const titleLower = item.title.toLowerCase();
            if (!syllabusKeywords.some(kw => titleLower.includes(kw))) continue;

            if (item.type === 'Page' && item.page_url) {
              try {
                const page = await client.getPage(course_id, item.page_url);
                if (page.body) {
                  return formatSuccess({
                    course_id,
                    syllabus_available: true,
                    source: 'module_page',
                    title: item.title,
                    syllabus: stripHtmlTags(page.body),
                  });
                }
              } catch { /* continue searching */ }
            }

            if (item.type === 'File' && item.content_id) {
              try {
                const file = await client.getFile(item.content_id);
                const arrayBuffer = await client.downloadFile(file.url);
                const buffer = Buffer.from(arrayBuffer);
                const { extractTextFromFile } = await import('../utils.js');
                const extracted = await extractTextFromFile(buffer, file['content-type'], 50000);
                if (extracted) {
                  return formatSuccess({
                    course_id,
                    syllabus_available: true,
                    source: 'module_file',
                    title: item.title,
                    file_name: file.display_name,
                    syllabus: extracted.text,
                  });
                }
              } catch { /* continue searching */ }
            }
          }
        }

        return formatSuccess({
          course_id,
          syllabus_available: false,
          message: 'No syllabus found in syllabus_body or course modules. It may be in an external tool.',
        });
      } catch (error) {
        return formatError('getting course syllabus', error);
      }
    }
  );

  server.tool(
    'find_syllabus',
    'Smart syllabus finder that searches multiple locations. Use this when get_course_syllabus returns empty — it scans modules for syllabus files and pages. Checks: 1) syllabus_body field, 2) module items with "syllabus" or "course information" in title.',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
    },
    async ({ course_id }) => {
      try {
        // Step 1: Try the standard syllabus_body
        const directSyllabus = await client.getCourseSyllabus(course_id);
        if (directSyllabus) {
          return formatSuccess({
            course_id,
            source: 'syllabus_body',
            course_name: directSyllabus.course_name,
            syllabus: directSyllabus.text,
          });
        }

        // Step 2: Scan modules for syllabus-like items
        const modules = await client.listModules(course_id, { include: ['items'] });
        const syllabusKeywords = ['syllabus', 'course information', 'course overview', 'course info', 'course schedule'];

        for (const mod of modules) {
          if (!mod.items) continue;
          for (const item of mod.items) {
            const titleLower = item.title.toLowerCase();
            const isSyllabusItem = syllabusKeywords.some(kw => titleLower.includes(kw));
            if (!isSyllabusItem) continue;

            if (item.type === 'Page' && item.page_url) {
              try {
                const page = await client.getPage(course_id, item.page_url);
                if (page.body) {
                  return formatSuccess({
                    course_id,
                    source: 'module_page',
                    module: mod.name,
                    title: item.title,
                    syllabus: stripHtmlTags(page.body),
                  });
                }
              } catch { /* page not accessible, continue searching */ }
            }

            if (item.type === 'File' && item.content_id) {
              try {
                const file = await client.getFile(item.content_id);
                const arrayBuffer = await client.downloadFile(file.url);
                const buffer = Buffer.from(arrayBuffer);
                const { extractTextFromFile } = await import('../utils.js');
                const extracted = await extractTextFromFile(buffer, file['content-type'], 50000);
                if (extracted) {
                  return formatSuccess({
                    course_id,
                    source: 'module_file',
                    module: mod.name,
                    title: item.title,
                    file_name: file.display_name,
                    syllabus: extracted.text,
                  });
                }
              } catch { /* file not accessible, continue searching */ }
            }
          }
        }

        return formatSuccess({
          course_id,
          syllabus_found: false,
          message: 'No syllabus found in syllabus_body or module items. The syllabus may be hosted in an external tool.',
        });
      } catch (error) {
        return formatError('finding syllabus', error);
      }
    }
  );

  server.tool(
    'get_course_tools',
    'Detect external tools and integrations used in a course (Gradescope, Top Hat, MindTap, McGraw-Hill, Zoom, Honorlock, etc.).',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
    },
    async ({ course_id }) => {
      try {
        const tabs = await client.listCourseTabs(course_id);

        const knownTools: Record<string, { category: string; description: string }> = {
          'gradescope': { category: 'grading', description: 'Assignment submission and grading platform' },
          'top hat': { category: 'participation', description: 'In-class participation and polling' },
          'tophat': { category: 'participation', description: 'In-class participation and polling' },
          'mindtap': { category: 'textbook', description: 'Cengage digital textbook and homework platform' },
          'cengage': { category: 'textbook', description: 'Cengage digital textbook and homework platform' },
          'mcgraw': { category: 'textbook', description: 'McGraw-Hill Connect homework and adaptive learning' },
          'connect': { category: 'textbook', description: 'McGraw-Hill Connect homework and adaptive learning' },
          'honorlock': { category: 'proctoring', description: 'Online exam proctoring' },
          'proctorio': { category: 'proctoring', description: 'Online exam proctoring' },
          'respondus': { category: 'proctoring', description: 'LockDown Browser and exam proctoring' },
          'zoom': { category: 'communication', description: 'Video conferencing for lectures and office hours' },
          'panopto': { category: 'lecture_capture', description: 'Lecture recording and video platform' },
          'kaltura': { category: 'lecture_capture', description: 'Video platform and lecture capture' },
          'piazza': { category: 'discussion', description: 'Q&A discussion platform' },
          'turnitin': { category: 'plagiarism', description: 'Plagiarism detection service' },
        };

        const externalTools = tabs
          .filter(tab => tab.id.startsWith('context_external_tool_'))
          .map(tab => {
            const labelLower = tab.label.toLowerCase();
            let matched: { category: string; description: string } | undefined;
            for (const [keyword, info] of Object.entries(knownTools)) {
              if (labelLower.includes(keyword)) {
                matched = info;
                break;
              }
            }
            return {
              tab_id: tab.id,
              label: tab.label,
              hidden: tab.hidden ?? false,
              category: matched?.category ?? 'other',
              description: matched?.description ?? 'External tool integration',
            };
          });

        const builtInTabs = tabs
          .filter(tab => !tab.id.startsWith('context_external_tool_'))
          .map(tab => ({ id: tab.id, label: tab.label, hidden: tab.hidden ?? false }));

        return formatSuccess({
          course_id,
          external_tools: externalTools,
          external_tool_count: externalTools.length,
          built_in_tabs: builtInTabs,
        });
      } catch (error) {
        return formatError('detecting course tools', error);
      }
    }
  );

  server.tool(
    'get_course',
    'Get detailed information about a specific course including syllabus, progress, and term',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      include_syllabus: z.boolean().optional().default(true)
        .describe('Include syllabus body in response'),
    },
    async ({ course_id, include_syllabus }) => {
      try {
        const include = ['term', 'total_students', 'course_progress'];
        if (include_syllabus) {
          include.push('syllabus_body');
        }

        const course = await client.getCourse(course_id, include);

        const formattedCourse = {
          id: course.id,
          name: course.name,
          course_code: course.course_code,
          term: course.term?.name,
          total_students: course.total_students,
          start_date: course.start_at,
          end_date: course.end_at,
          time_zone: course.time_zone,
          default_view: course.default_view,
          public_description: course.public_description,
          syllabus: include_syllabus && course.syllabus_body
            ? stripHtmlTags(course.syllabus_body)
            : undefined,
        };

        return formatSuccess(formattedCourse);
      } catch (error) {
        return formatError('getting course', error);
      }
    }
  );
}

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, stripHtmlTags } from '../utils.js';

export function registerCourseTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'list_courses',
    'List all your enrolled Canvas courses with term info and student count',
    {
      enrollment_type: z.enum(['teacher', 'student', 'ta', 'observer', 'designer']).optional()
        .describe('Filter by enrollment type'),
      enrollment_state: z.enum(['active', 'invited_or_pending', 'completed']).optional()
        .describe('Filter by enrollment state'),
      include_syllabus: z.boolean().optional().default(false)
        .describe('Include syllabus body in response'),
    },
    async ({ enrollment_type, enrollment_state, include_syllabus }) => {
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

        const formattedCourses = courses.map(course => ({
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
        if (!result) {
          return formatSuccess({
            course_id,
            syllabus_available: false,
            message: 'No syllabus has been published for this course.',
          });
        }
        return formatSuccess({
          course_id,
          course_name: result.course_name,
          syllabus_available: true,
          syllabus: result.text,
        });
      } catch (error) {
        return formatError('getting course syllabus', error);
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

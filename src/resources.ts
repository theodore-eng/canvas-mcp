import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from './canvas-client.js';
import { stripHtmlTags } from './utils.js';

/**
 * Register MCP Resources.
 *
 * Resources expose Canvas data as readable context that Claude can reference
 * without making tool calls. This is useful for providing background info
 * that informs Claude's responses.
 *
 * All resource handlers include error handling to return meaningful
 * error content rather than crashing.
 */
export function registerResources(server: McpServer) {
  const client = getCanvasClient();

  // Static resource: current grades across all courses
  server.resource(
    'grades-summary',
    'canvas://grades/summary',
    {
      description: 'Current grade summary across all active courses',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const courses = await client.listCourses({
          enrollment_state: 'active',
          state: ['available'],
          include: ['total_scores', 'term'],
        });

        const grades = courses
          .filter(c => c.enrollments && c.enrollments.length > 0)
          .map(c => ({
            course: c.name,
            code: c.course_code,
            term: c.term?.name,
            current_score: c.enrollments?.[0]?.computed_current_score ?? null,
            current_grade: c.enrollments?.[0]?.computed_current_grade ?? null,
            final_score: c.enrollments?.[0]?.computed_final_score ?? null,
            final_grade: c.enrollments?.[0]?.computed_final_grade ?? null,
          }));

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ grades, fetched_at: new Date().toISOString() }, null, 2),
          }],
        };
      } catch (error) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              error: `Failed to load grades: ${error instanceof Error ? error.message : String(error)}`,
              fetched_at: new Date().toISOString(),
            }),
          }],
        };
      }
    }
  );

  // Static resource: active courses list
  server.resource(
    'active-courses',
    'canvas://courses/active',
    {
      description: 'List of all active courses with IDs and details',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const courses = await client.listCourses({
          enrollment_state: 'active',
          state: ['available'],
          include: ['term', 'total_students'],
        });

        const courseList = courses.map(c => ({
          id: c.id,
          name: c.name,
          code: c.course_code,
          term: c.term?.name,
          total_students: c.total_students,
        }));

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ courses: courseList, fetched_at: new Date().toISOString() }, null, 2),
          }],
        };
      } catch (error) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              error: `Failed to load courses: ${error instanceof Error ? error.message : String(error)}`,
              fetched_at: new Date().toISOString(),
            }),
          }],
        };
      }
    }
  );

  // Dynamic resource template: course syllabus
  server.resource(
    'course-syllabus',
    new ResourceTemplate('canvas://courses/{courseId}/syllabus', {
      list: async () => {
        try {
          const courses = await client.listCourses({
            enrollment_state: 'active',
            state: ['available'],
          });
          return {
            resources: courses.map(c => ({
              uri: `canvas://courses/${c.id}/syllabus`,
              name: `${c.name} — Syllabus`,
              description: `Syllabus for ${c.course_code}`,
              mimeType: 'text/plain' as const,
            })),
          };
        } catch {
          return { resources: [] };
        }
      },
    }),
    {
      description: 'Course syllabus content',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      try {
        const courseId = Number(variables.courseId);
        if (!Number.isFinite(courseId) || courseId <= 0) {
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'text/plain',
              text: 'Error: Invalid course ID',
            }],
          };
        }

        const course = await client.getCourse(courseId, ['syllabus_body']);

        const syllabusText = course.syllabus_body
          ? stripHtmlTags(course.syllabus_body)
          : '(No syllabus available for this course)';

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `# ${course.name} — Syllabus\n\n${syllabusText}`,
          }],
        };
      } catch (error) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Error loading syllabus: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    }
  );

  // Dynamic resource template: course assignments overview
  server.resource(
    'course-assignments',
    new ResourceTemplate('canvas://courses/{courseId}/assignments', {
      list: async () => {
        try {
          const courses = await client.listCourses({
            enrollment_state: 'active',
            state: ['available'],
          });
          return {
            resources: courses.map(c => ({
              uri: `canvas://courses/${c.id}/assignments`,
              name: `${c.name} — Assignments`,
              description: `All assignments for ${c.course_code}`,
              mimeType: 'application/json' as const,
            })),
          };
        } catch {
          return { resources: [] };
        }
      },
    }),
    {
      description: 'All assignments for a course with submission status',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      try {
        const courseId = Number(variables.courseId);
        if (!Number.isFinite(courseId) || courseId <= 0) {
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ error: 'Invalid course ID' }),
            }],
          };
        }

        const assignments = await client.listAssignments(courseId, {
          include: ['submission'],
          order_by: 'due_at',
        });

        const formatted = assignments.map(a => ({
          id: a.id,
          name: a.name,
          due_at: a.due_at,
          points_possible: a.points_possible,
          submission_types: a.submission_types,
          status: a.submission?.workflow_state ?? 'unsubmitted',
          grade: a.submission?.grade ?? null,
          score: a.submission?.score ?? null,
        }));

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ assignments: formatted, fetched_at: new Date().toISOString() }, null, 2),
          }],
        };
      } catch (error) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              error: `Failed to load assignments: ${error instanceof Error ? error.message : String(error)}`,
              fetched_at: new Date().toISOString(),
            }),
          }],
        };
      }
    }
  );
}

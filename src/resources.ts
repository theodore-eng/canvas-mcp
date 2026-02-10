import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from './canvas-client.js';
import { stripHtmlTags } from './utils.js';
import { loadPreferences, loadContext } from './services/preferences.js';

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

  // Static resource: upcoming deadlines across all courses
  server.resource(
    'upcoming-deadlines',
    'canvas://deadlines/upcoming',
    {
      description: 'Rolling 7-day view of all upcoming deadlines across courses',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        const weekAheadStr = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const items = await client.listPlannerItems({
          start_date: todayStr,
          end_date: weekAheadStr,
          filter: 'incomplete_items',
        });

        const deadlines = items.map(item => {
          const plannable = item.plannable;
          const dueDate = plannable.due_at || plannable.todo_date || null;
          return {
            type: item.plannable_type,
            title: plannable.title || plannable.name || 'Untitled',
            course: item.context_name ?? `course_${item.course_id}`,
            due_at: dueDate,
            points_possible: plannable.points_possible ?? null,
            submitted: item.submissions && typeof item.submissions === 'object'
              ? (item.submissions.graded || item.submissions.needs_grading || false)
              : false,
          };
        }).sort((a, b) => {
          if (!a.due_at) return 1;
          if (!b.due_at) return -1;
          return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
        });

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ deadlines, fetched_at: new Date().toISOString() }, null, 2),
          }],
        };
      } catch (error) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              error: `Failed to load deadlines: ${error instanceof Error ? error.message : String(error)}`,
              fetched_at: new Date().toISOString(),
            }),
          }],
        };
      }
    }
  );

  // Dynamic resource template: course module structure
  server.resource(
    'course-modules',
    new ResourceTemplate('canvas://courses/{courseId}/modules', {
      list: async () => {
        try {
          const courses = await client.listCourses({
            enrollment_state: 'active',
            state: ['available'],
          });
          return {
            resources: courses.map(c => ({
              uri: `canvas://courses/${c.id}/modules`,
              name: `${c.name} — Modules`,
              description: `Module structure for ${c.course_code}`,
              mimeType: 'application/json' as const,
            })),
          };
        } catch {
          return { resources: [] };
        }
      },
    }),
    {
      description: 'Course module structure — the table of contents for a course',
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

        const modules = await client.listModules(courseId, {
          include: ['items', 'content_details'],
        });

        const formatted = modules.map(m => ({
          id: m.id,
          name: m.name,
          position: m.position,
          state: m.state,
          items_count: m.items_count,
          items: m.items?.map(item => ({
            id: item.id,
            title: item.title,
            type: item.type,
            due_at: item.content_details?.due_at,
          })),
        }));

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ modules: formatted, fetched_at: new Date().toISOString() }, null, 2),
          }],
        };
      } catch (error) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              error: `Failed to load modules: ${error instanceof Error ? error.message : String(error)}`,
              fetched_at: new Date().toISOString(),
            }),
          }],
        };
      }
    }
  );

  // Static resource: user preferences (learning system)
  server.resource(
    'user-preferences',
    'canvas://user/preferences',
    {
      description: 'User preferences and customizations — display style, priority courses, behavior settings. Claude should read this to tailor responses.',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const prefs = loadPreferences();
        const hasCustomizations =
          Object.keys(prefs.display).length > 0 ||
          Object.keys(prefs.priorities).length > 0 ||
          Object.keys(prefs.behavior).length > 0 ||
          Object.keys(prefs.courses).length > 0;

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              ...prefs,
              has_customizations: hasCustomizations,
              hint: hasCustomizations
                ? 'Use these preferences to tailor your responses (format, priority, verbosity).'
                : 'No preferences set yet. When the user expresses a preference (e.g., "I like brief summaries"), use save_preference to remember it.',
            }, null, 2),
          }],
        };
      } catch {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              display: {}, priorities: {}, behavior: {}, courses: {},
              has_customizations: false,
              hint: 'No preferences set yet. Use save_preference to store user preferences.',
            }),
          }],
        };
      }
    }
  );

  // Static resource: user context / learning notes
  server.resource(
    'user-context',
    'canvas://user/context',
    {
      description: 'Learned patterns and notes about this user — workflow habits, communication style, observed preferences. Claude should read this to personalize interactions.',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const context = loadContext();
        const totalNotes =
          context.workflow_patterns.length +
          context.conversation_notes.length +
          context.preferences_applied.length;

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              total_notes: totalNotes,
              workflow_patterns: context.workflow_patterns.slice(-10),
              key_insights: context.conversation_notes.slice(-10),
              preferences_applied: context.preferences_applied.slice(-5),
              hint: totalNotes > 0
                ? 'Apply these learned patterns to personalize your responses.'
                : 'No notes yet. When you notice a user pattern (e.g., they always ask about a specific course first), use save_context_note to remember it.',
            }, null, 2),
          }],
        };
      } catch {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              total_notes: 0,
              workflow_patterns: [], key_insights: [], preferences_applied: [],
              hint: 'No notes yet. Use save_context_note to record observations about user patterns.',
            }),
          }],
        };
      }
    }
  );

  // Static resource: unread inbox summary
  server.resource(
    'inbox-unread',
    'canvas://inbox/unread',
    {
      description: 'Quick view of unread Canvas inbox messages',
      mimeType: 'application/json',
    },
    async (uri) => {
      try {
        const conversations = await client.listConversations({ scope: 'unread' });

        const unread = conversations.slice(0, 10).map(c => ({
          id: c.id,
          subject: c.subject,
          participants: c.participants.map(p => p.name),
          last_message_preview: c.last_message
            ? stripHtmlTags(c.last_message).substring(0, 150)
            : null,
          last_message_at: c.last_message_at,
          message_count: c.message_count,
          context_name: c.context_name,
        }));

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              unread_count: conversations.length,
              messages: unread,
              fetched_at: new Date().toISOString(),
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              error: `Failed to load inbox: ${error instanceof Error ? error.message : String(error)}`,
              unread_count: 0,
              messages: [],
              fetched_at: new Date().toISOString(),
            }),
          }],
        };
      }
    }
  );
}

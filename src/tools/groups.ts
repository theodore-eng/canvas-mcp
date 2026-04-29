import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess } from '../utils.js';

/**
 * Group-set / group-membership tools — for group-submission assignments
 * (TP2-style team work). Lets the LLM tell who's on a team and surface
 * teammate names in briefings.
 *
 * NOTE: a separate "did the group submit?" question is satisfied by
 * get_submission with the assignment's group resolved at the API layer
 * (Canvas joins group submission to all members automatically). These
 * tools are about identity, not submission state.
 */
export function registerGroupTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'list_my_groups',
    "List all groups you are a member of, optionally filtered to a specific course. Use to surface who your teammates are on group-submission assignments. Each entry includes the group's group_category_id, which matches the assignment's group_category_id when the assignment is a group submission.",
    {
      course_id: z.number().int().positive().optional()
        .describe('Optional Canvas course ID. Omit to get all groups across all courses.'),
    },
    async ({ course_id }) => {
      try {
        const groups = await client.listMyGroups(course_id);
        const formatted = groups.map((g) => ({
          group_id: g.id,
          name: g.name,
          description: g.description ?? null,
          context_type: g.context_type,
          course_id: g.course_id ?? null,
          group_category_id: g.group_category_id,
          members_count: g.members_count,
          role: g.role ?? null,
        }));
        return formatSuccess({
          ...(course_id ? { course_id } : {}),
          count: formatted.length,
          groups: formatted,
        });
      } catch (error) {
        return formatError('listing my groups', error);
      }
    },
  );

  server.tool(
    'get_group_members',
    "Get the members of a group — names + Canvas user IDs. Use after list_my_groups to see exactly who is on your team. Pair with get_submission_rubric on a group assignment to attribute feedback.",
    {
      group_id: z.number().int().positive().describe('The Canvas group ID'),
    },
    async ({ group_id }) => {
      try {
        // include[]=users gives us names directly; falls back to memberships
        // if Canvas doesn't return users (rare).
        const group = await client.getGroup(group_id, true);
        if (group.users && group.users.length > 0) {
          return formatSuccess({
            group_id,
            name: group.name,
            members_count: group.users.length,
            members: group.users.map((u) => ({
              user_id: u.id,
              name: u.name,
              short_name: u.short_name ?? null,
              email: u.email ?? null,
            })),
          });
        }
        // Fallback: list memberships (no embedded user names — just IDs)
        const memberships = await client.getGroupMemberships(group_id);
        return formatSuccess({
          group_id,
          name: group.name,
          members_count: memberships.length,
          members: memberships.map((m) => ({
            user_id: m.user_id,
            membership_id: m.id,
            workflow_state: m.workflow_state,
            moderator: m.moderator,
            name: m.user?.name ?? null,
          })),
          note: 'Group did not return embedded users; falling back to memberships endpoint (names may be missing).',
        });
      } catch (error) {
        return formatError('getting group members', error);
      }
    },
  );
}

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, stripHtmlTags } from '../utils.js';

export function registerDiscussionTools(server: McpServer) {
  const client = getCanvasClient();

  // Read tools — always registered
  server.tool(
    'list_discussions',
    'List discussion topics in a course, sorted by position, recent activity, or title',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      order_by: z.enum(['position', 'recent_activity', 'title']).optional()
        .describe('Order discussions by field'),
    },
    async ({ course_id, order_by }) => {
      try {
        const topics = await client.listDiscussionTopics(course_id, order_by);

        const formattedTopics = topics.map(topic => ({
          id: topic.id,
          title: topic.title,
          message: topic.message ? stripHtmlTags(topic.message) : null,
          posted_at: topic.posted_at,
          last_reply_at: topic.last_reply_at,
          author: topic.user_name,
          discussion_subentry_count: topic.discussion_subentry_count,
          read_state: topic.read_state,
          unread_count: topic.unread_count,
          subscribed: topic.subscribed,
          published: topic.published,
          locked: topic.locked,
          pinned: topic.pinned,
          assignment_id: topic.assignment_id,
          html_url: topic.html_url,
        }));

        return formatSuccess({ count: formattedTopics.length, discussions: formattedTopics });
      } catch (error) {
        return formatError('listing discussions', error);
      }
    }
  );

  server.tool(
    'get_discussion_entries',
    'Read the posts and replies in a discussion topic',
    {
      course_id: z.number().int().positive().describe('The Canvas course ID'),
      topic_id: z.number().int().positive().describe('The discussion topic ID'),
    },
    async ({ course_id, topic_id }) => {
      try {
        const topic = await client.getDiscussionTopic(course_id, topic_id);
        const entries = await client.listDiscussionEntries(course_id, topic_id);

        const result = {
          topic: {
            id: topic.id,
            title: topic.title,
            message: topic.message ? stripHtmlTags(topic.message) : null,
            author: topic.user_name,
            posted_at: topic.posted_at,
            require_initial_post: topic.require_initial_post,
          },
          entries: entries.map(entry => ({
            id: entry.id,
            user_name: entry.user_name,
            message: entry.message ? stripHtmlTags(entry.message) : null,
            created_at: entry.created_at,
            read_state: entry.read_state,
            replies: entry.recent_replies?.map(reply => ({
              id: reply.id,
              user_name: reply.user_name,
              message: reply.message ? stripHtmlTags(reply.message) : null,
              created_at: reply.created_at,
            })),
            has_more_replies: entry.has_more_replies,
          })),
        };

        return formatSuccess(result);
      } catch (error) {
        return formatError('getting discussion entries', error);
      }
    }
  );

  // Write tools — only registered when ENABLE_WRITE_TOOLS is set
  if (process.env.ENABLE_WRITE_TOOLS === 'true') {
    server.tool(
      'post_discussion_entry',
      'Post a new entry to a discussion topic. This will be visible to your class. Only use when explicitly asked.',
      {
        course_id: z.number().int().positive().describe('The Canvas course ID'),
        topic_id: z.number().int().positive().describe('The discussion topic ID'),
        message: z.string().min(1).describe('The message to post (supports HTML)'),
      },
      async ({ course_id, topic_id, message }) => {
        try {
          const entry = await client.postDiscussionEntry(course_id, topic_id, message);

          return formatSuccess({
            success: true,
            message: 'Discussion entry posted successfully',
            entry: {
              id: entry.id,
              message: entry.message,
              created_at: entry.created_at,
              user_name: entry.user_name,
            },
          });
        } catch (error) {
          return formatError('posting discussion entry', error);
        }
      }
    );

    server.tool(
      'reply_to_discussion',
      'Reply to a specific post in a discussion topic. This will be visible to your class. Only use when explicitly asked.',
      {
        course_id: z.number().int().positive().describe('The Canvas course ID'),
        topic_id: z.number().int().positive().describe('The discussion topic ID'),
        entry_id: z.number().int().positive().describe('The entry ID to reply to'),
        message: z.string().min(1).describe('The reply message (supports HTML)'),
      },
      async ({ course_id, topic_id, entry_id, message }) => {
        try {
          const reply = await client.replyToDiscussionEntry(
            course_id,
            topic_id,
            entry_id,
            message
          );

          return formatSuccess({
            success: true,
            message: 'Reply posted successfully',
            reply: {
              id: reply.id,
              message: reply.message,
              created_at: reply.created_at,
              user_name: reply.user_name,
            },
          });
        } catch (error) {
          return formatError('posting reply', error);
        }
      }
    );
  }
}

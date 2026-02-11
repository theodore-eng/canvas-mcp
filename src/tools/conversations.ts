import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, stripHtmlTags } from '../utils.js';

export function registerConversationTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'list_conversations',
    'List messages in your Canvas inbox. Shows subject, participants, last message preview, and message count.',
    {
      scope: z.enum(['inbox', 'unread', 'starred', 'sent', 'archived']).optional()
        .describe('Filter conversations by scope. Defaults to "inbox".'),
    },
    async ({ scope }) => {
      try {
        const conversations = await client.listConversations({
          scope: scope ?? 'inbox',
        });

        const formattedConversations = conversations.map(convo => {
          const lastMessagePreview = convo.last_message
            ? stripHtmlTags(convo.last_message).substring(0, 200)
            : null;

          return {
            id: convo.id,
            subject: convo.subject,
            participants: convo.participants.map(p => p.name),
            last_message: lastMessagePreview,
            last_message_at: convo.last_message_at,
            message_count: convo.message_count,
            workflow_state: convo.workflow_state,
            context_name: convo.context_name ?? null,
          };
        });

        // Sort by last_message_at descending (most recent first)
        formattedConversations.sort((a, b) => {
          if (!a.last_message_at) return 1;
          if (!b.last_message_at) return -1;
          return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
        });

        return formatSuccess({
          count: formattedConversations.length,
          conversations: formattedConversations,
        });
      } catch (error) {
        return formatError('listing conversations', error);
      }
    }
  );

  server.tool(
    'get_conversation',
    'Get a specific conversation with all its messages. Shows the full message thread with author names and message bodies.',
    {
      conversation_id: z.number().int().positive()
        .describe('The ID of the conversation to retrieve.'),
    },
    async ({ conversation_id }) => {
      try {
        const conversation = await client.getConversation(conversation_id);

        // Build participant ID → name map for resolving author names
        const participantMap = new Map<number, string>();
        for (const participant of conversation.participants) {
          participantMap.set(participant.id, participant.name);
        }

        const formattedMessages = (conversation.messages ?? []).map(msg => ({
          id: msg.id,
          author: participantMap.get(msg.author_id) ?? `User ${msg.author_id}`,
          body: stripHtmlTags(msg.body),
          created_at: msg.created_at,
        }));

        return formatSuccess({
          id: conversation.id,
          subject: conversation.subject,
          workflow_state: conversation.workflow_state,
          context_name: conversation.context_name ?? null,
          message_count: conversation.message_count,
          participants: conversation.participants.map(p => ({ id: p.id, name: p.name })),
          messages: formattedMessages,
        });
      } catch (error) {
        return formatError('getting conversation', error);
      }
    }
  );
}

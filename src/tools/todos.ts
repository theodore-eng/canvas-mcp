import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess } from '../utils.js';

export function registerTodoTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'get_my_todo_items',
    'Get your Canvas TODO list — items that need attention like unsubmitted assignments and quizzes',
    {},
    async () => {
      try {
        const todos = await client.getTodoItems();

        const formattedTodos = todos.map(item => ({
          type: item.type,
          course_id: item.course_id,
          course_name: item.context_name,
          name: item.assignment?.name ?? item.quiz?.title ?? 'Unknown',
          due_at: item.assignment?.due_at ?? null,
          points_possible: item.assignment?.points_possible ?? null,
          html_url: item.html_url,
        }));

        return formatSuccess({
          count: formattedTodos.length,
          items: formattedTodos,
        });
      } catch (error) {
        return formatError('getting todo items', error);
      }
    }
  );
}

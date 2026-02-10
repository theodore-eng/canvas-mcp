import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatError, formatSuccess } from '../utils.js';
import {
  loadPreferences, setPreference, deletePreference,
  loadContext, addContextNote, clearOldNotes,
} from '../services/preferences.js';

export function registerPreferenceTools(server: McpServer) {

  // ==================== save_preference ====================

  server.tool(
    'save_preference',
    'Save a user preference for how they like information displayed, what they prioritize, behavioral settings, or course-specific notes.',
    {
      category: z.enum(['display', 'priorities', 'behavior', 'courses'])
        .describe('Preference category'),
      key: z.string()
        .describe('Preference key name'),
      value: z.string()
        .describe('Preference value (JSON-parsed if possible, otherwise stored as string)'),
    },
    async ({ category, key, value }) => {
      try {
        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          parsedValue = value;
        }
        const prefs = setPreference(category, key, parsedValue);
        return formatSuccess({
          saved: true,
          category,
          key,
          value: parsedValue,
        });
      } catch (error) {
        return formatError('saving preference', error);
      }
    }
  );

  // ==================== list_preferences ====================

  server.tool(
    'list_preferences',
    'View all saved user preferences, or filter by a specific category.',
    {
      category: z.enum(['display', 'priorities', 'behavior', 'courses']).optional()
        .describe('Optional category to filter by'),
    },
    async ({ category }) => {
      try {
        const prefs = loadPreferences();
        let result: Record<string, unknown>;

        if (category) {
          result = { [category]: prefs[category] };
        } else {
          result = {
            display: prefs.display,
            priorities: prefs.priorities,
            behavior: prefs.behavior,
            courses: prefs.courses,
            last_updated: prefs.last_updated,
          };
        }

        const hasCustomizations =
          Object.keys(prefs.display).length > 0 ||
          Object.keys(prefs.priorities).length > 0 ||
          Object.keys(prefs.behavior).length > 0 ||
          Object.keys(prefs.courses).length > 0;

        return formatSuccess({
          preferences: result,
          has_customizations: hasCustomizations,
        });
      } catch (error) {
        return formatError('listing preferences', error);
      }
    }
  );

  // ==================== delete_preference ====================

  server.tool(
    'delete_preference',
    'Remove a saved user preference by category and key.',
    {
      category: z.enum(['display', 'priorities', 'behavior', 'courses'])
        .describe('Preference category'),
      key: z.string()
        .describe('Preference key to delete'),
    },
    async ({ category, key }) => {
      try {
        const deleted = deletePreference(category, key);
        return formatSuccess({
          deleted,
          category,
          key,
        });
      } catch (error) {
        return formatError('deleting preference', error);
      }
    }
  );

  // ==================== save_context_note ====================

  server.tool(
    'save_context_note',
    'Save a learning note about the user to remember across sessions. Use this to record workflow patterns, preferences observed, or important context.',
    {
      note: z.string()
        .describe('The context note to save'),
      category: z.enum(['workflow_patterns', 'conversation_notes', 'preferences_applied']).optional()
        .describe('Note category (default: workflow_patterns)'),
      source: z.enum(['observation', 'user_statement', 'implicit']).optional()
        .describe('How this note was learned (default: observation)'),
    },
    async ({ note, category, source }) => {
      try {
        const noteCategory = category ?? 'workflow_patterns';
        const noteSource = source ?? 'observation';
        const noteEntry = addContextNote(note, noteCategory, noteSource);
        return formatSuccess({
          saved: true,
          note_entry: noteEntry,
        });
      } catch (error) {
        return formatError('saving context note', error);
      }
    }
  );

  // ==================== list_context_notes ====================

  server.tool(
    'list_context_notes',
    'View saved learning notes about the user. Shows workflow patterns, conversation notes, and applied preferences.',
    {
      category: z.enum(['workflow_patterns', 'conversation_notes', 'preferences_applied']).optional()
        .describe('Optional category to filter by'),
      limit: z.number().optional()
        .describe('Maximum number of notes to return per category (default: 20)'),
    },
    async ({ category, limit }) => {
      try {
        const context = loadContext();
        const noteLimit = limit ?? 20;
        let result: Record<string, unknown>;
        let totalCount = 0;

        if (category) {
          const notes = context[category].slice(-noteLimit);
          totalCount = context[category].length;
          result = { [category]: notes };
        } else {
          result = {
            workflow_patterns: context.workflow_patterns.slice(-noteLimit),
            conversation_notes: context.conversation_notes.slice(-noteLimit),
            preferences_applied: context.preferences_applied.slice(-noteLimit),
          };
          totalCount =
            context.workflow_patterns.length +
            context.conversation_notes.length +
            context.preferences_applied.length;
        }

        return formatSuccess({
          notes: result,
          total_count: totalCount,
        });
      } catch (error) {
        return formatError('listing context notes', error);
      }
    }
  );

  // ==================== clear_old_context ====================

  server.tool(
    'clear_old_context',
    'Remove context notes older than a specified number of days.',
    {
      days_old: z.number().optional()
        .describe('Remove notes older than this many days (default: 90)'),
    },
    async ({ days_old }) => {
      try {
        const days = days_old ?? 90;
        const cleared = clearOldNotes(days);
        return formatSuccess({
          cleared,
          days_old: days,
        });
      } catch (error) {
        return formatError('clearing old context notes', error);
      }
    }
  );
}

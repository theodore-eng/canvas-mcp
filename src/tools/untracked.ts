import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, runWithConcurrency, extractDateFromText } from '../utils.js';
import type { Module, Course } from '../types/canvas.js';

// Keyword lists for classifying SubHeader items
const readingKeywords = ['read', 'reading', 'chapter', 'pp.', 'pages', 'article', 'paper', 'textbook'];
const prepKeywords = ['prepare', 'before class', 'preparation', 'preview', 'review before'];
const homeworkKeywords = ['homework', 'practice', 'exercises', 'problems', 'not graded', 'ungraded'];
const discussionKeywords = ['discussion problem', 'think about', 'consider'];

type UntrackedType = 'reading' | 'prep' | 'homework' | 'discussion';
type Confidence = 'high' | 'medium' | 'low';

interface UntrackedItem {
  title: string;
  courseName: string;
  courseId: number;
  type: UntrackedType;
  inferredDate: string | null;
  confidence: Confidence;
  moduleName: string;
  modulePosition: number;
}

/**
 * Classify a SubHeader title against keyword lists.
 * Returns the matching type or null if no match.
 */
export function classifySubHeader(title: string): UntrackedType | null {
  const lower = title.toLowerCase();

  // Check in priority order: reading > prep > homework > discussion
  if (readingKeywords.some(kw => lower.includes(kw))) return 'reading';
  if (prepKeywords.some(kw => lower.includes(kw))) return 'prep';
  if (homeworkKeywords.some(kw => lower.includes(kw))) return 'homework';
  if (discussionKeywords.some(kw => lower.includes(kw))) return 'discussion';

  return null;
}

// parseMonthName and extractDateFromText imported from utils.ts

/**
 * Compute the Monday of "Week N" relative to a semester start.
 * Assumes semester starts around mid-January for spring, late-August for fall.
 */
function weekNumberToDate(weekNum: number, referenceYear: number): Date | null {
  if (weekNum < 1 || weekNum > 20) return null;

  const now = new Date();
  const currentMonth = now.getMonth();

  // Estimate semester start: Jan for spring (month 0), Aug for fall (month 7+)
  let semesterStart: Date;
  if (currentMonth < 6) {
    // Spring semester — starts around Jan 20
    semesterStart = new Date(referenceYear, 0, 20);
  } else {
    // Fall semester — starts around Aug 28
    semesterStart = new Date(referenceYear, 7, 28);
  }

  // Adjust to the Monday of that week
  const dayOfWeek = semesterStart.getDay();
  const daysToMonday = dayOfWeek === 0 ? 1 : (dayOfWeek === 1 ? 0 : 8 - dayOfWeek);
  const firstMonday = new Date(semesterStart);
  firstMonday.setDate(firstMonday.getDate() + daysToMonday);

  // Add (weekNum - 1) weeks
  const targetDate = new Date(firstMonday);
  targetDate.setDate(targetDate.getDate() + (weekNum - 1) * 7);
  return targetDate;
}

/**
 * Try to infer a date from a module name.
 * Looks for "Week N" patterns and date literals.
 */
function inferDateFromModuleName(moduleName: string, referenceYear: number): Date | null {
  // Try "Week N" pattern
  const weekMatch = moduleName.match(/\bWeek\s+(\d{1,2})\b/i);
  if (weekMatch) {
    const weekNum = parseInt(weekMatch[1], 10);
    const date = weekNumberToDate(weekNum, referenceYear);
    if (date) return date;
  }

  // Try date literals in the module name itself
  return extractDateFromText(moduleName, referenceYear);
}

/**
 * Scan a single course's modules for untracked SubHeader items that match
 * reading/prep/homework/discussion keywords.
 */
function scanCourseModules(
  modules: Module[],
  courseId: number,
  courseName: string,
  referenceYear: number,
): UntrackedItem[] {
  const items: UntrackedItem[] = [];

  for (const mod of modules) {
    if (!mod.items || mod.items.length === 0) continue;

    // Infer a base date from the module name
    const moduleDateFromName = inferDateFromModuleName(mod.name, referenceYear);

    // Collect all dates found in item titles within this module for contextual inference
    const itemDates: Map<number, Date> = new Map();
    for (const item of mod.items) {
      const date = extractDateFromText(item.title, referenceYear);
      if (date) {
        itemDates.set(item.position, date);
      }
    }

    for (const item of mod.items) {
      if (item.type !== 'SubHeader') continue;

      const itemType = classifySubHeader(item.title);
      if (!itemType) continue;

      // Infer due date with confidence tracking
      let inferredDate: Date | null = null;
      let confidence: Confidence = 'low';

      // 1. Check the SubHeader title itself for a date (high confidence)
      const dateFromTitle = extractDateFromText(item.title, referenceYear);
      if (dateFromTitle) {
        inferredDate = dateFromTitle;
        confidence = 'high';
      }

      // 2. Look at surrounding dated items — if between two dated items, use the next one (medium confidence)
      if (!inferredDate) {
        const sortedPositions = Array.from(itemDates.keys()).sort((a, b) => a - b);
        // Find the next dated item after this SubHeader's position
        const nextDatedPos = sortedPositions.find(pos => pos > item.position);
        if (nextDatedPos !== undefined) {
          inferredDate = itemDates.get(nextDatedPos)!;
          confidence = 'medium';
        } else {
          // No next dated item — try the previous one
          const prevDatedPositions = sortedPositions.filter(pos => pos < item.position);
          if (prevDatedPositions.length > 0) {
            inferredDate = itemDates.get(prevDatedPositions[prevDatedPositions.length - 1])!;
            confidence = 'medium';
          }
        }
      }

      // 3. Fall back to module-level date from name (medium confidence)
      if (!inferredDate && moduleDateFromName) {
        inferredDate = moduleDateFromName;
        confidence = 'medium';
      }

      // 4. Use module position to estimate date (low confidence)
      //    Spread modules evenly across the days_ahead window — handled during filtering

      items.push({
        title: item.title,
        courseName,
        courseId,
        type: itemType,
        inferredDate: inferredDate ? formatDateString(inferredDate) : null,
        confidence,
        moduleName: mod.name,
        modulePosition: mod.position,
      });
    }
  }

  return items;
}

/**
 * Format a Date as YYYY-MM-DD.
 */
function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Deduplicate items: if the same title appears in multiple modules, keep only
 * the one with the earliest inferred date. Items with no date are kept as-is
 * unless an identical title exists with a date.
 */
function deduplicateItems(items: UntrackedItem[]): UntrackedItem[] {
  const seen = new Map<string, UntrackedItem>();

  for (const item of items) {
    // Key by normalized title + course
    const key = `${item.courseId}:${item.title.toLowerCase().trim()}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, item);
      continue;
    }

    // Keep the one with the earliest date; prefer dated over undated
    if (!existing.inferredDate && item.inferredDate) {
      seen.set(key, item);
    } else if (existing.inferredDate && item.inferredDate && item.inferredDate < existing.inferredDate) {
      seen.set(key, item);
    }
  }

  return Array.from(seen.values());
}

export function registerUntrackedTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'scan_untracked_work',
    'Scan course modules for untracked work \u2014 readings, prep assignments, and tasks that don\'t appear on the Canvas calendar or planner. These are hidden in module SubHeaders and page content that students would otherwise need to check manually.',
    {
      course_id: z.number().int().positive().optional()
        .describe('Scan a specific course. If omitted, scans all active courses.'),
      days_ahead: z.number().int().min(1).max(30).optional().default(7)
        .describe('How many days ahead to look for upcoming untracked work (default: 7)'),
    },
    async ({ course_id, days_ahead }) => {
      try {
        // 1. Get courses to scan
        let courses: Course[];
        if (course_id) {
          const course = await client.getCourse(course_id);
          courses = [course];
        } else {
          const allCourses = await client.getActiveCourses();
          // Filter out past courses by term end date
          const now = new Date();
          courses = allCourses.filter(course => {
            const endDate = course.term?.end_at ?? course.end_at;
            if (!endDate) return true;
            return new Date(endDate) > now;
          });
        }

        if (courses.length === 0) {
          return formatSuccess({
            scan_date: client.getLocalDateString(),
            days_ahead,
            courses_scanned: 0,
            total_items: 0,
            items: [],
            note: 'No active courses found to scan.',
          });
        }

        // 2. Fetch modules with items for each course (concurrency limit 3)
        const fetchTasks = courses.map(course => async () => {
          const modules = await client.listModules(course.id, { include: ['items'] });
          return { course, modules };
        });

        const results = await runWithConcurrency(fetchTasks, 3);

        // 3. Scan each course's modules for untracked work
        const referenceYear = new Date().getFullYear();
        let allItems: UntrackedItem[] = [];
        const coursesScanned: string[] = [];

        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          const { course, modules } = result.value;
          coursesScanned.push(course.name);

          const courseItems = scanCourseModules(modules, course.id, course.name, referenceYear);
          allItems.push(...courseItems);
        }

        // 4. Filter by days_ahead window
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() + days_ahead);

        // For position-based estimation when no date is inferred:
        // We consider items in modules whose position suggests they are "current" or upcoming.
        // Use the total module count to estimate which positions fall within the window.
        const totalModulesByC = new Map<number, number>();
        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          totalModulesByC.set(result.value.course.id, result.value.modules.length);
        }

        allItems = allItems.filter(item => {
          if (item.inferredDate) {
            const itemDate = new Date(item.inferredDate + 'T00:00:00');
            // Include items that are due between yesterday (to catch items due today that
            // may have been posted with the previous day's date) and cutoff
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            return itemDate >= yesterday && itemDate <= cutoff;
          }

          // No inferred date — use position-based heuristic
          // Include items from the first ~(days_ahead/7 * 2 + 2) modules as "potentially upcoming"
          const totalModules = totalModulesByC.get(item.courseId) ?? 1;
          const modulesInWindow = Math.max(2, Math.ceil((days_ahead / 7) * 2 + 2));
          // Estimate which module positions are "current" — look at modules in the middle-to-later portion
          // In a typical 15-week semester, each week has ~1 module, so position correlates with week
          const semesterWeekEstimate = Math.ceil((now.getTime() - new Date(referenceYear, 0, 20).getTime()) / (7 * 24 * 60 * 60 * 1000));
          const currentModuleEstimate = Math.max(1, Math.min(semesterWeekEstimate, totalModules));
          return item.modulePosition >= currentModuleEstimate && item.modulePosition <= currentModuleEstimate + modulesInWindow;
        });

        // 5. Deduplicate
        allItems = deduplicateItems(allItems);

        // Sort by inferred date (soonest first), then undated at the end
        allItems.sort((a, b) => {
          if (!a.inferredDate && !b.inferredDate) return a.modulePosition - b.modulePosition;
          if (!a.inferredDate) return 1;
          if (!b.inferredDate) return -1;
          return a.inferredDate.localeCompare(b.inferredDate);
        });

        // 6. Format output
        return formatSuccess({
          scan_date: client.getLocalDateString(),
          days_ahead,
          courses_scanned: coursesScanned,
          total_items: allItems.length,
          items: allItems.map(item => ({
            title: item.title,
            course_name: item.courseName,
            course_id: item.courseId,
            type: item.type,
            inferred_due_date: item.inferredDate,
            confidence: item.confidence,
            source: {
              module_name: item.moduleName,
              source_type: 'module_heading',
              module_position: item.modulePosition,
            },
          })),
          note: 'These items don\'t appear on your Canvas calendar or planner. They are extracted from module headings and context.',
        });
      } catch (error) {
        return formatError('scanning for untracked work', error);
      }
    }
  );
}

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getCanvasClient } from '../canvas-client.js';
import { formatError, formatSuccess, stripHtmlTags, runWithConcurrency } from '../utils.js';

// Lightweight keyword lists for inline untracked work scanning
const untrackedKeywords = ['read', 'reading', 'chapter', 'prepare', 'before class', 'homework', 'practice'];

// Exam/quiz detection pattern
const examPattern = /exam|midterm|final|quiz|test/i;

/**
 * Inline lightweight date extraction from text for untracked work scanning.
 * Looks for "Month Day" patterns (e.g., "Feb 10", "March 3") and MM/DD patterns.
 */
function extractDateFromText(text: string, referenceYear: number): Date | null {
  const months: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, september: 8, sept: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
  };

  // Pattern 1: "Month Day" (e.g., "Feb 10", "March 3")
  const monthDayPattern = /\b([A-Z][a-z]+\.?)\s+(\d{1,2})\b/;
  const match1 = text.match(monthDayPattern);
  if (match1) {
    const cleaned = match1[1].toLowerCase().replace(/\.$/, '');
    const month = months[cleaned];
    const day = parseInt(match1[2], 10);
    if (month !== undefined && !isNaN(day) && day >= 1 && day <= 31) {
      return new Date(referenceYear, month, day);
    }
  }

  // Pattern 2: MM/DD format
  const mmddPattern = /\b(\d{1,2})\/(\d{1,2})\b/;
  const match2 = text.match(mmddPattern);
  if (match2) {
    const month = parseInt(match2[1], 10) - 1;
    const day = parseInt(match2[2], 10);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return new Date(referenceYear, month, day);
    }
  }

  return null;
}

/**
 * Classify an untracked SubHeader item type based on keywords.
 */
function classifyUntrackedType(title: string): string | null {
  const lower = title.toLowerCase();
  if (['read', 'reading', 'chapter'].some(kw => lower.includes(kw))) return 'reading';
  if (['prepare', 'before class'].some(kw => lower.includes(kw))) return 'prep';
  if (['homework', 'practice'].some(kw => lower.includes(kw))) return 'homework';
  return null;
}

export function registerDashboardTools(server: McpServer) {
  const client = getCanvasClient();

  server.tool(
    'daily_briefing',
    'Your morning command center: urgency alerts, exam warnings, today\'s schedule, upcoming assignments, untracked readings/prep, grade status, announcements, and a week-ahead preview. Run this first thing every day.',
    {
      days_ahead: z.number().optional().default(7)
        .describe('How many days ahead to look for upcoming work (default: 7)'),
    },
    async ({ days_ahead }) => {
      try {
        const todayStr = client.getLocalDateString();
        const now = new Date();
        const futureDate = new Date(Date.now() + days_ahead * 24 * 60 * 60 * 1000);
        const futureDateStr = client.getLocalDateString(futureDate);
        const tomorrowStr = client.getLocalDateString(new Date(Date.now() + 24 * 60 * 60 * 1000));
        const weekAgoStr = client.getLocalDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
        const exam_window_end = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

        const warnings: string[] = [];

        // ===== WAVE 1: Fetch courses, todos, planner items in parallel =====
        const [coursesResult, todosResult, plannerResult] = await Promise.allSettled([
          client.listCourses({
            enrollment_state: 'active',
            state: ['available'],
            include: ['total_scores', 'term'],
          }),
          client.getTodoItems(),
          client.listPlannerItems({
            start_date: todayStr,
            end_date: futureDateStr,
            filter: 'incomplete_items',
          }),
        ]);

        const courses = coursesResult.status === 'fulfilled' ? coursesResult.value : [];
        const todos = todosResult.status === 'fulfilled' ? todosResult.value : [];
        const plannerItems = plannerResult.status === 'fulfilled' ? plannerResult.value : [];

        if (coursesResult.status === 'rejected') warnings.push('Could not load courses');
        if (todosResult.status === 'rejected') warnings.push('Could not load todo items');
        if (plannerResult.status === 'rejected') warnings.push('Could not load planner items');

        // Build course name lookup
        const courseNameMap = new Map(courses.map(c => [`course_${c.id}`, c.name]));
        const contextCodes = courses.map(c => `course_${c.id}`);

        // ===== WAVE 2: Fetch events, announcements, modules, assignments (needs course IDs) =====
        const [eventsResult, announcementsResult, modulesResults, assignmentResults] = await Promise.allSettled([
          contextCodes.length > 0
            ? client.listCalendarEvents({
                context_codes: contextCodes,
                start_date: todayStr,
                end_date: tomorrowStr,
              })
            : Promise.resolve([]),
          contextCodes.length > 0
            ? client.listAnnouncements({
                context_codes: contextCodes,
                start_date: weekAgoStr,
                end_date: todayStr,
                active_only: true,
              })
            : Promise.resolve([]),
          // Fetch modules for untracked work scanning (concurrency limit 3)
          runWithConcurrency(courses.map(c => async () => {
            const mods = await client.listModules(c.id, { include: ['items'] });
            return { courseId: c.id, courseName: c.name, modules: mods };
          }), 3),
          // Fetch assignments for exam detection + upcoming assignments with submission status
          runWithConcurrency(courses.map(c => async () => {
            const assignments = await client.listAssignments(c.id, { include: ['submission'] });
            return { courseId: c.id, courseName: c.name, assignments };
          }), 3),
        ]);

        const todayEvents = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
        const announcements = announcementsResult.status === 'fulfilled' ? announcementsResult.value : [];

        if (eventsResult.status === 'rejected') warnings.push('Could not load calendar events');
        if (announcementsResult.status === 'rejected') warnings.push('Could not load announcements');

        // Process module results
        const moduleData: Array<{ courseId: number; courseName: string; modules: Awaited<ReturnType<typeof client.listModules>> }> = [];
        if (modulesResults.status === 'fulfilled') {
          for (const r of modulesResults.value) {
            if (r.status === 'fulfilled') {
              moduleData.push(r.value);
            }
          }
        } else {
          warnings.push('Could not load modules for untracked work scanning');
        }

        // Process assignment results
        const assignmentData: Array<{ courseId: number; courseName: string; assignments: Awaited<ReturnType<typeof client.listAssignments>> }> = [];
        if (assignmentResults.status === 'fulfilled') {
          for (const r of assignmentResults.value) {
            if (r.status === 'fulfilled') {
              assignmentData.push(r.value);
            }
          }
        } else {
          warnings.push('Could not load assignments');
        }

        // ===== SECTION 3: URGENCY =====
        // Collect all assignments across courses for urgency analysis
        const allAssignments: Array<{
          name: string;
          course: string;
          due_at: string | null;
          points_possible: number;
          submission_types: string[];
          submission_status: string;
          missing: boolean;
          days_until_due: number | null;
        }> = [];

        let overdueCount = 0;
        let dueTodayCount = 0;
        let dueTomorrowCount = 0;
        let dueThisWeekCount = 0;
        let missingCount = 0;

        const todayStart = new Date(todayStr + 'T00:00:00');
        const todayEnd = new Date(todayStr + 'T23:59:59');
        const tomorrowStart = new Date(tomorrowStr + 'T00:00:00');
        const tomorrowEnd = new Date(tomorrowStr + 'T23:59:59');
        const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        for (const courseData of assignmentData) {
          for (const a of courseData.assignments) {
            if (!a.published) continue;

            const sub = a.submission;
            const isSubmitted = sub?.workflow_state === 'submitted' || sub?.workflow_state === 'graded';
            const isMissing = sub?.missing ?? false;
            const dueAt = a.due_at ? new Date(a.due_at) : null;
            const daysUntil = dueAt
              ? Math.ceil((dueAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
              : null;

            let submissionStatus = 'not_submitted';
            if (sub?.workflow_state === 'graded') submissionStatus = 'graded';
            else if (sub?.workflow_state === 'submitted') submissionStatus = 'submitted';
            else if (isMissing) submissionStatus = 'missing';

            // Count urgency metrics (only for unsubmitted/missing assignments)
            if (!isSubmitted && dueAt) {
              if (dueAt < todayStart) overdueCount++;
              else if (dueAt >= todayStart && dueAt <= todayEnd) dueTodayCount++;
              else if (dueAt >= tomorrowStart && dueAt <= tomorrowEnd) dueTomorrowCount++;
              else if (dueAt > tomorrowEnd && dueAt <= weekEnd) dueThisWeekCount++;
            }
            if (isMissing) missingCount++;

            // Only include upcoming assignments (due in the future or recently overdue, and not yet graded)
            if (dueAt && dueAt >= todayStart && dueAt <= futureDate) {
              allAssignments.push({
                name: a.name,
                course: courseData.courseName,
                due_at: a.due_at,
                points_possible: a.points_possible,
                submission_types: a.submission_types,
                submission_status: submissionStatus,
                missing: isMissing,
                days_until_due: daysUntil,
              });
            }
          }
        }

        // Sort upcoming assignments by due date
        allAssignments.sort((a, b) => {
          if (!a.due_at) return 1;
          if (!b.due_at) return -1;
          return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
        });

        let alertLevel: 'critical' | 'warning' | 'normal' = 'normal';
        if (overdueCount > 0 || missingCount > 0) alertLevel = 'critical';
        else if (dueTodayCount > 0) alertLevel = 'warning';

        const urgency = {
          overdue_count: overdueCount,
          due_today_count: dueTodayCount,
          due_tomorrow_count: dueTomorrowCount,
          due_this_week_count: dueThisWeekCount,
          missing_count: missingCount,
          alert_level: alertLevel,
        };

        // ===== SECTION 4: EXAM ALERTS =====
        const examAlerts: Array<{
          name: string;
          course: string;
          due_at: string | null;
          days_until: number | null;
          points_possible: number;
        }> = [];

        for (const courseData of assignmentData) {
          for (const a of courseData.assignments) {
            if (!a.published || !a.due_at) continue;
            const dueAt = new Date(a.due_at);
            if (dueAt < todayStart || dueAt > exam_window_end) continue;

            const isQuizType = a.submission_types.includes('online_quiz');
            const nameMatchesExam = examPattern.test(a.name);

            if (isQuizType || nameMatchesExam) {
              const daysUntil = Math.ceil((dueAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              examAlerts.push({
                name: a.name,
                course: courseData.courseName,
                due_at: a.due_at,
                days_until: daysUntil,
                points_possible: a.points_possible,
              });
            }
          }
        }

        // Sort exam alerts by due date
        examAlerts.sort((a, b) => {
          if (!a.due_at) return 1;
          if (!b.due_at) return -1;
          return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
        });

        // ===== SECTION 5: TODAY'S EVENTS =====
        const todayEventsFormatted = todayEvents.map(event => ({
          title: event.title,
          type: event.type,
          start_at: event.start_at,
          end_at: event.end_at,
          location: event.location_name,
          context: event.context_name ?? event.context_code,
        })).sort((a, b) => {
          if (!a.start_at) return 1;
          if (!b.start_at) return -1;
          return new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
        });

        // ===== SECTION 6: ACTION ITEMS (Canvas todo queue) =====
        const actionItems = todos.map(item => ({
          name: item.assignment?.name ?? item.quiz?.title ?? 'Unknown',
          course: item.context_name,
          due_at: item.assignment?.due_at ?? null,
          points_possible: item.assignment?.points_possible ?? null,
        }));

        // ===== SECTION 7: UPCOMING ASSIGNMENTS =====
        // Already built above as allAssignments — format for output
        const upcomingAssignments = allAssignments.map(a => ({
          name: a.name,
          course: a.course,
          due_at: a.due_at,
          days_until_due: a.days_until_due,
          points_possible: a.points_possible,
          submission_status: a.submission_status,
          missing: a.missing,
        }));

        // ===== SECTION 8: UNTRACKED WORK =====
        const untrackedWork: Array<{
          title: string;
          course: string;
          type: string;
          inferred_date: string | null;
          module_name: string;
        }> = [];

        const referenceYear = now.getFullYear();
        const cutoffDate = new Date(now);
        cutoffDate.setHours(0, 0, 0, 0);
        const untrackedCutoff = new Date(cutoffDate);
        untrackedCutoff.setDate(untrackedCutoff.getDate() + days_ahead);
        const yesterday = new Date(cutoffDate);
        yesterday.setDate(yesterday.getDate() - 1);

        for (const courseModules of moduleData) {
          for (const mod of courseModules.modules) {
            if (!mod.items || mod.items.length === 0) continue;

            for (const item of mod.items) {
              if (item.type !== 'SubHeader') continue;

              const lower = item.title.toLowerCase();
              const matchesKeyword = untrackedKeywords.some(kw => lower.includes(kw));
              if (!matchesKeyword) continue;

              const itemType = classifyUntrackedType(item.title);
              if (!itemType) continue;

              // Try to extract a date from the title
              const inferredDate = extractDateFromText(item.title, referenceYear);
              let inferredDateStr: string | null = null;

              if (inferredDate) {
                // Filter to days_ahead window
                if (inferredDate < yesterday || inferredDate > untrackedCutoff) continue;
                const y = inferredDate.getFullYear();
                const m = String(inferredDate.getMonth() + 1).padStart(2, '0');
                const d = String(inferredDate.getDate()).padStart(2, '0');
                inferredDateStr = `${y}-${m}-${d}`;
              } else {
                // No date from title — try module name
                const modDate = extractDateFromText(mod.name, referenceYear);
                if (modDate) {
                  if (modDate < yesterday || modDate > untrackedCutoff) continue;
                  const y = modDate.getFullYear();
                  const m = String(modDate.getMonth() + 1).padStart(2, '0');
                  const d = String(modDate.getDate()).padStart(2, '0');
                  inferredDateStr = `${y}-${m}-${d}`;
                }
                // If no date at all, include the item without filtering by date
              }

              untrackedWork.push({
                title: item.title,
                course: courseModules.courseName,
                type: itemType,
                inferred_date: inferredDateStr,
                module_name: mod.name,
              });
            }
          }
        }

        // Sort untracked work: dated items first (by date), then undated
        untrackedWork.sort((a, b) => {
          if (!a.inferred_date && !b.inferred_date) return 0;
          if (!a.inferred_date) return 1;
          if (!b.inferred_date) return -1;
          return a.inferred_date.localeCompare(b.inferred_date);
        });

        // ===== SECTION 9: GRADES =====
        const grades: Array<{
          course: string;
          course_code: string;
          current_score: number | null;
          current_grade: string | null;
          adjusted_score?: number | null;
          grade_alert?: string;
        }> = [];

        for (const c of courses) {
          if (!c.enrollments || c.enrollments.length === 0) continue;
          const enrollment = c.enrollments[0];
          const currentScore = enrollment?.computed_current_score ?? null;
          const currentGrade = enrollment?.computed_current_grade ?? null;
          const finalScore = enrollment?.computed_final_score ?? null;

          if (currentScore === null) continue;

          const gradeEntry: {
            course: string;
            course_code: string;
            current_score: number | null;
            current_grade: string | null;
            adjusted_score?: number | null;
            grade_alert?: string;
          } = {
            course: c.name,
            course_code: c.course_code,
            current_score: currentScore,
            current_grade: currentGrade,
          };

          // Check for future-dated assignments graded as 0 (simplified deflation check)
          const courseAssignments = assignmentData.find(ad => ad.courseId === c.id);
          if (courseAssignments) {
            let futureZeroCount = 0;
            let totalEarned = 0;
            let totalPossible = 0;
            let futureZeroPossible = 0;

            for (const a of courseAssignments.assignments) {
              if (!a.published || a.omit_from_final_grade) continue;
              const sub = a.submission;
              if (!sub || sub.workflow_state !== 'graded' || sub.score === null) continue;

              totalEarned += sub.score;
              totalPossible += a.points_possible;

              if (sub.score === 0 && a.due_at && new Date(a.due_at) > now) {
                futureZeroCount++;
                futureZeroPossible += a.points_possible;
              }
            }

            if (futureZeroCount > 0 && totalPossible > 0) {
              const adjPossible = totalPossible - futureZeroPossible;
              if (adjPossible > 0) {
                const adjustedScore = Math.round((totalEarned / adjPossible) * 10000) / 100;
                gradeEntry.adjusted_score = adjustedScore;

                if (Math.abs(currentScore - adjustedScore) > 5) {
                  gradeEntry.grade_alert = `${futureZeroCount} future-dated assignment(s) graded as 0 may be deflating your score. Canvas shows ${currentScore}% but excluding future zeros gives ${adjustedScore}%.`;
                }
              }
            }
          }

          // Check for big gap between current and final score
          if (finalScore !== null && currentScore !== null && Math.abs(finalScore - currentScore) > 10) {
            const existingAlert = gradeEntry.grade_alert ?? '';
            const gapAlert = `Large gap between current score (${currentScore}%) and final score (${finalScore}%) — final score treats unsubmitted work as 0.`;
            gradeEntry.grade_alert = existingAlert ? `${existingAlert} ${gapAlert}` : gapAlert;
          }

          grades.push(gradeEntry);
        }

        // ===== SECTION 10: ANNOUNCEMENTS =====
        const recentAnnouncements = announcements.slice(0, 5).map(ann => ({
          title: ann.title,
          author: ann.user_name,
          posted_at: ann.posted_at,
          course: courseNameMap.get(ann.context_code) ?? ann.context_code,
          preview: stripHtmlTags(ann.message).substring(0, 200),
        }));

        // ===== SECTION 11: WEEK AHEAD PREVIEW =====
        const weekAheadPreview: Array<{ date: string; count: number; items: string[] }> = [];
        for (let i = 0; i < 7; i++) {
          const dayDate = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
          const dayStr = client.getLocalDateString(dayDate);
          const dayStart = new Date(dayStr + 'T00:00:00');
          const dayEnd = new Date(dayStr + 'T23:59:59');

          const dayItems: string[] = [];
          for (const courseData of assignmentData) {
            for (const a of courseData.assignments) {
              if (!a.published || !a.due_at) continue;
              const dueAt = new Date(a.due_at);
              if (dueAt >= dayStart && dueAt <= dayEnd) {
                const sub = a.submission;
                const isSubmitted = sub?.workflow_state === 'submitted' || sub?.workflow_state === 'graded';
                if (!isSubmitted) {
                  dayItems.push(`${a.name} (${courseData.courseName})`);
                }
              }
            }
          }

          weekAheadPreview.push({
            date: dayStr,
            count: dayItems.length,
            items: dayItems,
          });
        }

        // ===== BUILD FINAL RESPONSE =====
        return formatSuccess({
          date: todayStr,
          warnings: warnings.length > 0 ? warnings : undefined,
          urgency,
          exam_alerts: examAlerts,
          todays_events: todayEventsFormatted,
          action_items: actionItems,
          upcoming_assignments: upcomingAssignments,
          untracked_work: untrackedWork,
          grades,
          announcements: recentAnnouncements,
          week_ahead_preview: weekAheadPreview,
        });
      } catch (error) {
        return formatError('getting daily briefing', error);
      }
    }
  );

  server.tool(
    'get_my_profile',
    'Get your Canvas user profile information',
    {},
    async () => {
      try {
        const profile = await client.getUserProfile();

        return formatSuccess({
          id: profile.id,
          name: profile.name,
          short_name: profile.short_name,
          email: profile.primary_email,
          time_zone: profile.time_zone,
          locale: profile.locale,
          bio: profile.bio,
          avatar_url: profile.avatar_url,
        });
      } catch (error) {
        return formatError('getting profile', error);
      }
    }
  );
}

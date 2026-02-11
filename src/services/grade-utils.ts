/**
 * Shared grade deflation detection logic.
 * Detects "future zero" deflation where Canvas grades future-dated assignments as 0,
 * making the student's score appear lower than their actual performance.
 */

interface GradedItem {
  published?: boolean;
  omit_from_final_grade?: boolean;
  points_possible: number;
  due_at: string | null;
  submission?: {
    workflow_state: string;
    score: number | null;
  } | null;
}

export interface DeflationResult {
  totalEarned: number;
  totalPossible: number;
  futureZeroCount: number;
  futureZeroPossible: number;
  adjustedScore: number | null;
  deflationWarning: string | null;
}

/**
 * Analyze a flat list of assignments for future-zero grade deflation.
 * Works with both assignment group items and flat assignment lists.
 */
export function detectGradeDeflation(
  assignments: GradedItem[],
  now: Date,
  currentScore: number | null = null,
): DeflationResult {
  let totalEarned = 0;
  let totalPossible = 0;
  let futureZeroCount = 0;
  let futureZeroEarned = 0;
  let futureZeroPossible = 0;

  for (const a of assignments) {
    if (a.published === false || a.omit_from_final_grade) continue;

    const sub = a.submission;
    if (!sub || sub.workflow_state !== 'graded' || sub.score === null) continue;

    totalEarned += sub.score;
    totalPossible += a.points_possible;

    if (sub.score === 0 && a.due_at && new Date(a.due_at) > now) {
      futureZeroCount++;
      futureZeroEarned += sub.score;
      futureZeroPossible += a.points_possible;
    }
  }

  let adjustedScore: number | null = null;
  let deflationWarning: string | null = null;

  if (futureZeroCount > 0) {
    const adjEarned = totalEarned - futureZeroEarned;
    const adjPossible = totalPossible - futureZeroPossible;
    if (adjPossible > 0) {
      adjustedScore = Math.round((adjEarned / adjPossible) * 10000) / 100;
    }

    if (
      currentScore !== null &&
      adjustedScore !== null &&
      Math.abs(currentScore - adjustedScore) > 5
    ) {
      deflationWarning =
        `${futureZeroCount} future-dated assignment(s) graded as 0 may be deflating your score. ` +
        `Canvas shows ${currentScore}% but excluding future zeros gives ${adjustedScore}%.`;
    }
  }

  return {
    totalEarned,
    totalPossible,
    futureZeroCount,
    futureZeroPossible,
    adjustedScore,
    deflationWarning,
  };
}

/**
 * Flatten assignment groups into a single list of graded items.
 */
export function flattenAssignmentGroups(
  groups: Array<{ assignments?: GradedItem[] }>,
): GradedItem[] {
  const items: GradedItem[] = [];
  for (const group of groups) {
    for (const a of group.assignments ?? []) {
      items.push(a);
    }
  }
  return items;
}

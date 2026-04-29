import type {
  RubricCriteria,
  RubricAssessmentEntry,
} from '../types/canvas.js';

/**
 * Pure logic for joining a Canvas rubric template with the user's
 * per-criterion assessment. Lives in services/ so it can be unit-tested
 * without standing up a Canvas mock — the tool layer in tools/rubrics.ts
 * is a thin shell around `joinRubricAssessment`.
 *
 * Why this matters: the rubric-loss-pattern coach (future) needs the
 * same join. Sharing the function ensures the briefing's "you lost X
 * pts on Y" text and the coach's "you keep losing on criterion Y" text
 * agree on the math.
 */

export interface JoinedRubricCriterion {
  criterion_id: string;
  description: string;
  points_possible: number;
  points_awarded: number | null;
  points_lost: number | null;
  rating_id: string | null;
  rating_description: string | null;
  comments: string | null;
}

export interface RubricJoinResult {
  total_points_possible: number;
  total_points_awarded: number;
  total_points_lost: number;
  criteria: JoinedRubricCriterion[];
  biggest_losses: JoinedRubricCriterion[];
}

/**
 * Join a rubric template (assignment.rubric) with a per-criterion
 * assessment (submission.rubric_assessment). Returns:
 *   - criteria: every scoring criterion with points awarded/lost
 *   - totals: sum across non-ignored criteria
 *   - biggest_losses: top 3 criteria where points were lost (most lost first)
 *
 * Skips criteria flagged `ignore_for_scoring` from totals and from the
 * biggest-losses ranking, but still emits them in `criteria` so the LLM
 * can see grader comments on them.
 */
export function joinRubricAssessment(
  rubric: RubricCriteria[],
  assessment: Record<string, RubricAssessmentEntry> | undefined,
): RubricJoinResult {
  const ratingById = new Map<string, { description: string; points: number }>();
  for (const c of rubric ?? []) {
    for (const r of c.ratings ?? []) {
      ratingById.set(r.id, { description: r.description, points: r.points });
    }
  }

  const criteria: JoinedRubricCriterion[] = [];
  let totalPossible = 0;
  let totalAwarded = 0;

  for (const c of rubric ?? []) {
    const entry = assessment?.[c.id];
    const awarded = entry?.points ?? null;
    const points_lost = awarded !== null && awarded !== undefined ? c.points - awarded : null;
    const ratingId = entry?.rating_id ?? null;
    const ratingMeta = ratingId ? (ratingById.get(ratingId) ?? null) : null;

    if (!c.ignore_for_scoring) {
      totalPossible += c.points;
      if (awarded !== null && awarded !== undefined) totalAwarded += awarded;
    }

    criteria.push({
      criterion_id: c.id,
      description: c.description,
      points_possible: c.points,
      points_awarded: awarded,
      points_lost,
      rating_id: ratingId,
      rating_description: ratingMeta?.description ?? null,
      comments: entry?.comments ?? null,
    });
  }

  // Biggest losses excludes ignored-for-scoring criteria — they don't
  // affect the grade, so a "loss" there is misleading.
  const ignoredIds = new Set(
    (rubric ?? []).filter((c) => c.ignore_for_scoring).map((c) => c.id),
  );
  const biggest_losses = [...criteria]
    .filter((j) => !ignoredIds.has(j.criterion_id))
    .filter((j) => j.points_lost !== null && j.points_lost > 0)
    .sort((a, b) => (b.points_lost ?? 0) - (a.points_lost ?? 0))
    .slice(0, 3);

  return {
    total_points_possible: totalPossible,
    total_points_awarded: totalAwarded,
    total_points_lost: totalPossible - totalAwarded,
    criteria,
    biggest_losses,
  };
}

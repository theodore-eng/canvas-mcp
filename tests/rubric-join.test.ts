import { describe, it, expect } from 'vitest';
import { joinRubricAssessment } from '../src/services/rubric-join.js';
import type { RubricCriteria, RubricAssessmentEntry } from '../src/types/canvas.js';

/**
 * Pure-function tests for the rubric/assessment join. The tool layer in
 * src/tools/rubrics.ts is a thin shell over this — covering the join
 * here gives the rubric tools real test coverage without standing up
 * a Canvas mock.
 */

function criterion(over: Partial<RubricCriteria> & { id: string; points: number; description: string }): RubricCriteria {
  return {
    criterion_use_range: false,
    ratings: [],
    ...over,
  };
}

describe('joinRubricAssessment', () => {
  it('returns zero-totals + empty arrays for an empty rubric', () => {
    const result = joinRubricAssessment([], undefined);
    expect(result.total_points_possible).toBe(0);
    expect(result.total_points_awarded).toBe(0);
    expect(result.total_points_lost).toBe(0);
    expect(result.criteria).toEqual([]);
    expect(result.biggest_losses).toEqual([]);
  });

  it('joins points awarded per criterion and computes points_lost', () => {
    const rubric: RubricCriteria[] = [
      criterion({ id: 'c1', points: 10, description: 'Pitches' }),
      criterion({ id: 'c2', points: 5, description: 'Citations' }),
    ];
    const assessment: Record<string, RubricAssessmentEntry> = {
      c1: { points: 7 },
      c2: { points: 5 },
    };
    const out = joinRubricAssessment(rubric, assessment);
    expect(out.total_points_possible).toBe(15);
    expect(out.total_points_awarded).toBe(12);
    expect(out.total_points_lost).toBe(3);
    const c1 = out.criteria.find((c) => c.criterion_id === 'c1');
    expect(c1?.points_awarded).toBe(7);
    expect(c1?.points_lost).toBe(3);
    const c2 = out.criteria.find((c) => c.criterion_id === 'c2');
    expect(c2?.points_awarded).toBe(5);
    expect(c2?.points_lost).toBe(0);
  });

  it('returns null awarded/lost for criteria the grader did not score', () => {
    const rubric = [criterion({ id: 'c1', points: 10, description: 'X' })];
    const out = joinRubricAssessment(rubric, {});
    expect(out.criteria[0].points_awarded).toBeNull();
    expect(out.criteria[0].points_lost).toBeNull();
    expect(out.total_points_awarded).toBe(0);
  });

  it('biggest_losses orders by most-points-lost first, top 3', () => {
    const rubric: RubricCriteria[] = [
      criterion({ id: 'a', points: 10, description: 'A' }),
      criterion({ id: 'b', points: 10, description: 'B' }),
      criterion({ id: 'c', points: 10, description: 'C' }),
      criterion({ id: 'd', points: 10, description: 'D' }),
      criterion({ id: 'e', points: 10, description: 'E' }),
    ];
    const out = joinRubricAssessment(rubric, {
      a: { points: 7 },   // lost 3
      b: { points: 1 },   // lost 9 — biggest
      c: { points: 10 },  // lost 0
      d: { points: 4 },   // lost 6
      e: { points: 5 },   // lost 5
    });
    expect(out.biggest_losses.map((j) => j.criterion_id)).toEqual(['b', 'd', 'e']);
  });

  it('excludes ignore_for_scoring criteria from totals AND biggest_losses', () => {
    const rubric: RubricCriteria[] = [
      criterion({ id: 'real', points: 10, description: 'Real' }),
      criterion({ id: 'ignored', points: 100, description: 'Ignored', ignore_for_scoring: true }),
    ];
    const out = joinRubricAssessment(rubric, {
      real: { points: 8 },
      ignored: { points: 0 }, // would be a 100-point loss if counted
    });
    expect(out.total_points_possible).toBe(10);
    expect(out.total_points_awarded).toBe(8);
    expect(out.total_points_lost).toBe(2);
    // The ignored criterion still shows up in the criteria list (so the
    // LLM can see grader comments) but is NOT in biggest_losses.
    expect(out.criteria).toHaveLength(2);
    expect(out.biggest_losses.map((j) => j.criterion_id)).toEqual(['real']);
  });

  it('excludes zero-loss criteria from biggest_losses', () => {
    const rubric = [
      criterion({ id: 'a', points: 5, description: 'A' }),
      criterion({ id: 'b', points: 5, description: 'B' }),
    ];
    const out = joinRubricAssessment(rubric, {
      a: { points: 5 },
      b: { points: 5 },
    });
    expect(out.biggest_losses).toEqual([]);
  });

  it('hydrates rating_description from the matched rating_id', () => {
    const rubric: RubricCriteria[] = [
      {
        id: 'c1',
        points: 10,
        description: 'Style',
        criterion_use_range: false,
        ratings: [
          { id: 'r-good', points: 10, description: 'Excellent' },
          { id: 'r-mid',  points: 5,  description: 'Adequate' },
        ],
      },
    ];
    const out = joinRubricAssessment(rubric, {
      c1: { rating_id: 'r-mid', points: 5 },
    });
    expect(out.criteria[0].rating_description).toBe('Adequate');
    expect(out.criteria[0].rating_id).toBe('r-mid');
  });

  it('passes through grader comments verbatim', () => {
    const rubric = [criterion({ id: 'c1', points: 10, description: 'X' })];
    const out = joinRubricAssessment(rubric, {
      c1: { points: 7, comments: 'Solid analysis but weak on terminal value.' },
    });
    expect(out.criteria[0].comments).toBe('Solid analysis but weak on terminal value.');
  });

  it('handles undefined assessment (ungraded submission)', () => {
    const rubric = [criterion({ id: 'c1', points: 10, description: 'X' })];
    const out = joinRubricAssessment(rubric, undefined);
    expect(out.total_points_awarded).toBe(0);
    expect(out.criteria[0].points_awarded).toBeNull();
    expect(out.biggest_losses).toEqual([]);
  });
});

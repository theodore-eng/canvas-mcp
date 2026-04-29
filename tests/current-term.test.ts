import { describe, it, expect } from 'vitest';
import { isCurrentTermCourse } from '../src/canvas-client.js';
import type { Course } from '../src/types/canvas.js';

/**
 * Pure-logic tests for the current-term filter. These guarantee that
 * Canvas's "active" enrollment state never leaks past-semester or future-
 * semester courses into the briefing, grades, sync, etc.
 */

const FROZEN_NOW = new Date('2026-04-29T12:00:00Z');

function course(over: Partial<Course> & { id: number; name: string }): Course {
  return {
    course_code: over.name.slice(0, 8),
    workflow_state: 'available',
    account_id: 1,
    root_account_id: 1,
    enrollment_term_id: 1,
    start_at: null,
    end_at: null,
    apply_assignment_group_weights: false,
    ...over,
  };
}

describe('isCurrentTermCourse', () => {
  it('REJECTS a course with no term and no dates (likely a sandbox)', () => {
    // Strict version: real academic courses always have explicit term
    // dates. Null-everywhere is the signature of an onboarding/sandbox
    // course like "AlcoholEdu" or "Career Resources" that we want filtered
    // out.
    expect(isCurrentTermCourse(course({ id: 1, name: 'No-dates Course' }), FROZEN_NOW)).toBe(false);
  });

  it('rejects courses whose term ended before now', () => {
    const c = course({
      id: 2,
      name: 'Fall 2025',
      term: { id: 10, name: 'Fall 2025', start_at: '2025-09-01T00:00:00Z', end_at: '2025-12-20T00:00:00Z' },
    });
    expect(isCurrentTermCourse(c, FROZEN_NOW)).toBe(false);
  });

  it('rejects courses whose term has not started yet (future term)', () => {
    const c = course({
      id: 3,
      name: 'Summer 2026',
      term: { id: 11, name: 'Summer 2026', start_at: '2026-06-15T00:00:00Z', end_at: '2026-08-15T00:00:00Z' },
    });
    expect(isCurrentTermCourse(c, FROZEN_NOW)).toBe(false);
  });

  it('accepts courses whose term spans today', () => {
    const c = course({
      id: 4,
      name: 'Spring 2026',
      term: { id: 12, name: 'Spring 2026', start_at: '2026-01-15T00:00:00Z', end_at: '2026-05-15T00:00:00Z' },
    });
    expect(isCurrentTermCourse(c, FROZEN_NOW)).toBe(true);
  });

  it('falls back to course.start_at / course.end_at when term is missing', () => {
    const past = course({ id: 5, name: 'Past', start_at: '2025-01-01', end_at: '2025-05-01' });
    expect(isCurrentTermCourse(past, FROZEN_NOW)).toBe(false);

    const future = course({ id: 6, name: 'Future', start_at: '2026-09-01', end_at: '2026-12-01' });
    expect(isCurrentTermCourse(future, FROZEN_NOW)).toBe(false);

    const current = course({ id: 7, name: 'Current', start_at: '2026-01-15', end_at: '2026-05-15' });
    expect(isCurrentTermCourse(current, FROZEN_NOW)).toBe(true);
  });

  it('term dates trump course dates when both are present', () => {
    // Course dates say current; term dates say past → past wins.
    const c = course({
      id: 8,
      name: 'Mismatch',
      start_at: '2026-04-01',
      end_at: '2026-05-30',
      term: { id: 13, name: 'Old Term', start_at: '2025-01-01', end_at: '2025-05-30' },
    });
    expect(isCurrentTermCourse(c, FROZEN_NOW)).toBe(false);
  });

  it('rejects non-available workflow_state', () => {
    expect(
      isCurrentTermCourse(
        course({ id: 9, name: 'Completed', workflow_state: 'completed' }),
        FROZEN_NOW,
      ),
    ).toBe(false);
    expect(
      isCurrentTermCourse(
        course({ id: 10, name: 'Deleted', workflow_state: 'deleted' }),
        FROZEN_NOW,
      ),
    ).toBe(false);
    expect(
      isCurrentTermCourse(
        course({ id: 11, name: 'Unpublished', workflow_state: 'unpublished' }),
        FROZEN_NOW,
      ),
    ).toBe(false);
  });

  it('REJECTS courses with malformed date strings (fail-closed)', () => {
    const c = course({ id: 12, name: 'Bad dates', start_at: 'not-a-date', end_at: 'also-bad' });
    expect(isCurrentTermCourse(c, FROZEN_NOW)).toBe(false);
  });

  it('REJECTS terms with null start_at — sandbox / "Ongoing" terms', () => {
    // UW-Madison's "Ongoing" term (AlcoholEdu, etc.) and "Default Term"
    // (Career Resources sandboxes) carry null start/end dates. Reject.
    const c = course({
      id: 13,
      name: 'Onboarding',
      term: { id: 14, name: 'Ongoing', start_at: null, end_at: '2026-12-01T00:00:00Z' },
    });
    expect(isCurrentTermCourse(c, FROZEN_NOW)).toBe(false);
  });

  it('REJECTS terms with null end_at — also indicates non-academic', () => {
    const c = course({
      id: 14,
      name: 'Self-paced',
      term: { id: 15, name: 'Default Term', start_at: '2025-01-01T00:00:00Z', end_at: null },
    });
    expect(isCurrentTermCourse(c, FROZEN_NOW)).toBe(false);
  });

  it('accepts a course whose term has both dates AND spans today (real semester)', () => {
    const c = course({
      id: 15,
      name: 'SP26 RE410',
      course_code: 'SP26 REALEST 410 003',
      term: { id: 16, name: 'Spring 2025-2026', start_at: '2026-01-15T00:00:00Z', end_at: '2026-05-15T00:00:00Z' },
    });
    expect(isCurrentTermCourse(c, FROZEN_NOW)).toBe(true);
  });
});

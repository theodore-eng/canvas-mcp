import { describe, it, expect } from 'vitest';
import {
  stripHtmlTags,
  formatFileSize,
  formatError,
  formatSuccess,
  formatPlannerItem,
  sortByDueDate,
  runWithConcurrency,
  MAX_FILE_SIZE,
  DEFAULT_MAX_TEXT_LENGTH,
} from '../src/utils.js';

// ==================== stripHtmlTags ====================

describe('stripHtmlTags', () => {
  it('removes basic HTML tags', () => {
    expect(stripHtmlTags('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('strips style and script blocks entirely', () => {
    const html = '<style>.foo { color: red; }</style><p>Content</p><script>alert("x")</script>';
    expect(stripHtmlTags(html)).toBe('Content');
  });

  it('preserves line breaks from block elements', () => {
    const html = '<p>First paragraph</p><p>Second paragraph</p>';
    const result = stripHtmlTags(html);
    expect(result).toContain('\n');
    expect(result).toContain('First paragraph');
    expect(result).toContain('Second paragraph');
  });

  it('decodes common named HTML entities', () => {
    expect(stripHtmlTags('&amp; &lt; &gt; &quot;')).toBe('& < > "');
    expect(stripHtmlTags('&nbsp;')).toBe('');  // single space gets trimmed
    expect(stripHtmlTags('hello&nbsp;world')).toBe('hello world');
    expect(stripHtmlTags('&#39;')).toBe("'");
    expect(stripHtmlTags('&mdash;')).toBe('—');
    expect(stripHtmlTags('&ndash;')).toBe('–');
    expect(stripHtmlTags('&hellip;')).toBe('…');
  });

  it('decodes typographic quote entities', () => {
    expect(stripHtmlTags('&lsquo;hello&rsquo;')).toBe('\u2018hello\u2019');
    expect(stripHtmlTags('&ldquo;hello&rdquo;')).toBe('\u201Chello\u201D');
  });

  it('decodes decimal numeric entities', () => {
    expect(stripHtmlTags('&#65;')).toBe('A');      // ASCII A
    expect(stripHtmlTags('&#8212;')).toBe('—');     // em dash
  });

  it('decodes hex numeric entities', () => {
    expect(stripHtmlTags('&#x41;')).toBe('A');      // hex A
    expect(stripHtmlTags('&#x2014;')).toBe('—');    // hex em dash
  });

  it('rejects out-of-range numeric entities', () => {
    // Values above 0x10FFFF should be dropped
    expect(stripHtmlTags('&#1114112;')).toBe('');   // 0x10FFFF + 1
    expect(stripHtmlTags('&#99999999;')).toBe('');
  });

  it('collapses multiple spaces and blank lines', () => {
    const html = '<p>  lots   of    spaces  </p>\n\n\n\n<p>next</p>';
    const result = stripHtmlTags(html);
    expect(result).not.toMatch(/  /);              // no double spaces
    expect(result).not.toMatch(/\n{3,}/);          // no triple+ newlines
  });

  it('handles empty string', () => {
    expect(stripHtmlTags('')).toBe('');
  });

  it('handles plain text (no HTML)', () => {
    expect(stripHtmlTags('Just plain text')).toBe('Just plain text');
  });
});

// ==================== formatFileSize ====================

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1024 * 1023)).toBe('1023.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(25 * 1024 * 1024)).toBe('25.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatFileSize(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
  });
});

// ==================== formatError ====================

describe('formatError', () => {
  it('formats Error instances', () => {
    const result = formatError('fetching data', new Error('Network failure'));
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('Error fetching data: Network failure');
  });

  it('formats string errors', () => {
    const result = formatError('loading', 'something broke');
    expect(result.content[0].text).toBe('Error loading: something broke');
    expect(result.isError).toBe(true);
  });

  it('formats non-string/non-Error values', () => {
    const result = formatError('parsing', 42);
    expect(result.content[0].text).toBe('Error parsing: 42');
  });
});

// ==================== formatSuccess ====================

describe('formatSuccess', () => {
  it('formats objects as pretty JSON', () => {
    const data = { name: 'Test', count: 5 };
    const result = formatSuccess(data);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual(data);
  });

  it('formats arrays', () => {
    const result = formatSuccess([1, 2, 3]);
    expect(JSON.parse(result.content[0].text)).toEqual([1, 2, 3]);
  });

  it('formats primitives', () => {
    const result = formatSuccess('hello');
    expect(JSON.parse(result.content[0].text)).toBe('hello');
  });

  it('formats null', () => {
    const result = formatSuccess(null);
    expect(result.content[0].text).toBe('null');
  });

  it('does not have isError property', () => {
    const result = formatSuccess({});
    expect(result).not.toHaveProperty('isError');
  });
});

// ==================== formatPlannerItem ====================

describe('formatPlannerItem', () => {
  const basePlannerItem = {
    plannable_type: 'assignment',
    plannable: {
      title: 'Midterm Essay',
      due_at: '2025-03-15T23:59:00Z',
      points_possible: 100,
    },
    context_name: 'English 101',
    course_id: 42,
    planner_override: null,
    submissions: { graded: false, needs_grading: false, missing: false },
    html_url: 'https://canvas.example.com/courses/42/assignments/1',
    new_activity: false,
  };

  it('formats a basic planner item', () => {
    const result = formatPlannerItem(basePlannerItem);
    expect(result.type).toBe('assignment');
    expect(result.title).toBe('Midterm Essay');
    expect(result.course).toBe('English 101');
    expect(result.course_id).toBe(42);
    expect(result.due_at).toBe('2025-03-15T23:59:00Z');
    expect(result.points_possible).toBe(100);
    expect(result.completed).toBe(false);
    expect(result.submitted).toBe(false);
    expect(result.missing).toBe(false);
    expect(result.html_url).toBe('https://canvas.example.com/courses/42/assignments/1');
    expect(result.new_activity).toBe(false);
  });

  it('uses name fallback when title is missing', () => {
    const item = {
      ...basePlannerItem,
      plannable: { name: 'Alt Name' },
    };
    expect(formatPlannerItem(item).title).toBe('Alt Name');
  });

  it('defaults to Untitled when no title or name', () => {
    const item = {
      ...basePlannerItem,
      plannable: {},
    };
    expect(formatPlannerItem(item).title).toBe('Untitled');
  });

  it('uses courseNameFallback when context_name is missing', () => {
    const item = {
      ...basePlannerItem,
      context_name: undefined,
    };
    expect(formatPlannerItem(item, 'Fallback Course').course).toBe('Fallback Course');
  });

  it('falls back to course_id string when no name available', () => {
    const item = {
      ...basePlannerItem,
      context_name: undefined,
      course_id: 99,
    };
    expect(formatPlannerItem(item).course).toBe('course_99');
  });

  it('shows Unknown when no course info at all', () => {
    const item = {
      ...basePlannerItem,
      context_name: undefined,
      course_id: undefined,
    };
    expect(formatPlannerItem(item).course).toBe('Unknown');
  });

  it('marks completed from planner_override', () => {
    const item = {
      ...basePlannerItem,
      planner_override: { marked_complete: true },
    };
    expect(formatPlannerItem(item).completed).toBe(true);
  });

  it('marks submitted when graded', () => {
    const item = {
      ...basePlannerItem,
      submissions: { graded: true, needs_grading: false, missing: false },
    };
    expect(formatPlannerItem(item).submitted).toBe(true);
  });

  it('marks submitted when needs_grading', () => {
    const item = {
      ...basePlannerItem,
      submissions: { graded: false, needs_grading: true, missing: false },
    };
    expect(formatPlannerItem(item).submitted).toBe(true);
  });

  it('handles submissions=false', () => {
    const item = {
      ...basePlannerItem,
      submissions: false,
    };
    const result = formatPlannerItem(item);
    expect(result.submitted).toBe(false);
    expect(result.missing).toBe(false);
  });

  it('handles submissions=null', () => {
    const item = {
      ...basePlannerItem,
      submissions: null,
    };
    const result = formatPlannerItem(item);
    expect(result.submitted).toBe(false);
    expect(result.missing).toBe(false);
  });

  it('calculates days_until_due', () => {
    const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const item = {
      ...basePlannerItem,
      plannable: { title: 'Future', due_at: futureDate },
    };
    const result = formatPlannerItem(item);
    expect(result.days_until_due).toBe(3);
  });

  it('returns null days_until_due when no due date', () => {
    const item = {
      ...basePlannerItem,
      plannable: { title: 'No date' },
    };
    expect(formatPlannerItem(item).days_until_due).toBeNull();
  });

  it('uses todo_date when due_at is missing', () => {
    const item = {
      ...basePlannerItem,
      plannable: { title: 'Note', todo_date: '2025-04-01' },
    };
    expect(formatPlannerItem(item).due_at).toBe('2025-04-01');
  });
});

// ==================== sortByDueDate ====================

describe('sortByDueDate', () => {
  it('sorts items with dates ascending (soonest first)', () => {
    const items = [
      { due_at: '2025-03-15T00:00:00Z', name: 'C' },
      { due_at: '2025-03-01T00:00:00Z', name: 'A' },
      { due_at: '2025-03-10T00:00:00Z', name: 'B' },
    ];
    const sorted = sortByDueDate(items);
    expect(sorted.map(i => i.name)).toEqual(['A', 'B', 'C']);
  });

  it('puts null dates at the end', () => {
    const items = [
      { due_at: null, name: 'NoDate' },
      { due_at: '2025-01-01T00:00:00Z', name: 'HasDate' },
    ];
    const sorted = sortByDueDate(items);
    expect(sorted[0].name).toBe('HasDate');
    expect(sorted[1].name).toBe('NoDate');
  });

  it('handles all null dates', () => {
    const items = [
      { due_at: null, name: 'A' },
      { due_at: null, name: 'B' },
    ];
    const sorted = sortByDueDate(items);
    expect(sorted).toHaveLength(2);
  });

  it('handles empty array', () => {
    expect(sortByDueDate([])).toEqual([]);
  });
});

// ==================== runWithConcurrency ====================

describe('runWithConcurrency', () => {
  it('runs all tasks and returns results in order', async () => {
    const tasks = [
      () => Promise.resolve('a'),
      () => Promise.resolve('b'),
      () => Promise.resolve('c'),
    ];
    const results = await runWithConcurrency(tasks, 2);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'a' });
    expect(results[1]).toEqual({ status: 'fulfilled', value: 'b' });
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'c' });
  });

  it('captures rejected tasks without failing the batch', async () => {
    const tasks = [
      () => Promise.resolve('ok'),
      () => Promise.reject(new Error('fail')),
      () => Promise.resolve('also ok'),
    ];
    const results = await runWithConcurrency(tasks, 2);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(results[2].status).toBe('fulfilled');
  });

  it('respects concurrency limit', async () => {
    let maxConcurrent = 0;
    let current = 0;

    const tasks = Array.from({ length: 6 }, () => async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise(r => setTimeout(r, 10));
      current--;
      return 'done';
    });

    await runWithConcurrency(tasks, 2);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('handles empty task list', async () => {
    const results = await runWithConcurrency([], 3);
    expect(results).toEqual([]);
  });

  it('defaults to concurrency of 3', async () => {
    let maxConcurrent = 0;
    let current = 0;

    const tasks = Array.from({ length: 9 }, () => async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise(r => setTimeout(r, 10));
      current--;
      return 'done';
    });

    await runWithConcurrency(tasks);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });
});

// ==================== Constants ====================

describe('constants', () => {
  it('MAX_FILE_SIZE is 25MB', () => {
    expect(MAX_FILE_SIZE).toBe(25 * 1024 * 1024);
  });

  it('DEFAULT_MAX_TEXT_LENGTH is 50000', () => {
    expect(DEFAULT_MAX_TEXT_LENGTH).toBe(50000);
  });
});

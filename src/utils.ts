// Shared utilities for the Canvas MCP server

/**
 * Parse a PDF buffer into text content.
 * Uses pdf-parse v2 class-based API.
 */
export async function parsePdf(buffer: Buffer): Promise<{ text: string; numpages: number }> {
  try {
    // Race against a 30-second timeout to prevent hangs on corrupted PDFs
    const result = await Promise.race([
      (async () => {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        const parsed = await parser.getText();
        const numpages = parsed.total;
        await parser.destroy();
        return { text: parsed.text, numpages };
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PDF parsing timed out after 30 seconds')), 30_000)
      ),
    ]);
    return result;
  } catch (error) {
    throw new Error(`PDF parsing failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/**
 * Parse Office documents (DOCX, PPTX, XLSX, ODT, ODP, ODS) into text.
 * Uses officeparser for broad format support.
 */
export async function parseOfficeDocument(buffer: Buffer): Promise<string> {
  try {
    const { parseOffice } = await import('officeparser');
    const result = await Promise.race([
      parseOffice(buffer) as Promise<unknown>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Office document parsing timed out after 30 seconds')), 30_000)
      ),
    ]);
    return String(result);
  } catch (error) {
    throw new Error(`Office document parsing failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/**
 * Strip HTML tags and decode common HTML entities.
 * Returns clean plain text suitable for LLM consumption.
 */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Preserve line breaks from block elements
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|pre|hr)[^>]*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201D')
    .replace(/&ldquo;/g, '\u201C')
    // Decode numeric entities (with range validation)
    .replace(/&#(\d+);/g, (_match, code) => {
      const num = parseInt(code, 10);
      return num >= 0 && num <= 0x10FFFF ? String.fromCodePoint(num) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const num = parseInt(code, 16);
      return num >= 0 && num <= 0x10FFFF ? String.fromCodePoint(num) : '';
    })
    // Clean up whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Format a byte count into a human-readable size string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Format an error into a consistent MCP error response.
 */
export function formatError(context: string, error: unknown): {
  content: [{ type: 'text'; text: string }];
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);

  // Map common Canvas API error codes to actionable messages
  let hint = '';
  if (/\b401\b/.test(message)) {
    hint = ' Hint: Your Canvas API token may have expired.';
  } else if (/\b403\b/.test(message)) {
    hint = ' Hint: Access denied. This course may restrict API access — try list_modules to find content through module items instead.';
  } else if (/\b404\b/.test(message)) {
    hint = ' Hint: Not found. This item may have been deleted or unpublished by the instructor.';
  } else if (/\b429\b/.test(message)) {
    hint = ' Hint: Canvas is rate-limiting requests. Please wait a moment and try again.';
  } else if (/\b5\d{2}\b/.test(message)) {
    hint = ' Hint: Canvas server error. This is temporary — try again in a minute.';
  }

  // Sanitize filesystem paths from error messages
  const sanitized = (message + hint).replace(/\/Users\/[^\s:]+/g, '<path>');

  return {
    content: [{
      type: 'text' as const,
      text: `Error ${context}: ${sanitized}`,
    }],
    isError: true,
  };
}

/**
 * Create a successful MCP tool response from a JSON-serializable value.
 */
export function formatSuccess(data: unknown): {
  content: [{ type: 'text'; text: string }];
} {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(data != null && typeof data === 'object' ? stripNulls(data) : data, null, 2),
    }],
  };
}

/**
 * Extract text content from a file buffer based on its content type.
 * Returns the extracted text or null if the type is not supported.
 */
export async function extractTextFromFile(
  buffer: Buffer,
  contentType: string,
  maxLength: number = 50000,
): Promise<{ text: string; truncated: boolean; pages?: number } | null> {
  let extractedText = '';
  let pages: number | undefined;

  if (contentType === 'application/pdf') {
    const pdfData = await parsePdf(buffer);
    extractedText = pdfData.text;
    pages = pdfData.numpages;
  } else if (
    contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    contentType === 'application/msword' ||
    contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    contentType === 'application/vnd.ms-powerpoint' ||
    contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    contentType === 'application/vnd.ms-excel' ||
    contentType === 'application/vnd.oasis.opendocument.text' ||
    contentType === 'application/vnd.oasis.opendocument.presentation' ||
    contentType === 'application/vnd.oasis.opendocument.spreadsheet'
  ) {
    extractedText = await parseOfficeDocument(buffer);
  } else if (contentType === 'text/html') {
    extractedText = stripHtmlTags(buffer.toString('utf-8'));
  } else if (
    contentType === 'text/plain' ||
    contentType === 'text/csv' ||
    contentType === 'text/markdown' ||
    contentType === 'application/json' ||
    contentType?.startsWith('text/')
  ) {
    extractedText = buffer.toString('utf-8');
  } else {
    return null; // Unsupported type
  }

  const truncated = extractedText.length > maxLength;
  if (truncated) {
    extractedText = extractedText.substring(0, maxLength);
  }

  return { text: extractedText, truncated, pages };
}

/**
 * Format a planner item into a standardized shape for LLM consumption.
 * Used across planner, search, dashboard, and resources to prevent duplication.
 */
export function formatPlannerItem(item: {
  plannable_type: string;
  plannable: { title?: string; name?: string; due_at?: string; todo_date?: string; points_possible?: number };
  context_name?: string;
  course_id?: number;
  planner_override?: { marked_complete?: boolean } | null;
  submissions?: { graded?: boolean; needs_grading?: boolean; missing?: boolean } | false | null;
  html_url?: string;
  new_activity?: boolean;
}, courseNameFallback?: string) {
  const plannable = item.plannable;
  const dueDate = plannable.due_at || plannable.todo_date || null;

  return {
    type: item.plannable_type,
    title: plannable.title || plannable.name || 'Untitled',
    course: item.context_name ?? courseNameFallback ?? (item.course_id ? `course_${item.course_id}` : 'Unknown'),
    course_id: item.course_id ?? null,
    due_at: dueDate,
    due_display: dueDate ? formatDateDisplay(dueDate) : null,
    days_until_due: dueDate
      ? Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null,
    points_possible: plannable.points_possible ?? null,
    completed: item.planner_override?.marked_complete ?? false,
    submitted: item.submissions && typeof item.submissions === 'object'
      ? (item.submissions.graded || item.submissions.needs_grading || false)
      : false,
    missing: item.submissions && typeof item.submissions === 'object'
      ? (item.submissions.missing ?? false)
      : false,
    html_url: item.html_url,
    new_activity: item.new_activity ?? false,
  };
}

/**
 * Sort items by due date ascending (soonest first, null dates last).
 */
export function sortByDueDate<T extends { due_at: string | null }>(items: T[]): T[] {
  return items.sort((a, b) => {
    if (!a.due_at) return 1;
    if (!b.due_at) return -1;
    return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
  });
}

/**
 * Extract Canvas file links from HTML content.
 * Finds <a> tags whose href points to Canvas file URLs and returns structured file info.
 * This must be called BEFORE stripHtmlTags, which destroys link information.
 */
export function extractLinkedFiles(html: string): Array<{
  filename: string;
  file_id: number | null;
  url: string;
  link_text: string;
}> {
  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const filePatterns = [
    /\/files\/(\d+)\/download/,
    /\/courses\/\d+\/files\/(\d+)/,
    /\/files\/(\d+)/,
  ];

  const seen = new Set<number>();
  const results: Array<{
    filename: string;
    file_id: number | null;
    url: string;
    link_text: string;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const rawLinkText = match[2];

    // Check if this href matches any Canvas file URL pattern
    let fileId: number | null = null;
    for (const pattern of filePatterns) {
      const fileMatch = href.match(pattern);
      if (fileMatch) {
        fileId = parseInt(fileMatch[1], 10);
        break;
      }
    }

    // Skip non-file links
    if (fileId === null) continue;

    // Deduplicate by file_id
    if (seen.has(fileId)) continue;
    seen.add(fileId);

    // Strip inner HTML tags from link text
    const linkText = rawLinkText.replace(/<[^>]+>/g, '').trim();

    // Determine filename: use link text unless it's generic/empty, then extract from URL
    let filename = linkText;
    if (!filename || /^(here|click|link|download|view)$/i.test(filename)) {
      // Try to extract filename from URL path
      const urlPath = href.split('?')[0];
      const segments = urlPath.split('/');
      const lastSegment = segments[segments.length - 1];
      filename = lastSegment === 'download' && segments.length > 1
        ? segments[segments.length - 2]
        : lastSegment;
      // If filename is still just a number (file ID), keep link text as-is
      if (/^\d+$/.test(filename)) {
        filename = linkText || `file_${fileId}`;
      }
    }

    results.push({
      filename,
      file_id: fileId,
      url: href,
      link_text: linkText,
    });
  }

  return results;
}

/**
 * Extract all links from HTML content.
 * Returns an array of {url, text} for every <a href> found in the HTML.
 * This must be called BEFORE stripHtmlTags, which destroys link information.
 */
export function extractLinks(html: string): Array<{
  url: string;
  text: string;
}> {
  const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const results: Array<{ url: string; text: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const rawText = match[2];
    const text = rawText.replace(/<[^>]+>/g, '').trim();

    results.push({
      url: href,
      text: text || href,
    });
  }

  return results;
}

/**
 * Parse a month name abbreviation (e.g., "Feb", "Feb.", "February") into a 0-indexed month number.
 */
export function parseMonthName(monthStr: string): number | null {
  const months: Record<string, number> = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, september: 8, sept: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };
  const cleaned = monthStr.toLowerCase().replace(/\.$/, '');
  return months[cleaned] ?? null;
}

/**
 * Try to extract a date from a string using various patterns.
 * Handles: "(Tue, Feb 10)", "Feb 10", "March 3", "2/10", "02/10"
 */
export function extractDateFromText(text: string, referenceYear: number): Date | null {
  // Pattern 1: "(Tue, Feb 10)" or "(Monday, March 3)" — day-of-week + month + day
  const dowMonthDay = /\((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+([A-Z][a-z]+\.?\s+\d{1,2})\)/i;
  const match1 = text.match(dowMonthDay);
  if (match1) {
    const parts = match1[1].trim().split(/\s+/);
    if (parts.length === 2) {
      const month = parseMonthName(parts[0]);
      const day = parseInt(parts[1], 10);
      if (month !== null && !isNaN(day) && day >= 1 && day <= 31) {
        return new Date(referenceYear, month, day);
      }
    }
  }

  // Pattern 2: "Feb 10" or "March 3" standalone (month name + day)
  const monthDayPattern = /\b([A-Z][a-z]+\.?)\s+(\d{1,2})\b/;
  const match2 = text.match(monthDayPattern);
  if (match2) {
    const month = parseMonthName(match2[1]);
    const day = parseInt(match2[2], 10);
    if (month !== null && !isNaN(day) && day >= 1 && day <= 31) {
      return new Date(referenceYear, month, day);
    }
  }

  // Pattern 3: MM/DD format
  const mmddPattern = /\b(\d{1,2})\/(\d{1,2})\b/;
  const match3 = text.match(mmddPattern);
  if (match3) {
    const month = parseInt(match3[1], 10) - 1;
    const day = parseInt(match3[2], 10);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return new Date(referenceYear, month, day);
    }
  }

  return null;
}

/**
 * Sanitize HTML content before submitting to Canvas.
 * Strips dangerous tags and attributes that could be used for XSS.
 */
export function sanitizeHtmlForSubmission(html: string): string {
  return html
    // Remove dangerous tags entirely
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>[\s\S]*?<\/embed>/gi, '')
    // Remove event handler attributes (onclick, onerror, etc.)
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+on\w+\s*=\s*\S+/gi, '')
    // Remove javascript: URLs
    .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"')
    .replace(/src\s*=\s*["']javascript:[^"']*["']/gi, 'src=""');
}

/**
 * Format an ISO date string into a human-friendly display.
 * Returns "Wed, Feb 15 at 11:59 PM" style strings.
 */
export function formatDateDisplay(iso: string): string {
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

/**
 * Format a score as "42/50 (84.0%)" for human-readable display.
 * Returns null if score or points_possible is missing/zero.
 */
export function formatScoreDisplay(score: number | null | undefined, pointsPossible: number | null | undefined): string | null {
  if (score == null || !pointsPossible) return null;
  const pct = ((score / pointsPossible) * 100).toFixed(1);
  return `${score}/${pointsPossible} (${pct}%)`;
}

/**
 * Sort items by a date field, with configurable order and null handling.
 */
export function sortByDate<T>(
  items: T[],
  getDate: (item: T) => string | null | undefined,
  order: 'asc' | 'desc' = 'asc',
): T[] {
  return [...items].sort((a, b) => {
    const da = getDate(a);
    const db = getDate(b);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    const diff = new Date(da).getTime() - new Date(db).getTime();
    return order === 'asc' ? diff : -diff;
  });
}

/**
 * Recursively strip null and undefined values from an object.
 * Preserves 0, empty strings, and false.
 */
export function stripNulls(obj: unknown): unknown {
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) {
    return obj.map(stripNulls).filter(v => v !== undefined);
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const stripped = stripNulls(value);
      if (stripped !== undefined) {
        result[key] = stripped;
      }
    }
    return result;
  }
  return obj;
}

/**
 * Stable JSON.stringify with sorted keys for deterministic cache keys.
 */
export function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
  });
}

/** Maximum file size for text extraction (25 MB) */
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

/** Default max characters for text extraction */
export const DEFAULT_MAX_TEXT_LENGTH = 50000;

/**
 * Run async tasks with a concurrency limit to avoid overwhelming the Canvas API.
 * Returns results in the same order as the input tasks.
 */
export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number = 3
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: 'fulfilled', value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

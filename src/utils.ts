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
  return {
    content: [{
      type: 'text' as const,
      text: `Error ${context}: ${message}`,
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
      text: JSON.stringify(data, null, 2),
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

// Shared utilities for the Canvas MCP server

/**
 * Parse a PDF buffer into text content.
 * Uses pdf-parse v2 class-based API.
 */
export async function parsePdf(buffer: Buffer): Promise<{ text: string; numpages: number }> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    const numpages = result.total;
    await parser.destroy();
    return { text: result.text, numpages };
  } catch (error) {
    throw new Error(`PDF parsing failed: ${error instanceof Error ? error.message : String(error)}`);
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
    // Decode numeric entities
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
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

/** Maximum file size for text extraction (25 MB) */
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

/** Default max characters for text extraction */
export const DEFAULT_MAX_TEXT_LENGTH = 50000;

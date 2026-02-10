import type {
  Course,
  Assignment,
  Submission,
  Module,
  ModuleItem,
  Announcement,
  DiscussionTopic,
  DiscussionEntry,
  CanvasFile,
  Page,
  CalendarEvent,
  TodoItem,
  PlannerItem,
  PlannerNote,
  PlannerOverride,
  UserProfile,
  FileUploadResponse,
  ListCoursesParams,
  ListAssignmentsParams,
  ListModulesParams,
  ListAnnouncementsParams,
  ListFilesParams,
  ListPagesParams,
  ListCalendarEventsParams,
  ListPlannerItemsParams,
  ListPlannerNotesParams,
  CreatePlannerNoteParams,
  CreatePlannerOverrideParams,
  SubmitAssignmentParams,
} from './types/canvas.js';

interface CanvasClientConfig {
  baseUrl: string;
  apiToken: string;
}

export class CanvasClient {
  private baseUrl: string;
  private apiToken: string;
  private baseOrigin: string;

  /** Default request timeout in milliseconds (30 seconds) */
  private static readonly REQUEST_TIMEOUT_MS = 30_000;
  /** Maximum number of pages to fetch in paginated requests */
  private static readonly MAX_PAGES = 100;
  /** Maximum total items to collect across all pages */
  private static readonly MAX_PAGINATED_ITEMS = 10_000;

  constructor(config: CanvasClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiToken = config.apiToken;
    // Extract origin for URL validation
    try {
      this.baseOrigin = new URL(this.baseUrl).origin;
    } catch {
      this.baseOrigin = this.baseUrl;
    }
  }

  /**
   * Validate that a URL belongs to the configured Canvas instance.
   * Prevents SSRF by ensuring we only follow URLs to the same origin.
   */
  private isAllowedUrl(url: string): boolean {
    try {
      return new URL(url).origin === this.baseOrigin;
    } catch {
      return false;
    }
  }

  /**
   * Create an AbortSignal with timeout for fetch requests.
   */
  private createTimeoutSignal(timeoutMs: number = CanvasClient.REQUEST_TIMEOUT_MS): AbortSignal {
    return AbortSignal.timeout(timeoutMs);
  }

  /**
   * Sanitize error messages to avoid leaking sensitive info (tokens, internal URLs).
   */
  private sanitizeErrorMessage(status: number, statusText: string, body: string): string {
    // Remove any auth tokens that might appear in error body
    const sanitized = body
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
      .replace(/access_token=[^\s&"']+/gi, 'access_token=[REDACTED]');
    // Truncate very long error bodies
    const truncated = sanitized.length > 500
      ? sanitized.substring(0, 500) + '... (truncated)'
      : sanitized;
    return `Canvas API error: ${status} ${statusText} - ${truncated}`;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}/api/v1${endpoint}`;

    // Validate URL origin for absolute URLs
    if (endpoint.startsWith('http') && !this.isAllowedUrl(url)) {
      throw new Error('Request blocked: URL does not match configured Canvas instance');
    }

    const headers: HeadersInit = {
      'Authorization': `Bearer ${this.apiToken}`,
      ...(options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE'
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
      signal: options.signal ?? this.createTimeoutSignal(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(this.sanitizeErrorMessage(response.status, response.statusText, errorBody));
    }

    return response.json() as Promise<T>;
  }

  /**
   * Paginated request that follows Link headers and collects all pages.
   * Includes safety guards: max pages, max items, origin validation, and timeouts.
   */
  private async requestPaginated<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T[]> {
    const results: T[] = [];
    let url: string | null = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}/api/v1${endpoint}`;

    // Ensure per_page=100 is set
    if (!url.includes('per_page=')) {
      url += url.includes('?') ? '&per_page=100' : '?per_page=100';
    }

    let pageCount = 0;

    while (url) {
      // Guard: max pages
      if (++pageCount > CanvasClient.MAX_PAGES) {
        console.error(`Pagination limit reached (${CanvasClient.MAX_PAGES} pages). Returning partial results.`);
        break;
      }

      // Guard: validate URL origin for followed links
      if (url.startsWith('http') && !this.isAllowedUrl(url)) {
        console.error('Pagination stopped: next page URL does not match Canvas instance origin.');
        break;
      }

      const headers: HeadersInit = {
        'Authorization': `Bearer ${this.apiToken}`,
        ...options.headers,
      };

      const response = await fetch(url, {
        ...options,
        headers,
        signal: options.signal ?? this.createTimeoutSignal(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(this.sanitizeErrorMessage(response.status, response.statusText, errorBody));
      }

      const data = await response.json() as T[];
      results.push(...data);

      // Guard: max items
      if (results.length >= CanvasClient.MAX_PAGINATED_ITEMS) {
        console.error(`Item limit reached (${CanvasClient.MAX_PAGINATED_ITEMS} items). Returning partial results.`);
        break;
      }

      // Parse Link header for next page
      url = this.getNextPageUrl(response.headers.get('Link'));
    }

    return results;
  }

  private getNextPageUrl(linkHeader: string | null): string | null {
    if (!linkHeader) return null;

    const links = linkHeader.split(',');
    for (const link of links) {
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      if (match) return match[1];
    }
    return null;
  }

  private buildQueryString(params: object): string {
    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        value.forEach(v => searchParams.append(`${key}[]`, String(v)));
      } else {
        searchParams.append(key, String(value));
      }
    }

    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : '';
  }

  // ==================== COURSES ====================

  async listCourses(params: ListCoursesParams = {}): Promise<Course[]> {
    const query = this.buildQueryString(params);
    return this.requestPaginated<Course>(`/courses${query}`);
  }

  async getCourse(courseId: number, include?: string[]): Promise<Course> {
    const query = include ? this.buildQueryString({ include }) : '';
    return this.request<Course>(`/courses/${courseId}${query}`);
  }

  // ==================== ASSIGNMENTS ====================

  async listAssignments(
    courseId: number,
    params: ListAssignmentsParams = {}
  ): Promise<Assignment[]> {
    const query = this.buildQueryString(params);
    return this.requestPaginated<Assignment>(
      `/courses/${courseId}/assignments${query}`
    );
  }

  async getAssignment(
    courseId: number,
    assignmentId: number,
    include?: string[]
  ): Promise<Assignment> {
    const query = include ? this.buildQueryString({ include }) : '';
    return this.request<Assignment>(
      `/courses/${courseId}/assignments/${assignmentId}${query}`
    );
  }

  // ==================== SUBMISSIONS ====================

  async getSubmission(
    courseId: number,
    assignmentId: number,
    userId: number | 'self' = 'self',
    include?: string[]
  ): Promise<Submission> {
    const query = include ? this.buildQueryString({ include }) : '';
    return this.request<Submission>(
      `/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}${query}`
    );
  }

  async submitAssignment(
    courseId: number,
    assignmentId: number,
    params: SubmitAssignmentParams
  ): Promise<Submission> {
    const body: Record<string, unknown> = {
      submission: {
        submission_type: params.submission_type,
      },
    };

    if (params.body) {
      body.submission = { ...body.submission as object, body: params.body };
    }
    if (params.url) {
      body.submission = { ...body.submission as object, url: params.url };
    }
    if (params.file_ids) {
      body.submission = { ...body.submission as object, file_ids: params.file_ids };
    }

    return this.request<Submission>(
      `/courses/${courseId}/assignments/${assignmentId}/submissions`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
  }

  // ==================== FILE UPLOADS ====================

  async initiateFileUpload(
    courseId: number,
    assignmentId: number,
    fileName: string,
    fileSize: number,
    contentType: string
  ): Promise<FileUploadResponse> {
    return this.request<FileUploadResponse>(
      `/courses/${courseId}/assignments/${assignmentId}/submissions/self/files`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: fileName,
          size: fileSize,
          content_type: contentType,
        }),
      }
    );
  }

  async uploadFileToUrl(
    uploadUrl: string,
    uploadParams: Record<string, string>,
    fileContent: Uint8Array | string,
    fileName: string,
    contentType: string
  ): Promise<{ id: number; url: string }> {
    const formData = new FormData();

    for (const [key, value] of Object.entries(uploadParams)) {
      formData.append(key, value);
    }

    let arrayBuffer: ArrayBuffer;
    if (typeof fileContent === 'string') {
      const encoder = new TextEncoder();
      arrayBuffer = encoder.encode(fileContent).buffer as ArrayBuffer;
    } else {
      arrayBuffer = fileContent.buffer.slice(
        fileContent.byteOffset,
        fileContent.byteOffset + fileContent.byteLength
      ) as ArrayBuffer;
    }

    const blob = new Blob([arrayBuffer], { type: contentType });
    formData.append('file', blob, fileName);

    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`File upload error: ${response.status} - ${errorBody}`);
    }

    return response.json();
  }

  // ==================== FILES (READING/DOWNLOADING) ====================

  async listCourseFiles(
    courseId: number,
    params: ListFilesParams = {}
  ): Promise<CanvasFile[]> {
    const query = this.buildQueryString(params);
    return this.requestPaginated<CanvasFile>(`/courses/${courseId}/files${query}`);
  }

  async getFile(fileId: number): Promise<CanvasFile> {
    return this.request<CanvasFile>(`/files/${fileId}`);
  }

  async downloadFile(downloadUrl: string): Promise<ArrayBuffer> {
    // Canvas file URLs redirect to pre-signed S3 URLs.
    // We must NOT send the Bearer token on the redirect.
    // Note: S3 URLs have a different origin, so we don't validate origin here.
    const response = await fetch(downloadUrl, {
      redirect: 'follow',
      signal: this.createTimeoutSignal(60_000), // 60s timeout for file downloads
    });

    if (!response.ok) {
      throw new Error(`File download error: ${response.status} ${response.statusText}`);
    }

    return response.arrayBuffer();
  }

  // ==================== PAGES ====================

  async listPages(
    courseId: number,
    params: ListPagesParams = {}
  ): Promise<Page[]> {
    const query = this.buildQueryString(params);
    return this.requestPaginated<Page>(`/courses/${courseId}/pages${query}`);
  }

  async getPage(courseId: number, pageUrlOrId: string): Promise<Page> {
    return this.request<Page>(`/courses/${courseId}/pages/${pageUrlOrId}`);
  }

  // ==================== MODULES ====================

  async listModules(
    courseId: number,
    params: ListModulesParams = {}
  ): Promise<Module[]> {
    const query = this.buildQueryString(params);
    return this.requestPaginated<Module>(`/courses/${courseId}/modules${query}`);
  }

  async getModule(
    courseId: number,
    moduleId: number,
    include?: string[]
  ): Promise<Module> {
    const query = include ? this.buildQueryString({ include }) : '';
    return this.request<Module>(
      `/courses/${courseId}/modules/${moduleId}${query}`
    );
  }

  async listModuleItems(
    courseId: number,
    moduleId: number,
    include?: string[]
  ): Promise<ModuleItem[]> {
    const query = include ? this.buildQueryString({ include }) : '';
    return this.requestPaginated<ModuleItem>(
      `/courses/${courseId}/modules/${moduleId}/items${query}`
    );
  }

  // ==================== ANNOUNCEMENTS ====================

  async listAnnouncements(
    params: ListAnnouncementsParams
  ): Promise<Announcement[]> {
    const query = this.buildQueryString(params);
    return this.requestPaginated<Announcement>(`/announcements${query}`);
  }

  // ==================== DISCUSSIONS ====================

  async listDiscussionTopics(
    courseId: number,
    orderBy?: 'position' | 'recent_activity' | 'title'
  ): Promise<DiscussionTopic[]> {
    const query = orderBy ? this.buildQueryString({ order_by: orderBy }) : '';
    return this.requestPaginated<DiscussionTopic>(
      `/courses/${courseId}/discussion_topics${query}`
    );
  }

  async getDiscussionTopic(
    courseId: number,
    topicId: number
  ): Promise<DiscussionTopic> {
    return this.request<DiscussionTopic>(
      `/courses/${courseId}/discussion_topics/${topicId}`
    );
  }

  async listDiscussionEntries(
    courseId: number,
    topicId: number
  ): Promise<DiscussionEntry[]> {
    return this.requestPaginated<DiscussionEntry>(
      `/courses/${courseId}/discussion_topics/${topicId}/entries`
    );
  }

  async postDiscussionEntry(
    courseId: number,
    topicId: number,
    message: string
  ): Promise<DiscussionEntry> {
    return this.request<DiscussionEntry>(
      `/courses/${courseId}/discussion_topics/${topicId}/entries`,
      {
        method: 'POST',
        body: JSON.stringify({ message }),
      }
    );
  }

  async replyToDiscussionEntry(
    courseId: number,
    topicId: number,
    entryId: number,
    message: string
  ): Promise<DiscussionEntry> {
    return this.request<DiscussionEntry>(
      `/courses/${courseId}/discussion_topics/${topicId}/entries/${entryId}/replies`,
      {
        method: 'POST',
        body: JSON.stringify({ message }),
      }
    );
  }

  // ==================== RUBRICS ====================

  async getRubric(
    courseId: number,
    rubricId: number,
    include?: ('assessments' | 'graded_assessments' | 'peer_assessments' | 'associations' | 'assignment_associations' | 'course_associations' | 'account_associations')[]
  ): Promise<unknown> {
    const query = include ? this.buildQueryString({ include }) : '';
    return this.request<unknown>(
      `/courses/${courseId}/rubrics/${rubricId}${query}`
    );
  }

  // ==================== CALENDAR ====================

  async listCalendarEvents(
    params: ListCalendarEventsParams = {}
  ): Promise<CalendarEvent[]> {
    const query = this.buildQueryString(params);
    return this.requestPaginated<CalendarEvent>(`/calendar_events${query}`);
  }

  // ==================== TODO ====================

  async getTodoItems(): Promise<TodoItem[]> {
    return this.requestPaginated<TodoItem>('/users/self/todo');
  }

  // ==================== PLANNER ====================

  async listPlannerItems(
    params: ListPlannerItemsParams = {}
  ): Promise<PlannerItem[]> {
    const query = this.buildQueryString(params);
    return this.requestPaginated<PlannerItem>(`/planner/items${query}`);
  }

  async listPlannerNotes(
    params: ListPlannerNotesParams = {}
  ): Promise<PlannerNote[]> {
    const query = this.buildQueryString(params);
    return this.requestPaginated<PlannerNote>(`/planner_notes${query}`);
  }

  async createPlannerNote(
    params: CreatePlannerNoteParams
  ): Promise<PlannerNote> {
    return this.request<PlannerNote>('/planner_notes', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async updatePlannerNote(
    noteId: number,
    params: Partial<CreatePlannerNoteParams>
  ): Promise<PlannerNote> {
    return this.request<PlannerNote>(`/planner_notes/${noteId}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  }

  async deletePlannerNote(noteId: number): Promise<PlannerNote> {
    return this.request<PlannerNote>(`/planner_notes/${noteId}`, {
      method: 'DELETE',
    });
  }

  async createPlannerOverride(
    params: CreatePlannerOverrideParams
  ): Promise<PlannerOverride> {
    return this.request<PlannerOverride>('/planner/overrides', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async updatePlannerOverride(
    overrideId: number,
    params: { marked_complete?: boolean; dismissed?: boolean }
  ): Promise<PlannerOverride> {
    return this.request<PlannerOverride>(`/planner/overrides/${overrideId}`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  }

  // ==================== USER PROFILE ====================

  async getUserProfile(): Promise<UserProfile> {
    return this.request<UserProfile>('/users/self/profile');
  }

  // ==================== SEARCH / UTILITY ====================

  async searchCourseContent(
    courseId: number,
    searchTerm: string
  ): Promise<{ modules: Module[]; assignments: Assignment[] }> {
    const modules = await this.listModules(courseId, {
      search_term: searchTerm,
      include: ['items'],
    });

    const assignments = await this.listAssignments(courseId, {
      search_term: searchTerm,
    });

    return { modules, assignments };
  }

  async getUpcomingAssignments(
    courseId: number,
    daysAhead: number = 7
  ): Promise<Assignment[]> {
    const assignments = await this.listAssignments(courseId, {
      bucket: 'upcoming',
      include: ['submission'],
    });

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + daysAhead);

    return assignments.filter(a => {
      if (!a.due_at) return false;
      const dueDate = new Date(a.due_at);
      return dueDate <= cutoffDate;
    });
  }

  async getOverdueAssignments(courseId: number): Promise<Assignment[]> {
    return this.listAssignments(courseId, {
      bucket: 'overdue',
      include: ['submission'],
    });
  }

  async getAssignmentsByDateRange(
    courseId: number,
    startDate: Date,
    endDate: Date
  ): Promise<Assignment[]> {
    const assignments = await this.listAssignments(courseId, {
      include: ['submission'],
    });

    return assignments.filter(a => {
      if (!a.due_at) return false;
      const dueDate = new Date(a.due_at);
      return dueDate >= startDate && dueDate <= endDate;
    });
  }

  // ==================== USER INFO ====================

  async getCurrentUser(): Promise<{ id: number; name: string; email?: string }> {
    return this.request<{ id: number; name: string; email?: string }>('/users/self');
  }
}

// Singleton instance creator
let clientInstance: CanvasClient | null = null;

export function getCanvasClient(): CanvasClient {
  if (!clientInstance) {
    const baseUrl = process.env.CANVAS_BASE_URL;
    const apiToken = process.env.CANVAS_API_TOKEN;

    if (!baseUrl || !apiToken) {
      throw new Error(
        'Missing required environment variables: CANVAS_BASE_URL and CANVAS_API_TOKEN must be set'
      );
    }

    clientInstance = new CanvasClient({ baseUrl, apiToken });
  }

  return clientInstance;
}

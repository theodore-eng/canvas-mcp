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
  AssignmentGroup,
  ListAssignmentGroupsParams,
  Conversation,
  ListConversationsParams,
  Folder,
  ListFoldersParams,
  ActivityStreamItem,
  ActivityStreamSummary,
  Tab,
} from './types/canvas.js';
import { stripHtmlTags, stableStringify } from './utils.js';

interface CanvasClientConfig {
  baseUrl: string;
  apiToken: string;
}

export class CanvasClient {
  private baseUrl: string;
  private apiToken: string;
  private baseOrigin: string;

  /** Cached user timezone from profile */
  private userTimezone: string | null = null;

  /** In-memory cache with TTL and LRU eviction */
  private cache = new Map<string, { data: unknown; expiresAt: number }>();

  /** Maximum cache entries before LRU eviction */
  private static readonly MAX_CACHE_ENTRIES = 500;
  /** Default cache TTL: 5 minutes */
  private static readonly CACHE_TTL_MS = 300_000;
  /** Default request timeout in milliseconds (30 seconds) */
  private static readonly REQUEST_TIMEOUT_MS = 30_000;
  /** Maximum retry attempts for transient errors */
  private static readonly MAX_RETRIES = 3;
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
   * Validate that a URL belongs to Canvas or known S3/CDN upload/download domains.
   * Prevents SSRF by blocking requests to arbitrary hosts.
   */
  private isAllowedFileUrl(url: string): boolean {
    try {
      const hostname = new URL(url).hostname;
      // Allow Canvas origin
      if (hostname === new URL(this.baseUrl).hostname) return true;
      // Allow known S3 patterns used by Canvas/Instructure
      if (hostname === 'instructure-uploads.s3.amazonaws.com') return true;
      if (/^[\w.-]+\.s3\.amazonaws\.com$/.test(hostname)) return true;
      if (/^[\w.-]+\.s3\.[\w-]+\.amazonaws\.com$/.test(hostname)) return true;
      // Allow Instructure CDN domains
      if (hostname.endsWith('.instructure.com')) return true;
      return false;
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

  // ==================== CACHE ====================

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // Move to end for LRU ordering (most recently accessed = last)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data as T;
  }

  private setCached(key: string, data: unknown, ttlMs: number = CanvasClient.CACHE_TTL_MS): void {
    // Evict expired entries if approaching capacity
    if (this.cache.size >= CanvasClient.MAX_CACHE_ENTRIES) {
      this.sweepExpired();
    }
    // If still at capacity after sweep, evict oldest (first in Map)
    while (this.cache.size >= CanvasClient.MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
      else break;
    }
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  /** Remove all expired entries from cache */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /** Clear all cached data */
  public clearCache(): void {
    this.cache.clear();
  }

  // ==================== RETRY ====================

  /**
   * Fetch with retry logic for transient errors (429, 5xx).
   * Uses exponential backoff and honors Retry-After header.
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    callerSignal?: AbortSignal | null,
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= CanvasClient.MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          signal: callerSignal ?? this.createTimeoutSignal(),
        });

        // Don't retry on success or non-retryable errors
        if (response.ok) return response;

        const isRetryable = response.status === 429 || response.status >= 500;
        if (!isRetryable || attempt === CanvasClient.MAX_RETRIES) {
          const errorBody = await response.text();
          throw new Error(this.sanitizeErrorMessage(response.status, response.statusText, errorBody));
        }

        // Calculate backoff delay
        const retryAfter = response.headers.get('Retry-After');
        let delayMs: number;
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          delayMs = isNaN(parsed) ? (1000 * Math.pow(2, attempt)) : parsed * 1000;
        } else {
          delayMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        }

        console.error(`Canvas API ${response.status}: retrying in ${delayMs}ms (attempt ${attempt + 1}/${CanvasClient.MAX_RETRIES})`);
        await response.text(); // consume body before retry
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === CanvasClient.MAX_RETRIES) throw lastError;
      }
    }

    throw lastError ?? new Error('Request failed after retries');
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

    const response = await this.fetchWithRetry(url, { ...options, headers }, options.signal);

    // Clone response so we can read the body as text if JSON parsing fails
    const cloned = response.clone();
    try {
      return await response.json() as T;
    } catch {
      const text = await cloned.text().catch(() => '(empty body)');
      throw new Error(`Canvas API returned non-JSON response (${response.status}): ${text.substring(0, 200)}`);
    }
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

      const response = await this.fetchWithRetry(url, { ...options, headers }, options.signal);

      let data: T[];
      const clonedPaged = response.clone();
      try {
        data = await response.json() as T[];
      } catch {
        const text = await clonedPaged.text().catch(() => '(empty body)');
        throw new Error(`Canvas API returned non-JSON response (${response.status}): ${text.substring(0, 200)}`);
      }
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
    const cacheKey = `courses:${stableStringify(params)}`;
    const cached = this.getCached<Course[]>(cacheKey);
    if (cached) return cached;

    const query = this.buildQueryString(params);
    const courses = await this.requestPaginated<Course>(`/courses${query}`);
    this.setCached(cacheKey, courses);
    return courses;
  }

  /**
   * Get all active, available courses. Convenience wrapper for the common pattern.
   */
  async getActiveCourses(include?: string[]): Promise<Course[]> {
    return this.listCourses({
      enrollment_state: 'active',
      state: ['available'],
      ...(include ? { include: include as ('term' | 'total_students' | 'syllabus_body')[] } : {}),
    });
  }

  /**
   * Get context_codes for all active courses (e.g., ["course_123", "course_456"]).
   */
  async getActiveCourseContextCodes(): Promise<string[]> {
    const courses = await this.getActiveCourses();
    return courses.map(c => `course_${c.id}`);
  }

  async getCourse(courseId: number, include?: string[]): Promise<Course> {
    const query = include ? this.buildQueryString({ include }) : '';
    return this.request<Course>(`/courses/${courseId}${query}`);
  }

  /**
   * Get a course's syllabus as plain text. Cached for 10 minutes since syllabi rarely change.
   * Returns null if the course has no syllabus.
   */
  async getCourseSyllabus(courseId: number): Promise<{ text: string; course_name: string } | null> {
    const cacheKey = `syllabus:${courseId}`;
    // Use a wrapper to distinguish "not cached" from "cached null"
    const cached = this.getCached<{ value: { text: string; course_name: string } | null }>(cacheKey);
    if (cached) return cached.value;

    const course = await this.getCourse(courseId, ['syllabus_body']);
    if (!course.syllabus_body) {
      this.setCached(cacheKey, { value: null }, 600_000); // cache the miss too
      return null;
    }

    const result = { text: stripHtmlTags(course.syllabus_body), course_name: course.name };
    this.setCached(cacheKey, { value: result }, 600_000); // 10 min TTL
    return result;
  }

  // ==================== TABS ====================

  async listCourseTabs(courseId: number): Promise<Tab[]> {
    const cacheKey = `tabs:${courseId}`;
    const cached = this.getCached<Tab[]>(cacheKey);
    if (cached) return cached;

    const tabs = await this.requestPaginated<Tab>(`/courses/${courseId}/tabs`);
    this.setCached(cacheKey, tabs);
    return tabs;
  }

  // ==================== ASSIGNMENT GROUPS ====================

  async listAssignmentGroups(
    courseId: number,
    params: ListAssignmentGroupsParams = {}
  ): Promise<AssignmentGroup[]> {
    const cacheKey = `assignmentGroups:${courseId}:${stableStringify(params)}`;
    const cached = this.getCached<AssignmentGroup[]>(cacheKey);
    if (cached) return cached;

    const query = this.buildQueryString(params);
    const groups = await this.requestPaginated<AssignmentGroup>(
      `/courses/${courseId}/assignment_groups${query}`
    );
    this.setCached(cacheKey, groups, 180_000); // 3 min TTL
    return groups;
  }

  // ==================== ASSIGNMENTS ====================

  async listAssignments(
    courseId: number,
    params: ListAssignmentsParams = {}
  ): Promise<Assignment[]> {
    const cacheKey = `assignments:${courseId}:${stableStringify(params)}`;
    const cached = this.getCached<Assignment[]>(cacheKey);
    if (cached) return cached;

    const query = this.buildQueryString(params);
    const assignments = await this.requestPaginated<Assignment>(
      `/courses/${courseId}/assignments${query}`
    );
    this.setCached(cacheKey, assignments, 180_000); // 3 min TTL
    return assignments;
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

    if (!this.isAllowedFileUrl(uploadUrl)) {
      throw new Error(`Upload URL rejected: hostname not in allowlist`);
    }

    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
      signal: this.createTimeoutSignal(60_000),
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
    if (!this.isAllowedFileUrl(downloadUrl)) {
      throw new Error(`Download URL rejected: hostname not in allowlist`);
    }

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
    return this.request<Page>(`/courses/${courseId}/pages/${encodeURIComponent(pageUrlOrId)}`);
  }

  // ==================== MODULES ====================

  async listModules(
    courseId: number,
    params: ListModulesParams = {}
  ): Promise<Module[]> {
    const cacheKey = `modules:${courseId}:${stableStringify(params)}`;
    const cached = this.getCached<Module[]>(cacheKey);
    if (cached) return cached;

    const query = this.buildQueryString(params);
    const modules = await this.requestPaginated<Module>(`/courses/${courseId}/modules${query}`);
    this.setCached(cacheKey, modules, 180_000); // 3 min TTL
    return modules;
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

  async listPlannerOverrides(): Promise<PlannerOverride[]> {
    return this.requestPaginated<PlannerOverride>('/planner/overrides');
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

  /**
   * Create or update a planner override. Tries to create first;
   * if the override already exists (400), finds the existing one and updates it.
   */
  async createOrUpdatePlannerOverride(
    params: CreatePlannerOverrideParams
  ): Promise<PlannerOverride> {
    try {
      return await this.createPlannerOverride(params);
    } catch (error) {
      // Canvas returns 400 if override already exists — find and update it
      if (error instanceof Error && error.message.includes('400')) {
        const overrides = await this.listPlannerOverrides();
        const existing = overrides.find(
          o => o.plannable_type === params.plannable_type && o.plannable_id === params.plannable_id
        );
        if (existing) {
          return this.updatePlannerOverride(existing.id, {
            marked_complete: params.marked_complete,
          });
        }
      }
      throw error;
    }
  }

  // ==================== USER PROFILE ====================

  async getUserProfile(): Promise<UserProfile> {
    const cacheKey = 'user-profile';
    const cached = this.getCached<UserProfile>(cacheKey);
    if (cached) return cached;

    const profile = await this.request<UserProfile>('/users/self/profile');
    this.setCached(cacheKey, profile);
    return profile;
  }

  // ==================== TIMEZONE ====================

  /**
   * Get the user's timezone from their Canvas profile.
   * Caches the result for subsequent calls. Falls back to 'UTC'.
   */
  async getUserTimezone(): Promise<string> {
    if (this.userTimezone) return this.userTimezone;
    try {
      const profile = await this.getUserProfile();
      this.userTimezone = profile.time_zone || 'UTC';
    } catch {
      this.userTimezone = 'UTC';
    }
    return this.userTimezone;
  }

  /**
   * Get a YYYY-MM-DD string in the user's timezone.
   * Falls back to UTC if timezone not yet loaded.
   */
  getLocalDateString(date?: Date): string {
    const d = date ?? new Date();
    const tz = this.userTimezone ?? 'UTC';
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return formatter.format(d);
    } catch {
      return d.toISOString().split('T')[0];
    }
  }

  /**
   * Get the current date/time for consistent "now" handling.
   */
  getLocalNow(): Date {
    return new Date();
  }

  // ==================== SEARCH / UTILITY ====================

  async searchCourseContent(
    courseId: number,
    searchTerm: string
  ): Promise<{
    modules: Module[];
    assignments: Assignment[];
    pages: Page[];
    files: CanvasFile[];
    discussions: DiscussionTopic[];
  }> {
    // Run all searches in parallel for speed
    // For modules: fetch ALL modules with items, then filter client-side by both
    // module name AND item title — the Canvas API search_term only matches module names,
    // so searching for "midterm" would miss an item titled "Midterm Review" inside "Unit 5"
    const [modules, assignments, pages, files, discussions] = await Promise.allSettled([
      this.listModules(courseId, {
        include: ['items'],
      }),
      this.listAssignments(courseId, {
        search_term: searchTerm,
      }),
      this.listPages(courseId, {
        search_term: searchTerm,
      }),
      this.listCourseFiles(courseId, {
        search_term: searchTerm,
      }),
      this.listDiscussionTopics(courseId),
    ]);

    // Filter modules: include a module if its name OR any of its item titles match
    const allModules = modules.status === 'fulfilled' ? modules.value : [];
    const lowerTerm = searchTerm.toLowerCase();
    const filteredModules = allModules.filter(m =>
      m.name.toLowerCase().includes(lowerTerm) ||
      m.items?.some(item => item.title.toLowerCase().includes(lowerTerm))
    );

    // Filter discussions client-side since the API doesn't have a search_term param
    const allDiscussions = discussions.status === 'fulfilled' ? discussions.value : [];
    const filteredDiscussions = allDiscussions.filter(d =>
      d.title.toLowerCase().includes(lowerTerm) ||
      (d.message && d.message.toLowerCase().includes(lowerTerm))
    );

    // Supplement pages/files from module items when direct APIs failed
    const directPagesFailed = pages.status === 'rejected';
    const directFilesFailed = files.status === 'rejected';

    const supplementalPages: Page[] = [];
    const supplementalFiles: CanvasFile[] = [];

    if (directPagesFailed || directFilesFailed) {
      for (const mod of allModules) {
        if (!mod.items) continue;
        for (const item of mod.items) {
          if (directPagesFailed && item.type === 'Page' && item.title.toLowerCase().includes(lowerTerm)) {
            supplementalPages.push({
              page_id: item.content_id ?? item.id,
              url: item.page_url ?? '',
              title: item.title,
              created_at: '',
              updated_at: '',
              editing_roles: '',
              published: true,
              front_page: false,
              locked_for_user: false,
            } as Page);
          }
          if (directFilesFailed && item.type === 'File' && item.title.toLowerCase().includes(lowerTerm)) {
            supplementalFiles.push({
              id: item.content_id ?? item.id,
              display_name: item.title,
              filename: item.title,
            } as Pick<CanvasFile, 'id' | 'display_name' | 'filename'> as CanvasFile);
          }
        }
      }
    }

    return {
      modules: filteredModules,
      assignments: assignments.status === 'fulfilled' ? assignments.value : [],
      pages: pages.status === 'fulfilled' ? pages.value : supplementalPages,
      files: files.status === 'fulfilled' ? files.value : supplementalFiles,
      discussions: filteredDiscussions,
    };
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

  // ==================== CONVERSATIONS (INBOX) ====================

  async listConversations(
    params: ListConversationsParams = {}
  ): Promise<Conversation[]> {
    const query = this.buildQueryString(params);
    return this.requestPaginated<Conversation>(`/conversations${query}`);
  }

  async getConversation(
    conversationId: number
  ): Promise<Conversation> {
    return this.request<Conversation>(`/conversations/${conversationId}`);
  }

  // ==================== FOLDERS ====================

  async listCourseFolders(
    courseId: number,
    params: ListFoldersParams = {}
  ): Promise<Folder[]> {
    const query = this.buildQueryString(params);
    return this.requestPaginated<Folder>(`/courses/${courseId}/folders${query}`);
  }

  async getFolder(folderId: number): Promise<Folder> {
    return this.request<Folder>(`/folders/${folderId}`);
  }

  async listFolderFiles(
    folderId: number,
    params: ListFilesParams = {}
  ): Promise<CanvasFile[]> {
    const query = this.buildQueryString(params);
    return this.requestPaginated<CanvasFile>(`/folders/${folderId}/files${query}`);
  }

  async listFolderSubfolders(
    folderId: number,
    params: ListFoldersParams = {}
  ): Promise<Folder[]> {
    const query = this.buildQueryString(params);
    return this.requestPaginated<Folder>(`/folders/${folderId}/folders${query}`);
  }

  // ==================== ACTIVITY STREAM ====================

  async getActivityStream(
    params: { only_active_courses?: boolean; per_page?: number } = {}
  ): Promise<ActivityStreamItem[]> {
    const query = this.buildQueryString(params);
    // When per_page is set, use single request to avoid paginating through entire history
    if (params.per_page) {
      return this.request<ActivityStreamItem[]>(`/users/self/activity_stream${query}`);
    }
    return this.requestPaginated<ActivityStreamItem>(`/users/self/activity_stream${query}`);
  }

  async getActivityStreamSummary(): Promise<ActivityStreamSummary[]> {
    return this.request<ActivityStreamSummary[]>('/users/self/activity_stream/summary');
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

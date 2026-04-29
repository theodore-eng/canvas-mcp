// Canvas LMS API Type Definitions

export interface Course {
  id: number;
  name: string;
  course_code: string;
  workflow_state: 'unpublished' | 'available' | 'completed' | 'deleted';
  account_id: number;
  root_account_id: number;
  enrollment_term_id: number;
  start_at: string | null;
  end_at: string | null;
  enrollments?: Enrollment[];
  total_students?: number;
  calendar?: CalendarLink;
  default_view: 'feed' | 'wiki' | 'modules' | 'assignments' | 'syllabus';
  syllabus_body?: string;
  needs_grading_count?: number;
  term?: Term;
  apply_assignment_group_weights: boolean;
  public_description?: string;
  time_zone?: string;
}

export interface Term {
  id: number;
  name: string;
  start_at: string | null;
  end_at: string | null;
}

export interface CalendarLink {
  ics: string;
}

export interface Enrollment {
  type: string;
  role: string;
  role_id: number;
  user_id: number;
  enrollment_state: 'active' | 'invited' | 'inactive' | 'completed' | 'rejected';
  computed_current_score?: number;
  computed_final_score?: number;
  computed_current_grade?: string;
  computed_final_grade?: string;
}

export interface Assignment {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  due_at: string | null;
  lock_at: string | null;
  unlock_at: string | null;
  has_overrides: boolean;
  course_id: number;
  html_url: string;
  submissions_download_url: string;
  assignment_group_id: number;
  due_date_required: boolean;
  allowed_extensions?: string[];
  max_name_length: number;
  points_possible: number;
  submission_types: SubmissionType[];
  has_submitted_submissions: boolean;
  grading_type: GradingType;
  grading_standard_id: number | null;
  published: boolean;
  unpublishable: boolean;
  only_visible_to_overrides: boolean;
  locked_for_user: boolean;
  lock_info?: LockInfo;
  lock_explanation?: string;
  submission?: Submission;
  use_rubric_for_grading?: boolean;
  rubric_settings?: RubricSettings;
  rubric?: RubricCriteria[];
  allowed_attempts: number;
  post_manually: boolean;
  anonymous_grading: boolean;
  omit_from_final_grade: boolean;
  score_statistics?: ScoreStatistics;
}

export type SubmissionType =
  | 'online_text_entry'
  | 'online_url'
  | 'online_upload'
  | 'online_quiz'
  | 'media_recording'
  | 'student_annotation'
  | 'discussion_topic'
  | 'external_tool'
  | 'on_paper'
  | 'none';

export type GradingType =
  | 'pass_fail'
  | 'percent'
  | 'letter_grade'
  | 'gpa_scale'
  | 'points'
  | 'not_graded';

export interface LockInfo {
  asset_string: string;
  unlock_at?: string;
  lock_at?: string;
  context_module?: object;
  manually_locked: boolean;
}

export interface RubricSettings {
  id?: number;
  title?: string;
  points_possible: number;
  free_form_criterion_comments?: boolean;
}

export interface RubricCriteria {
  id: string;
  points: number;
  description: string;
  long_description?: string;
  criterion_use_range: boolean;
  ratings: RubricRating[];
  learning_outcome_id?: string;
  ignore_for_scoring?: boolean;
}

export interface RubricRating {
  id: string;
  points: number;
  description: string;
  long_description?: string;
}

export interface Submission {
  id: number;
  assignment_id: number;
  user_id: number;
  submitted_at: string | null;
  attempt: number | null;
  body: string | null;
  grade: string | null;
  score: number | null;
  submission_type: SubmissionType | null;
  workflow_state: 'submitted' | 'unsubmitted' | 'graded' | 'pending_review';
  grade_matches_current_submission: boolean;
  graded_at: string | null;
  grader_id: number | null;
  late: boolean;
  missing: boolean;
  excused: boolean;
  late_policy_status: string | null;
  points_deducted: number | null;
  preview_url: string;
  submission_comments?: SubmissionComment[];
  attachments?: FileAttachment[];
  url?: string;
  /**
   * Populated when the submission is requested with
   * `include[]=rubric_assessment`. Keys are RubricCriteria.id; values
   * are the grader's per-criterion verdict.
   */
  rubric_assessment?: Record<string, RubricAssessmentEntry>;
}

export interface RubricAssessmentEntry {
  /** Points awarded for this criterion. */
  points?: number;
  /** Free-form grader comment, if the rubric allows them. */
  comments?: string;
  /** ID of the matched RubricRating, if the grader picked a tier. */
  rating_id?: string;
  /** Sometimes present in full_rubric_assessment expansion. */
  description?: string;
}

export interface SubmissionComment {
  id: number;
  author_id: number;
  author_name: string;
  author: User;
  comment: string;
  created_at: string;
  edited_at: string | null;
  media_comment?: MediaComment;
}

export interface MediaComment {
  content_type: string;
  display_name: string;
  media_id: string;
  media_type: 'audio' | 'video';
  url: string;
}

export interface User {
  id: number;
  name: string;
  sortable_name?: string;
  short_name?: string;
  login_id?: string;
  avatar_url?: string;
  email?: string;
}

export interface FileAttachment {
  id: number;
  uuid: string;
  folder_id: number;
  display_name: string;
  filename: string;
  content_type: string;
  url: string;
  size: number;
  created_at: string;
  updated_at: string;
}

// Canvas File object (from the Files API)
export interface CanvasFile {
  id: number;
  uuid: string;
  folder_id: number;
  display_name: string;
  filename: string;
  'content-type': string;
  url: string;
  size: number;
  created_at: string;
  updated_at: string;
  unlock_at: string | null;
  locked: boolean;
  hidden: boolean;
  lock_at: string | null;
  hidden_for_user: boolean;
  thumbnail_url: string | null;
  modified_at: string;
  mime_class: string;
  media_entry_id: string | null;
  locked_for_user: boolean;
  preview_url?: string;
}

// Canvas Page object (from the Pages/Wiki API)
export interface Page {
  page_id: number;
  url: string;
  title: string;
  body?: string;
  created_at: string;
  updated_at: string;
  editing_roles: string;
  last_edited_by?: User;
  published: boolean;
  front_page: boolean;
  locked_for_user: boolean;
  lock_explanation?: string;
}

// Canvas Calendar Event
export interface CalendarEvent {
  id: number;
  title: string;
  description: string | null;
  start_at: string | null;
  end_at: string | null;
  location_name: string | null;
  location_address: string | null;
  context_code: string;
  context_name?: string;
  workflow_state: 'active' | 'locked' | 'deleted';
  all_day: boolean;
  all_day_date: string | null;
  html_url: string;
  type: 'event' | 'assignment';
  assignment?: Assignment;
}

// Canvas Todo Item
export interface TodoItem {
  type: string;
  assignment?: Assignment;
  quiz?: { id: number; title: string; html_url: string };
  ignore: string;
  ignore_permanently: string;
  html_url: string;
  needs_grading_count?: number;
  context_type: string;
  course_id: number;
  context_name?: string;
}

export interface Module {
  id: number;
  name: string;
  position: number;
  unlock_at: string | null;
  require_sequential_progress: boolean;
  prerequisite_module_ids: number[];
  items_count: number;
  items_url: string;
  items?: ModuleItem[];
  state?: 'locked' | 'unlocked' | 'started' | 'completed';
  completed_at?: string | null;
  publish_final_grade?: boolean;
  published?: boolean;
}

export interface ModuleItem {
  id: number;
  module_id: number;
  position: number;
  title: string;
  indent: number;
  type: ModuleItemType;
  content_id?: number;
  html_url?: string;
  url?: string;
  page_url?: string;
  external_url?: string;
  new_tab?: boolean;
  completion_requirement?: CompletionRequirement;
  content_details?: ContentDetails;
  published?: boolean;
}

export type ModuleItemType =
  | 'File'
  | 'Page'
  | 'Discussion'
  | 'Assignment'
  | 'Quiz'
  | 'SubHeader'
  | 'ExternalUrl'
  | 'ExternalTool';

export interface CompletionRequirement {
  type: 'must_view' | 'must_submit' | 'must_contribute' | 'min_score' | 'must_mark_done';
  min_score?: number;
  completed?: boolean;
}

export interface ContentDetails {
  points_possible?: number;
  due_at?: string;
  unlock_at?: string;
  lock_at?: string;
}

export interface Announcement {
  id: number;
  title: string;
  message: string;
  html_url: string;
  posted_at: string;
  delayed_post_at: string | null;
  context_code: string;
  user_name: string;
  topic_children: number[];
  attachments?: FileAttachment[];
  author: User;
  read_state?: 'read' | 'unread';
}

export interface DiscussionTopic {
  id: number;
  title: string;
  message: string;
  html_url: string;
  posted_at: string;
  last_reply_at: string | null;
  require_initial_post: boolean;
  user_can_see_posts: boolean;
  discussion_subentry_count: number;
  read_state: 'read' | 'unread';
  unread_count: number;
  subscribed: boolean;
  assignment_id: number | null;
  delayed_post_at: string | null;
  published: boolean;
  lock_at: string | null;
  locked: boolean;
  pinned: boolean;
  locked_for_user: boolean;
  lock_info?: LockInfo;
  lock_explanation?: string;
  user_name: string;
  author: User;
  attachments?: FileAttachment[];
  permissions?: {
    attach: boolean;
    update: boolean;
    reply: boolean;
    delete: boolean;
  };
}

export interface DiscussionEntry {
  id: number;
  user_id: number;
  user_name: string;
  user: User;
  message: string;
  read_state: 'read' | 'unread';
  forced_read_state: boolean;
  created_at: string;
  updated_at: string;
  attachment?: FileAttachment;
  recent_replies?: DiscussionEntry[];
  has_more_replies?: boolean;
}

export interface FileUploadParams {
  name: string;
  size: number;
  content_type: string;
  parent_folder_path?: string;
  on_duplicate?: 'overwrite' | 'rename';
}

export interface FileUploadResponse {
  upload_url: string;
  upload_params: Record<string, string>;
  file_param: string;
}

export interface SubmitAssignmentParams {
  submission_type: SubmissionType;
  body?: string;
  url?: string;
  file_ids?: number[];
}

// Query parameter types
export interface ListCoursesParams {
  enrollment_type?: 'teacher' | 'student' | 'ta' | 'observer' | 'designer';
  enrollment_state?: 'active' | 'invited_or_pending' | 'completed';
  state?: ('unpublished' | 'available' | 'completed' | 'deleted')[];
  include?: ('needs_grading_count' | 'syllabus_body' | 'total_scores' | 'term' | 'course_progress' | 'sections' | 'total_students' | 'current_grading_period_scores')[];
}

export interface ListAssignmentsParams {
  include?: ('submission' | 'assignment_visibility' | 'all_dates' | 'overrides' | 'score_statistics')[];
  search_term?: string;
  bucket?: 'past' | 'overdue' | 'undated' | 'ungraded' | 'unsubmitted' | 'upcoming' | 'future';
  assignment_ids?: number[];
  order_by?: 'position' | 'name' | 'due_at';
}

export interface ListModulesParams {
  include?: ('items' | 'content_details')[];
  search_term?: string;
  student_id?: number;
}

export interface ListAnnouncementsParams {
  context_codes: string[];
  start_date?: string;
  end_date?: string;
  active_only?: boolean;
  latest_only?: boolean;
}

export interface ListFilesParams {
  content_types?: string[];
  search_term?: string;
  sort?: 'name' | 'size' | 'created_at' | 'updated_at' | 'content_type';
  order?: 'asc' | 'desc';
}

export interface ListPagesParams {
  sort?: 'title' | 'created_at' | 'updated_at';
  order?: 'asc' | 'desc';
  search_term?: string;
  published?: boolean;
}

export interface ListCalendarEventsParams {
  type?: 'event' | 'assignment';
  context_codes?: string[];
  start_date?: string;
  end_date?: string;
  all_events?: boolean;
  undated?: boolean;
}

// ==================== PLANNER ====================

export interface PlannerItem {
  context_type: string;
  course_id: number;
  plannable_id: number;
  plannable_type: string;
  plannable: {
    id: number;
    title?: string;
    name?: string;
    due_at?: string;
    todo_date?: string;
    points_possible?: number;
    submission_types?: string[];
    description?: string;
    details?: string;
    created_at?: string;
    updated_at?: string;
    course_id?: number | null;
    user_id?: number;
    workflow_state?: string;
  };
  planner_override: PlannerOverride | null;
  submissions:
    | false
    | {
        excused: boolean;
        graded: boolean;
        late: boolean;
        missing: boolean;
        needs_grading: boolean;
        with_feedback: boolean;
      };
  html_url: string;
  context_name?: string;
  new_activity?: boolean;
}

export interface PlannerNote {
  id: number;
  title: string;
  description: string;
  details?: string;
  user_id: number;
  workflow_state: string;
  course_id: number | null;
  todo_date: string;
  linked_object_type: string | null;
  linked_object_id: number | null;
  linked_object_html_url: string | null;
  linked_object_url: string | null;
}

export interface PlannerOverride {
  id: number;
  plannable_type: string;
  plannable_id: number;
  user_id: number;
  assignment_id: number | null;
  workflow_state: string;
  marked_complete: boolean;
  dismissed: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ListPlannerItemsParams {
  start_date?: string;
  end_date?: string;
  context_codes?: string[];
  filter?: 'new_activity' | 'incomplete_items' | 'complete_items';
}

export interface ListPlannerNotesParams {
  start_date?: string;
  end_date?: string;
  context_codes?: string[];
}

export interface CreatePlannerNoteParams {
  title: string;
  details?: string;
  todo_date?: string;
  course_id?: number;
  linked_object_type?: 'announcement' | 'assignment' | 'discussion_topic' | 'wiki_page' | 'quiz';
  linked_object_id?: number;
}

export interface CreatePlannerOverrideParams {
  plannable_type: 'announcement' | 'assignment' | 'discussion_topic' | 'quiz' | 'wiki_page' | 'planner_note' | 'calendar_event' | 'assessment_request';
  plannable_id: number;
  marked_complete?: boolean;
  dismissed?: boolean;
}

// ==================== USER PROFILE ====================

export interface UserProfile {
  id: number;
  name: string;
  sortable_name: string;
  short_name: string;
  login_id: string;
  avatar_url: string;
  title: string | null;
  bio: string | null;
  primary_email: string;
  time_zone: string;
  locale: string | null;
  calendar?: CalendarLink;
}

// ==================== ASSIGNMENT GROUPS ====================

export interface AssignmentGroup {
  id: number;
  name: string;
  position: number;
  group_weight: number;
  assignments?: Assignment[];
  rules?: {
    drop_lowest?: number;
    drop_highest?: number;
    never_drop?: number[];
  };
}

export interface ListAssignmentGroupsParams {
  include?: ('assignments' | 'discussion_topic' | 'assignment_visibility' | 'submission' | 'score_statistics')[];
  assignment_ids?: number[];
  exclude_assignment_submission_types?: string[];
  override_assignment_dates?: boolean;
  grading_period_id?: number;
}

// ==================== SCORE STATISTICS ====================

export interface ScoreStatistics {
  mean: number;
  min: number;
  max: number;
  upper_q?: number;
  median?: number;
  lower_q?: number;
}

// ==================== CONVERSATIONS (INBOX) ====================

export interface Conversation {
  id: number;
  subject: string;
  workflow_state: 'read' | 'unread' | 'archived';
  last_message: string | null;
  last_message_at: string | null;
  last_authored_message: string | null;
  last_authored_message_at: string | null;
  message_count: number;
  subscribed: boolean;
  private: boolean;
  starred: boolean;
  properties?: string[];
  audience: number[];
  audience_contexts: Record<string, Record<string, string[]>>;
  avatar_url: string | null;
  participants: ConversationParticipant[];
  visible: boolean;
  context_name?: string;
  messages?: ConversationMessage[];
}

export interface ConversationParticipant {
  id: number;
  name: string;
  full_name?: string;
  avatar_url?: string;
}

export interface ConversationMessage {
  id: number;
  created_at: string;
  body: string;
  author_id: number;
  generated: boolean;
  media_comment: MediaComment | null;
  forwarded_messages?: ConversationMessage[];
  attachments?: FileAttachment[];
  participating_user_ids?: number[];
}

export interface ListConversationsParams {
  scope?: 'inbox' | 'unread' | 'starred' | 'sent' | 'archived';
  filter?: string[];
  filter_mode?: 'and' | 'or';
  include_all_conversation_ids?: boolean;
}

// ==================== FOLDERS ====================

export interface Folder {
  id: number;
  name: string;
  full_name: string;
  context_id: number;
  context_type: string;
  parent_folder_id: number | null;
  created_at: string;
  updated_at: string;
  lock_at: string | null;
  unlock_at: string | null;
  position: number | null;
  locked: boolean;
  folders_url: string;
  files_url: string;
  files_count: number;
  folders_count: number;
  hidden: boolean | null;
  locked_for_user: boolean;
  hidden_for_user: boolean;
  for_submissions: boolean;
}

export interface ListFoldersParams {
  sort_by?: 'name' | 'created_at' | 'updated_at';
  order?: 'asc' | 'desc';
}

// ==================== ACTIVITY STREAM ====================

export interface ActivityStreamItem {
  id: number;
  title: string;
  message: string | null;
  type: 'DiscussionTopic' | 'Announcement' | 'Conversation' | 'Message' | 'Submission' | 'Conference' | 'Collaboration' | 'AssessmentRequest';
  created_at: string;
  updated_at: string;
  read_state: boolean;
  context_type: string;
  course_id?: number;
  group_id?: number;
  html_url: string;

  // Type-specific fields
  total_root_discussion_entries?: number;
  require_initial_post?: boolean;
  user_has_posted?: boolean;
  root_discussion_entries?: unknown[];
  assignment_id?: number;
  grade?: string;
  score?: number;
  submission_comments?: string[];
}

export interface ActivityStreamSummary {
  type: string;
  unread_count: number;
  count: number;
}

// ==================== TABS ====================

export interface Tab {
  id: string;
  label: string;
  type: string;
  position: number;
  hidden?: boolean;
  visibility?: string;
  url?: string;
}

// ==================== QUIZZES ====================

/**
 * A Canvas Quiz. Lives in /courses/:id/quizzes — separate from assignments,
 * which is why the regular submission-status path can't authoritatively
 * tell you whether you took a quiz.
 */
export interface Quiz {
  id: number;
  title: string;
  html_url: string;
  mobile_url?: string;
  description?: string | null;
  quiz_type: 'practice_quiz' | 'assignment' | 'graded_survey' | 'survey';
  assignment_group_id?: number | null;
  /** Set when the quiz publishes a linked Assignment row. */
  assignment_id?: number | null;
  time_limit?: number | null;
  shuffle_answers?: boolean;
  hide_results?: 'always' | 'until_after_last_attempt' | null;
  show_correct_answers?: boolean;
  show_correct_answers_last_attempt?: boolean;
  show_correct_answers_at?: string | null;
  hide_correct_answers_at?: string | null;
  allowed_attempts: number;
  scoring_policy?: 'keep_highest' | 'keep_latest' | 'keep_average';
  one_question_at_a_time?: boolean;
  question_count?: number;
  points_possible: number | null;
  cant_go_back?: boolean;
  access_code?: string | null;
  ip_filter?: string | null;
  due_at: string | null;
  lock_at: string | null;
  unlock_at: string | null;
  published: boolean;
  unpublishable?: boolean;
  locked_for_user?: boolean;
  lock_info?: LockInfo;
  lock_explanation?: string;
  /** Present on /quizzes/:qid response with include[]=can_unpublish etc. */
  speedgrader_url?: string;
  question_types?: string[];
  has_access_code?: boolean;
  post_to_sis?: boolean;
  migration_id?: string;
  one_time_results?: boolean;
  only_visible_to_overrides?: boolean;
  preview_url?: string;
}

export interface ListQuizzesParams {
  search_term?: string;
}

/**
 * A user's submission record for a single quiz attempt. The workflow_state
 * here is authoritative for "did I take this quiz?" — bypasses the
 * indeterminate path in get_my_submission_status.
 */
// ==================== LATE POLICY ====================

/**
 * Per-course late and missing submission policy. Drives the actual point
 * deductions Canvas applies — separate from the assignment-level "late"
 * boolean. `late_submission_interval` is "day" or "hour".
 */
export interface LatePolicy {
  id: number;
  course_id: number;
  missing_submission_deduction_enabled: boolean;
  /** Percent of total deducted for missing submissions (e.g., 100 → 0). */
  missing_submission_deduction: number;
  late_submission_deduction_enabled: boolean;
  /** Percent deducted per interval (e.g., 10 → −10%/day). */
  late_submission_deduction: number;
  late_submission_interval: 'day' | 'hour';
  /** Floor — Canvas won't deduct below this percent of total. */
  late_submission_minimum_percent: number;
  late_submission_minimum_percent_deducted?: number;
  created_at?: string;
  updated_at?: string;
}

// ==================== COURSE ANALYTICS ====================

/**
 * Per-assignment analytics for the calling student. From
 * /courses/:id/analytics/users/self/assignments — includes timing,
 * the submission record, and the score statistics across the cohort.
 */
export interface StudentAssignmentAnalytics {
  assignment_id: number;
  title: string;
  points_possible: number;
  due_at: string | null;
  unlock_at?: string | null;
  muted?: boolean;
  min_score?: number | null;
  max_score?: number | null;
  median?: number | null;
  /** First-quartile / third-quartile score across the cohort. */
  first_quartile?: number | null;
  third_quartile?: number | null;
  module_ids?: number[];
  /** Status from the student's perspective. */
  status?: 'on_time' | 'late' | 'missing' | 'floating';
  excused?: boolean;
  submission?: {
    posted_at: string | null;
    submitted_at: string | null;
    score: number | null;
  };
  /** Days late, if late. */
  late_days?: number;
}

// ==================== GROUPS ====================

/**
 * A Canvas group (subset of a group set). Used for group-submission
 * assignments — TP2-style. Membership maps Theo to teammates.
 */
export interface Group {
  id: number;
  name: string;
  description?: string | null;
  is_public: boolean;
  followed_by_user?: boolean;
  join_level?: 'parent_context_auto_join' | 'parent_context_request' | 'invitation_only';
  members_count: number;
  avatar_url?: string | null;
  context_type: string;
  course_id?: number;
  account_id?: number;
  role?: string | null;
  group_category_id: number;
  storage_quota_mb?: number;
  permissions?: Record<string, boolean>;
  users?: User[];
}

export interface GroupMembership {
  id: number;
  group_id: number;
  user_id: number;
  workflow_state: 'accepted' | 'invited' | 'requested';
  moderator: boolean;
  just_created?: boolean;
  user?: User;
}

export interface QuizSubmission {
  id: number;
  user_id: number;
  quiz_id: number;
  attempt: number | null;
  workflow_state:
    | 'untaken'
    | 'pending_review'
    | 'complete'
    | 'settings_only'
    | 'preview';
  /** Score Canvas counts (per scoring_policy). */
  kept_score: number | null;
  /** Score for THIS attempt. */
  score: number | null;
  score_before_regrade: number | null;
  fudge_points: number | null;
  has_seen_results: boolean;
  started_at: string | null;
  finished_at: string | null;
  end_at: string | null;
  time_spent: number | null;
  attempts_left: number;
  /** Linked Submission record (when quiz publishes as Assignment). */
  submission_id?: number | null;
  /** Total points possible at time of submission — handy for percent calcs. */
  quiz_points_possible: number | null;
  extra_attempts?: number | null;
  extra_time?: number | null;
  manually_unlocked?: boolean;
  validation_token?: string;
  overdue_and_needs_submission?: boolean;
}


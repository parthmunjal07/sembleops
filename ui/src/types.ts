// Mirror of the API's shapes (kept in sync by hand for now — small on purpose).

export type TaskStatus = "open" | "done" | "killed" | "deferred" | "blocked";

export interface Task {
  id: string;
  title: string;
  source: string;
  created_at: string;
  due_at: string | null;
  priority: number;
  status: TaskStatus;
  snooze_count: number;
  blocked_reason: string | null;
  blocked_recheck_at: string | null;
  escalation_level: number;
  next_nag_at: string | null;
}

export interface InboxItem {
  task: Task;
  message: string;
  forced: boolean;
}

export interface RecheckItem {
  task: Task;
  message: string;
}

export interface Persona {
  name: string;
  role: string;
  promise: string;
  color: string;
  pressure: string;
}

export interface Meta {
  node: string;
  timezone: string;
  personas: Record<string, Persona>;
  snooze_cap: number;
  runtimes: string[];
  projects: string[];
  dex_mode: "local" | "remote";
  dex_online: boolean;
}

export interface ReminderSettings {
  timezone: string;
  quiet_hours: {
    start: string;
    end: string;
  };
  morning_brief: string;
  evening_reckoning: string;
}

export interface ReminderSettingsResponse {
  settings: ReminderSettings;
  defaults: ReminderSettings;
}

export interface TasksResponse {
  open: Task[];
  blocked: Task[];
  closed: Task[];
}

export interface InboxResponse {
  nags: InboxItem[];
  rechecks: RecheckItem[];
}

export interface Delegation {
  id: string;
  created_at: string;
  agent: string;
  title: string;
  instructions: string;
  status: "queued" | "running" | "needs_review" | "reviewed" | "dismissed" | "error";
  runtime: string | null;
  session_id: string | null;
  result: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  cost_usd: number | null;
  project: string | null;
  diff: string | null;
  parent_id: string | null;
  verify_requested: number;
  mission_id: string | null;
  content_idea_id: string | null;
  content_run_kind: "context" | "verification" | null;
  content_request_id: string | null;
}

export interface DelegationDetail {
  delegation: Delegation;
  children: Delegation[];
  parent: { id: string; title: string; agent: string } | null;
}

export interface MissionDetail {
  goal: { user_text: string; reply: string; at: string } | null;
  delegations: Delegation[];
}

export interface DelegationsResponse {
  running: Delegation[];
  needs_review: Delegation[];
  recent: Delegation[];
}

export type ContentAgentRun = Pick<
  Delegation,
  | "id"
  | "created_at"
  | "finished_at"
  | "agent"
  | "title"
  | "status"
  | "mission_id"
  | "content_idea_id"
  | "content_run_kind"
>;

export interface RoutedAction {
  type: "commitment" | "delegate";
  agent: string;
  title: string;
  detail: string;
  id: string;
}

export interface MarcoResponse {
  reply: string;
  actions: RoutedAction[];
}

export interface MarcoLogEntry {
  id: number;
  at: string;
  user_text: string;
  reply: string;
  actions: RoutedAction[];
}

export interface Today {
  decisions_needed: number;
  agents_working: number;
  at_risk: number;
  top3: Task[];
  open_count: number;
  blocked_count: number;
  notifications: number;
}

export type ContentIdeaStage = "inbox" | "shaping" | "ready" | "drafting";
export type ContentIdeaPriority = "low" | "normal" | "high";

export interface ContentIdea {
  id: string;
  title: string;
  hook: string;
  angle: string;
  audience: string;
  notes: string;
  stage: ContentIdeaStage;
  priority: ContentIdeaPriority;
  tags: string[];
  source: "manual" | "import";
  sort_order: number;
  target_date: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  agent_runs: ContentAgentRun[];
}

export type ContentIdeaPatch = Partial<
  Pick<
    ContentIdea,
    "title" | "hook" | "angle" | "audience" | "notes" | "stage" | "priority" | "tags" | "target_date"
  >
>;

export interface NotificationEvent {
  id: number;
  created_at: string;
  local_date: string | null;
  task_id: string | null;
  kind: "nag" | "brief" | "reckoning" | "digest" | "other";
  agent: string;
  title: string;
  body: string;
  link_path: string;
  browser_notified_at: string | null;
  read_at: string | null;
}

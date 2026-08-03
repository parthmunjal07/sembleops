// Shared between engine, API, and (duplicated into) the UI.

export type TaskStatus = "open" | "done" | "killed" | "deferred" | "blocked";
export type TaskSource = "voice" | "text" | "auto" | "email";

export interface Task {
  id: string;
  title: string;
  source: TaskSource;
  created_at: string; // UTC ISO
  due_at: string | null;
  priority: number;
  status: TaskStatus;
  snooze_count: number;
  blocked_reason: string | null;
  blocked_recheck_at: string | null;
  thread_id: string | null;
  session_id: string | null;
  escalation_level: number; // 0 = not yet nagged; 1..3 = ladder (4 = calendar, post-MVP)
  next_nag_at: string | null;
}

export interface HistoryEvent {
  id: number;
  task_id: string;
  at: string;
  event: string;
  detail: string | null;
}

export type DecisionAction = "done" | "snooze" | "blocked" | "kill" | "defer";

export interface DecisionInput {
  action: DecisionAction;
  snooze_hours?: number; // snooze
  reason?: string; // blocked
  due_at?: string; // defer (UTC ISO)
}

export interface InboxItem {
  task: Task;
  message: string; // Larry's line for the current escalation level
  forced: boolean; // level 3+: forced decision, snooze disabled
}

export type ContentIdeaStage = "inbox" | "shaping" | "ready" | "drafting";
export type ContentIdeaPriority = "low" | "normal" | "high";
export type ContentIdeaSource = "manual" | "import";

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
  source: ContentIdeaSource;
  sort_order: number;
  target_date: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

import type {
  ContentIdea,
  ContentAgentRun,
  ContentIdeaPatch,
  ContentIdeaStage,
  Delegation,
  DelegationDetail,
  DelegationsResponse,
  InboxResponse,
  MarcoLogEntry,
  MarcoResponse,
  Meta,
  MissionDetail,
  NotificationEvent,
  ReminderSettings,
  ReminderSettingsResponse,
  Task,
  TasksResponse,
  Today,
} from "./types";

export interface ContentHandoffResponse {
  handoff: {
    request_id: string;
    content_idea_id: string;
    status: "routing" | "complete" | "error";
    mission_id: string;
    created_at: string;
    updated_at: string;
    error: string | null;
  } | null;
  marco: MarcoResponse | null;
  delegations: Delegation[];
  reused: boolean;
}

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    // Only claim a JSON body when there is one: Fastify 400s an empty body
    // that arrives with a JSON content type (broke take-now and unblock).
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });

const patch = (url: string, body: unknown) =>
  fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const api = {
  login: (token: string) => post("/api/login", { token }).then((r) => json<{ ok: boolean }>(r)),
  meta: () => fetch("/api/meta").then((r) => json<Meta>(r)),
  reminderSettings: () =>
    fetch("/api/settings/reminders").then((r) => json<ReminderSettingsResponse>(r)),
  updateReminderSettings: (settings: ReminderSettings) =>
    post("/api/settings/reminders", settings).then((r) =>
      json<{ settings: ReminderSettings }>(r),
    ),
  today: () => fetch("/api/today").then((r) => json<Today>(r)),
  contentIdeas: () =>
    fetch("/api/content-ideas").then((r) => json<{ ideas: ContentIdea[] }>(r)),
  createContentIdea: (title: string) =>
    post("/api/content-ideas", { title }).then((r) => json<{ idea: ContentIdea }>(r)),
  importContentIdeas: (titles: string[]) =>
    post("/api/content-ideas/import", { titles }).then((r) =>
      json<{ ideas: ContentIdea[]; skipped: number; skipped_titles: string[] }>(r),
    ),
  updateContentIdea: (id: string, changes: ContentIdeaPatch) =>
    patch(`/api/content-ideas/${id}`, changes).then((r) => json<{ idea: ContentIdea }>(r)),
  moveContentIdea: (id: string, stage: ContentIdeaStage, index: number) =>
    post(`/api/content-ideas/${id}/move`, { stage, index }).then((r) =>
      json<{ idea: ContentIdea }>(r),
    ),
  handoffContentIdea: (id: string, focus: string, requestId: string) =>
    post(`/api/content-ideas/${id}/handoff`, { focus, request_id: requestId }).then((r) =>
      json<ContentHandoffResponse>(r),
    ),
  contentIdeaAgentRuns: (id: string) =>
    fetch(`/api/content-ideas/${id}/agent-runs`).then((r) =>
      json<{ agent_runs: ContentAgentRun[] }>(r),
    ),
  archiveContentIdea: (id: string) =>
    fetch(`/api/content-ideas/${id}`, { method: "DELETE" }).then((r) =>
      json<{ idea: ContentIdea }>(r),
    ),
  tasks: () => fetch("/api/tasks").then((r) => json<TasksResponse>(r)),
  inbox: () => fetch("/api/inbox").then((r) => json<InboxResponse>(r)),
  delegations: () => fetch("/api/delegations").then((r) => json<DelegationsResponse>(r)),
  notifications: () =>
    fetch("/api/notifications").then((r) => json<{ notifications: NotificationEvent[] }>(r)),
  markNotificationNotified: (id: number) =>
    post(`/api/notifications/${id}/notified`).then((r) =>
      json<{ notification: NotificationEvent }>(r),
    ),
  markNotificationRead: (id: number) =>
    post(`/api/notifications/${id}/read`).then((r) => json<{ notification: NotificationEvent }>(r)),
  markAllNotificationsRead: () =>
    post("/api/notifications/read-all").then((r) => json<{ ok: true }>(r)),
  delegation: (id: string) =>
    fetch(`/api/delegations/${id}`).then((r) => json<DelegationDetail>(r)),
  mission: (id: string) => fetch(`/api/missions/${id}`).then((r) => json<MissionDetail>(r)),
  marcoLog: () => fetch("/api/message/log").then((r) => json<{ log: MarcoLogEntry[] }>(r)),
  message: (text: string) => post("/api/message", { text }).then((r) => json<MarcoResponse>(r)),
  transcribe: (audio: Blob) =>
    fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": audio.type || "audio/webm" },
      body: audio,
    }).then((r) => json<{ transcript: string }>(r)),
  decide: (
    id: string,
    body: {
      action: "done" | "snooze" | "blocked" | "kill" | "defer";
      snooze_hours?: number;
      reason?: string;
      due_at?: string;
    },
  ) => post(`/api/tasks/${id}/decision`, body).then((r) => json<{ task: Task }>(r)),
  takeNow: (id: string) => post(`/api/tasks/${id}/take-now`).then((r) => json<{ task: Task }>(r)),
  unblock: (id: string) => post(`/api/tasks/${id}/unblock`).then((r) => json<{ task: Task }>(r)),
  reviewDelegation: (id: string, action: "reviewed" | "dismissed" | "retry") =>
    post(`/api/delegations/${id}/review`, { action }).then((r) => json<{ delegation: Delegation }>(r)),
};

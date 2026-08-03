import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  DecisionInput,
  HistoryEvent,
  Task,
  TaskSource,
  TaskStatus,
} from "../shared/types.js";
import type { QuietHours } from "./nag.js";

const nowIso = (): string => new Date().toISOString();
type DeliveryKind = "nag" | "brief" | "reckoning" | "digest" | "other";

export interface ReminderSettings {
  timezone: string;
  quiet_hours: QuietHours;
  morning_brief: string;
  evening_reckoning: string;
}

export interface ReminderSettingsInput {
  timezone?: string;
  quiet_hours?: Partial<QuietHours>;
  morning_brief?: string;
  evening_reckoning?: string;
}

export interface NotificationEvent {
  id: number;
  created_at: string;
  local_date: string | null;
  task_id: string | null;
  kind: DeliveryKind;
  agent: string;
  title: string;
  body: string;
  link_path: string;
  browser_notified_at: string | null;
  read_at: string | null;
}

export class TaskStore {
  constructor(private readonly db: Database.Database) {}

  getReminderSettings(defaults: ReminderSettings): ReminderSettings {
    const rows = this.db
      .prepare("SELECT key, value FROM app_settings WHERE key LIKE 'reminder.%'")
      .all() as Array<{ key: string; value: string }>;
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return {
      timezone: values.get("reminder.timezone") ?? defaults.timezone,
      quiet_hours: {
        start: values.get("reminder.quiet_start") ?? defaults.quiet_hours.start,
        end: values.get("reminder.quiet_end") ?? defaults.quiet_hours.end,
      },
      morning_brief: values.get("reminder.morning_brief") ?? defaults.morning_brief,
      evening_reckoning: values.get("reminder.evening_reckoning") ?? defaults.evening_reckoning,
    };
  }

  updateReminderSettings(
    input: ReminderSettingsInput,
    defaults: ReminderSettings,
  ): ReminderSettings {
    const current = this.getReminderSettings(defaults);
    const next: ReminderSettings = {
      timezone: input.timezone ?? current.timezone,
      quiet_hours: {
        start: input.quiet_hours?.start ?? current.quiet_hours.start,
        end: input.quiet_hours?.end ?? current.quiet_hours.end,
      },
      morning_brief: input.morning_brief ?? current.morning_brief,
      evening_reckoning: input.evening_reckoning ?? current.evening_reckoning,
    };
    const at = nowIso();
    const write = this.db.prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    this.db.transaction(() => {
      write.run("reminder.timezone", next.timezone, at);
      write.run("reminder.quiet_start", next.quiet_hours.start, at);
      write.run("reminder.quiet_end", next.quiet_hours.end, at);
      write.run("reminder.morning_brief", next.morning_brief, at);
      write.run("reminder.evening_reckoning", next.evening_reckoning, at);
    })();
    return next;
  }

  createTask(input: {
    title: string;
    source: TaskSource;
    due_at: string | null;
    next_nag_at: string | null;
    priority?: number;
  }): Task {
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      source: input.source,
      created_at: nowIso(),
      due_at: input.due_at,
      priority: input.priority ?? 0,
      status: "open",
      snooze_count: 0,
      blocked_reason: null,
      blocked_recheck_at: null,
      thread_id: null,
      session_id: null,
      escalation_level: 0,
      next_nag_at: input.next_nag_at,
    };
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, source, created_at, due_at, priority, status,
           snooze_count, escalation_level, next_nag_at)
         VALUES (@id, @title, @source, @created_at, @due_at, @priority, @status,
           @snooze_count, @escalation_level, @next_nag_at)`,
      )
      .run(task as unknown as Record<string, unknown>);
    this.addHistory(task.id, "captured", { source: input.source, due_at: input.due_at });
    return task;
  }

  getTask(id: string): Task | undefined {
    return this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
  }

  listTasks(statuses: TaskStatus[]): Task[] {
    const placeholders = statuses.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT * FROM tasks WHERE status IN (${placeholders})
         ORDER BY due_at IS NULL, due_at ASC, priority DESC, created_at ASC`,
      )
      .all(...statuses) as Task[];
  }

  closedTaskTitlesSince(sinceIso: string, limit = 6): string[] {
    return this.db
      .prepare(
        `SELECT t.title FROM task_history h
         JOIN tasks t ON t.id = h.task_id
         WHERE h.at >= ? AND h.event IN ('done', 'killed')
         ORDER BY h.at DESC
         LIMIT ?`,
      )
      .all(sinceIso, limit)
      .map((r) => (r as { title: string }).title);
  }

  /** Open tasks whose nag is now visible in the inbox (a nag has fired, undecided). */
  inboxTasks(): Task[] {
    return this.db
      .prepare(
        `SELECT * FROM tasks WHERE status = 'open' AND escalation_level >= 1
         ORDER BY escalation_level DESC, due_at IS NULL, due_at ASC`,
      )
      .all() as Task[];
  }

  /** Open tasks whose next nag time has arrived (scheduler input). */
  dueForNag(now: string): Task[] {
    return this.db
      .prepare(
        "SELECT * FROM tasks WHERE status = 'open' AND next_nag_at IS NOT NULL AND next_nag_at <= ?",
      )
      .all(now) as Task[];
  }

  /** Blocked tasks whose recheck time has arrived. */
  dueForBlockedRecheck(now: string): Task[] {
    return this.db
      .prepare(
        "SELECT * FROM tasks WHERE status = 'blocked' AND blocked_recheck_at IS NOT NULL AND blocked_recheck_at <= ?",
      )
      .all(now) as Task[];
  }

  escalate(id: string, level: number, nextNagAt: string): void {
    this.db
      .prepare("UPDATE tasks SET escalation_level = ?, next_nag_at = ? WHERE id = ?")
      .run(level, nextNagAt, id);
    this.addHistory(id, "nag_fired", { level });
  }

  rescheduleNag(id: string, nextNagAt: string, reason: string): void {
    this.db.prepare("UPDATE tasks SET next_nag_at = ? WHERE id = ?").run(nextNagAt, id);
    this.addHistory(id, "nag_rescheduled", { reason, next_nag_at: nextNagAt });
  }

  rescheduleBlockedRecheck(id: string, recheckAt: string): void {
    this.db.prepare("UPDATE tasks SET blocked_recheck_at = ? WHERE id = ?").run(recheckAt, id);
    this.addHistory(id, "blocked_recheck_fired", {});
  }

  applyDecision(task: Task, input: DecisionInput, snoozeCap: number, blockedRecheckHours: number):
    | { ok: true; task: Task }
    | { ok: false; error: string } {
    const now = nowIso();
    switch (input.action) {
      case "done":
        this.setStatus(task.id, "done");
        this.addHistory(task.id, "done", {});
        break;
      case "kill":
        this.setStatus(task.id, "killed");
        this.addHistory(task.id, "killed", {});
        break;
      case "snooze": {
        // Past the snooze cap, snoozing is no longer offered:
        // enforced server-side, not just hidden in the UI.
        if (task.snooze_count >= snoozeCap) {
          return { ok: false, error: "snooze cap reached, pick a real decision" };
        }
        const hours = input.snooze_hours ?? 3;
        const next = new Date(Date.now() + hours * 3_600_000).toISOString();
        this.db
          .prepare(
            "UPDATE tasks SET snooze_count = snooze_count + 1, next_nag_at = ?, escalation_level = 0 WHERE id = ?",
          )
          .run(next, task.id);
        this.addHistory(task.id, "snoozed", { hours, count: task.snooze_count + 1 });
        break;
      }
      case "blocked": {
        const recheck = new Date(Date.now() + blockedRecheckHours * 3_600_000).toISOString();
        this.db
          .prepare(
            "UPDATE tasks SET status = 'blocked', blocked_reason = ?, blocked_recheck_at = ?, next_nag_at = NULL, escalation_level = 0 WHERE id = ?",
          )
          .run(input.reason ?? "no reason given", recheck, task.id);
        this.addHistory(task.id, "blocked", { reason: input.reason ?? null });
        break;
      }
      case "defer": {
        // Defer-with-date is a first-class explicit outcome:
        // it resets the ladder rather than counting as a snooze.
        if (!input.due_at) return { ok: false, error: "defer requires due_at" };
        this.db
          .prepare(
            "UPDATE tasks SET status = 'open', due_at = ?, next_nag_at = ?, escalation_level = 0, snooze_count = 0, blocked_reason = NULL, blocked_recheck_at = NULL WHERE id = ?",
          )
          .run(input.due_at, input.due_at, task.id);
        this.addHistory(task.id, "deferred", { due_at: input.due_at, from: now });
        break;
      }
    }
    const updated = this.getTask(task.id);
    if (!updated) return { ok: false, error: "task vanished" };
    return { ok: true, task: updated };
  }

  /** "Take now": surface a waiting task in the decision inbox immediately. */
  nagNow(task: Task): void {
    const next = new Date(Date.now() + 4 * 3_600_000).toISOString();
    const level = Math.max(1, task.escalation_level);
    this.db
      .prepare("UPDATE tasks SET escalation_level = ?, next_nag_at = ? WHERE id = ?")
      .run(level, next, task.id);
    this.addHistory(task.id, "taken_now", {});
    this.recordDelivery({ task_id: task.id, kind: "nag", channel: "ui" });
    this.createNotification({
      task_id: task.id,
      kind: "nag",
      agent: "larry",
      title: "Larry Ledger: taken now",
      body: `You pulled this forward: ${task.title}. What's the move?`,
      link_path: "/",
    });
  }

  /** Unblock: back to open, nag again shortly. */
  unblock(task: Task): Task | undefined {
    const next = new Date(Date.now() + 60_000).toISOString();
    this.db
      .prepare(
        "UPDATE tasks SET status = 'open', blocked_reason = NULL, blocked_recheck_at = NULL, next_nag_at = ?, escalation_level = 0 WHERE id = ?",
      )
      .run(next, task.id);
    this.addHistory(task.id, "unblocked", {});
    return this.getTask(task.id);
  }

  history(taskId: string): HistoryEvent[] {
    return this.db
      .prepare("SELECT * FROM task_history WHERE task_id = ? ORDER BY id ASC")
      .all(taskId) as HistoryEvent[];
  }

  recordDelivery(input: {
    task_id: string | null;
    kind: DeliveryKind;
    channel: string;
    discord_message_id?: string | null;
  }): void {
    // In the UI/browser channels, "delivered" means "persisted where the inbox
    // reads it". For Discord, the persisted message ID is the confirmation.
    this.db
      .prepare(
        "INSERT INTO deliveries (task_id, kind, sent_at, channel, discord_message_id) VALUES (?, ?, ?, ?, ?)",
      )
      .run(input.task_id, input.kind, nowIso(), input.channel, input.discord_message_id ?? null);
  }

  /** Unread, not-yet-Discord-delivered events (delivery bus for the bot). */
  notificationsPendingDiscord(limit = 10): NotificationEvent[] {
    return this.db
      .prepare(
        `SELECT * FROM notification_events
         WHERE read_at IS NULL AND discord_sent_at IS NULL
         ORDER BY id ASC LIMIT ?`,
      )
      .all(limit) as NotificationEvent[];
  }

  markNotificationDiscordSent(id: number, messageId: string | null): void {
    const event = this.db
      .prepare("SELECT * FROM notification_events WHERE id = ?")
      .get(id) as NotificationEvent | undefined;
    if (!event) return;
    this.db
      .prepare("UPDATE notification_events SET discord_sent_at = ?, discord_message_id = ? WHERE id = ?")
      .run(nowIso(), messageId, id);
    this.recordDelivery({
      task_id: event.task_id,
      kind: event.kind,
      channel: "discord",
      discord_message_id: messageId,
    });
  }

  /** On bot startup: don't flood the channel with a stale backlog. */
  skipStaleDiscordBacklog(olderThanIso: string): number {
    return this.db
      .prepare(
        `UPDATE notification_events SET discord_sent_at = 'skipped-backlog'
         WHERE discord_sent_at IS NULL AND created_at < ?`,
      )
      .run(olderThanIso).changes;
  }

  createNotification(input: {
    task_id: string | null;
    kind: DeliveryKind;
    agent: string;
    title: string;
    body: string;
    link_path?: string;
    local_date?: string | null;
  }): NotificationEvent {
    const result = this.db
      .prepare(
        `INSERT INTO notification_events
           (created_at, local_date, task_id, kind, agent, title, body, link_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nowIso(),
        input.local_date ?? null,
        input.task_id,
        input.kind,
        input.agent,
        input.title,
        input.body,
        input.link_path ?? "/",
      );
    return this.db
      .prepare("SELECT * FROM notification_events WHERE id = ?")
      .get(result.lastInsertRowid) as NotificationEvent;
  }

  hasNotificationForLocalDate(kind: DeliveryKind, localDate: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM notification_events WHERE kind = ? AND local_date = ? LIMIT 1")
      .get(kind, localDate);
    return row !== undefined;
  }

  listNotifications(limit = 50): NotificationEvent[] {
    return this.db
      .prepare(
        `SELECT * FROM notification_events
         WHERE read_at IS NULL
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as NotificationEvent[];
  }

  markNotificationBrowserNotified(id: number): NotificationEvent | undefined {
    const event = this.db
      .prepare("SELECT * FROM notification_events WHERE id = ?")
      .get(id) as NotificationEvent | undefined;
    if (!event) return undefined;
    if (!event.browser_notified_at) {
      const at = nowIso();
      this.db
        .prepare("UPDATE notification_events SET browser_notified_at = ? WHERE id = ?")
        .run(at, id);
      this.recordDelivery({ task_id: event.task_id, kind: event.kind, channel: "browser" });
    }
    return this.db
      .prepare("SELECT * FROM notification_events WHERE id = ?")
      .get(id) as NotificationEvent | undefined;
  }

  markNotificationRead(id: number): NotificationEvent | undefined {
    const at = nowIso();
    this.db
      .prepare("UPDATE notification_events SET read_at = COALESCE(read_at, ?) WHERE id = ?")
      .run(at, id);
    return this.db
      .prepare("SELECT * FROM notification_events WHERE id = ?")
      .get(id) as NotificationEvent | undefined;
  }

  markAllNotificationsRead(): void {
    this.db
      .prepare("UPDATE notification_events SET read_at = COALESCE(read_at, ?) WHERE read_at IS NULL")
      .run(nowIso());
  }

  private setStatus(id: string, status: TaskStatus): void {
    this.db
      .prepare("UPDATE tasks SET status = ?, next_nag_at = NULL WHERE id = ?")
      .run(status, id);
  }

  private addHistory(taskId: string, event: string, detail: unknown): void {
    this.db
      .prepare("INSERT INTO task_history (task_id, at, event, detail) VALUES (?, ?, ?, ?)")
      .run(taskId, nowIso(), event, JSON.stringify(detail));
  }
}

// The deterministic tick loop — fires escalations and blocked rechecks.
// No model calls occur anywhere in this scheduling path.

import type { TaskStore } from "./store.js";
import type { ReminderSettings } from "./store.js";
import {
  blockedRecheckLine,
  inQuietHoursAt,
  larryLine,
  MAX_LEVEL,
  minutesOfDay,
  nextNagAfterEscalation,
  quietEndAfter,
  type QuietHours,
} from "./nag.js";

interface DailyRhythm {
  timezone: string;
  morningBrief: string;
  eveningReckoning: string;
}

interface SchedulerSettings {
  timezone: string;
  quiet: QuietHours;
  morningBrief: string;
  eveningReckoning: string;
}

const DAILY_DELIVERY_WINDOW_MINUTES = 120;

function localParts(now: Date, timezone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function insideDeliveryWindow(nowMinutes: number, scheduledMinutes: number): boolean {
  return (
    nowMinutes >= scheduledMinutes &&
    nowMinutes < scheduledMinutes + DAILY_DELIVERY_WINDOW_MINUTES
  );
}

function briefBody(store: TaskStore): string {
  const open = store.listTasks(["open"]);
  const top = open.slice(0, 3).map((t, i) => `${i + 1}. ${t.title}`);
  const decisions = store.inboxTasks().length;
  return [
    `Morning brief: ${open.length} open commitment${open.length === 1 ? "" : "s"}, ${decisions} waiting on a decision.`,
    ...top,
    decisions > 0 ? "Start with the decision inbox." : "No forced decisions yet.",
  ].join("\n");
}

function reckoningBody(store: TaskStore, now: Date): string {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const closed = store.closedTaskTitlesSince(dayStart.toISOString());
  const atRisk = store
    .listTasks(["open"])
    .filter((t) => t.escalation_level >= 2 || (t.due_at !== null && new Date(t.due_at) < now));
  const closedLine =
    closed.length > 0 ? `Closed today: ${closed.slice(0, 3).join("; ")}.` : "Nothing closed today yet.";
  const riskLine =
    atRisk.length > 0
      ? `At risk tomorrow: ${atRisk.slice(0, 3).map((t) => t.title).join("; ")}.`
      : "Nothing is currently at risk.";
  return [`Evening reckoning: ${closedLine}`, riskLine, "Larry will keep the loop alive."].join("\n");
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly fallbackSettings: SchedulerSettings;

  constructor(
    private readonly store: TaskStore,
    private readonly quiet: QuietHours,
    private readonly blockedRecheckHours: number,
    private readonly rhythm?: DailyRhythm,
    private readonly getReminderSettings?: () => ReminderSettings,
  ) {
    this.fallbackSettings = {
      timezone: rhythm?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      quiet,
      morningBrief: rhythm?.morningBrief ?? "08:00",
      eveningReckoning: rhythm?.eveningReckoning ?? "20:30",
    };
  }

  start(intervalMs = 60_000): void {
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  tick(now: Date = new Date()): { escalated: number; rechecks: number; daily: number } {
    const settings = this.currentSettings();
    const nowIso = now.toISOString();

    const due = this.store.dueForNag(nowIso);
    let escalated = 0;
    let foldedIntoBrief = 0;
    for (const task of due) {
      if (inQuietHoursAt(now, settings.quiet, settings.timezone)) {
        const next = quietEndAfter(now, settings.quiet, settings.timezone);
        this.store.rescheduleNag(task.id, next.toISOString(), "quiet_hours");
        continue;
      }

      const level = Math.min(task.escalation_level + 1, MAX_LEVEL);
      const next = nextNagAfterEscalation(level, now, settings.quiet, settings.timezone);
      this.store.escalate(task.id, level, next.toISOString());

      if (this.shouldFoldNagIntoMorningBrief(task, now, settings)) {
        foldedIntoBrief += 1;
        continue;
      }

      this.store.recordDelivery({ task_id: task.id, kind: "nag", channel: "ui" });
      this.store.createNotification({
        task_id: task.id,
        kind: "nag",
        agent: "larry",
        title: "Larry Ledger: commitment needs a decision",
        body: larryLine({ ...task, escalation_level: level, next_nag_at: next.toISOString() }, level),
        link_path: "/",
      });
      escalated += 1;
    }

    const rechecks = this.store.dueForBlockedRecheck(nowIso);
    for (const task of rechecks) {
      if (inQuietHoursAt(now, settings.quiet, settings.timezone)) {
        const next = quietEndAfter(now, settings.quiet, settings.timezone);
        this.store.rescheduleBlockedRecheck(task.id, next.toISOString());
        continue;
      }
      const next = new Date(now.getTime() + this.blockedRecheckHours * 3_600_000);
      this.store.rescheduleBlockedRecheck(task.id, next.toISOString());
      this.store.recordDelivery({ task_id: task.id, kind: "nag", channel: "ui" });
      this.store.createNotification({
        task_id: task.id,
        kind: "nag",
        agent: "larry",
        title: "Larry Ledger: blocked commitment check-in",
        body: blockedRecheckLine(task),
        link_path: "/",
      });
    }

    const daily = this.fireDailyRhythm(now, settings);
    return { escalated: escalated + foldedIntoBrief, rechecks: rechecks.length, daily };
  }

  private currentSettings(): SchedulerSettings {
    const fromStore = this.getReminderSettings?.();
    if (!fromStore) return this.fallbackSettings;
    return {
      timezone: fromStore.timezone,
      quiet: fromStore.quiet_hours,
      morningBrief: fromStore.morning_brief,
      eveningReckoning: fromStore.evening_reckoning,
    };
  }

  private shouldFoldNagIntoMorningBrief(
    task: { next_nag_at: string | null },
    now: Date,
    settings: SchedulerSettings,
  ): boolean {
    if (task.next_nag_at === null) return false;
    const local = localParts(now, settings.timezone);
    return (
      insideDeliveryWindow(local.minutes, minutesOfDay(settings.morningBrief)) &&
      !this.store.hasNotificationForLocalDate("brief", local.date) &&
      inQuietHoursAt(new Date(task.next_nag_at), settings.quiet, settings.timezone)
    );
  }

  private fireDailyRhythm(now: Date, settings: SchedulerSettings): number {
    if (inQuietHoursAt(now, settings.quiet, settings.timezone)) return 0;
    const local = localParts(now, settings.timezone);
    let count = 0;

    if (
      insideDeliveryWindow(local.minutes, minutesOfDay(settings.morningBrief)) &&
      !this.store.hasNotificationForLocalDate("brief", local.date)
    ) {
      this.store.createNotification({
        task_id: null,
        kind: "brief",
        agent: "larry",
        title: "Larry Ledger: morning brief",
        body: briefBody(this.store),
        local_date: local.date,
        link_path: "/",
      });
      count += 1;
    }

    if (
      insideDeliveryWindow(local.minutes, minutesOfDay(settings.eveningReckoning)) &&
      !this.store.hasNotificationForLocalDate("reckoning", local.date)
    ) {
      this.store.createNotification({
        task_id: null,
        kind: "reckoning",
        agent: "larry",
        title: "Larry Ledger: evening reckoning",
        body: reckoningBody(this.store, now),
        local_date: local.date,
        link_path: "/",
      });
      count += 1;
    }

    return count;
  }
}

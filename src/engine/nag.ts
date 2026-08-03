// Pure escalation logic — no I/O, no LLM. This file IS the G1 guarantee.
// Larry's phrasing here is the deterministic template fallback; a model may
// rewrite these lines, but the ladder itself never depends on one.

import type { Task } from "../shared/types.js";

export const MAX_LEVEL = 3; // level 4 (calendar intervention) is post-MVP

// Hours until the next escalation fires if a nag is ignored, by current level.
const ESCALATION_GAP_HOURS: Record<number, number> = {
  1: 4, // gentle → context
  2: 4, // context → forced choice
  3: 24, // forced choice repeats daily until answered
};

export interface QuietHours {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export function minutesOfDay(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function localParts(instant: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function offsetMs(instant: Date, timezone: string): number {
  const p = localParts(instant, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

function zonedTimeToUtc(
  local: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timezone: string,
): Date {
  const localAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second ?? 0,
  );
  let candidate = new Date(localAsUtc - offsetMs(new Date(localAsUtc), timezone));
  const corrected = new Date(localAsUtc - offsetMs(candidate, timezone));
  if (corrected.getTime() !== candidate.getTime()) candidate = corrected;
  return candidate;
}

function addLocalDay(local: { year: number; month: number; day: number }): {
  year: number;
  month: number;
  day: number;
} {
  const next = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

/** True if `local` (a Date already in wall-clock terms) falls inside quiet hours. */
export function inQuietHours(local: Date, quiet: QuietHours): boolean {
  const t = local.getHours() * 60 + local.getMinutes();
  const start = minutesOfDay(quiet.start);
  const end = minutesOfDay(quiet.end);
  return start <= end ? t >= start && t < end : t >= start || t < end;
}

export function inQuietHoursAt(instant: Date, quiet: QuietHours, timezone: string): boolean {
  const local = localParts(instant, timezone);
  const t = local.hour * 60 + local.minute;
  const start = minutesOfDay(quiet.start);
  const end = minutesOfDay(quiet.end);
  return start <= end ? t >= start && t < end : t >= start || t < end;
}

export function quietEndAfter(instant: Date, quiet: QuietHours, timezone: string): Date {
  const local = localParts(instant, timezone);
  const [hour = 0, minute = 0] = quiet.end.split(":").map(Number);
  let out = zonedTimeToUtc({ ...local, hour, minute, second: 0 }, timezone);
  if (out <= instant) {
    out = zonedTimeToUtc({ ...addLocalDay(local), hour, minute, second: 0 }, timezone);
  }
  return out;
}

/** Push a timestamp out of quiet hours to the quiet-hours end. */
export function deferOutOfQuietHours(when: Date, quiet: QuietHours, timezone?: string): Date {
  if (timezone) {
    return inQuietHoursAt(when, quiet, timezone) ? quietEndAfter(when, quiet, timezone) : when;
  }
  if (!inQuietHours(when, quiet)) return when;
  const out = new Date(when);
  const [h = 0, m = 0] = quiet.end.split(":").map(Number);
  out.setHours(h, m, 0, 0);
  // Overnight window (e.g. 22:00–07:30): a 23:00 nag moves to 07:30 *tomorrow*.
  if (out <= when) out.setDate(out.getDate() + 1);
  return out;
}

/** When the ignored-nag follow-up should fire, given the level just reached. */
export function nextNagAfterEscalation(
  level: number,
  now: Date,
  quiet: QuietHours,
  timezone?: string,
): Date {
  const gap = ESCALATION_GAP_HOURS[Math.min(level, MAX_LEVEL)] ?? 24;
  return deferOutOfQuietHours(new Date(now.getTime() + gap * 3_600_000), quiet, timezone);
}

/** Larry's template line for a task at a given escalation level (firmness: direct). */
export function larryLine(task: Task, level: number): string {
  let due = "no due date";
  if (task.due_at !== null) {
    const d = new Date(task.due_at);
    const now = new Date();
    if (d < now) due = "overdue";
    else if (d.toDateString() === now.toDateString()) due = "due today";
    else due = `due ${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
  }
  switch (level) {
    case 1:
      return `Quick nudge: ${task.title} (${due}).`;
    case 2:
      return `Still open: ${task.title} (${due})${
        task.snooze_count > 0 ? `, snoozed ${task.snooze_count}x` : ""
      }. This one's starting to slip.`;
    default:
      return `This has survived ${level} reminders: ${task.title}. Pick one: do it, defer it with a date, mark it blocked, or kill it.`;
  }
}

export function blockedRecheckLine(task: Task): string {
  return `Still blocked? "${task.title}" (reason on file: ${
    task.blocked_reason ?? "none given"
  }). Unblock it, keep waiting, or kill it.`;
}

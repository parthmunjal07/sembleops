// Capture parsing — deterministic MVP version (chrono-node for dates).
// A model-backed edge may later upgrade this parser. The confirmation-echo
// contract keeps an imperfect parser reviewable: every capture is echoed back.

import * as chrono from "chrono-node";

export interface ParsedCapture {
  title: string;
  due_at: string | null; // UTC ISO
  echo: string; // one-line confirmation shown to the user
}

const LEAD_INS = [
  /^remind me to\s+/i,
  /^reminder( to)?[:\s]+/i,
  /^i need to\s+/i,
  /^i'?ll\s+/i,
  /^todo[:\s]+/i,
  /^task[:\s]+/i,
  /^don'?t let me forget( to)?\s+/i,
];

export function parseCapture(text: string, now: Date = new Date()): ParsedCapture {
  let title = text.trim();
  for (const lead of LEAD_INS) title = title.replace(lead, "");

  const results = chrono.parse(title, now, { forwardDate: true });
  let due: Date | null = null;
  // Prefer the most specific date phrase, not the first: "call now about
  // next Friday" should parse "next Friday", not eat the word "now".
  const first = [...results].sort((a, b) => b.text.length - a.text.length)[0];
  if (first) {
    due = first.start.date();
    // A truly bare date ("tomorrow") gets chrono's default hour (noon, or the
    // current clock time depending on phrasing) — move it to 09:00 local.
    // Phrases like "afternoon"/"evening" imply a real hour (15:00/18:00) even
    // though isCertain is false; keep those.
    const impliedHour = first.start.get("hour");
    if (
      !first.start.isCertain("hour") &&
      (impliedHour === 12 || impliedHour === now.getHours() || impliedHour === 6)
    ) {
      // 12 = chrono's bare-date noon, current-hour = "tomorrow" phrasing,
      // 6 = chrono's "morning". All land at 09:00 local instead.
      due.setHours(9, 0, 0, 0);
    }
    // Strip the date phrase (and an orphaned trailing preposition) from the title.
    title = (title.slice(0, first.index) + title.slice(first.index + first.text.length))
      .replace(/\s+(by|on|at|before|until)\s*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  if (title.length === 0) title = text.trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);

  const echo =
    due !== null
      ? `Captured: ${title}, due ${due.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}.`
      : `Captured: ${title}, no due date. I'll surface it in tomorrow's brief.`;

  return { title, due_at: due ? due.toISOString() : null, echo };
}

/** Nag time for a task with no due date: next morning-brief slot. */
export function defaultNagTime(morningBrief: string, now: Date = new Date()): Date {
  const [h = 8, m = 0] = morningBrief.split(":").map(Number);
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

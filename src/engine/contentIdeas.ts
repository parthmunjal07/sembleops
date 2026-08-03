import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  ContentIdea,
  ContentIdeaPriority,
  ContentIdeaSource,
  ContentIdeaStage,
} from "../shared/types.js";

const nowIso = (): string => new Date().toISOString();

type ContentIdeaRow = Omit<ContentIdea, "tags"> & { tags_json: string };

export interface ContentIdeaInput {
  title: string;
  hook?: string;
  angle?: string;
  audience?: string;
  notes?: string;
  stage?: ContentIdeaStage;
  priority?: ContentIdeaPriority;
  tags?: string[];
  source?: ContentIdeaSource;
  target_date?: string | null;
}

export interface ContentIdeaUpdate {
  title?: string;
  hook?: string;
  angle?: string;
  audience?: string;
  notes?: string;
  stage?: ContentIdeaStage;
  priority?: ContentIdeaPriority;
  tags?: string[];
  target_date?: string | null;
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function asIdea(row: ContentIdeaRow): ContentIdea {
  const { tags_json, ...idea } = row;
  return { ...idea, tags: parseTags(tags_json) };
}

function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#/, "").slice(0, 30);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === 8) break;
  }
  return out;
}

export class ContentIdeaStore {
  constructor(private readonly db: Database.Database) {}

  list(includeArchived = false): ContentIdea[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM content_ideas
         ${includeArchived ? "" : "WHERE archived_at IS NULL"}
         ORDER BY
           CASE stage
             WHEN 'inbox' THEN 1
             WHEN 'shaping' THEN 2
             WHEN 'ready' THEN 3
             WHEN 'drafting' THEN 4
           END,
           sort_order ASC,
           updated_at DESC`,
      )
      .all() as ContentIdeaRow[];
    return rows.map(asIdea);
  }

  get(id: string): ContentIdea | undefined {
    const row = this.db.prepare("SELECT * FROM content_ideas WHERE id = ?").get(id) as
      | ContentIdeaRow
      | undefined;
    return row ? asIdea(row) : undefined;
  }

  create(input: ContentIdeaInput): ContentIdea {
    const title = input.title.trim();
    if (!title || title.length > 240) {
      throw new Error("content idea title must be between 1 and 240 characters");
    }
    const stage = input.stage ?? "inbox";
    const at = nowIso();
    const idea: ContentIdea = {
      id: randomUUID(),
      title,
      hook: input.hook?.trim() ?? "",
      angle: input.angle?.trim() ?? "",
      audience: input.audience?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
      stage,
      priority: input.priority ?? "normal",
      tags: cleanTags(input.tags ?? []),
      source: input.source ?? "manual",
      sort_order: this.nextSortOrder(stage),
      target_date: input.target_date ?? null,
      created_at: at,
      updated_at: at,
      archived_at: null,
    };
    this.insert(idea);
    return idea;
  }

  importTitles(titles: string[]): { ideas: ContentIdea[]; skipped: number; skipped_titles: string[] } {
    const existing = new Set(
      this.list().map((idea) => idea.title.trim().toLocaleLowerCase()),
    );
    const ideas: ContentIdea[] = [];
    const skippedTitles: string[] = [];
    this.db.transaction(() => {
      for (const raw of titles) {
        const title = raw.trim();
        const key = title.toLocaleLowerCase();
        if (!title || existing.has(key)) {
          skippedTitles.push(title || "(blank line)");
          continue;
        }
        existing.add(key);
        ideas.push(this.create({ title, source: "import" }));
      }
    })();
    return { ideas, skipped: skippedTitles.length, skipped_titles: skippedTitles };
  }

  update(id: string, patch: ContentIdeaUpdate): ContentIdea | undefined {
    const current = this.get(id);
    if (!current || current.archived_at) return undefined;
    const stage = patch.stage ?? current.stage;
    const moved = stage !== current.stage;
    const next: ContentIdea = {
      ...current,
      title: patch.title?.trim() ?? current.title,
      hook: patch.hook?.trim() ?? current.hook,
      angle: patch.angle?.trim() ?? current.angle,
      audience: patch.audience?.trim() ?? current.audience,
      notes: patch.notes?.trim() ?? current.notes,
      stage,
      priority: patch.priority ?? current.priority,
      tags: patch.tags ? cleanTags(patch.tags) : current.tags,
      target_date: patch.target_date !== undefined ? patch.target_date : current.target_date,
      sort_order: moved ? this.nextSortOrder(stage) : current.sort_order,
      updated_at: nowIso(),
    };
    this.db
      .prepare(
        `UPDATE content_ideas SET
           title = @title,
           hook = @hook,
           angle = @angle,
           audience = @audience,
           notes = @notes,
           stage = @stage,
           priority = @priority,
           tags_json = @tags_json,
           sort_order = @sort_order,
           target_date = @target_date,
           updated_at = @updated_at
         WHERE id = @id AND archived_at IS NULL`,
      )
      .run({ ...next, tags_json: JSON.stringify(next.tags) });
    return this.get(id);
  }

  archive(id: string): ContentIdea | undefined {
    const at = nowIso();
    const result = this.db
      .prepare(
        "UPDATE content_ideas SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL",
      )
      .run(at, at, id);
    return result.changes > 0 ? this.get(id) : undefined;
  }

  move(id: string, stage: ContentIdeaStage, index: number): ContentIdea | undefined {
    const current = this.get(id);
    if (!current || current.archived_at) return undefined;
    const orderedIds = (column: ContentIdeaStage): string[] =>
      (this.db
        .prepare(
          `SELECT id FROM content_ideas
           WHERE stage = ? AND archived_at IS NULL AND id <> ?
           ORDER BY sort_order ASC, updated_at DESC`,
        )
        .all(column, id) as Array<{ id: string }>).map((row) => row.id);

    this.db.transaction(() => {
      if (current.stage !== stage) {
        const source = orderedIds(current.stage);
        const reindex = this.db.prepare("UPDATE content_ideas SET sort_order = ? WHERE id = ?");
        source.forEach((ideaId, position) => reindex.run(position, ideaId));
      }

      const destination = orderedIds(stage);
      const target = Math.max(0, Math.min(Math.trunc(index), destination.length));
      destination.splice(target, 0, id);
      const at = nowIso();
      const place = this.db.prepare(
        `UPDATE content_ideas SET
           stage = ?, sort_order = ?, updated_at = CASE WHEN id = ? THEN ? ELSE updated_at END
         WHERE id = ?`,
      );
      destination.forEach((ideaId, position) => place.run(stage, position, id, at, ideaId));
    })();

    return this.get(id);
  }

  private nextSortOrder(stage: ContentIdeaStage): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM content_ideas WHERE stage = ? AND archived_at IS NULL",
      )
      .get(stage) as { next: number };
    return row.next;
  }

  private insert(idea: ContentIdea): void {
    this.db
      .prepare(
        `INSERT INTO content_ideas
           (id, title, hook, angle, audience, notes, stage, priority, tags_json,
            source, sort_order, target_date, created_at, updated_at, archived_at)
         VALUES
           (@id, @title, @hook, @angle, @audience, @notes, @stage, @priority, @tags_json,
            @source, @sort_order, @target_date, @created_at, @updated_at, @archived_at)`,
      )
      .run({ ...idea, tags_json: JSON.stringify(idea.tags) });
  }
}

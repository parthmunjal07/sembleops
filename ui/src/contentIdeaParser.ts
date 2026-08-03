export type IdeaImportMode = "list" | "headings" | "lines";
export type IdeaImportSelection = "auto" | IdeaImportMode;

export interface ParsedIdeaDocument {
  titles: string[];
  mode: IdeaImportMode;
  modeLabel: string;
}

function markdownLinesOutsideFences(raw: string): string[] {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const visible: string[] = [];
  let fence: "`" | "~" | null = null;
  for (const line of lines) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (marker) {
      const markerKind = marker[0] as "`" | "~";
      if (fence === null) fence = markerKind;
      else if (fence === markerKind) fence = null;
      continue;
    }
    if (fence === null) visible.push(line);
  }
  return visible;
}

/** Parse idea titles without treating nested outlines or fenced code samples as cards. */
export function parseIdeaDocument(
  raw: string,
  selection: IdeaImportSelection = "auto",
): ParsedIdeaDocument {
  const lines = markdownLinesOutsideFences(raw);
  const listItems = lines.flatMap((line) => {
    const match = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+)$/);
    return match?.[1] !== undefined && match[2]
      ? [{ indent: match[1].replace(/\t/g, "    ").length, title: match[2].trim() }]
      : [];
  });
  const minimumListIndent = listItems.length > 0
    ? Math.min(...listItems.map((item) => item.indent))
    : 0;
  const listTitles = listItems
    .filter((item) => item.indent === minimumListIndent)
    .map((item) => item.title)
    .filter(Boolean);
  const headings = lines.flatMap((line) => {
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    return match?.[1] && match[2]
      ? [{ level: match[1].length, title: match[2].trim() }]
      : [];
  });
  const counts = new Map<number, number>();
  headings.forEach((heading) => counts.set(heading.level, (counts.get(heading.level) ?? 0) + 1));
  const repeatedLevels = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([level]) => level)
    .sort((a, b) => a - b);
  const chosenLevel = repeatedLevels.find((level) => level > 1) ?? repeatedLevels[0];
  const headingTitles = chosenLevel
    ? headings.filter((heading) => heading.level === chosenLevel).map((heading) => heading.title)
    : headings.map((heading) => heading.title);

  let mode: IdeaImportMode = "lines";
  let candidates: string[];
  if (selection === "list") {
    mode = "list";
    candidates = listTitles;
  } else if (selection === "headings") {
    mode = "headings";
    candidates = headingTitles;
  } else if (selection === "lines") {
    candidates = lines
      .map((line) => line.trim())
      .filter((line) => line && !/^(?:---|\*\*\*|___)$/.test(line))
      .map((line) => line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/, "")
        .trim());
  } else if (
    headingTitles.length >= 2
    && (listTitles.length === 0 || listTitles.length <= headingTitles.length * 2)
  ) {
    mode = "headings";
    candidates = headingTitles;
  } else if (listTitles.length > 0) {
    mode = "list";
    candidates = listTitles;
  } else {
    candidates = lines
      .map((line) => line.trim())
      .filter((line) => line && !/^(?:---|\*\*\*|___)$/.test(line))
      .map((line) => line.replace(/^#{1,6}\s+/, "").trim());
  }

  const seen = new Set<string>();
  const titles: string[] = [];
  for (const candidate of candidates) {
    const title = candidate.trim();
    if (!title) continue;
    const key = title.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
  }

  const modeLabel = mode === "list"
    ? "Top-level Markdown list"
    : mode === "headings"
      ? "Markdown headings"
      : "One idea per line";
  return { titles, mode, modeLabel };
}

export function parseIdeaText(raw: string): string[] {
  return parseIdeaDocument(raw).titles;
}

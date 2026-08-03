// Full-page reading view for a delegation packet. Agents return structured
// plain text (headings, bullets, numbered steps); this parses that shape and
// renders it with real typography instead of a <pre> wall.

import { useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { AgentBadge } from "./Badge";
import type { DelegationDetail, Meta } from "./types";

export type Block =
  | { kind: "h"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "cards"; items: { label: string | null; body: string }[] }
  | { kind: "flow"; items: string[] }
  | { kind: "verdict"; text: string };

const BULLET = /^[-•*]\s+/;
const NUMBERED = /^\d+[.)]\s+/;
const LABELED = /^([A-Z][A-Za-z0-9 /&'-]{1,38}):\s+(.+)$/;
const FLOW_HEADING = /workflow|steps|process|pipeline|flow|how it works/i;
const VERDICT_START = /^(top line|bottom line|verdict|publish recommendation|recommendation|overall)[:,-]\s*/i;

/** Second pass: recognize the visual shapes hiding in plain text. */
function visualize(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let lastHeading = "";
  for (const block of blocks) {
    if (block.kind === "h") {
      lastHeading = block.text;
      out.push(block);
      continue;
    }
    if (block.kind === "ul" && block.items.length >= 3) {
      // "Label: description" lists become a card grid.
      const parsed = block.items.map((item) => {
        const m = item.match(LABELED);
        return m ? { label: m[1] ?? null, body: m[2] ?? "" } : { label: null, body: item };
      });
      const labeled = parsed.filter((p) => p.label !== null).length;
      if (labeled >= Math.ceil(block.items.length * 0.7)) {
        out.push({ kind: "cards", items: parsed });
        continue;
      }
    }
    // Numbered steps under a flow heading become a stepper, including run-on
    // enumerations ("1) do this, 2) then this, 3) ...") on a single line.
    if ((block.kind === "ol" || block.kind === "p") && FLOW_HEADING.test(lastHeading)) {
      const source = block.kind === "ol" ? block.items.join(" ") : block.text;
      const parts = source
        .split(/,?\s*\d+[.)]\s+/)
        .map((s) => s.trim().replace(/[,;]$/, ""))
        .filter((s) => s.length > 0);
      const items = block.kind === "ol" && block.items.length >= 3 ? block.items : parts;
      if (items.length >= 3) {
        out.push({ kind: "flow", items });
        continue;
      }
    }
    if (block.kind === "p" && VERDICT_START.test(block.text)) {
      out.push({ kind: "verdict", text: block.text.replace(VERDICT_START, "") });
      continue;
    }
    out.push(block);
  }
  return out;
}

const CLASSIFICATION = /\b(Safe|Needs Source|Reword|Risky|Unknown)\b(?=[.,;)]|$)/;

/** Paige's per-claim labels render as colored badges. */
function classificationChip(text: string): ReactNode[] | null {
  if (!/classification/i.test(text)) return null;
  const m = text.match(CLASSIFICATION);
  if (!m || m.index === undefined) return null;
  const cls = (m[1] ?? "").toLowerCase().replace(" ", "-");
  return [
    <span key="pre">{inline(text.slice(0, m.index))}</span>,
    <span key="chip" className={`claim-chip claim-${cls}`}>{m[1]}</span>,
    <span key="post">{inline(text.slice(m.index + (m[1]?.length ?? 0)))}</span>,
  ];
}

function isHeading(line: string, prevBlank: boolean): boolean {
  return (
    prevBlank &&
    line.length <= 64 &&
    !BULLET.test(line) &&
    !NUMBERED.test(line) &&
    !/[.!?;]$/.test(line)
  );
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let prevBlank = true;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) {
      prevBlank = true;
      continue;
    }
    const last = blocks[blocks.length - 1];

    if (BULLET.test(line)) {
      const item = line.replace(BULLET, "");
      if (last?.kind === "ul") last.items.push(item);
      else blocks.push({ kind: "ul", items: [item] });
    } else if (NUMBERED.test(line)) {
      const item = line.replace(NUMBERED, "");
      if (last?.kind === "ol") last.items.push(item);
      else blocks.push({ kind: "ol", items: [item] });
    } else if (isHeading(line, prevBlank)) {
      blocks.push({ kind: "h", text: line });
    } else if (last?.kind === "p" && !prevBlank) {
      last.text += " " + line;
    } else {
      blocks.push({ kind: "p", text: line });
    }
    prevBlank = false;
  }
  return blocks;
}

/** Inline markdown that agents actually emit: **bold**, [links](url), `code`. */
function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const href = link[2] ?? "";
      const external = href.startsWith("http");
      return external ? (
        <a key={i} href={href} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      ) : (
        <span key={i} className="packet-path">{link[1]}</span>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function agentLabel(meta: Meta | null, slug: string): { name: string; role: string; color: string } {
  const p = meta?.personas?.[slug];
  return { name: p?.name ?? slug, role: p?.role ?? "Agent", color: p?.color ?? "#2563EB" };
}

function itemContent(item: string): ReactNode {
  return classificationChip(item) ?? inline(item);
}

export function Blocks({ text, leadFirst = false }: { text: string; leadFirst?: boolean }) {
  const all = visualize(parseBlocks(text));
  // The Appendix contract: agents park exhaustive detail below an "Appendix"
  // heading, and the reading surface stays short because we collapse it here.
  const appendixAt = all.findIndex((b) => b.kind === "h" && /^appendix\b/i.test(b.text));
  const blocks = appendixAt === -1 ? all : all.slice(0, appendixAt);
  const appendix = appendixAt === -1 ? [] : all.slice(appendixAt + 1);
  const firstParagraph = leadFirst ? blocks.findIndex((b) => b.kind === "p") : -1;
  return (
    <>
      {renderBlocks(blocks, firstParagraph)}
      {appendix.length > 0 && (
        <details className="packet-appendix">
          <summary>Appendix</summary>
          <div className="packet-appendix-body">{renderBlocks(appendix, -1)}</div>
        </details>
      )}
    </>
  );
}

function renderBlocks(blocks: Block[], firstParagraph: number) {
  return (
    <>
      {blocks.map((block, i) => {
        if (block.kind === "h") return <h3 key={i}>{inline(block.text)}</h3>;
        if (block.kind === "cards")
          return (
            <div key={i} className="packet-cards">
              {block.items.map((item, j) => (
                <div key={j} className={`p-card a${j % 6}`}>
                  {item.label && <div className="p-card-label">{item.label}</div>}
                  <div className="p-card-body">{itemContent(item.body)}</div>
                </div>
              ))}
            </div>
          );
        if (block.kind === "flow")
          return (
            <div key={i} className="packet-flow">
              {block.items.map((item, j) => (
                <div key={j} className="flow-step">
                  <div className="flow-marker">
                    <span className="flow-num">{j + 1}</span>
                    {j < block.items.length - 1 && <span className="flow-line" />}
                  </div>
                  <div className="flow-text">{inline(item)}</div>
                </div>
              ))}
            </div>
          );
        if (block.kind === "verdict")
          return (
            <div key={i} className="packet-verdict">
              <div className="verdict-kicker">Bottom line</div>
              <div className="verdict-text">{inline(block.text)}</div>
            </div>
          );
        if (block.kind === "ul")
          return (
            <ul key={i}>
              {block.items.map((item, j) => <li key={j}>{itemContent(item)}</li>)}
            </ul>
          );
        if (block.kind === "ol")
          return (
            <ol key={i}>
              {block.items.map((item, j) => <li key={j}>{itemContent(item)}</li>)}
            </ol>
          );
        return (
          <p key={i} className={i === firstParagraph ? "packet-lead" : ""}>
            {itemContent(block.text)}
          </p>
        );
      })}
    </>
  );
}

export function PacketView({
  meta,
  packetId,
  onBack,
  onResolved,
  onOpenPacket,
}: {
  meta: Meta | null;
  packetId: string;
  onBack: () => void;
  onResolved: () => void;
  onOpenPacket: (id: string) => void;
}) {
  const [detail, setDetail] = useState<DelegationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api
        .delegation(packetId)
        .then(setDetail)
        .catch((err) => setError((err as Error).message));
    load();
    // Verification children land asynchronously; keep the chain fresh.
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [packetId]);

  if (error) return <div className="packet-page"><div className="error">{error}</div></div>;
  if (!detail) return <div className="packet-page"><div className="empty">Loading packet...</div></div>;

  const d = detail.delegation;
  const agent = agentLabel(meta, d.agent);
  const verification = detail.children.find((c) => c.agent === "paige");
  const verificationPending =
    d.verify_requested === 1 && !verification && d.status === "needs_review";
  const resolve = (action: "reviewed" | "dismissed") =>
    api.reviewDelegation(d.id, action).then(() => {
      onResolved();
      onBack();
    });

  return (
    <div className="packet-page">
      <div className="packet-nav">
        <button className="btn ghost packet-back" onClick={onBack}>
          Back
        </button>
        {detail.parent && (
          <button className="btn ghost" onClick={() => onOpenPacket(detail.parent!.id)}>
            Original packet: {detail.parent.title.length > 44 ? detail.parent.title.slice(0, 44) + "..." : detail.parent.title}
          </button>
        )}
      </div>

      <header className="packet-head">
        <AgentBadge slug={d.agent} color={agent.color} size={56} />
        <div className="packet-head-copy">
          <h1>{d.title}</h1>
          <div className="packet-chips">
            <span className="packet-chip" style={{ color: agent.color }}>{agent.name}</span>
            <span className="packet-chip">{agent.role}</span>
            {d.project && <span className="packet-chip">{d.project}</span>}
            {d.runtime && <span className="packet-chip">{d.runtime}</span>}
            <span className="packet-chip">
              {new Date(d.finished_at ?? d.created_at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <span className={`packet-chip status-${d.status}`}>
              {d.status === "needs_review" ? "Review needed" : d.status.replace("_", " ")}
            </span>
          </div>
        </div>
      </header>

      <article className="packet-body">
        {d.error && <div className="error">{d.error}</div>}
        {d.result && <Blocks text={d.result} leadFirst />}
        {!d.result && !d.error && (d.status === "queued" || d.status === "running") && (
          <p className="packet-pending">Still working. This page fills in when the run completes.</p>
        )}
        {!d.result && !d.error && d.status !== "queued" && d.status !== "running" && (
          <div className="error">
            This run finished without producing any output. That usually means the model hit a hard
            length cap. Dismiss it and re-run the request; the empty-output guard now retries automatically.
          </div>
        )}
        {d.diff && (
          <details className="packet-diff">
            <summary>Working-tree changes</summary>
            <pre>{d.diff}</pre>
          </details>
        )}

        {(verification || verificationPending) && (
          <section className="packet-verification">
            <div className="verification-head">
              <AgentBadge slug="paige" color={agentLabel(meta, "paige").color} size={34} />
              <span className="verification-title">Paige's verification</span>
              {verification?.status === "needs_review" || verification?.status === "reviewed" ? (
                <span className="packet-chip status-reviewed">Complete</span>
              ) : verification?.status === "error" ? (
                <span className="packet-chip status-needs_review">Failed</span>
              ) : (
                <span className="packet-chip">In progress</span>
              )}
            </div>
            {verification?.result ? (
              <Blocks text={verification.result} />
            ) : verification?.error ? (
              <div className="error">{verification.error}</div>
            ) : (
              <p className="packet-pending">
                Paige is auditing the claims in this draft. Her findings will appear here.
              </p>
            )}
          </section>
        )}
      </article>

      {d.status === "needs_review" && (
        <footer className="packet-actions">
          <button className="btn done-solid" onClick={() => resolve("reviewed")}>
            Mark reviewed
          </button>
          <button className="btn ghost" onClick={() => resolve("dismissed")}>
            Dismiss
          </button>
        </footer>
      )}
    </div>
  );
}

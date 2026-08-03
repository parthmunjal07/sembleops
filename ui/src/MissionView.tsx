// Combined mission packet: one goal, every contributing agent's section in
// their own color, verification nested under the artifact it audited.

import { useEffect, useState } from "react";
import { api } from "./api";
import { AgentBadge } from "./Badge";
import { Blocks, parseBlocks, type Block } from "./PacketView";
import type { Delegation, Meta, MissionDetail } from "./types";

function agentInfo(meta: Meta | null, slug: string): { name: string; role: string; color: string } {
  const p = meta?.personas?.[slug];
  return { name: p?.name ?? slug, role: p?.role ?? "Agent", color: p?.color ?? "#2563EB" };
}

function statusChip(d: Delegation): { label: string; cls: string } {
  if (d.status === "needs_review") return { label: "Ready", cls: "status-reviewed" };
  if (d.status === "reviewed") return { label: "Reviewed", cls: "status-reviewed" };
  if (d.status === "error") return { label: "Failed", cls: "status-needs_review" };
  if (d.status === "dismissed") return { label: "Dismissed", cls: "" };
  return { label: d.status === "queued" ? "Queued" : "Working", cls: "" };
}

type ClaimKind = "Safe" | "Needs Source" | "Reword" | "Risky" | "Unknown";

interface MissionDigest {
  summary: string | null;
  verdict: string | null;
  sections: string[];
  claimCounts: Partial<Record<ClaimKind, number>>;
}

const CLAIMS: ClaimKind[] = ["Safe", "Needs Source", "Reword", "Risky", "Unknown"];
const VERDICT_START = /^(top line|bottom line|verdict|publish recommendation|recommendation|overall)[:,-]\s*/i;

function tidy(text: string): string {
  return text
    .replace(/^(one[- ]paragraph\s+)?summary[:,-]\s*/i, "")
    .replace(/^publish recommendation[:,-]\s*/i, "")
    .trim();
}

function clamp(text: string, max = 300): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(", "));
  return `${cut.slice(0, sentence > 160 ? sentence + 1 : max).trim()}...`;
}

function paragraphAfter(blocks: Block[], heading: RegExp): string | null {
  const index = blocks.findIndex((b) => b.kind === "h" && heading.test(b.text));
  if (index === -1) return null;
  const next = blocks.slice(index + 1).find((b) => b.kind === "p");
  return next?.kind === "p" ? tidy(next.text) : null;
}

function digestText(text: string | null): MissionDigest {
  if (!text) return { summary: null, verdict: null, sections: [], claimCounts: {} };
  const blocks = parseBlocks(text);
  const firstParagraph = blocks.find((b) => b.kind === "p");
  const summary =
    paragraphAfter(blocks, /^summary$/i) ??
    (firstParagraph?.kind === "p" ? tidy(firstParagraph.text) : null);
  const verdictBlock = blocks.find((b) => b.kind === "p" && VERDICT_START.test(b.text));
  const verdict = verdictBlock?.kind === "p" ? tidy(verdictBlock.text.replace(VERDICT_START, "")) : null;
  const sections = blocks
    .filter((b): b is Extract<Block, { kind: "h" }> => b.kind === "h")
    .map((b) => b.text.replace(/:$/, ""))
    .filter((h) => !/^summary$/i.test(h) && !/^bottom line$/i.test(h))
    .slice(0, 4);
  const claimCounts: Partial<Record<ClaimKind, number>> = {};
  for (const claim of CLAIMS) {
    const count = text.match(new RegExp(`\\b${claim.replace(" ", "\\s+")}\\b`, "g"))?.length ?? 0;
    if (count > 0) claimCounts[claim] = count;
  }
  return {
    summary: summary ? clamp(summary) : null,
    verdict: verdict ? clamp(verdict, 240) : null,
    sections,
    claimCounts,
  };
}

function MissionDigestView({
  digest,
  fallback,
  verification = false,
}: {
  digest: MissionDigest;
  fallback: string;
  verification?: boolean;
}) {
  const claimEntries = Object.entries(digest.claimCounts) as [ClaimKind, number][];
  return (
    <div className={`mission-digest ${verification ? "verification-digest" : ""}`}>
      <p>{digest.summary ?? fallback}</p>
      {digest.verdict && (
        <div className="mission-bottomline">
          <span>Bottom line</span>
          {digest.verdict}
        </div>
      )}
      {(digest.sections.length > 0 || claimEntries.length > 0) && (
        <div className="mission-digest-meta">
          {digest.sections.map((section) => (
            <span key={section}>{section}</span>
          ))}
          {claimEntries.map(([claim, count]) => (
            <span key={claim} className={`claim-count claim-${claim.toLowerCase().replace(" ", "-")}`}>
              {count} {claim}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function MissionView({
  meta,
  missionId,
  onBack,
  onResolved,
  onOpenPacket,
}: {
  meta: Meta | null;
  missionId: string;
  onBack: () => void;
  onResolved: () => void;
  onOpenPacket: (id: string) => void;
}) {
  const [detail, setDetail] = useState<MissionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api
        .mission(missionId)
        .then(setDetail)
        .catch((err) => setError((err as Error).message));
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [missionId]);

  if (error) return <div className="packet-page"><div className="error">{error}</div></div>;
  if (!detail) return <div className="packet-page"><div className="empty">Loading mission...</div></div>;

  const roots = detail.delegations.filter((d) => d.parent_id === null);
  const childrenOf = (id: string) => detail.delegations.filter((d) => d.parent_id === id);
  const pending = detail.delegations.filter((d) => d.status === "needs_review");
  const working = detail.delegations.filter((d) => d.status === "queued" || d.status === "running");
  const contributors = [...new Set(detail.delegations.map((d) => d.agent))];
  const finishedRoots = roots.filter((d) => d.status !== "queued" && d.status !== "running").length;
  const finishedVerifications = detail.delegations.filter(
    (d) => d.parent_id !== null && d.status !== "queued" && d.status !== "running",
  ).length;

  const resolveAll = () =>
    Promise.all(pending.map((d) => api.reviewDelegation(d.id, "reviewed"))).then(() => {
      onResolved();
      onBack();
    });

  return (
    <div className="packet-page">
      <div className="packet-nav">
        <button className="btn ghost packet-back" onClick={onBack}>Back</button>
      </div>

      <header className="packet-head mission-head">
        <div className="packet-head-copy">
          <div className="mission-kicker">Mission</div>
          <h1>{detail.goal?.user_text ?? roots[0]?.title ?? "Mission"}</h1>
          {detail.goal?.reply && <p className="mission-reply">{detail.goal.reply}</p>}
          <div className="mission-crew">
            {contributors.map((slug) => {
              const info = agentInfo(meta, slug);
              const done = detail.delegations
                .filter((d) => d.agent === slug)
                .every((d) => d.status !== "queued" && d.status !== "running");
              return (
                <span key={slug} className="crew-chip" style={{ borderColor: `${info.color}55` }}>
                  <AgentBadge slug={slug} color={info.color} size={24} />
                  {info.name}
                  <span className={`status-dot ${done ? "on" : ""}`} />
                </span>
              );
            })}
            {working.length > 0 && (
              <span className="packet-chip">{working.length} still working</span>
            )}
          </div>
          <div className="mission-overview" aria-label="Mission progress">
            <div>
              <span>{roots.length}</span>
              work packets
            </div>
            <div>
              <span>{finishedRoots}</span>
              finished packets
            </div>
            <div>
              <span>{finishedVerifications}</span>
              verifications
            </div>
            <div>
              <span>{pending.length}</span>
              awaiting review
            </div>
          </div>
        </div>
      </header>

      {roots.map((d) => {
        const info = agentInfo(meta, d.agent);
        const chip = statusChip(d);
        const kids = childrenOf(d.id);
        return (
          <section key={d.id} className="mission-section" style={{ borderLeftColor: info.color }}>
            <div className="mission-section-head" style={{ background: `${info.color}14` }}>
              <AgentBadge slug={d.agent} color={info.color} size={38} />
              <div className="mission-section-copy">
                <span className="mission-agent" style={{ color: info.color }}>{info.name}</span>
                <span className="mission-task">{d.title}</span>
              </div>
              <span className={`packet-chip ${chip.cls}`}>{chip.label}</span>
              <button className="btn small ghost" onClick={() => onOpenPacket(d.id)}>Open</button>
            </div>
            <div className="mission-section-body packet-body">
              {d.result && (
                <>
                  <MissionDigestView
                    digest={digestText(d.result)}
                    fallback={`${info.name} finished this packet. Open the full detail below when you need the source text.`}
                  />
                  <details className="mission-full-detail">
                    <summary>Full {info.name} packet</summary>
                    <div className="mission-full-content">
                      <Blocks text={d.result} />
                    </div>
                  </details>
                </>
              )}
              {d.error && <div className="error">{d.error}</div>}
              {!d.result && !d.error && (
                <p className="packet-pending">
                  {agentInfo(meta, d.agent).name} is still working. This section fills in when the run completes.
                </p>
              )}
              {d.diff && (
                <details className="packet-diff">
                  <summary>Working-tree changes</summary>
                  <pre>{d.diff}</pre>
                </details>
              )}
              {kids.map((kid) => {
                const kidInfo = agentInfo(meta, kid.agent);
                return (
                  <div key={kid.id} className="packet-verification">
                    <div className="verification-head">
                      <AgentBadge slug={kid.agent} color={kidInfo.color} size={30} />
                      <span className="verification-title">{kidInfo.name}'s verification</span>
                      {kid.status === "needs_review" || kid.status === "reviewed" ? (
                        <span className="packet-chip status-reviewed">Complete</span>
                      ) : kid.status === "error" ? (
                        <span className="packet-chip status-needs_review">Failed</span>
                      ) : kid.status === "dismissed" ? (
                        <span className="packet-chip">Dismissed</span>
                      ) : (
                        <span className="packet-chip">In progress</span>
                      )}
                    </div>
                    {kid.result ? (
                      <>
                        <MissionDigestView
                          digest={digestText(kid.result)}
                          fallback={`${kidInfo.name} finished verification. Open the full audit below for every claim note.`}
                          verification
                        />
                        <details className="mission-full-detail verification-full">
                          <summary>Full verification notes</summary>
                          <div className="mission-full-content">
                            <Blocks text={kid.result} />
                          </div>
                        </details>
                      </>
                    ) : kid.error ? (
                      <div className="error">{kid.error}</div>
                    ) : kid.status === "queued" || kid.status === "running" ? (
                      <p className="packet-pending">Auditing the claims in this section.</p>
                    ) : (
                      <p className="packet-pending">
                        Verification finished but the summary is unavailable here.{" "}
                        <button className="btn small ghost" onClick={() => onOpenPacket(kid.id)}>
                          Open the full audit
                        </button>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {pending.length > 0 && (
        <footer className="packet-actions">
          <button className="btn done-solid" onClick={resolveAll}>
            Mark all reviewed ({pending.length})
          </button>
        </footer>
      )}
    </div>
  );
}

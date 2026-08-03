import type { CSSProperties, ReactElement } from "react";

const fallbackGlyph: Record<string, (c: string) => ReactElement> = {
  marco: (c) => (
    <>
      <circle cx="20" cy="14" r="2.6" fill={c} />
      <circle cx="13.5" cy="19.5" r="2" fill={c} opacity="0.72" />
      <circle cx="26.5" cy="19.5" r="2" fill={c} opacity="0.72" />
      <path d="m15.1 18 3.1-2.7m6.7 2.7-3.1-2.7M15.5 20h9" stroke={c} strokeWidth="1.7" fill="none" strokeLinecap="round" />
    </>
  ),
  larry: (c) => (
    <>
      <path d="M13.5 13.5h13v13h-13z" stroke={c} strokeWidth="2" fill="none" strokeLinejoin="round" />
      <path d="m16.5 18 1.8 1.8 4-4M16.5 23h6.5" stroke={c} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  penny: (c) => (
    <>
      <path d="M14 13.5h10l2 2v11H14z" stroke={c} strokeWidth="1.8" fill="none" strokeLinejoin="round" />
      <path d="m17 23 7-7 2 2-7 7-2 .5z" stroke={c} strokeWidth="1.7" fill="none" strokeLinejoin="round" />
    </>
  ),
  paige: (c) => (
    <>
      <path d="M20 12.5 27 15v5.2c0 4-2.8 6.4-7 8.3-4.2-1.9-7-4.3-7-8.3V15z" stroke={c} strokeWidth="1.9" fill="none" strokeLinejoin="round" />
      <path d="m16.8 20.2 2.1 2.1 4.6-4.7" stroke={c} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  sam: (c) => (
    <>
      <circle cx="18.5" cy="18.5" r="5.5" stroke={c} strokeWidth="2" fill="none" />
      <path d="m22.6 22.6 4.2 4.2M17 20l2-4 1 3z" stroke={c} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  dex: (c) => (
    <>
      <path d="m16 14-6 6 6 6" stroke={c} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m24 14 6 6-6 6" stroke={c} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 13.5h14" stroke={c} strokeWidth="2.2" strokeLinecap="round" opacity="0.72" />
    </>
  ),
  default: (c) => (
    <>
      <path d="M13.5 23.8 24 13.3" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="25.2" cy="12.2" r="3.1" fill={c} />
    </>
  ),
};

export function AgentBadge({
  slug,
  color,
  size = 40,
}: {
  slug: string;
  color: string;
  size?: number;
}) {
  const glyph = fallbackGlyph[slug] ?? fallbackGlyph.default;
  return (
    <span
      className="agent-badge"
      data-agent={slug}
      style={
        {
          width: size,
          height: size,
          borderColor: `${color}55`,
          "--agent-color": color,
        } as CSSProperties
      }
    >
      <svg width={size * 0.86} height={size * 0.86} viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="22" r="13.5" fill="#fff" opacity="0.84" />
        <path d="M10.6 33.2c1.8-5.1 5.2-7.7 9.4-7.7s7.6 2.6 9.4 7.7" fill={color} opacity="0.2" />
        <circle cx="15.8" cy="20.5" r="1.4" fill="#10204a" opacity="0.78" />
        <circle cx="24.2" cy="20.5" r="1.4" fill="#10204a" opacity="0.78" />
        <path d="M17 25.2c2 1.4 4 1.4 6 0" stroke="#10204a" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.54" />
        <g className="agent-role-glyph">{glyph(color)}</g>
      </svg>
    </span>
  );
}

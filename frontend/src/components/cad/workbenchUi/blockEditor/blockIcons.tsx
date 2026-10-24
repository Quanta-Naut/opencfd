import React from 'react';

// Blocking has no stock icons: these draw what each tool does to the
// topology, in Lucide's 24px / stroke 2 style so they sit beside it.

type IconProps = { className?: string };

const Svg = ({ className, children }: IconProps & { children: React.ReactNode }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

/** One dashed block around a body. */
export const InitBlockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="1" strokeDasharray="3 3" />
    <path d="M7 13c2-3 8-3 10 0c-2 1.5-8 1.5-10 0z" />
  </Svg>
);

/** A block and its four corner vertices. */
export const CreateBlockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="5" width="14" height="14" />
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="5" r="2.5" />
      <circle cx="19" cy="5" r="2.5" />
      <circle cx="5" cy="19" r="2.5" />
      <circle cx="19" cy="19" r="2.5" />
    </g>
  </Svg>
);

/** A block ringed by four: the inner square and its corner spokes. */
export const OGridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="1" />
    <rect x="8.5" y="8.5" width="7" height="7" />
    <path d="M3 3l5.5 5.5M21 3l-5.5 5.5M3 21l5.5-5.5M21 21l-5.5-5.5" />
  </Svg>
);

/** A straight block edge pulled onto a curve. */
export const AssociateIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 19h16" strokeDasharray="2.5 3" />
    <path d="M4 19C5 5 19 5 20 19" />
    <g fill="currentColor" stroke="none">
      <circle cx="4" cy="19" r="2.5" />
      <circle cx="20" cy="19" r="2.5" />
    </g>
  </Svg>
);

// Nodes bunched toward the left end, as a graded edge looks.
const GRADED = [4, 6.5, 10, 14.5, 20];
const nodes = (y: number, h: number) => GRADED.map((x) => `M${x} ${y - h}v${2 * h}`).join('');

/** One edge's node distribution. */
export const EdgeParamsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12h16" />
    <path d={nodes(12, 4)} strokeWidth={1.5} />
  </Svg>
);

/** A reference edge's distribution copied onto another. */
export const MatchSpacingIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h16M4 18h16" />
    <path d={nodes(6, 2.5) + nodes(18, 2.5)} strokeWidth={1.5} />
    <path d="M12 9.5v5M10 12.5l2 2 2-2" strokeWidth={1.5} />
  </Svg>
);

/** Two vertices drawn into one. */
export const MergeVerticesIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="6" r="2" />
    <circle cx="5" cy="18" r="2" />
    <path d="M7 7l7.5 4M7 17l7.5-4" />
    <circle cx="18" cy="12" r="3" fill="currentColor" />
  </Svg>
);

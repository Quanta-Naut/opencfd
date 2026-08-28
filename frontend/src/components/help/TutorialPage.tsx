import React, { useEffect, useRef, useState } from 'react';

/* Standalone how-to guide at /tutorial. No canvas - instructions + SVG diagrams,
   with a sticky section nav on the left. */

const C = {
  fluid: '#EFF6FF',
  boundary: '#1D4ED8',
  wall: '#D97706',
  inlet: '#2563EB',
  outlet: '#DC2626',
  sym: '#9333EA',
  far: '#0891B2',
  ink: '#171A1F',
  mut: '#69717D',
  line: '#CBD5E1',
};

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'airfoil', label: 'External flow around a body' },
  { id: 'windtunnel', label: 'Wind tunnel / flow over a wedge' },
  { id: 'internal', label: 'Internal flow (pipe / channel)' },
  { id: 'inside-box', label: 'A body floating inside a box' },
  { id: 'tags', label: 'Boundary tag reference' },
  { id: 'mesh', label: 'Meshing' },
  { id: 'axisymmetric', label: 'Axisymmetric' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
];

/* ── small building blocks ────────────────────────────────────────────────── */

const Key: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="px-1.5 py-0.5 rounded border border-[#D1D5DB] bg-[#F5F6F8] text-[11px] font-mono">{children}</kbd>
);

const Tag: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span className="inline-flex items-center gap-1 font-semibold whitespace-nowrap" style={{ color }}>
    <span className="w-2 h-2 rounded-full" style={{ background: color }} />{children}
  </span>
);

const Steps: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ol className="space-y-2.5 my-3">{children}</ol>
);
const S: React.FC<{ n: number; children: React.ReactNode }> = ({ n, children }) => (
  <li className="flex gap-3 text-[13px] leading-relaxed text-[#374151]">
    <span className="w-5 h-5 mt-0.5 rounded-full bg-[#2563EB] text-white text-[11px] font-bold flex items-center justify-center shrink-0">{n}</span>
    <div>{children}</div>
  </li>
);

const Note: React.FC<{ tone?: 'info' | 'warn'; children: React.ReactNode }> = ({ tone = 'info', children }) => (
  <div className={`my-3 p-3 rounded-lg text-[12px] leading-relaxed border ${
    tone === 'warn' ? 'bg-amber-50 border-amber-200 text-[#92400E]' : 'bg-blue-50 border-blue-200 text-[#1D4ED8]'
  }`}>{children}</div>
);

const Fig: React.FC<{ children: React.ReactNode; caption?: string }> = ({ children, caption }) => (
  <figure className="my-4 border border-[#E1E4E8] rounded-xl bg-[#FAFBFC] p-4 max-w-md">
    <svg viewBox="0 0 260 160" className="w-full">{children}</svg>
    {caption && <figcaption className="text-[11px] text-[#69717D] mt-2">{caption}</figcaption>}
  </figure>
);

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section id={id} className="scroll-mt-6 pt-2 pb-10 border-b border-[#EDF0F3] last:border-0">
    <h2 className="text-[17px] font-bold text-[#171A1F] mb-3">{title}</h2>
    {children}
  </section>
);

/* ── diagrams ─────────────────────────────────────────────────────────────── */

const wedgePath = 'M20,120 L95,120 L120,80 L138,80 L160,120 L235,120 L235,25 L20,25 Z';

const DiagOverview = () => (
  <>
    <g>
      <rect x="12" y="18" width="70" height="55" fill={C.fluid} stroke={C.far} strokeWidth={1.5} strokeDasharray="4 3" />
      <path d="M34 45 q6 -5 16 0 q-8 4 -16 0Z" fill={C.ink} />
      <text x="14" y="88" fontSize="8" fill={C.mut} fontFamily="monospace">auto far-field</text>
    </g>
    <g>
      <path d="M96,73 L120,50 L134,50 L150,73 L178,73 L178,18 L96,18 Z" fill={C.fluid} stroke={C.boundary} strokeWidth={1.8} />
      <text x="98" y="88" fontSize="8" fill={C.mut} fontFamily="monospace">you draw the box</text>
    </g>
    <g>
      <path d="M196,20 h48 v50 h-48 Z M204,30 h32 v30 h-32 Z" fill={C.fluid} stroke={C.boundary} strokeWidth={1.5} fillRule="evenodd" />
      <text x="196" y="88" fontSize="8" fill={C.mut} fontFamily="monospace">internal</text>
    </g>
    <text x="12" y="115" fontSize="9" fill={C.ink} fontFamily="monospace">Three ways to define the fluid region</text>
  </>
);

const DiagFarfield = () => (
  <>
    <circle cx="130" cy="80" r="62" fill={C.fluid} stroke={C.far} strokeWidth={2} strokeDasharray="5 4" />
    <path d="M108,80 q22 -14 46 0 q-24 10 -46 0Z" fill={C.ink} />
    <line x1="70" y1="80" x2="86" y2="80" stroke={C.inlet} strokeWidth={2.5} />
    <text x="40" y="83" fontSize="9" fill={C.far} fontFamily="monospace">farfield</text>
    <text x="150" y="150" fontSize="9" fill={C.mut} fontFamily="monospace">Generate far-field domain →</text>
  </>
);

const DiagTrace = () => (
  <>
    <path d={wedgePath} fill={C.fluid} stroke={C.boundary} strokeWidth={2.2} />
    <circle cx="20" cy="120" r="4" fill={C.boundary} />
    <text x="6" y="140" fontSize="8" fill={C.mut} fontFamily="monospace">start / close here</text>
    <text x="40" y="134" fontSize="10" fill={C.boundary} fontFamily="monospace">▶</text>
    <text x="185" y="20" fontSize="10" fill={C.boundary} fontFamily="monospace">◀</text>
    <text x="112" y="108" fontSize="8" fill={C.wall} fontFamily="monospace">wedge</text>
  </>
);

const DiagTags = () => (
  <>
    <path d={wedgePath} fill={C.fluid} stroke={C.line} strokeWidth={1} />
    <line x1="20" y1="120" x2="20" y2="25" stroke={C.inlet} strokeWidth={3.5} />
    <line x1="235" y1="120" x2="235" y2="25" stroke={C.outlet} strokeWidth={3.5} />
    <line x1="20" y1="25" x2="235" y2="25" stroke={C.sym} strokeWidth={3.5} />
    <line x1="20" y1="120" x2="95" y2="120" stroke={C.sym} strokeWidth={3.5} />
    <line x1="160" y1="120" x2="235" y2="120" stroke={C.sym} strokeWidth={3.5} />
    <line x1="95" y1="120" x2="120" y2="80" stroke={C.wall} strokeWidth={3.5} />
    <line x1="120" y1="80" x2="138" y2="80" stroke={C.wall} strokeWidth={3.5} />
    <line x1="138" y1="80" x2="160" y2="120" stroke={C.wall} strokeWidth={3.5} />
    <g fontSize="8" fontFamily="monospace">
      <text x="110" y="17" fill={C.sym}>symmetry (top)</text>
      <text x="2" y="76" fill={C.inlet} transform="rotate(-90 8 76)">inlet</text>
      <text x="245" y="76" fill={C.outlet} transform="rotate(-90 251 76)">outlet</text>
      <text x="30" y="138" fill={C.sym}>symmetry (floor)</text>
      <text x="112" y="70" fill={C.wall}>wall</text>
    </g>
  </>
);

const DiagPipe = () => (
  <>
    <path d="M20,45 L240,45 L240,70 L150,70 L150,115 L240,115 L240,140 L20,140 Z" fill={C.fluid} stroke={C.line} strokeWidth={1} />
    <line x1="20" y1="45" x2="20" y2="140" stroke={C.inlet} strokeWidth={3.5} />
    <line x1="240" y1="45" x2="240" y2="70" stroke={C.outlet} strokeWidth={3.5} />
    <line x1="240" y1="115" x2="240" y2="140" stroke={C.outlet} strokeWidth={3.5} />
    <path d="M20,45 L240,45 M240,70 L150,70 L150,115 L240,115 M20,140 L240,140" fill="none" stroke={C.wall} strokeWidth={3.5} />
    <g fontSize="8" fontFamily="monospace">
      <text x="2" y="98" fill={C.inlet} transform="rotate(-90 8 98)">inlet</text>
      <text x="90" y="38" fill={C.wall}>wall</text>
      <text x="246" y="60" fill={C.outlet}>outlet</text>
    </g>
  </>
);

const DiagInsideBox = () => (
  <>
    <rect x="22" y="22" width="216" height="116" fill={C.fluid} stroke={C.boundary} strokeWidth={2} />
    <path d="M112,58 L150,80 L112,102 L96,80 Z" fill="#fff" stroke={C.wall} strokeWidth={2} />
    <text x="70" y="128" fontSize="8" fill={C.wall} fontFamily="monospace">separate closed loop = automatic hole</text>
  </>
);

const DiagBad = () => (
  <>
    <rect x="22" y="22" width="216" height="104" fill="none" stroke={C.line} strokeWidth={2} />
    <path d="M95,132 L125,80 L160,132 Z" fill="none" stroke={C.outlet} strokeWidth={2} />
    <line x1="60" y1="126" x2="200" y2="126" stroke={C.outlet} strokeWidth={2} strokeDasharray="3 2" />
    <text x="50" y="150" fontSize="8.5" fill={C.outlet} fontFamily="monospace">wedge edge crosses the box edge - invalid ✗</text>
  </>
);

/* ── page ─────────────────────────────────────────────────────────────────── */

export const TutorialPage: React.FC = () => {
  const [active, setActive] = useState('overview');
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: '-10% 0px -70% 0px', threshold: 0 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const back = (e: React.MouseEvent) => {
    e.preventDefault();
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/';
  };

  return (
    <div className="h-screen w-screen flex bg-white text-[#171A1F] overflow-hidden [user-select:text]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* sidebar */}
      <aside className="w-64 shrink-0 border-r border-[#E1E4E8] bg-[#FAFBFC] flex flex-col">
        <div className="p-4 border-b border-[#E1E4E8]">
          <a href="/" onClick={back} className="text-[12px] text-[#2563EB] font-medium hover:underline">← Back to OpenCFD</a>
          <h1 className="text-[15px] font-bold mt-2">How-to guide</h1>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {SECTIONS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => go(s.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-[12px] leading-snug transition-colors ${
                active === s.id ? 'bg-blue-50 text-[#1D4ED8] font-semibold' : 'text-[#69717D] hover:bg-[#F1F3F5] hover:text-[#171A1F]'
              }`}
            >
              <span className="font-mono text-[10px] mr-1.5 opacity-60">{String(i + 1).padStart(2, '0')}</span>
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* content */}
      <div ref={mainRef} className="flex-1 overflow-y-auto min-h-0" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="max-w-2xl mx-auto px-8 py-8">

          <Section id="overview" title="Overview - the three ways to set up a domain">
            <p className="text-[13px] leading-relaxed text-[#374151]">
              Before you can mesh, the app needs to know the <b>fluid region</b>. There are three
              patterns, chosen in the <b>Geometry ▸ Domain</b> section:
            </p>
            <Fig caption="Left: auto far-field. Middle: you trace the outer box. Right: internal flow.">
              <DiagOverview />
            </Fig>
            <p className="text-[13px] leading-relaxed text-[#374151]">
              Under <b>Domain</b>, first pick <b>External</b> or <b>Internal</b> flow, then:
            </p>
            <ul className="text-[13px] leading-relaxed text-[#374151] space-y-1.5 list-disc ml-5">
              <li><b>External → Generate far-field domain</b> - the app wraps an auto box / C-grid / circle around an imported or drawn body. Best for airfoils and isolated bodies.</li>
              <li><b>External → Use selected loop as the domain</b> - you draw your own outer boundary (a wind tunnel), select it, and pin it. Best for flow over a ramp/wedge, a backward-facing step, wall-mounted bodies.</li>
              <li><b>Internal</b> - the geometry walls <i>are</i> the fluid boundary. Best for pipes and channels.</li>
            </ul>
            <p className="text-[13px] leading-relaxed text-[#374151] mt-2">
              After the domain is set you <b>tag every boundary edge</b>, then <b>Generate mesh</b>.
            </p>
          </Section>

          <Section id="airfoil" title="External flow around a body (auto far-field)">
            <Steps>
              <S n={1}>In <b>Geometry ▸ Geometry</b>, import a <Key>.dat</Key>/<Key>.csv</Key> airfoil or a DXF, or draw a closed profile.</S>
              <S n={2}>Open <b>Geometry ▸ Domain</b>. Keep <b>Flow type = External</b>. Pick a far-field shape (Box / C-grid / Farfield) and a size preset, or type your own clearance in chords.</S>
              <S n={3}>Click <b>Generate far-field domain</b>. A dashed boundary appears with drag handles you can pull to resize.</S>
              <S n={4}>Open <b>Boundary patches</b>. Set flow direction, then <b>Auto-tag from flow direction</b> - or click edges by hand: far-field ring → <Tag color={C.far}>farfield</Tag>, body → <Tag color={C.wall}>wall</Tag>. For a Box you can instead use <Tag color={C.inlet}>inlet</Tag> / <Tag color={C.outlet}>outlet</Tag> / <Tag color={C.sym}>symmetry</Tag>.</S>
              <S n={5}>Open the <b>Mesh</b> tab and press <b>Generate mesh</b>.</S>
            </Steps>
            <Fig caption="Auto far-field circle around an airfoil.">
              <DiagFarfield />
            </Fig>
          </Section>

          <Section id="windtunnel" title="Wind tunnel / flow over a wedge">
            <Note>
              <b>Key idea:</b> the fluid is <b>one connected area</b> - a box with a bite taken out where
              the wedge sits. Trace <b>one closed loop</b> around the whole fluid boundary, going up and
              over the wedge. Do <b>not</b> draw the box and the wedge as two separate shapes.
            </Note>
            <Steps>
              <S n={1}>
                Turn <b>SNAP</b> on (top bar) and draw the boundary <b>any way you like</b> - the Line
                tool, the Pline tool, or a Rectangle you then cut with <b>Trim</b>, or an imported
                <Key>.dat</Key>/<Key>.csv</Key>/<Key>DXF</Key>. Just walk the entire fluid outline as
                one closed path:
                <div className="mt-1.5 text-[12px] text-[#69717D] pl-3 border-l-2 border-[#E1E4E8]">
                  bottom-left → along the floor to the toe of the wedge → up the ramp → across the wedge
                  top → down the back to the floor → along the floor to bottom-right → up the right wall →
                  left across the top → down the left wall → back to the start.
                </div>
                Endpoints must meet exactly (that's what SNAP is for).
              </S>
              <S n={2}>Open <b>Boundary patches</b> and tag each edge of the loop (see diagram): left → <Tag color={C.inlet}>inlet</Tag>, right → <Tag color={C.outlet}>outlet</Tag>, every wedge face → <Tag color={C.wall}>wall</Tag>, the top and both floor segments → <Tag color={C.sym}>symmetry</Tag>. Every segment needs a tag.</S>
              <S n={3}>Open <b>Domain</b>, keep <b>Flow type = External</b>. Switch to the <b>Select</b> tool, drag a box around the whole boundary to select every segment, then click <b>“Use selected loop as the domain”</b> (below “Generate far-field domain”). A green ✓ confirms it's pinned.</S>
              <S n={4}>Open the <b>Mesh</b> tab and press <b>Generate mesh</b>.</S>
            </Steps>
            <Fig caption="Walk the whole boundary as one closed path, detouring over the wedge.">
              <DiagTrace />
            </Fig>
            <Fig caption="Then tag every edge.">
              <DiagTags />
            </Fig>
            <p className="text-[12px] text-[#69717D]">
              Loose segments drawn with the Line tool are fine - the mesher stitches them into one loop
              and carries your edge tags across. The only rule is that the segments form a single closed
              boundary.
            </p>
          </Section>

          <Section id="internal" title="Internal flow (pipe / channel)">
            <Steps>
              <S n={1}>Draw the channel outline as one closed loop (any tool) - the walls, the inlet mouth and the outlet mouth.</S>
              <S n={2}>Open <b>Domain</b> and set <b>Flow type = Internal</b>. No outer domain is generated; the loop you drew is the fluid boundary. (If you had a far-field box, switching to Internal removes it.)</S>
              <S n={3}>In <b>Boundary patches</b>: the open ends → <Tag color={C.inlet}>inlet</Tag> / <Tag color={C.outlet}>outlet</Tag>, the solid sides → <Tag color={C.wall}>wall</Tag>.</S>
              <S n={4}><b>Mesh</b> tab → <b>Generate mesh</b>.</S>
            </Steps>
            <Fig caption="A step channel: one closed loop, ends tagged inlet/outlet, sides wall.">
              <DiagPipe />
            </Fig>
          </Section>

          <Section id="inside-box" title="A body floating inside a box">
            <p className="text-[13px] leading-relaxed text-[#374151]">
              If the body does <b>not</b> touch a wall (a cylinder, a diamond, a wedge suspended in the
              stream), draw the box as one closed loop <i>and</i> the body as its own separate closed
              loop. The mesher automatically treats the inner loop as a hole.
            </p>
            <Fig caption="Box loop + body loop. The mesher subtracts the inner loop.">
              <DiagInsideBox />
            </Fig>
            <Note tone="warn">
              This only works when the inner loop is fully inside the outer one. A wall-mounted wedge
              drawn as a separate triangle crosses the box edge and produces an invalid mesh - trace one
              loop instead (see “Wind tunnel”).
            </Note>
            <Fig caption="Anti-pattern: overlapping shapes.">
              <DiagBad />
            </Fig>
          </Section>

          <Section id="tags" title="Boundary tag reference">
            <div className="space-y-2 text-[13px] text-[#374151]">
              <p><Tag color={C.inlet}>inlet</Tag> - flow enters. Velocity or pressure specified. At least one required.</p>
              <p><Tag color={C.outlet}>outlet</Tag> - flow leaves. Zero gauge pressure by default. At least one required.</p>
              <p><Tag color={C.wall}>wall</Tag> - solid no-slip surface (the body, channel walls).</p>
              <p><Tag color={C.far}>farfield</Tag> - free-stream boundary far from the body (used with the auto circle/C-grid).</p>
              <p><Tag color={C.sym}>symmetry</Tag> - a mirror plane; also used for the far tunnel walls / top &amp; bottom when you don't want them to act as solid walls.</p>
              <p><Tag color="#16A34A">periodic</Tag> - the edge repeats onto a matching edge (cascades, channels with streamwise periodicity).</p>
            </div>
            <Note>Every segment of every boundary loop must carry exactly one tag before the Mesh tab unlocks.</Note>
          </Section>

          <Section id="mesh" title="Meshing">
            <Steps>
              <S n={1}><b>Resolution</b> - coarse / medium / fine scales the whole mesh. Start coarse, refine once the setup is right.</S>
              <S n={2}><b>Element type</b> - Triangles (robust), Hybrid (prism layers along walls + triangles elsewhere), Quad-dominant, or all-Quad.</S>
              <S n={3}><b>Boundary layer</b> - for wall-bounded turbulence. Set target y⁺, first-cell height and layer count. This sizes the prism stack against <Tag color={C.wall}>wall</Tag> edges only.</S>
              <S n={4}><b>Advanced</b> - algorithm, growth rate, min/max size, local wall size, curvature refinement.</S>
            </Steps>
            <Note>
              If the boundary layer can't be built (sharp corners, thin trailing edges) the mesher drops
              it and falls back to a clean triangle mesh, with a warning. That mesh is still usable.
            </Note>
          </Section>

          <Section id="axisymmetric" title="Axisymmetric">
            <p className="text-[13px] leading-relaxed text-[#374151]">
              Not supported yet - there is no <code className="text-[12px] bg-[#F5F6F8] px-1 rounded">axis</code>
              tag, and the OpenFOAM case export is still a fixed template.
            </p>
            <p className="text-[13px] leading-relaxed text-[#374151] mt-2">
              <b>Stopgap:</b> model the half-section and tag the axis edge as <Tag color={C.sym}>symmetry</Tag>.
              That gives a <b>planar 2D</b> solution - correct only if the real flow is genuinely 2D, not
              a body of revolution.
            </p>
            <p className="text-[13px] leading-relaxed text-[#374151] mt-2">
              A true axisymmetric run needs the 2D mesh revolved into a 1-cell wedge with
              <code className="text-[12px] bg-[#F5F6F8] px-1 rounded"> wedge</code> front/back patches and an
              <code className="text-[12px] bg-[#F5F6F8] px-1 rounded"> axis</code> patch - backend work.
            </p>
          </Section>

          <Section id="troubleshooting" title="Troubleshooting">
            <div className="space-y-3 text-[13px] text-[#374151]">
              <p><b>A drawn line vanished when I pinned my loop as domain.</b> Fixed - a hand-drawn domain loop is now left exactly as drawn. Re-select all segments and pin again.</p>
              <p><b>The Mesh tab is locked even though I pinned my own domain.</b> Fixed - a pinned hand-drawn loop (one closed polyline, or several segments forming a loop) now counts as the domain. You still need geometry + a domain + at least one inlet and one outlet tag; the checklist says which is missing.</p>
              <p><b>Rectangle / arc “did nothing”.</b> Fixed - the two quick clicks were being read as a double-click that recentred the view. Double-click now only acts with the Select tool.</p>
              <p><b>Trim deleted my whole line.</b> Trim removes the piece of a line <i>between two crossing edges</i>. If nothing crosses it, trim now does nothing and tells you.</p>
              <p><b>The domain resize handles won't go away.</b> They only show for an auto far-field domain, in the Domain step. Switch to Internal or pin your own loop and they disappear.</p>
              <p><b>Slider snaps in 0.5c steps.</b> That's the SNAP toggle (top bar). Turn it off for free-flow dragging.</p>
            </div>
          </Section>

          <p className="text-[11px] text-[#69717D] mt-8 pb-6">
            Meshing and edge tags are fully wired. Translating arbitrary tag sets into a complete OpenFOAM
            <code className="text-[10px] bg-[#F5F6F8] px-1 rounded"> polyMesh/boundary</code> + per-field
            boundary conditions is still in progress.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TutorialPage;

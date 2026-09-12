# OpenCFD Visual Design Direction

## Philosophy

This is engineering software, not a consumer app. The reference point is
ANSYS Workbench / SolidWorks / CATIA / Fusion 360 - precise, dense, flat,
built for someone staring at it for eight hours a day - not Apple's
consumer software language (no soft shadows, no glassy blur, no "premium"
airiness). Depth comes from borders and contrast, never elevation effects.
Every decision below should be checked against: "does this make the tool
feel more precise, or does it make it feel decorative?" - if it's the
second one, cut it.

## The core problem today

1. **The accent color is used as decoration, not signal.** `#2563EB` blue
   appears in roughly 200 places across the frontend - active tabs, every
   badge, hover states, borders, icons. When everything is the accent
   color, nothing is. It should mark exactly one thing: the primary action
   or true current selection.
2. **Shadows and blur exist in a few places and should be zero.** Current
   usage: `shadow-xs`/`shadow-sm`/`shadow-md`/`shadow-2xl` in
   `CreatePlotModal.tsx`, `PlotViewDialog.tsx`, `PlotThumbnail.tsx`,
   `ResultsRightRail.tsx`, `LeftStagePanel.tsx`, and `App.tsx`; `backdrop-blur`
   in 8 files. All of it goes. Replace with a border and, if a floating
   element genuinely needs to read as "on top" (a modal, a dropdown), a
   solid background plus a 1px border is enough - no blur, no glow.
3. **Corner radius is a bit soft for this context.** `rounded-lg` (8px) and
   `rounded-md` (6px) are the two most common radius classes in the app
   (dominant in `LeftStagePanel.tsx`, `CadWorkbench2D.tsx`,
   `HomeScreen.tsx`, and most panel components). Tighten this across the
   board - see the radius scale below.

## What's already right - keep it

- The neutral gray scale is good and should stay exactly as-is:
  `#171A1F` (primary text), `#69717D` (secondary text), `#8A929E` /
  `#A5ACB5` / `#C4C9D0` (tertiary/disabled text), `#E1E4E8` (default
  border), `#EDEFF3` / `#F5F6F8` (subtle backgrounds), `#CBD5E1` (mesh/
  wireframe lines). This is a legitimate, already-consistent grayscale
  system - the fix is what gets layered on top of it, not the grays
  themselves.
- Typography stack is fine: Inter for UI text, JetBrains Mono for
  numeric/technical readouts (residuals, coordinates, cell counts). Keep
  both. Do not switch to a "premium" display font.

## Rules to apply everywhere

### Color
- One accent color, used ONLY for: the single primary button on a given
  screen, and the current true selection (an active tab, a selected run/
  plot/tool). Everything else - secondary buttons, hover states, badges,
  counters, decorative borders - uses the neutral gray scale above.
- Status colors (green for success/running, red for error/delete, amber
  for warning) stay as-is - those carry real meaning and aren't the
  problem. Just stop reaching for blue as a default "this is interactive"
  signal.
- Backgrounds: white for primary content/canvas, `#F5F6F8` for chrome
  (toolbars, panel headers, the collapsed rail strip) - already mostly
  correct, just be consistent about which is which.

### Depth (no shadows, borders only)
- Remove every `shadow-*` and `backdrop-blur-*` class in the frontend.
- A panel, card, or row is delimited by a 1px `#E1E4E8` border, full stop.
- A modal/dialog is a solid white panel with a 1px border, sitting over a
  semi-transparent dark scrim (`bg-black/40` or similar, no blur) - not a
  frosted/blurred backdrop.
- "Active" or "selected" state is shown by a border color change (to the
  accent) and/or a subtle background tint (`#EFF6FF`-style), never by
  adding a shadow.

### Radius
- Tighten the scale app-wide. Suggested new scale to standardize on:
  - Buttons, inputs, small chips/badges: `2px` (`rounded-sm`)
  - Panels, cards, modals: `4px` (`rounded`)
  - Nothing in the app should use `rounded-lg` (8px), `rounded-xl`, or
    `rounded-2xl` - those read as consumer-app softness. Audit every
    `rounded-lg`/`rounded-md` occurrence (heaviest in `LeftStagePanel.tsx`,
    `CadWorkbench2D.tsx`, `HomeScreen.tsx`) and step it down.
  - Fully round (`rounded-full`) stays only for genuine dots/avatars
    (status indicators), not for buttons or pills.

### Density and spacing
- This is a tool for people who want information density, not breathing
  room. Do not add generous whitespace as part of this pass - if
  anything, keep the current compact padding (`px-2 py-1`-scale controls)
  as the standard, and resist any temptation to "open things up."
- Keep alignment tight and grid-like: labels and values in forms should
  line up in consistent columns, not float with ad-hoc margins.

### Icons
- Keep the current line-icon style (lucide-react, already in use
  throughout) - thin stroke, no filled/duotone icons. This is already
  correct, just noting it so it doesn't drift when other things change.

### Motion
- Keep transitions short and functional (`transition-colors`, ~150ms,
  already the convention in most buttons) - color/border changes only, no
  scale/bounce/fade-in-from-elevation effects. A hover or active state
  should feel instant, not "designed."

## Suggested approach for implementing this "one by one"

Rather than hand-tuning each component's hex codes, consider pulling the
handful of values above into CSS custom properties (e.g. a new
`frontend/src/styles/tokens.css`, or constants at the top of
`frontend/src/index.css`) - `--color-border`, `--color-text-secondary`,
`--color-accent`, `--radius-sm`, `--radius-md` - so a future palette or
radius tweak is a one-line change instead of a repo-wide find/replace.
This isn't required to get the visual result, but it's the difference
between doing this once and doing it every time something drifts.

Suggested order, roughly easiest/highest-impact first:
1. Remove all `shadow-*` and `backdrop-blur-*` usage (small, mechanical,
   immediately makes things feel flatter).
2. Audit `#2563EB` usage file by file and reclassify each instance as
   "genuinely the primary action/selection" (keep) or "just marking
   something as interactive" (convert to the neutral gray scale, with a
   border-color or background-tint change on hover/active instead).
3. Step down `rounded-lg`/`rounded-md` to the tighter scale above,
   starting with `LeftStagePanel.tsx` and `CadWorkbench2D.tsx` since they
   have the most occurrences.
4. Re-check modals (`CreatePlotModal.tsx`, `PlotViewDialog.tsx`) last,
   since they currently combine all three problems (shadow, blur, and the
   softest radius in the app) - fixing 1-3 first makes this one fast.

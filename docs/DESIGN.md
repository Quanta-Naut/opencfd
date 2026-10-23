# OpenCFD Visual Design

## Philosophy

This is engineering software, not a consumer app. The references are
Plasticity (a CAD tool built around the viewport, with chrome that gets out
of the way) and the newer crop of open-source creative tools such as
PhotoCraft: dark-capable, flat, dense, keyboard-first. Someone will stare at
this for eight hours a day.

Check every decision against one question: does this make the tool feel more
precise, or more decorative? If it is the second, cut it.

Four rules carry most of the weight:

1. **The viewport is the product.** Chrome is thin and quiet; tools float over
   the canvas instead of eating rows above it.
2. **One accent, used as signal.** Blue marks the single primary action on a
   screen. Everything else is neutral.
3. **Depth from lines and surface steps, never shadows.** No `shadow-*`, no
   `backdrop-blur-*`, anywhere.
4. **Everything is reachable from the keyboard.** Every command lives in the
   command palette (`Ctrl/⌘ K`); frequent ones have a hotkey shown in the
   tooltip.

## Tokens and themes

All colour comes from semantic roles in `frontend/src/styles/tokens.css`,
mapped into Tailwind by the `@theme` block in `frontend/src/index.css`. A
component never contains a raw hex for UI chrome; it uses `bg-surface`,
`text-fg-2`, `border-line` and so on. Data colours (colormaps, plot series,
mesh block tints) are the exception: they are data, not chrome.

| Role | Use |
| --- | --- |
| `app` | Outer chrome: app bar, panel backgrounds behind cards |
| `surface`, `surface-2`, `surface-3` | Panels and cards; rows and inputs; hover and the selected tab |
| `viewport` | The canvas, one step apart from the panels around it |
| `line-soft`, `line`, `line-strong` | Dividers; default borders; emphasised borders |
| `fg`, `fg-2` ... `fg-5` | Primary text down to disabled/placeholder |
| `accent`, `accent-hover` | The primary button only |
| `accent-soft`, `accent-fg`, `accent-line` | The selected state (tool, segment, run, tab number) |
| `danger`, `success`, `warning` (+ `-soft`, `-line`) | Status with real meaning |
| `inverse`, `on-inverse` | The logo tile and toasts |
| `scrim` | Behind modals; a flat tint, no blur |

Themes: `data-theme` on `<html>` is always the resolved theme (`light` or
`dark`). The user's preference is System (default), Light or Dark, stored in
`localStorage` under `opencfd_theme` and applied by an inline script in
`index.html` before first paint, so there is no flash. `utils/theme.ts` owns
it: `useResolvedTheme()` for components, `setThemePreference()` and
`toggleTheme()` for the app bar toggle, Preferences and the command palette.

Canvas code cannot use CSS classes. The CAD workbench reads its colours from
`canvasPalette(theme)` in `components/cad/workbenchCore/canvasPalette.ts`;
chart canvases call `cssVar('--fg-3')` at draw time and redraw when the theme
changes.

## Shell

- **App bar (44px, one row).** Projects button, logo, editable project name,
  the five workflow stages as tabs (number, label, lock when gated, hotkeys
  `1`-`5`), then global actions: OpenFOAM dicts, the command search, a real
  backend health dot, theme toggle, shortcuts, preferences. It replaces the
  old header, stage strip and status bar.
- **Left stage panel (280px).** Stage controls. `Ctrl/⌘ B` hides it.
- **Viewport.** In Geometry, a vertical tool rail floats at the top left
  (undo/redo, select, draw, modify, delete) with icon-only buttons and
  right-side tooltips that show the hotkey. Fillet and Offset open a small
  flyout holding their one parameter. Drafting aids (grid, grid snap, object
  snap, ortho, angle, construction) and zoom sit in a compact strip at the top
  centre. Readouts (cursor, scale, mesh summary) float at the bottom corners.
- **Console.** A drawer along the bottom of the viewport.

## Components

- **Selected state** is `bg-accent-soft text-accent-fg`, plus
  `border-accent-line` when the control has a border. Never a solid accent
  fill: that is reserved for the primary button.
- **Segmented controls** (Laminar/Turbulent, Steady/Transient, colormaps) use
  the selected state above on one segment, neutral on the rest.
- **Primary button**: `bg-accent text-white hover:bg-accent-hover`, at most
  one per screen. Secondary actions are bordered neutral buttons.
- **Tooltips** use `components/ui/Tooltip` (pass `side="right"` on a vertical
  rail) and show shortcuts with `components/ui/Kbd`.
- **Modals** are a solid `surface` panel with a 1px `line` border over
  `bg-scrim`.

## Type

- Inter (UI) and JetBrains Mono (numbers), both bundled through
  `@fontsource-variable`, so the app looks the same offline and on every OS.
- Mono is for numbers and code only: coordinates, residuals, cell counts,
  file contents, numeric inputs. Prose (empty states, option labels,
  placeholders) is sans.
- Nothing below 10px. Section labels are 11px uppercase with tracking; body
  text is 12-13px.

## Radius, density, motion

- Radius: `rounded-sm` (2px) for buttons, inputs and chips; `rounded` (4px)
  for panels, cards, modals and floating bars. No `rounded-lg` or larger.
  `rounded-full` only for status dots.
- Dense by default: compact controls, labels and values aligned in columns.
  Do not "open things up".
- Motion is short and functional: colour transitions around 150ms, tooltips
  fade and slide a few pixels. No scale or bounce.
- Icons: lucide-react line icons, no filled or duotone variants.

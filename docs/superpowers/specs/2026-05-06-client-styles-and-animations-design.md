# Client Styles & Animations Redesign

**Date:** 2026-05-06
**Scope:** `client/` only. Visual + motion layer. **No core logic changes.**
**Goal:** Make the React client prettier and more animated, with a "playful productivity" aesthetic.

---

## 1. Direction & Constraints

**Aesthetic:** Playful productivity. Warmer palette, friendly micro-illustrations, springy motion that delights without distracting. Status colors carry personality.

**Non-goals:**
- No changes to API layer (`src/api.ts`), hooks (`useParserEditor`, `useTheme`, `useDebugRun`, `useParserSSE`), routing logic, or any business behavior.
- No new pages, no new features, no refactor of state management.
- No changes to Monaco editor configuration.

**Stack additions:**
- `framer-motion` (~40kb gz) — only new dependency. React 19 compatible.

**Stack unchanged:**
- React 19, Vite 8, Tailwind v3 (`darkMode: 'class'`), TypeScript, monaco editor, react-json-view.

---

## 2. Architecture & File Layout

```
client/
├─ tailwind.config.js          ← extend theme: colors, animations, keyframes, shadows
├─ src/
│  ├─ index.css                ← CSS vars for status accents + reduced-motion guard
│  ├─ design/
│  │  ├─ tokens.ts             ← motion tokens (durations, easings, springs)
│  │  └─ status.ts             ← status → color/icon/label maps (single source)
│  ├─ components/
│  │  ├─ motion/
│  │  │  ├─ FadeIn.tsx
│  │  │  ├─ StaggerList.tsx
│  │  │  ├─ MotionCard.tsx
│  │  │  ├─ SpringButton.tsx
│  │  │  ├─ PageTransition.tsx
│  │  │  ├─ StatusBadge.tsx
│  │  │  └─ StatusDot.tsx
│  │  └─ <existing pages>      ← refactor JSX to consume primitives + tokens
│  └─ hooks/
│     └─ useReducedMotion.ts   ← thin wrapper over framer-motion's hook
```

Net new: `src/design/`, `src/components/motion/`, ~10 small files. No deletions. Existing pages keep their files; only their JSX changes.

---

## 3. Design Tokens

### 3.1 Palette (semantic, multi-accent)

Defined in `tailwind.config.js` via `theme.extend.colors` and `theme.extend.boxShadow`. Status maps live in `src/design/status.ts` so every component pulls from a single source.

**Status colors (light variant shown; dark mirrored):**
| State | bg | fg | ring/dot |
|---|---|---|---|
| idle | slate-100 | slate-600 | slate-300 |
| running | amber-100 | amber-700 | amber-400 |
| stopped | orange-100 | orange-700 | orange-400 |
| complete | emerald-100 | emerald-700 | emerald-400 |
| error | rose-100 | rose-700 | rose-400 |

**Brand:**
- Primary action: `violet-600` (Run, Save, +New Parser)
- Success: `emerald-600`
- Warning: `amber-500`
- Danger: `rose-600`

**Neutrals:** Migrate `gray-*` → `stone-*` for warmer feel. Tailwind class swap; same scale steps.

### 3.2 Motion tokens (`src/design/tokens.ts`)

```ts
export const ease = {
  out:        [0.16, 1, 0.3, 1],          // expo-out, snappy
  inOut:      [0.65, 0, 0.35, 1],
  spring:     { type: 'spring', stiffness: 380, damping: 30 },   // playful, tight
  springSoft: { type: 'spring', stiffness: 200, damping: 22 },
}
export const dur = { fast: 0.18, base: 0.28, slow: 0.45 }
```

### 3.3 Shadows

```js
boxShadow: {
  card:      '0 1px 2px rgb(28 25 23 / 0.06), 0 4px 12px rgb(28 25 23 / 0.04)',
  cardHover: '0 2px 4px rgb(28 25 23 / 0.08), 0 12px 24px rgb(28 25 23 / 0.08)',
  glow:      '0 0 0 4px rgb(124 58 237 / 0.12)',
}
```

### 3.4 Typography

Keep current font stack. Tighten headings (`tracking-tight`), bump h1 weight to extrabold, h2 to bold. No font swap.

---

## 4. Motion Primitives API

All primitives expose `className` + minimal animation knobs. No deep customization surface — consistency over flexibility.

### 4.1 `<FadeIn>`
```tsx
<FadeIn delay={0.1} y={8} as="div">{children}</FadeIn>
```
- Mount fade + small Y rise. `delay`, `y`, `as` optional.
- Reduced-motion: opacity-only, 150ms tween.

### 4.2 `<StaggerList>`
```tsx
<StaggerList stagger={0.05}>
  {items.map(i => <FadeIn key={i.id}>...</FadeIn>)}
</StaggerList>
```
- Applies stagger via parent variants; children inherit.
- Reduced-motion: stagger 0.

### 4.3 `<MotionCard>`
```tsx
<MotionCard className="...">{children}</MotionCard>
```
- Replaces `<div>` for cards. Hover: `y:-2`, shadow-card → shadow-cardHover. Tap: `scale:0.98`. Mount: fade-up.
- Reduced-motion: shadow change only.

### 4.4 `<SpringButton>`
```tsx
<SpringButton variant="primary|ghost|danger|success|warning" loading={bool}>Run</SpringButton>
```
- Drop-in `<button>` replacement. Tap: scale 0.96, spring back. Loading: spinner inside button.
- Reduced-motion: bg color change only.

### 4.5 `<PageTransition>`
```tsx
<AnimatePresence mode="wait">
  <PageTransition key={page}>{currentPage}</PageTransition>
</AnimatePresence>
```
- Fade + 6px Y crossfade between routed pages.
- Reduced-motion: instant swap.

### 4.6 `<StatusBadge>`
```tsx
<StatusBadge status="running" />
```
- Colored pill with `layoutId` so color morphs smoothly when status changes.
- Reduced-motion: color swap, no motion.

### 4.7 `<StatusDot>`
```tsx
<StatusDot status="running" />
```
- Colored dot. `running`: ping ring. `complete`: brief scale-pop on mount/transition. `error`: brief shake. `idle`/`stopped`: static.
- Reduced-motion: static dot.

### 4.8 `useReducedMotion()`
Thin re-export of framer-motion's hook so primitives can branch without each importing from the lib directly.

---

## 5. Per-Page Motion Plan

### 5.1 `App.tsx` (header + page wrapper)
- Header sticky+blur preserved. Add 1px gradient strip under header (violet→emerald), subtle shimmer when any parser is running.
- Logo bolt icon: gentle Y bob (3s loop, off under reduced-motion).
- Nav buttons: underline grows from center on hover (`scaleX`).
- Theme toggle: rotate+fade icon swap.
- Wrap routed page in `<PageTransition>`.

### 5.2 Parsers grid
- Empty state: `<FadeIn>` with floating SVG illustration.
- Header row ("N parsers", +New): `<FadeIn delay={0}>`.
- Grid: `<StaggerList stagger={0.04}>` over `<ParserCard>`s.
- "+ New Parser": `<SpringButton variant="primary">` violet.

### 5.3 `ParserCard.tsx`
- Wrapper: `<MotionCard>`.
- Status dot: `<StatusDot>`.
- Status badge: `<StatusBadge>`.
- Run/Stop/Resume: `<SpringButton>` with appropriate variant.
- Output files: `<StaggerList>` so files slide in when run completes.
- Stats numbers: animated count-up via `useMotionValue` + `animate`.
- Error message: slide+fade via `AnimatePresence`.

### 5.4 `JobsPage.tsx`
- Title: `<FadeIn>`.
- Refresh: `<SpringButton variant="ghost">`, icon spins 360° on click.
- Table rows: `<StaggerList stagger={0.025}>`; rows fade-up on first paint only (skip stagger on poll re-renders).
- Status pills: `<StatusBadge>`.
- Pagination: `<SpringButton>` variants.
- Row hover: bg shift + 2px violet left border slides in.

### 5.5 `JobDetailPage.tsx` / `TaskDetailPage.tsx`
- Page mount: header fade-up, sections stagger.
- Back: `<SpringButton variant="ghost">` arrow nudges left on hover.
- Stats cards: `<MotionCard>` with number count-up.
- Task list (JobDetail): `<StaggerList>`; status icon morphs on state change.

### 5.6 `ParserEditorPage.tsx`
- Header bar: `<FadeIn>`.
- Save button: `<SpringButton variant="primary">`; saved-state checkmark scales-in on success.
- Save status text: crossfade `Saving… / Saved / Save failed` via `AnimatePresence`.
- Step sidebar: `<StaggerList>` on first mount; new step slides in from top; deleted step fades+slides out via `AnimatePresence`.
- Active step indicator: violet bar on left edge with `layoutId` so it slides between selections.
- "+ Add Step" border: dashed outline with animated `dash-offset` on hover.
- Monaco editor: untouched.
- StepDebugPanel: slides in from right via `AnimatePresence`.

### 5.7 `DebugPage.tsx` + `StepDebugPanel.tsx`
- Mount: `<FadeIn>`.
- Run button: `<SpringButton variant="primary">`; running state shows pulsing dot.
- Output blocks: `<StaggerList>` as results appear.

### 5.8 New parser creation form (`ParserEditorPage` empty parserName branch)
- Form fields: `<StaggerList>` on mount.
- Submit: `<SpringButton variant="primary">`.

---

## 6. Reduced-Motion + Accessibility

### 6.1 Reduced-motion behavior
| Primitive | Default | Reduced |
|---|---|---|
| FadeIn | opacity + y:8 | opacity only, 150ms |
| StaggerList | stagger 0.04s | stagger 0 |
| MotionCard | hover lift + tap scale | shadow change only |
| SpringButton | tap scale 0.96 | bg color change only |
| PageTransition | fade + y crossfade | instant |
| StatusBadge flip | layout morph | color swap |
| StatusDot ping | ping ring | static dot |
| Logo float | y bob | static |
| Number count-up | tween value | jump to final |

### 6.2 Focus + keyboard
- All interactive elements: `focus-visible:ring-2 ring-violet-500 ring-offset-2`.
- No keyboard traps introduced.
- `AnimatePresence` exits do not block focus return.

### 6.3 Color contrast
- Audit all status fg/bg pairs in both themes against WCAG AA before merging the palette change.
- Save status text never drops below opacity 0.4 mid-fade (readability during transition).

### 6.4 Screen readers
- Decorative motion adds no DOM elements.
- `<StatusBadge>` keeps text label.
- `<StatusDot>` is `aria-hidden="true"`.

---

## 7. Verification

### 7.1 Build / lint
- `cd client && npm run build` passes (tsc -b + vite build).
- `cd client && npm run lint` clean.

### 7.2 Manual QA matrix
| Page | Light | Dark | Reduced-motion | Mobile (<640px) |
|---|---|---|---|---|
| Parsers grid | ✓ | ✓ | ✓ | ✓ |
| Jobs table | ✓ | ✓ | ✓ | ✓ |
| Job detail | ✓ | ✓ | ✓ | ✓ |
| Task detail | ✓ | ✓ | ✓ | ✓ |
| Parser editor | ✓ | ✓ | ✓ | n/a (desktop tool) |
| Debug page | ✓ | ✓ | ✓ | ✓ |

### 7.3 State-change checks
- Start parser → ping appears, badge color morphs, button springs.
- Stop parser → orange transition, no color flash.
- Parser completes → emerald scale-pop, output files stagger in.
- Parser errors → rose shake, error slides in.
- Step add/remove → list animations clean, no layout jank.
- Page navigate → crossfade smooth, no shift.

### 7.4 Performance budget
- Bundle: ~40kb gz added (framer-motion). Acceptable for internal tool.
- Animations target 60fps; transform/opacity only. No animated width/height/top/left.
- AnimatePresence on tables: bounded by existing `LIMIT = 50`.

### 7.5 Browser checks
- `npm run dev` in Chrome and Firefox.
- Toggle DevTools `prefers-reduced-motion` → confirm reduced behavior.
- Toggle theme system/dark/light → confirm clean transitions, no FOUC.

### 7.6 Rollback
All changes additive. If a primitive misbehaves, its motion props can be neutralized inside the primitive without touching page code.

---

## 8. Out of Scope

- Backend / API changes.
- New features, new routes.
- Monaco editor theming changes beyond the existing dark/light prop.
- Tests (none required — visual layer, no logic).
- i18n / new strings.
- Bundle splitting beyond Vite defaults.

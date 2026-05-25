# Editor Modals + Collapsible Nav — Design Spec

**Date:** 2026-05-25  
**Status:** Approved

---

## Overview

Two independent UI improvements to the scraper client:

1. **Editor page modals** — Parser and step settings move from inline expanding panels into modal overlays, simplifying the header and step meta bars.
2. **Collapsible nav** — The sidebar can shrink to a 48px icon-only rail, toggled by a chevron button and persisted to localStorage.

---

## Part A — Editor Page Modals

### Problem

The current `ParserEditorPage` header is dense: it embeds Entry URL, Entry Step, and Browser selects inline alongside the parser name and Save button. Step settings expand as an inline bar that pushes the Monaco editor down. Both patterns eat vertical space and clutter the primary coding surface.

### Design

#### Shared `Modal.tsx`

New file: `client/src/components/Modal.tsx`

- `createPortal` to `document.body`
- Framer Motion backdrop (opacity fade) + card (scale 0.95→1, y 8→0 slide) — same motion spec as the existing `SchemaModal` in `ParserSettingsPanel`
- Escape key closes; backdrop click closes
- Props: `title: string`, `onClose: () => void`, `children: React.ReactNode`, optional `width?: string` (default `'max-w-xl'`)

#### `ParserSettingsModal`

New file: `client/src/components/ParserSettingsModal.tsx`

Replaces `ParserSettingsPanel` (file deleted).

Triggered by **"⚙ Parser Settings"** button in the parser header bar.

Fields (single scrollable modal body, save-on-blur):
- Entry URL (text input, `saveParserSettings({ entryUrl })`)
- Entry Step (select from step names, `saveParserSettings({ entryStep })`)
- Browser (select: playwright / playwright-stealth / puppeteer, `saveParserSettings({ browserType })`)
- Max Retries + Concurrent Quota (2-column grid)
- Deduplication (checkbox)
- Webhook URL (text input)
- Browser Settings JSON (`JsonEditor`, with `?` schema button opening `SchemaModal`)

`SchemaModal` (currently a local component inside `ParserSettingsPanel.tsx`) moves into `ParserSettingsModal.tsx` as a local component — it is only used there.

#### `StepSettingsModal`

New file: `client/src/components/StepSettingsModal.tsx`

Replaces the `StepSettingsBar` function in `ParserEditorPage` (removed).

Triggered by **"⚙ Step Settings"** button in the step meta bar.

Fields (single scrollable modal body, save-on-blur):
- Step Entry URL (text input)
- Output file (text input, extractors only)
- Delay Min + Delay Max ms (2-column grid)
- Max Pages/Context (number input)
- Output Format (select: csv / json / excel)
- Proxy Pool (textarea, one URL per line)
- Step Settings JSON (`JsonEditor` for remaining fields)

#### Header simplification

**Before:**
```
← [parser name]  Entry URL:[...]  Entry Step:[...]  Browser:[...]  ⚙ Settings  [status]  Save
```

**After:**
```
← [parser name]          ⚙ Parser Settings   [status]   Save
```

Entry URL, Entry Step, and Browser move into `ParserSettingsModal`. `showSettings` boolean now controls the modal, not the inline panel.

#### Step meta bar simplification

**Before:**
```
[step name]  [type]  Entry URL:[...]  Output:[...]  Templates…  ⚙  History  ▶ Run
```

**After:**
```
[step name]  [type]          Templates…  ⚙ Step Settings  History  ▶ Run
```

Entry URL and Output file move into `StepSettingsModal`. `showStepSettings` boolean now controls the modal.

### Files changed

| Action | File | Change |
|--------|------|--------|
| Create | `client/src/components/Modal.tsx` | Shared modal base |
| Create | `client/src/components/ParserSettingsModal.tsx` | Parser settings modal |
| Create | `client/src/components/StepSettingsModal.tsx` | Step settings modal |
| Modify | `client/src/components/ParserEditorPage.tsx` | Remove header inline fields, remove StepSettingsBar fn, wire modals |
| Delete | `client/src/components/ParserSettingsPanel.tsx` | Replaced by ParserSettingsModal |

---

## Part B — Collapsible Nav

### Problem

The sidebar is fixed at 220px. On smaller monitors or when focused on the editor, the nav label text wastes horizontal space.

### Design

#### State

`useSettings` hook gains one new field: `navCollapsed: boolean` (default `false`). The `Settings` interface in `useSettings.ts` gains `navCollapsed: boolean`; the `defaultSettings` object sets it to `false`.

The existing `updateSettings` + localStorage sync handles persistence — no new storage logic needed.

#### `Layout.tsx` changes

- Sidebar width: `w-[220px]` ↔ `w-[48px]`, with `transition-all duration-200`
- Logo area: when collapsed, hide `<span>Parser</span>`, keep only the 28px bolt icon div (already fits the 48px rail)
- Nav items: when collapsed, hide label text (`hidden` class on the label `<span>`); keep icon visible. Add `title={item.label}` for native hover tooltip
- Theme toggle: same — icon stays, label text hidden when collapsed
- **Toggle button:** bottom of sidebar, below the theme toggle `div`. Shows `‹` when expanded, `›` when collapsed. Calls `updateSettings({ navCollapsed: !settings.navCollapsed })`

#### Collapsed rail layout (48px)

```
[bolt icon]            ← logo
[dashboard icon]       ← title="Dashboard"
[parsers icon]         ← title="Parsers"
[jobs icon]            ← title="Jobs"
[settings icon]        ← title="Settings"
─────────────
[theme icon]           ← title="Theme: dark"
[›]                    ← expand
```

### Files changed

| Action | File | Change |
|--------|------|--------|
| Modify | `client/src/hooks/useSettings.ts` | Add `navCollapsed: boolean` field |
| Modify | `client/src/components/Layout.tsx` | Collapse logic, toggle button |

---

## What is not changing

- Monaco editor, debug panel, history panel, version panel — untouched
- Save-on-blur pattern for all settings fields — preserved exactly
- All API calls, hooks, and persistence — no backend changes
- `JsonEditor`, `SpringButton`, motion variants — reused as-is

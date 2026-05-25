# 017 — Editor modals and collapsible nav sidebar

## Background

The parser editor page accumulated settings directly in the header bar (Entry URL, Entry Step, Browser type) and as inline expanding panels (`ParserSettingsPanel`, `StepSettingsBar`). On small monitors this consumed significant vertical space and pushed the Monaco editor down whenever settings were open. The sidebar was fixed at 220 px wide with no way to reclaim horizontal space.

## Problem

1. **Inline panels push Monaco down.** Opening parser settings or step settings inserted a block of form fields between the header and the editor, reducing the visible code area.
2. **Header bar overloaded.** Entry URL, Entry Step, and Browser selects lived directly in the top bar alongside the parser name and Save button, making the bar wide and hard to scan.
3. **Sidebar always wide.** The 220 px sidebar labels are wasted real estate when the user is focused on coding and knows the nav by icon alone.

## Design

### Modal system

A shared `Modal.tsx` base component centralises the portal + animation pattern that was already established in the local `SchemaModal` inside `ParserSettingsPanel`. It uses `createPortal` to `document.body`, Framer Motion for entrance/exit animations (opacity + scale + y on the card), Escape-key and backdrop-click dismissal.

Two modal components replace the inline panels:

**`ParserSettingsModal`** — triggered by "⚙ Parser Settings" button in the header. Contains: Entry URL, Entry Step (select from step names), Browser type, Max Retries + Concurrent Quota (2-column grid), Deduplication, Webhook URL, Browser Settings JSON + schema reference modal. Uses explicit Save / Cancel buttons with client-side validation; saves all fields in one API call on Save click. Closes on success or on Cancel/Escape/backdrop.

**`StepSettingsModal`** — triggered by "⚙ Step Settings" button in the step meta bar. Contains: step Entry URL, Output File (extractor steps only), Delay Min + Delay Max, Max Pages/Context, Output Format, Proxy Pool, freeform Step Settings JSON. Same Save / Cancel pattern with JSON validation before submit.

Both modals are wrapped in `<AnimatePresence>` at the call site in `ParserEditorPage` so exit animations fire on close. `StepSettingsModal` is keyed by `selectedStep.name` so switching steps while the modal is open remounts it and resets state.

### Header and step meta bar simplification

**Header after:** `← [parser name] … ⚙ Parser Settings  [save status]  Save`

**Step meta bar after:** `[step name]  [type]  …  Templates  ⚙ Step Settings  History  ▶ Run`

Entry URL, Entry Step, and Browser are removed from the header. Entry URL and Output File are removed from the step meta bar. Both move into their respective modals.

`ParserSettingsPanel.tsx` is deleted.

### Collapsible sidebar

`useSettings` gains `navCollapsed: boolean` (default `false`). The existing `updateSettings` + localStorage mechanism persists the value automatically.

`Layout.tsx` transitions the sidebar between `w-[220px]` and `w-[48px]` via `transition-all duration-200`. When collapsed: the "Parser" wordmark is hidden (bolt icon only), nav item labels are hidden (`{!collapsed && label}`), native `title` attributes provide hover tooltips, and both the nav buttons and theme toggle become `justify-center`. A `‹` / `›` chevron button at the bottom of the sidebar toggles the state.

## Questions and Answers

**Q: Why not keep save-on-blur inside the modals?**
A: Auto-save is appropriate for inline panels where the user sees the effect immediately and can correct mistakes inline. In a modal, the expected UX is to commit all changes at once via an explicit Save button. Auto-saving individual fields on blur inside a modal is surprising and harder to cancel.

**Q: Why a shared `Modal` base rather than duplicating the pattern?**
A: The portal + backdrop + animation boilerplate was already duplicated once (SchemaModal inside ParserSettingsPanel). Extracting it to `Modal.tsx` (~55 lines) makes both modals shorter and ensures consistent behaviour (Escape key, backdrop click, animation timing) without coordination.

**Q: Why `title` attributes for collapsed nav tooltips rather than a custom tooltip component?**
A: The scraper UI is a desktop tool used by one operator at a time. Native `title` tooltips are instantaneous on hover, require zero code, and are sufficient for icon-only nav labels. A custom tooltip component would add complexity with no meaningful UX gain in this context.

## Trade-offs

- **Save button adds a click.** Users who were accustomed to blur-saving individual fields in the old inline panels now need to click Save. This is the correct UX for a modal but is a behaviour change.
- **SchemaModal is not reused from `Modal.tsx`.** It keeps its own portal/animation implementation to maintain a higher z-index (`z-[60]` vs `z-[50]`) without complicating the `Modal` API with a `zIndex` prop.
- **navCollapsed stored in app settings.** This couples a layout preference to the same key as theme and page-limit preferences. A dedicated `ui-prefs` key would be cleaner at scale, but the current `AppSettings` object is small and the trade-off is not material.

## Implementation Results

- `client/src/components/Modal.tsx` created (~55 lines)
- `client/src/components/ParserSettingsModal.tsx` created (~240 lines); replaces `ParserSettingsPanel.tsx`
- `client/src/components/StepSettingsModal.tsx` created (~170 lines); replaces `StepSettingsBar` local function
- `client/src/components/ParserEditorPage.tsx` modified: header stripped, step meta bar stripped, both modals wired with `AnimatePresence`
- `client/src/components/ParserSettingsPanel.tsx` deleted
- `client/src/hooks/useSettings.ts` modified: `navCollapsed: boolean` added
- `client/src/components/Layout.tsx` modified: dynamic sidebar width, collapsed icon-rail, chevron toggle button

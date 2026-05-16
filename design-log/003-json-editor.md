# 003 — Monaco-based JSON editor

## Background

Several fields in the UI accept JSON configuration: parser-level Browser Settings, step-level Step Settings, and the Browser Settings field on the new-parser creation form. All three were plain `<textarea>` elements with a hand-rolled `try/catch` validation loop. Errors appeared only as a red "Invalid JSON" label — no highlighting, no indication of where the problem was, and no way to auto-format pasted blobs.

## Problem

Replace all JSON configuration textareas with a proper code-editor experience: syntax highlighting, inline error markers at the problem line/column, and one-click formatting — without adding a new dependency.

Constraints:

- Monaco Editor (`@monaco-editor/react`) is already in the bundle for the step code editor; no new dependency may be added.
- All JSON fields must remain controlled (value + onChange) so parent components can read and save the value.
- `onBlur`-triggered saves used by `ParserSettingsPanel` and `StepSettingsBar` must continue to work.
- The editor must respect the app's light/dark theme.

## Questions and Answers

- **Q1 — New component or upgrade existing `JsonEditor`?** Upgrade `JsonEditor`. It is already the shared component used by `DebugPage` and `StepDebugPanel`; upgrading it propagates the improvement everywhere.
- **Q2 — Why Monaco over CodeMirror / Ace?** Monaco is already in the bundle. Adding a second editor library would increase bundle size for no gain.
- **Q3 — How to surface `onBlur`?** Monaco does not forward DOM blur directly. `editor.onDidBlurEditorText(callback)` fires when focus leaves the editor text area and is wired in `onMount`.
- **Q4 — How does Format work?** Monaco's built-in JSON language service includes a document formatter. `editor.getAction('editor.action.formatDocument').run()` invokes it; the button replaces the old manual `JSON.stringify(JSON.parse(v), null, 2)` approach.
- **Q5 — Placeholder text?** Dropped. Monaco does not support native placeholder text, and overlaying a positioned `<div>` cannot reliably align with Monaco's internal padding across themes. The label above each field supplies sufficient context.
- **Q6 — Height?** Derived from the existing `rows` prop: `rows × 19 + 12` px. Keeps the API stable for callers that already set `rows`.
- **Q7 — What happens to the parent-owned error state?** Removed from `ParserSettingsPanel` (`browserJsonError`) and `StepSettingsBar` (`error`). Monaco renders inline squiggles; the parent `onBlur` handler still calls `JSON.parse` and skips the save on failure, but no longer needs to set its own error flag.

## Design

### `JsonEditor` component

```tsx
// Replaces the textarea with a Monaco Editor in JSON mode.
// Parent API (value, onChange, onBlur, disabled, rows) is unchanged.
<Editor
  language="json"
  theme={monacoTheme}          // derived from useTheme()
  value={value}
  onChange={(v) => onChange(v ?? '')}
  onMount={(editor) => {
    editorRef.current = editor
    if (onBlur) editor.onDidBlurEditorText(onBlur)
  }}
  options={{
    minimap: { enabled: false },
    lineNumbers: 'off',
    glyphMargin: false,
    folding: false,
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    renderLineHighlight: 'none',
    overviewRulerLanes: 0,
  }}
/>
```

Format button overlays the top-right corner and calls `editor.action.formatDocument`. It is hidden when the editor is empty and disabled when `disabled` prop is set.

### Callers migrated to `JsonEditor`

| File | Field |
| --- | --- |
| `ParserSettingsPanel.tsx` | Browser Settings |
| `ParserEditorPage.tsx` (`StepSettingsBar`) | Step Settings |
| `ParserEditorPage.tsx` (new-parser form) | Browser Settings (advanced) |

`DebugPage` and `StepDebugPanel` already used `JsonEditor` and gain the upgrade automatically.

### State removed from callers

`ParserSettingsPanel` — `browserJsonError` state and the `setBrowserJsonError` calls in `saveBrowserSettings`.

`StepSettingsBar` — `error` state and the `setError` calls in `handleBlur` and `onChange`.

`ParserEditorPage` new-parser form — `newParserBrowserJsonError` state and the `setNewParserBrowserJsonError` calls in `handleCreate`.

## Trade-offs

- **Monaco weight**: Monaco is not lightweight, but it was already loaded for the step code editor. Adding JSON mode adds no extra loading cost.
- **No placeholder**: Minor UX regression for empty fields; acceptable given labels provide context.
- **`rows` → pixel height**: The conversion (`rows × 19 + 12`) is an approximation of Monaco's line height. Fields will not auto-grow as content is typed, consistent with the previous textarea resize behaviour.
- **`onBlur` via `onDidBlurEditorText`**: This fires when the text area loses focus but not when ancillary Monaco UI (command palette, suggest widget) steals focus transiently — correct behaviour for save-on-blur.

## Implementation Results

Implemented across four files:

- `client/src/components/JsonEditor.tsx` — switched from `<textarea>` to Monaco Editor; added `onBlur` and `rows` props; Format button calls `editor.action.formatDocument`
- `client/src/components/ParserSettingsPanel.tsx` — uses `JsonEditor`; removed `browserJsonError` state
- `client/src/components/ParserEditorPage.tsx` — `StepSettingsBar` uses `JsonEditor`, removed `error` state; new-parser form uses `JsonEditor`, removed `newParserBrowserJsonError` state; added `JsonEditor` import
- `client/src/hooks/useTheme.ts` — unchanged; consumed by `JsonEditor` to derive Monaco theme

`tsc --noEmit` clean. No new dependencies.

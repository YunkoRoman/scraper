# 005 — JsonEditor stale closure fix

## Background

After the Monaco-based `JsonEditor` was introduced (003), saving parser Browser Settings or step settings always sent an empty object `{ "browserSettings": {} }` regardless of what was typed. The field appeared to accept input but silently discarded it on save.

## Problem

`JsonEditor` registers a blur handler with Monaco's `editor.onDidBlurEditorText(onBlur)` inside `onMount`. `onMount` runs once when the editor mounts. At that point the `onBlur` prop is the function instance from the first render — a closure over the parent's state at that moment (e.g. `browserJson = ''`).

On every subsequent render the parent produces a new `onBlur` / `saveBrowserSettings` function that closes over the current state value, but Monaco keeps the original reference. When the user types and then blurs, the stale handler fires, reads the original empty string, and calls `onSave({ browserSettings: {} })`.

```
mount         → onDidBlurEditorText(onBlur_v1)  ← browserJson = ''
user types    → browserJson = '{ "userAgent": "..." }'
               → new onBlur_v2 created each render, never registered
blur fires    → onBlur_v1() reads browserJson = '' → sends {}
```

This is the classic React stale-closure problem when an external event listener is registered once and the callback is not kept up to date.

## Questions and Answers

- **Q1 — Why does `onChange` work but `onBlur` doesn't?** Monaco's `onChange` (the `onChange` prop of `<Editor>`) is re-evaluated by `@monaco-editor/react` on every render, so it always receives the latest function. `onDidBlurEditorText` is a raw Monaco API called imperatively in `onMount` — the library does not manage its lifecycle.
- **Q2 — Fix location?** Inside `JsonEditor`. The bug is an implementation detail of how the component wires Monaco events; callers should not need to know about it.
- **Q3 — Fix pattern?** Store the latest `onBlur` prop in a ref, updated via `useEffect`. The `onDidBlurEditorText` callback calls through the ref, so it always invokes the current version.
- **Q4 — Does the same issue affect `onChange`?** No — `onChange` is passed directly as the `<Editor onChange>` prop, which `@monaco-editor/react` re-binds on each render.
- **Q5 — Which callers are affected?** All callers that pass `onBlur`: `ParserSettingsPanel` (Browser Settings), `StepSettingsBar` (Step Settings), and the debug panels via `StepDebugPanel`. The ref fix applies to all of them without any caller-side changes.

## Design

```tsx
const onBlurRef = useRef(onBlur)
useEffect(() => { onBlurRef.current = onBlur }, [onBlur])

function handleMount(editor) {
  editorRef.current = editor
  editor.onDidBlurEditorText(() => onBlurRef.current?.())
}
```

`onBlurRef` is initialised with the prop value so it is correct even if blur fires before the first effect runs (which cannot happen in practice, but is safe). The `useEffect` keeps the ref in sync on every render. The anonymous arrow function passed to `onDidBlurEditorText` is stable across renders — it only reads through the ref, never capturing the prop directly.

## Trade-offs

- **Ref vs re-registering on prop change**: re-registering would require calling `editor.onDidBlurEditorText` again inside a `useEffect([onBlur])`, which produces a new disposable each time and leaks the previous one unless explicitly disposed. The ref approach is simpler and has no leak.
- **`useEffect` timing**: the ref update runs after render, so there is a theoretical window between render and effect where the ref holds the previous value. In practice blur cannot fire in this window (it requires a user action), making this safe.

## Implementation Results

One file changed:

- `client/src/components/JsonEditor.tsx` — added `onBlurRef` + `useEffect` to keep it current; `handleMount` now registers `() => onBlurRef.current?.()` instead of `onBlur` directly; added `useEffect` to imports

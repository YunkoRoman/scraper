# 018 — React Router and client source layout

## Background

The client used a hand-rolled hash router: a `parseHash()` function mapped `window.location.hash` fragments (`#/jobs/123`) to a `Page` union type, and a `navigate()` function wrote hashes back. All page components received navigation callbacks as props (`onBack`, `onViewJob`, `onNavigateToParsers`, etc.). All component files lived flat in `client/src/components/`.

## Problem

1. **Hash URLs are ugly.** `#/jobs/abc` instead of `/jobs/abc`. No semantic meaning to browsers or crawlers; breaks browser history subtleties.
2. **Nav props pollute every component.** Every page received callbacks purely to pass them further down or call them on button click. No page component had any reason to know about routing — they just wanted to navigate somewhere.
3. **Flat components folder.** Pages, shared UI, and page-specific panels all lived in one directory. No signal at a glance about what is shared vs. scoped to one page.

## Design

### React Router

`react-router-dom` v7 replaces the hand-rolled router.

`BrowserRouter` wraps the app in `main.tsx`. `App.tsx` declares all routes via `<Routes>` / `<Route>`. `AnimatePresence` + `PageTransition` key on `location.pathname` preserves exit animations.

Route table:

| Path | Component |
|---|---|
| `/` | DashboardPage |
| `/parsers` | ParsersPage |
| `/parsers/:parserId` | ParserDetailPage |
| `/editor` | ParserEditorPage (new parser) |
| `/editor/:parserId` | ParserEditorPage (existing) |
| `/jobs` | JobsPage |
| `/jobs/:runId` | JobDetailPage |
| `/jobs/:runId/tasks/:taskId` | TaskDetailPage |
| `/settings` | SettingsPage |
| `/debug` | DebugPage |

All navigation callback props (`onBack`, `onViewJob`, `onViewTask`, `onEdit`, `onViewParser`, `onNavigateToParsers`, `onParserSelect`, `onNavigate`) are removed from every page component. Each page calls `useNavigate()` directly; pages with URL parameters call `useParams()` to read them instead of receiving them as props.

`Layout` drops its `activePage` and `onNavigate` props; it reads `useLocation().pathname` to derive the active nav section and calls `useNavigate()` for nav item clicks.

### Source layout

```
client/src/
  pages/                        ← route-level components
    DashboardPage.tsx
    DebugPage.tsx
    JobsPage.tsx
    ParsersPage.tsx
    SettingsPage.tsx
    TaskDetailPage.tsx
    JobDetailPage/
      index.tsx
      JobInsightsPanel.tsx      ← used only by JobDetailPage
    ParserDetailPage/
      index.tsx
      SchedulePanel.tsx         ← used only by ParserDetailPage
    ParserEditorPage/
      index.tsx
      ParserSettingsModal.tsx   ← used only by ParserEditorPage
      StepDebugPanel.tsx
      StepSettingsModal.tsx
      StepVersionsPanel.tsx
  components/                   ← shared across multiple pages
    Layout.tsx
    Modal.tsx
    JsonEditor.tsx
    motion/
```

The rule: if a component is imported by exactly one page, it lives in that page's folder. If imported by two or more, it lives in `components/`.

## Questions and Answers

**Q: Why not keep hash routing — it works without server config?**
A: The Vite dev server already serves `index.html` for all paths. Production deployments behind nginx/caddy add one `try_files` line. The UX and readability improvement justifies the trivial config requirement.

**Q: Why remove nav props rather than keep them for testability?**
A: The only "testability" argument for prop-threading is unit-testing navigation in isolation, which we don't do. The props added noise to every component interface with no benefit in practice.

**Q: Why index.tsx for multi-file page folders?**
A: Import sites write `from './pages/JobDetailPage'` — cleaner than `from './pages/JobDetailPage/JobDetailPage'`. The folder name carries the page identity.

## Trade-offs

- **Server requires `try_files` in production.** Any direct URL hit must return `index.html`. Vite handles this in dev; production needs one nginx/caddy rule.
- **`useParams` returns `string | undefined`.** Routes guarantee the params exist, so non-null assertions (`runId!`) are used. This is safe but bypasses the type system.
- **`StatsPanel.tsx` stays in `components/`.** It has no current importers but is kept as a shared slot in case it's wired up later.

## Implementation Results

- `client/src/main.tsx` — wrapped with `<BrowserRouter>`
- `client/src/App.tsx` — replaced hand-rolled router with `<Routes>` / `<Route>`; removed `Page` type, `parseHash`, `navigate` function, `navPage` derivation
- `client/src/components/Layout.tsx` — removed `activePage` / `onNavigate` props; added `useLocation` + `useNavigate`
- All page components — removed all navigation props; added `useNavigate()` and `useParams()` where needed
- `client/src/pages/` — created; all page components moved here
- `client/src/pages/JobDetailPage/` — `index.tsx` + `JobInsightsPanel.tsx`
- `client/src/pages/ParserDetailPage/` — `index.tsx` + `SchedulePanel.tsx`
- `client/src/pages/ParserEditorPage/` — `index.tsx` + `ParserSettingsModal.tsx` + `StepDebugPanel.tsx` + `StepSettingsModal.tsx` + `StepVersionsPanel.tsx`

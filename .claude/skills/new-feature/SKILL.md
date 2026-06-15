---
name: new-feature
description: Implements a new feature using the researcher → planner → implementer agent pipeline. Use whenever the user asks to create, add, build, or implement a feature — even if phrased casually ("I need X", "can we add X", "let's build X", "implement X"). Always run this pipeline before writing any code. Never skip straight to implementation.
---

# New Feature Pipeline

Three agents run in strict sequence. Do not skip steps or merge them.

## Step 1 — Researcher (Explore agent)

Spawn a `researcher` agent with a prompt that includes:
- The feature description in plain terms
- Specific questions to answer (see below)
- Instruction to report file paths + line numbers for every finding

**What to ask the researcher:**
- Which existing domain entities / value objects are relevant?
- Which application services / orchestrator methods will need to change?
- Which infrastructure files (DB schema, workers, adapters) are touched?
- Which API routes and client components are affected?
- Are there existing patterns to follow (e.g., how another similar feature was built)?
- Any layer boundary risks (domain importing infra, etc.)?

Wait for the researcher to complete before continuing.

## Step 2 — Planner (planner agent)

Spawn a `planner` agent. Pass it:
- The full feature description
- The researcher's findings (file paths, current signatures, layer map)

The planner must produce the standard output format:
1. Problem statement
2. Design decision + alternatives rejected
3. Layer-by-layer changes (domain / application / infrastructure / api / client)
4. DB schema changes + migration strategy (if any)
5. Worker protocol changes (if any)
6. Implementation sequence (ordered, non-breaking steps)
7. Trade-offs
8. Design log entry needed? (slug + one-liner)

Present the plan to the user. Wait for explicit approval before proceeding. If the user has corrections, re-prompt the planner with the feedback — do not improvise design yourself.

## Step 3 — Implementer (implementer agent)

Spawn an `implementer` agent only after the plan is approved. Pass it:
- The approved plan (full text)
- The researcher's file map (so it starts with location context)

The implementer:
- Follows the plan's implementation sequence exactly
- Spawns researcher sub-agents when it needs to locate code mid-task
- Spawns planner sub-agents when it hits an unexpected conflict
- Creates the design-log entry if the plan flagged one as needed
- Runs mandatory reviewers after all edits (`ddd-boundary-reviewer` always; others based on what changed)
- Reports each changed file with line numbers and reviewer verdicts

## Hard rules

- **Never commit.** User commits explicitly.
- **Never skip researcher.** Even if the feature seems small — the researcher catches layer violations before they're coded.
- **Never start implementing without plan approval.** Present the plan, wait for a green light.
- **Design log is not optional** when the plan says it's needed.
- **Implementer does not redesign.** If a conflict blocks implementation, the planner resolves it.

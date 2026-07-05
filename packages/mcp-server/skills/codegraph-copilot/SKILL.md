---
name: codegraph-copilot
description: Developer copilot over the Contextify code knowledge graph. Use when the user asks to explain this project, generate onboarding docs, find flows (auth, payment, checkout), visualize state management or architecture, generate Mermaid diagrams, estimate feature complexity, or break work into tasks/Jira tickets. Works on React/Next.js and Flutter projects.
---

# Codegraph Developer Copilot

Answer project-level questions by **querying the knowledge graph first and reading
code second**. The graph gives you the verified skeleton (what exists, what connects
to what); read source files only to fill in behavior the graph can't see. Never
answer architecture questions from generic assumptions.

## Always start the same way

1. `index_project` on the project root (fast; also refreshes `graph.html`).
2. `get_project_map` — this is your table of contents for everything below.

## Playbooks by request type

**"Explain this project" / onboarding docs**
Project map + `analyze_project` + read the entry point and 2–3 central components
(the ones with the highest degree in `search_graph` results). Produce: what the app
does, route inventory, component architecture, state management approach, API
surface, and "start reading here" pointers. For onboarding docs, write it to
`docs/ONBOARDING.md` only if the user asks for a file.

**"Find the X flow" (auth, payment, checkout…)**
`search_graph` for the domain terms (login, auth, pay, checkout, cart…), then follow
the hits' relations: route → component → hooks/contexts → APIs → navigates_to.
Present the flow end-to-end in order (UI → state → API → next screen) with file
paths, then a Mermaid `flowchart TD` of it. If search returns nothing, say the flow
doesn't exist in this codebase rather than inventing one.

**"Visualize state management"**
Filter the graph to context/hook nodes: `search_graph` for each context, list which
components `use` each one. Mermaid diagram: contexts/stores as one rank, consuming
components grouped per route. Remind the user `.pixelcontextify/graph.html` has the
interactive version.

**"Estimate complexity of changing/adding X"**
`get_impact` on the closest existing node(s). Translate the blast radius into an
estimate: affected components/routes/APIs → S (<5 dependents), M (5–15), L (>15 or
3+ routes). State the regression-risk areas explicitly. For brand-new features with
no existing node, estimate from the nearest analogous flow's subtree size and say
that's the basis.

**"Break this into tasks / Jira tickets"**
First run the complexity estimate above, then emit tasks in dependency order —
schema/model → API → state → UI → wiring → tests. Each task: title (imperative),
description with the file paths involved, and the affected-routes list as its test
scope. Output as markdown the user can paste; do not call any external ticket system
unless the user has one connected and asks.

**"Why is X broken?" / root-cause analysis**
Combine the graph with git history — neither alone is enough:
1. `search_graph` / `get_impact` on the broken feature to find its dependency chain
   (component → hooks/contexts → APIs). Note any edge you'd *expect* that is missing
   — a missing `uses`/`calls` edge is often the symptom made visible.
2. `graph_timeline` and `graph_diff` to see when the structure changed around it.
3. `git log --follow -p -- <file>` and `git log -S '<symbol>'` on the suspect files
   to find the commit that introduced the change, and read its message/diff for the why.
4. Report as a causal chain, not a file list: *symptom → missing/changed dependency →
   commit that changed it → why (from the commit/diff)*. If the cause can't be
   pinned to a commit, say what was ruled out rather than guessing.

**"Find performance bottlenecks / security issues"**
The graph narrows the search; it does not detect these itself — say so. Use it to
find the hot paths (components on many routes, APIs called from many places), then
read those files looking for the usual suspects (N+1 fetch patterns, missing
memoization on high-degree components, secrets in client code, unvalidated route
params flowing into API calls). Report only what you verified in source, with
file:line references.

## Rules

- Every claim about structure cites a node or edge from the graph (file paths, route
  paths, endpoint names). If the graph and your reading of the code disagree, trust
  the code and mention the discrepancy.
- Mermaid diagrams: keep under ~25 nodes; collapse leaf clusters ("…and 8 more
  cards") rather than emitting spaghetti.
- If a tool reports stale files, re-index before answering.

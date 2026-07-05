---
name: codegraph-rosetta
description: Framework translator for developers landing in an unfamiliar backend codebase. Use when the user knows one framework (e.g. NestJS) and must work in another — Django, Spring Boot, FastAPI, Flask, Go, or Rust — or asks "what's the equivalent of X in Y", "explain this codebase like I'm a NestJS dev", or wants onboarding to a new-to-them stack. Translates concepts (controllers, DI, modules, entities, guards, middleware) between frameworks and maps them onto the actual files in the project.
---

# Codegraph Rosetta — framework translator

Onboard a developer into a codebase written in a framework they don't know, by
translating everything into the framework they DO know. Never explain the
target framework in the abstract — always anchor every concept to a real file
in this project and to its equivalent in the user's home framework.

## Workflow

**1. Establish the two frameworks.**

- *Home framework* (what the user knows): from their words ("I'm a NestJS dev"),
  else ask one short question. Default assumption if they've used Contextify on
  NestJS projects before: NestJS.
- *Target framework* (this codebase): detect from marker files, do not ask:

| Marker | Target |
| ------ | ------ |
| `manage.py`, `settings.py`, `INSTALLED_APPS` | Django |
| `pom.xml` / `build.gradle` + `@SpringBootApplication` | Spring Boot |
| `pyproject.toml`/`requirements*.txt` containing `fastapi` | FastAPI |
| … containing `flask` | Flask |
| `go.mod` | Go |
| `Cargo.toml` (look for `axum`, `actix-web`) | Rust |
| `@nestjs/core` in package.json | NestJS |

**2. Load exactly one reference file** from `references/` for the target
framework (`django.md`, `spring-boot.md`, `fastapi.md`, `flask.md`, `go.md`,
`rust.md`). It contains the concept-translation table, project-layout guide,
and the gotchas list. Do not load the others.

**3. Index, then respect what the graph can and cannot see.**
Run `index_project`. Check which providers contributed:

- **Graph covers the target** (NestJS, React/Next.js, Flutter today): use
  `get_project_map`, `search_graph`, `trace_flow`, `get_impact` as the skeleton
  and cite nodes/edges for every structural claim, exactly like codegraph-copilot.
- **No provider for the target yet** (Django, Spring, FastAPI, Flask, Go, Rust):
  say so in one line ("no compiler provider for Django yet — this walkthrough is
  from reading the code directly, not from the verified graph"). Then locate the
  project's real entry points using the reference file's layout guide and read
  those specific files. Never present unverified structure with the same
  confidence as graph-backed structure.

**4. Deliver the translation, anchored in this repo.** The default deliverable
for "help me get into this codebase":

- **The map, in home-framework terms** — "Django apps `orders/`, `payments/` are
  what you'd write as NestJS modules; `orders/views.py` is the controller;
  `orders/services.py` is the service layer (this repo does use one — not all
  Django code does)."
- **The mental-model shifts** — the 3–5 gotchas from the reference file that
  actually apply to this repo, each with a file:line example from the project.
- **A translated flow walkthrough** — take one real request (pick an endpoint
  that exists here) and narrate it end to end, naming each stage in BOTH
  frameworks: "request hits `urls.py` (your route decorator) → `OrderViewSet`
  (your controller) → …".
- **"If you were writing this in <home>" cheat sheet** — for the 5 most common
  tasks in this repo (add an endpoint, add a model field, add a migration, add
  a background job, add a test): the home-framework move and the target-framework
  move, side by side, with the real file paths where each happens here.

**For one-off questions** ("what's the equivalent of a guard here?"): answer
directly from the translation table, show the closest real example in this repo,
and stop. No full onboarding dump.

## Rules

- Every structural claim about the project cites either a graph node/edge or a
  file:line you actually read. Framework knowledge comes from the reference
  table; project facts come from the project.
- Translation ≠ equivalence. When a concept has no true counterpart (Django has
  no DI container; Go has no decorators), say "no equivalent — here's the idiom
  that fills the role" rather than forcing a false mapping.
- Match the codebase's dialect, not the framework's textbook style. If this
  Django repo puts logic in fat models rather than a service layer, translate to
  what's actually here and note the difference.
- Don't dump the whole reference table at the user — use it to answer what was
  asked, in the shape of their question.

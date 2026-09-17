# Contributing

Thank you for improving FocusGrid.

## Before making a change

1. Read [docs/README.md](docs/README.md) and the guide for the area being changed.
2. Keep the domain pure. `src/domain/**` may not import React, Next, browser
   globals, storage, AI SDKs, or `process`; ESLint and
   `src/domain/boundary.test.ts` enforce this.
3. Keep one priority formula. The UI renders what the domain computes; it never
   re-implements the math.
4. Treat everything that crosses a trust boundary (imports, API routes, model
   output, feed URLs) as untrusted and validate it with the existing Zod schemas.
5. Use plain language in docs. Button and menu labels must match the app exactly.
6. State clearly whether a change was only written, run locally, or verified in
   a real browser or device.

## Make and check the change

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run test:e2e   # npx playwright install once; needs port 3000 free
```

`npm test` runs every Vitest suite (domain, application, persistence with
`fake-indexeddb`, and server-only modules). `npm run test:e2e` starts its own
dev server on port 3000; stop any other server on that port first or Playwright
reuses it and tests the wrong build.

## Open a pull request

Use the pull request template. Include:

- What changed and why.
- The area changed (domain, application, persistence, UI, API route, docs).
- The checks that passed, and any check that was not run and why.
- Whether the priority engine or the IndexedDB schema changed. Schema changes
  need a migration in `src/persistence/` and a test that opens an old export.
- Screenshots for UI changes, taken from demo mode (`/?demo=1`), in the light
  theme unless the change is theme-specific.

## What belongs in Git

Commit source, tests, CI configuration, public documentation, and screenshots.

Keep out of Git: `.env*` files other than `.env.example`, the `.data/` runtime
store, test output, build output, personal editor settings, and AI-assistant
instruction files (`CLAUDE.md`, `AGENTS.md`, `.claude/`). None of these is
required to run or test the project.

# Repository Memory

For nontrivial work, read `docs/codebase-map.md` for subsystem purpose, data flows,
trust boundaries, tests, and known risks. Use `docs/codebase-graph.yaml` for named
dependencies and change-impact questions. Verify exact behavior in the referenced code
and nearest tests. Update both memory files when a change alters a runtime, route family,
persistence boundary, state owner, provider, auth mechanism, or named dependency edge.

Use `npm run memory:index` to build or refresh the ignored local index, then
`npm run memory:ask -- "<question>"` for citation-ready retrieval and
`npm run memory:graph -- "<path-or-symbol>"` for structural edges. Run
`npm run memory:eval` and `npm run test:memory` after changing the memory tooling.
`memory:ask` and `memory:eval` default to local hybrid reranking; pass
`-- --mode lexical` when a strict lexical-only comparison is needed.

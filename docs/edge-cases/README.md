# Edge Case Behaviour Catalog

This folder documents non-happy-path behaviours and product decisions for the `voice-memos` recorder and memo pipeline.

Each file should answer three questions for a specific edge case:

1. **What scenario are we talking about?** (Concrete trigger/conditions.)
2. **What happens today?** (Actual behaviour, including limitations and failure modes.)
3. **What should happen?** (Intended UX and technical guardrails, even if not yet implemented.)

Documents here are **implementation-agnostic** by default: they describe user-facing behaviour and invariants, and may optionally link to tests or code.

## Current Edge Cases

- [Recording duration and auto-stop](./recording-duration-and-auto-stop.md)


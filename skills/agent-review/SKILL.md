---
name: agent-review
description: Use a lightweight localhost HTML page when a plan, comparison, report, or other large structured answer would be easier for the user to review visually.
---

# Agent Review

Use `/home/fernando/Projects/agent-review/bin/agent-review.mjs` to open a local review loop.

## Workflow

1. Write one plain, semantic `.html` artifact in the current project or `/tmp`.
2. Keep CSS minimal. Do not generate ornamental dashboards, cards, icons, gradients, animations, or large scripts unless the user asks.
3. Give each feedback-worthy section a short stable `data-review-id`, such as `summary`, `option-a`, or `step-3`. Add `data-review-kind="direction"` or `data-review-kind="decision"` only when it should contribute to the summary counts. Optionally set `data-review-kicker` on `<body>`.
4. Run `agent-review.mjs open <file>` and give the user the localhost URL if the browser does not open.
5. Run `agent-review.mjs watch <file>` in the active turn and retain its running process/session. Do not finish the agent turn while the review remains open.
6. For each compact JSON line emitted by watch, handle every item, then wait on the same watch process again. Never launch a replacement one-shot poll between items.
7. On element feedback, locate only the returned target and make the narrow edit.
8. When the target is area, use its normalized rectangle and nearby IDs to identify the intended page region; inspect only the relevant layout if it is ambiguous.
9. When the target is screenshot, inspect the returned `screenshot.annotated` local image with the available image-viewing tool. Compare `screenshot.original` only when the drawing obscures context. Apply the accompanying comment without asking the user to paste or upload it again.
10. When the target is chat, answer in the browser with `agent-review.mjs reply <file> <concise-reply>`, then wait on the same watch process.
11. Stop only when watch emits `{"status":"ended"}`. Use `poll` only for a deliberate one-shot diagnostic.

Watch emits compact JSON lines like:

```json
{"status":"feedback","items":[{"target":"@step-3","comment":"Add staging first"}]}
```

The HTML file is the source of truth. Never paste its full contents into the conversation unless the user requests that.

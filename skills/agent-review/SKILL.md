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
5. Run `agent-review.mjs poll <file>` in the active turn. Do not repeatedly read or send the whole artifact.
6. On feedback, locate only the returned `target`, make the narrow edit, and poll again.
7. Stop when poll returns `{"status":"ended"}`.

Poll returns compact JSON like:

```json
{"status":"feedback","items":[{"target":"@step-3","comment":"Add staging first"}]}
```

The HTML file is the source of truth. Never paste its full contents into the conversation unless the user requests that.

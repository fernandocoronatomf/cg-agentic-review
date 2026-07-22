# CG Agentic Review

A lightweight, dependency-free localhost workspace for reviewing structured
output from Codex, Claude Code, and other agents that can edit files and run
shell commands.

It is intentionally plain: the artifact remains a normal HTML file, while the
review UI sends only a target, an optional short selection, and a comment back
to the waiting agent.

## Try it

Requires Node.js 20 or newer.

```bash
cd /home/fernando/Projects/agent-review
node bin/agent-review.mjs open examples/plan.html
```

Click an element to comment on it, or choose `Select area` and drag over any
region—including blank space—before entering an instruction.

To review a screenshot, press Ctrl/⌘+V anywhere in the page, drag an image into
the browser, or use `Add screenshot`. Draw on it with the red pen, add a short
instruction, and send it. PNG, JPEG, and WebP images up to 15 MB are accepted.
The original and composited annotation are saved under
`~/.cg-agentic-review/uploads/<session>/`.

The `open` command stays connected by default and prints one compact JSON line for each feedback batch until the review ends. Use `--no-watch` only when open should exit immediately; use `watch` to attach without opening another browser. Browser chat arrives with target `chat`;
answer it with `cg-review reply <file.html> "Your reply"`. After editing the HTML, keep the same `open` process running. The browser reloads the artifact automatically.

Optional global command:

```bash
npm link
cg-review open examples/plan.html
```

## Agent integration

The same protocol works for Codex and Claude Code because it uses only files and
a CLI process. Tell either agent:

> Read `skills/agent-review/SKILL.md` and use it for this plan.

To make the skill available inside another project, copy or symlink
`skills/agent-review` into that agent's skills directory. The instructions are
not tied to either agent.

## Token behavior

- The initial artifact costs about as much as generating the same content once.
- Element feedback contains only its stable target, selected excerpt (up to
  400 characters), and comment (up to 2,000 characters). Area feedback adds a
  bounded normalized rectangle and up to eight nearby stable IDs, not a screenshot.
- Screenshot feedback contains the instruction and two local file paths. Image
  bytes are not embedded in the agent message or repeated as base64 text.
- The agent edits the local file instead of reproducing the full result in chat.
- The server and an idle connected listener consume no model tokens.

The server listens only on `127.0.0.1` and serves only HTML files explicitly
opened through the CLI. Stop it with `cg-review stop`.

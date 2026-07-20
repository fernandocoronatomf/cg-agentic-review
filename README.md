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
node bin/agent-review.mjs poll examples/plan.html
```

Click an element in the browser, enter a comment, and send it. The `poll`
command prints one compact JSON response. After editing the HTML, run `poll`
again. The browser reloads the artifact automatically.

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
- A feedback message contains only its stable target, selected excerpt (up to
  400 characters), and comment (up to 2,000 characters).
- The agent edits the local file instead of reproducing the full result in chat.
- The server and an idle `poll` consume no model tokens.

The server listens only on `127.0.0.1` and serves only HTML files explicitly
opened through the CLI. Stop it with `cg-review stop`.

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createReviewServer } from "../src/server.mjs";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "agent-review-"));
  const file = join(directory, "review.html");
  await writeFile(file, "<!doctype html><h1 data-review-id=title>Hello</h1>");
  const server = createReviewServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, file, base: `http://127.0.0.1:${port}` };
}

test("serves an explicitly opened artifact", async (t) => {
  const { server, file, base } = await fixture();
  t.after(() => server.close());
  const opened = await fetch(`${base}/api/open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file }),
  }).then((response) => response.json());
  const artifact = await fetch(`${base}/artifact?session=${opened.id}`).then((response) => response.text());
  assert.match(artifact, /Hello/);
});

test("delivers compact feedback to a waiting poll", async (t) => {
  const { server, file, base } = await fixture();
  t.after(() => server.close());
  const opened = await fetch(`${base}/api/open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file }),
  }).then((response) => response.json());

  const polling = fetch(`${base}/api/poll?session=${opened.id}`).then((response) => response.json());
  await fetch(`${base}/api/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: opened.id, target: "@title", comment: "Make this clearer" }),
  });

  assert.deepEqual(await polling, {
    status: "feedback",
    items: [{ target: "@title", comment: "Make this clearer" }],
  });
});

test("truncates selected text to keep feedback bounded", async (t) => {
  const { server, file, base } = await fixture();
  t.after(() => server.close());
  const opened = await fetch(`${base}/api/open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file }),
  }).then((response) => response.json());
  await fetch(`${base}/api/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: opened.id, target: "@title", selected: "x".repeat(900), comment: "Shorten it" }),
  });
  const result = await fetch(`${base}/api/poll?session=${opened.id}`).then((response) => response.json());
  assert.equal(result.items[0].selected.length, 400);
});


test("bridges browser chat to the agent and returns the reply", async (t) => {
  const { server, file, base } = await fixture();
  t.after(() => server.close());
  const opened = await fetch(base + "/api/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file }),
  }).then((response) => response.json());

  const polling = fetch(base + "/api/poll?session=" + opened.id).then((response) => response.json());
  await fetch(base + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: opened.id, text: "Can we simplify step two?" }),
  });

  assert.deepEqual(await polling, {
    status: "feedback",
    items: [{ target: "chat", comment: "Can we simplify step two?" }],
  });

  await fetch(base + "/api/reply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: opened.id, text: "Yes. I will make it one action." }),
  });
  const conversation = await fetch(base + "/api/conversation?session=" + opened.id)
    .then((response) => response.json());

  assert.deepEqual(
    conversation.messages.map(({ role, text }) => ({ role, text })),
    [
      { role: "user", text: "Can we simplify step two?" },
      { role: "agent", text: "Yes. I will make it one action." },
    ],
  );
});

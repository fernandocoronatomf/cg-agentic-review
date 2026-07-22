import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createReviewServer } from "../src/server.mjs";

const CLI = fileURLToPath(new URL("../bin/agent-review.mjs", import.meta.url));

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "agent-review-"));
  const file = join(directory, "review.html");
  await writeFile(file, "<!doctype html><h1 data-review-id=title>Hello</h1>");
  const server = createReviewServer({ stateDir: directory });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, file, directory, base: `http://127.0.0.1:${port}` };
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
  const version = await fetch(base + "/api/version?session=" + opened.id)
    .then((response) => response.json());
  assert.equal(typeof version.appVersion, "number");
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


test("delivers bounded area-selection context", async (t) => {
  const { server, file, base } = await fixture();
  t.after(() => server.close());
  const opened = await fetch(base + "/api/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file }),
  }).then((response) => response.json());

  await fetch(base + "/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session: opened.id,
      target: "area",
      comment: "Add a contents table here",
      area: {
        xPct: 4.44,
        yPct: -2,
        widthPct: 28.88,
        heightPct: 72.22,
        scrollX: 0,
        scrollY: 320,
        viewportWidth: 1200,
        viewportHeight: 700,
        nearby: ["@summary", "@step-1"],
      },
    }),
  });

  const result = await fetch(base + "/api/poll?session=" + opened.id)
    .then((response) => response.json());
  assert.deepEqual(result.items[0], {
    target: "area",
    comment: "Add a contents table here",
    area: {
      xPct: 4.4,
      yPct: 0,
      widthPct: 28.9,
      heightPct: 72.2,
      scrollX: 0,
      scrollY: 320,
      viewportWidth: 1200,
      viewportHeight: 700,
      nearby: ["@summary", "@step-1"],
    },
  });
});

test("stores original and annotated screenshots and queues only their paths", async (t) => {
  const { server, file, base } = await fixture();
  t.after(() => server.close());
  const opened = await fetch(base + "/api/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file }),
  }).then((response) => response.json());

  const originalBytes = Buffer.from("original-image");
  const uploaded = await fetch(base + "/api/upload?session=" + opened.id, {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: originalBytes,
  }).then((response) => response.json());
  assert.deepEqual(await readFile(uploaded.original), originalBytes);

  const annotatedBytes = Buffer.from("annotated-image");
  const annotated = await fetch(
    base + "/api/annotate?session=" + opened.id + "&upload=" + uploaded.upload,
    {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: annotatedBytes,
    },
  ).then((response) => response.json());
  assert.deepEqual(await readFile(annotated.annotated), annotatedBytes);

  await fetch(base + "/api/screenshot-feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session: opened.id,
      upload: uploaded.upload,
      comment: "Move the contents table into the marked space",
    }),
  });
  const result = await fetch(base + "/api/poll?session=" + opened.id)
    .then((response) => response.json());
  assert.deepEqual(result.items, [{
    target: "screenshot",
    comment: "Move the contents table into the marked space",
    screenshot: {
      original: uploaded.original,
      annotated: annotated.annotated,
    },
  }]);
});

test("reports whether an agent listener is connected", async (t) => {
  const { server, file, base } = await fixture();
  t.after(() => server.close());
  const opened = await fetch(base + "/api/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file }),
  }).then((response) => response.json());

  const waiting = await fetch(base + "/api/status?session=" + opened.id)
    .then((response) => response.json());
  assert.equal(waiting.agentListening, false);

  const polling = fetch(base + "/api/poll?session=" + opened.id)
    .then((response) => response.json());
  await new Promise((resolve) => setTimeout(resolve, 10));
  const connected = await fetch(base + "/api/status?session=" + opened.id)
    .then((response) => response.json());
  assert.equal(connected.agentListening, true);

  await fetch(base + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: opened.id, text: "Finish listener test" }),
  });
  await polling;
  const processing = await fetch(base + "/api/status?session=" + opened.id)
    .then((response) => response.json());
  assert.equal(processing.agentListening, false);
  assert.equal(processing.agentProcessing, true);
});


test("watch stays connected across multiple feedback batches", async (t) => {
  const { server, file, base } = await fixture();
  t.after(() => server.close());
  const opened = await fetch(base + "/api/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file }),
  }).then((response) => response.json());

  const child = spawn(process.execPath, [CLI, "watch", file], {
    env: { ...process.env, AGENT_REVIEW_PORT: new URL(base).port },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGTERM");
  });
  let errors = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  async function nextJson() {
    let timer;
    const result = await Promise.race([
      lines.next(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timeout: true }), 2_000);
      }),
    ]);
    clearTimeout(timer);
    assert.equal(result.timeout, undefined, "watch output timed out: " + errors);
    assert.equal(result.done, false);
    return JSON.parse(result.value);
  }

  let connected = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const current = await fetch(base + "/api/status?session=" + opened.id)
      .then((response) => response.json());
    if (current.agentListening) {
      connected = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(connected, true);

  await fetch(base + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: opened.id, text: "First message" }),
  });
  assert.deepEqual(await nextJson(), {
    status: "feedback",
    items: [{ target: "chat", comment: "First message" }],
  });

  await fetch(base + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: opened.id, text: "Second message" }),
  });
  assert.deepEqual(await nextJson(), {
    status: "feedback",
    items: [{ target: "chat", comment: "Second message" }],
  });

  await fetch(base + "/api/end", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: opened.id }),
  });
  assert.deepEqual(await nextJson(), { status: "ended" });
  const [code] = await exited;
  assert.equal(code, 0, errors);
});

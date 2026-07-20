#!/usr/bin/env node

import { access, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createReviewServer } from "../src/server.mjs";

const DEFAULT_PORT = Number(process.env.AGENT_REVIEW_PORT || 4388);
const HOST = "127.0.0.1";
const SELF = fileURLToPath(import.meta.url);

function usage() {
  console.log(`CG Agentic Review

Usage:
  cg-review open <file.html> [--no-open]
  cg-review poll <file.html>
  cg-review end <file.html>
  cg-review status <file.html>
  cg-review stop

The poll command waits silently and prints one compact JSON response when the
reviewer sends feedback or ends the session.`);
}

async function request(pathname, options = {}) {
  return fetch(`http://${HOST}:${DEFAULT_PORT}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
}

async function serverIsRunning() {
  try {
    const response = await request("/health", { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverIsRunning()) return;

  const child = spawn(process.execPath, [SELF, "serve", "--port", String(DEFAULT_PORT)], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (await serverIsRunning()) return;
  }
  throw new Error(`Local server did not start on ${HOST}:${DEFAULT_PORT}`);
}

async function resolveHtmlFile(value) {
  if (!value) throw new Error("An HTML file path is required.");
  await access(value);
  const file = await realpath(value);
  if (!file.toLowerCase().endsWith(".html")) {
    throw new Error("The review artifact must be an .html file.");
  }
  return file;
}

async function register(file, reopen = false) {
  const response = await request("/api/open", {
    method: "POST",
    body: JSON.stringify({ file, reopen }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function launchBrowser(url) {
  let command;
  let args;
  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

async function main() {
  const [command, value, ...flags] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }

  if (command === "serve") {
    const portIndex = process.argv.indexOf("--port");
    const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : DEFAULT_PORT;
    const server = createReviewServer();
    server.listen(port, HOST);
    return;
  }

  if (command === "stop") {
    if (!(await serverIsRunning())) return;
    await request("/api/stop", { method: "POST", body: "{}" });
    return;
  }

  const file = await resolveHtmlFile(value);
  await ensureServer();

  if (command === "open") {
    const session = await register(file, true);
    const url = `http://${HOST}:${DEFAULT_PORT}/?session=${encodeURIComponent(session.id)}`;
    if (!flags.includes("--no-open")) launchBrowser(url);
    console.log(url);
    return;
  }

  if (command === "poll") {
    const session = await register(file);
    while (true) {
      const response = await request(`/api/poll?session=${encodeURIComponent(session.id)}`);
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      if (result.status !== "waiting") {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return;
      }
    }
  }

  if (command === "end") {
    const session = await register(file);
    await request("/api/end", {
      method: "POST",
      body: JSON.stringify({ session: session.id }),
    });
    return;
  }

  if (command === "status") {
    const session = await register(file);
    const response = await request(`/api/status?session=${encodeURIComponent(session.id)}`);
    console.log(JSON.stringify(await response.json()));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`cg-review: ${error.message}`);
  process.exitCode = 1;
});

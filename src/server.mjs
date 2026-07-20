import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = resolve(ROOT, "public");
const MAX_COMMENT = 2000;
const MAX_SELECTION = 400;

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function text(response, status, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error("Request is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sessionId(file) {
  return createHash("sha256").update(file).digest("hex").slice(0, 16);
}

export function createReviewServer() {
  const sessions = new Map();

  function getSession(url) {
    return sessions.get(url.searchParams.get("session"));
  }

  function flush(session) {
    if (!session.waiter) return;
    if (session.queue.length) {
      const items = session.queue.splice(0);
      const waiter = session.waiter;
      session.waiter = null;
      clearTimeout(waiter.timer);
      json(waiter.response, 200, { status: "feedback", items });
    } else if (session.ended) {
      const waiter = session.waiter;
      session.waiter = null;
      clearTimeout(waiter.timer);
      json(waiter.response, 200, { status: "ended" });
    }
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/health") {
        text(response, 200, "ok");
        return;
      }

      if (request.method === "GET" && url.pathname === "/") {
        text(response, 200, await readFile(resolve(PUBLIC, "index.html"), "utf8"), "text/html; charset=utf-8");
        return;
      }

      if (request.method === "GET" && url.pathname === "/app.js") {
        text(response, 200, await readFile(resolve(PUBLIC, "app.js"), "utf8"), "text/javascript; charset=utf-8");
        return;
      }

      if (request.method === "GET" && url.pathname === "/style.css") {
        text(response, 200, await readFile(resolve(PUBLIC, "style.css"), "utf8"), "text/css; charset=utf-8");
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/open") {
        const { file, reopen = false } = await bodyJson(request);
        if (typeof file !== "string" || !file.toLowerCase().endsWith(".html")) {
          json(response, 400, { error: "A valid HTML path is required" });
          return;
        }
        await stat(file);
        const id = sessionId(file);
        let session = sessions.get(id);
        if (!session) {
          session = { id, file, queue: [], ended: false, waiter: null, nonce: randomUUID() };
          sessions.set(id, session);
        }
        if (reopen) session.ended = false;
        json(response, 200, { id });
        return;
      }

      if (request.method === "GET" && url.pathname === "/artifact") {
        const session = getSession(url);
        if (!session) return json(response, 404, { error: "Unknown session" });
        text(response, 200, await readFile(session.file, "utf8"), "text/html; charset=utf-8");
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/version") {
        const session = getSession(url);
        if (!session) return json(response, 404, { error: "Unknown session" });
        const info = await stat(session.file);
        json(response, 200, { version: info.mtimeMs });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/status") {
        const session = getSession(url);
        if (!session) return json(response, 404, { error: "Unknown session" });
        json(response, 200, { status: session.ended ? "ended" : "open", queued: session.queue.length });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/poll") {
        const session = getSession(url);
        if (!session) return json(response, 404, { error: "Unknown session" });
        if (session.queue.length) {
          const items = session.queue.splice(0);
          json(response, 200, { status: "feedback", items });
          return;
        }
        if (session.ended) {
          json(response, 200, { status: "ended" });
          return;
        }
        if (session.waiter) {
          clearTimeout(session.waiter.timer);
          json(session.waiter.response, 200, { status: "waiting" });
        }
        const timer = setTimeout(() => {
          if (session.waiter?.response === response) session.waiter = null;
          json(response, 200, { status: "waiting" });
        }, 25_000);
        session.waiter = { response, timer };
        request.on("close", () => {
          if (session.waiter?.response === response) {
            clearTimeout(timer);
            session.waiter = null;
          }
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/feedback") {
        const input = await bodyJson(request);
        const session = sessions.get(input.session);
        if (!session) return json(response, 404, { error: "Unknown session" });
        const comment = String(input.comment || "").trim().slice(0, MAX_COMMENT);
        if (!comment) return json(response, 400, { error: "Comment is required" });
        const item = {
          target: String(input.target || "page").slice(0, 200),
          comment,
        };
        const selected = String(input.selected || "").trim().slice(0, MAX_SELECTION);
        if (selected) item.selected = selected;
        session.queue.push(item);
        flush(session);
        json(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/end") {
        const input = await bodyJson(request);
        const session = sessions.get(input.session);
        if (!session) return json(response, 404, { error: "Unknown session" });
        session.ended = true;
        flush(session);
        json(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/stop") {
        json(response, 200, { ok: true });
        setImmediate(() => server.close());
        return;
      }

      json(response, 404, { error: "Not found" });
    } catch (error) {
      json(response, 500, { error: error.message });
    }
  });

  return server;
}

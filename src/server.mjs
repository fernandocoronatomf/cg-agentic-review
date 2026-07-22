import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = resolve(ROOT, "public");
const MAX_COMMENT = 2000;
const MAX_SELECTION = 400;
const MAX_CHAT_MESSAGE = 4000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

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

async function bodyBuffer(request, maximum = MAX_IMAGE_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw new Error("Image is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function image(response, status, body, contentType) {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": body.length,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function boundedNumber(value, minimum, maximum, decimals = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  const bounded = Math.max(minimum, Math.min(maximum, number));
  const factor = 10 ** decimals;
  return Math.round(bounded * factor) / factor;
}

function normalizeArea(value) {
  if (!value || typeof value !== "object") return null;
  const widthPct = boundedNumber(value.widthPct, 0, 100, 1);
  const heightPct = boundedNumber(value.heightPct, 0, 100, 1);
  if (!widthPct || !heightPct) return null;
  return {
    xPct: boundedNumber(value.xPct, 0, 100, 1),
    yPct: boundedNumber(value.yPct, 0, 100, 1),
    widthPct,
    heightPct,
    scrollX: boundedNumber(value.scrollX, 0, 10_000_000),
    scrollY: boundedNumber(value.scrollY, 0, 10_000_000),
    viewportWidth: boundedNumber(value.viewportWidth, 1, 100_000),
    viewportHeight: boundedNumber(value.viewportHeight, 1, 100_000),
    nearby: Array.isArray(value.nearby)
      ? value.nearby.slice(0, 8).map((item) => String(item).slice(0, 100))
      : [],
  };
}

function sessionId(file) {
  return createHash("sha256").update(file).digest("hex").slice(0, 16);
}

export function createReviewServer(options = {}) {
  const sessions = new Map();
  const stateDirectory = resolve(
    options.stateDir
      || process.env.CG_AGENTIC_REVIEW_STATE_DIR
      || join(homedir(), ".cg-agentic-review"),
  );

  function addMessage(session, role, value, kind = "chat") {
    session.messages ||= [];
    const message = {
      id: randomUUID(),
      role,
      kind,
      text: String(value || "").trim().slice(0, MAX_CHAT_MESSAGE),
    };
    session.messages.push(message);
    if (session.messages.length > 100) session.messages.splice(0, session.messages.length - 100);
    return message;
  }

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
          session = {
            id,
            file,
            queue: [],
            messages: [],
            uploads: new Map(),
            lastAgentSeenAt: 0,
            ended: false,
            waiter: null,
            nonce: randomUUID(),
          };
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
        json(response, 200, {
          status: session.ended ? "ended" : "open",
          queued: session.queue.length,
          agentListening: Boolean(session.waiter)
            || Date.now() - (session.lastAgentSeenAt || 0) < 2_000,
          lastAgentSeenAt: session.lastAgentSeenAt || null,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/conversation") {
        const session = getSession(url);
        if (!session) return json(response, 404, { error: "Unknown session" });
        json(response, 200, { messages: session.messages || [] });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/upload") {
        const session = getSession(url);
        if (!session) return json(response, 404, { error: "Unknown session" });
        const contentType = String(request.headers["content-type"] || "").split(";", 1)[0].toLowerCase();
        const extension = IMAGE_TYPES.get(contentType);
        if (!extension) return json(response, 415, { error: "Paste a PNG, JPEG, or WebP image" });
        const body = await bodyBuffer(request);
        if (!body.length) return json(response, 400, { error: "Image is empty" });
        const upload = randomUUID();
        const directory = join(stateDirectory, "uploads", session.id);
        const original = join(directory, upload + "-original." + extension);
        await mkdir(directory, { recursive: true });
        await writeFile(original, body);
        session.uploads.set(upload, { original, originalType: contentType, annotated: null });
        json(response, 200, {
          upload,
          original,
          url: "/api/upload-image?session=" + encodeURIComponent(session.id)
            + "&upload=" + encodeURIComponent(upload),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/upload-image") {
        const session = getSession(url);
        const upload = session?.uploads.get(url.searchParams.get("upload"));
        if (!upload) return json(response, 404, { error: "Unknown screenshot" });
        image(response, 200, await readFile(upload.original), upload.originalType);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/annotate") {
        const session = getSession(url);
        const uploadId = url.searchParams.get("upload");
        const upload = session?.uploads.get(uploadId);
        if (!upload) return json(response, 404, { error: "Unknown screenshot" });
        const contentType = String(request.headers["content-type"] || "").split(";", 1)[0].toLowerCase();
        if (contentType !== "image/png") return json(response, 415, { error: "Annotated image must be PNG" });
        const body = await bodyBuffer(request, MAX_IMAGE_BYTES * 2);
        if (!body.length) return json(response, 400, { error: "Annotated image is empty" });
        const annotated = join(dirname(upload.original), uploadId + "-annotated.png");
        await writeFile(annotated, body);
        upload.annotated = annotated;
        json(response, 200, { annotated });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/screenshot-feedback") {
        const input = await bodyJson(request);
        const session = sessions.get(input.session);
        if (!session) return json(response, 404, { error: "Unknown session" });
        const upload = session.uploads.get(String(input.upload || ""));
        if (!upload) return json(response, 404, { error: "Unknown screenshot" });
        if (!upload.annotated) return json(response, 400, { error: "Annotate the screenshot before sending" });
        const comment = String(input.comment || "").trim().slice(0, MAX_COMMENT);
        if (!comment) return json(response, 400, { error: "Instruction is required" });
        const item = {
          target: "screenshot",
          comment,
          screenshot: { original: upload.original, annotated: upload.annotated },
        };
        session.queue.push(item);
        addMessage(session, "user", "Screenshot: " + comment, "annotation");
        flush(session);
        json(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/poll") {
        const session = getSession(url);
        if (!session) return json(response, 404, { error: "Unknown session" });
        session.lastAgentSeenAt = Date.now();
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
        const area = normalizeArea(input.area);
        if (area) item.area = area;
        session.queue.push(item);
        addMessage(session, "user", item.target + ": " + comment, "annotation");
        flush(session);
        json(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/chat") {
        const input = await bodyJson(request);
        const session = sessions.get(input.session);
        if (!session) return json(response, 404, { error: "Unknown session" });
        const message = String(input.text || "").trim().slice(0, MAX_CHAT_MESSAGE);
        if (!message) return json(response, 400, { error: "Message is required" });
        session.queue.push({ target: "chat", comment: message });
        addMessage(session, "user", message);
        flush(session);
        json(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/reply") {
        const input = await bodyJson(request);
        const session = sessions.get(input.session);
        if (!session) return json(response, 404, { error: "Unknown session" });
        const message = String(input.text || "").trim().slice(0, MAX_CHAT_MESSAGE);
        if (!message) return json(response, 400, { error: "Reply is required" });
        addMessage(session, "agent", message);
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

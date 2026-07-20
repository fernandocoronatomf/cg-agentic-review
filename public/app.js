const params = new URLSearchParams(location.search);
const session = params.get("session");
const frame = document.querySelector("#artifact");
const target = document.querySelector("#target");
const selected = document.querySelector("#selected");
const comment = document.querySelector("#comment");
const status = document.querySelector("#status");
let version = null;
let highlighted = null;

function selectorFor(element) {
  const reviewElement = element.closest("[data-review-id]");
  if (reviewElement) return `@${reviewElement.dataset.reviewId}`;
  if (element.id) return `#${element.id}`;
  const heading = element.closest("h1,h2,h3,h4,h5,h6,p,li,section,article,table,pre");
  const node = heading || element;
  const siblings = [...node.parentElement.children].filter((item) => item.tagName === node.tagName);
  return `${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`;
}

function choose(element, selection = "") {
  if (highlighted) highlighted.style.outline = highlighted.dataset.previousOutline || "";
  highlighted = element;
  highlighted.dataset.previousOutline = highlighted.style.outline;
  highlighted.style.outline = "2px solid #2878d0";
  target.value = selectorFor(element);
  selected.value = selection.trim().slice(0, 400);
}

function attachReviewEvents() {
  const doc = frame.contentDocument;
  if (!doc) return;
  highlighted = null;
  doc.addEventListener("click", (event) => {
    event.preventDefault();
    choose(event.target, doc.getSelection()?.toString() || "");
  }, true);
  doc.addEventListener("mouseup", (event) => {
    const selection = doc.getSelection()?.toString() || "";
    if (selection.trim()) choose(event.target, selection);
  });
}

async function send(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error((await response.json()).error || "Request failed");
}

async function refreshVersion() {
  try {
    const response = await fetch(`/api/version?session=${encodeURIComponent(session)}`, { cache: "no-store" });
    const data = await response.json();
    if (version !== null && data.version !== version) {
      frame.contentWindow.location.reload();
      status.textContent = "Updated by agent.";
    }
    version = data.version;
  } catch {
    status.textContent = "Local server is unavailable.";
  }
}

document.querySelector("#send").addEventListener("click", async () => {
  try {
    await send("/api/feedback", {
      session,
      target: target.value,
      selected: selected.value,
      comment: comment.value,
    });
    comment.value = "";
    status.textContent = "Feedback sent. Waiting for the agent…";
  } catch (error) {
    status.textContent = error.message;
  }
});

document.querySelector("#end").addEventListener("click", async () => {
  await send("/api/end", { session });
  status.textContent = "Review ended.";
});

if (!session) {
  status.textContent = "Missing session identifier.";
} else {
  frame.src = `/artifact?session=${encodeURIComponent(session)}`;
  frame.addEventListener("load", attachReviewEvents);
  status.textContent = "Click something in the page to comment on it.";
  refreshVersion();
  setInterval(refreshVersion, 1200);
}

const params = new URLSearchParams(location.search);
const session = params.get("session");
const frame = document.querySelector("#artifact");
const status = document.querySelector("#status");
const layer = document.querySelector("#annotation-layer");
const card = document.querySelector("#annotation-card");
const annotationTitle = document.querySelector("#annotation-title");
const selectionPreview = document.querySelector("#selection-preview");
const comment = document.querySelector("#comment");
let version = null;
let highlighted = null;
let previousOutline = "";
let activeTarget = "page";
let activeSelection = "";

function selectorFor(element) {
  const reviewElement = element.closest("[data-review-id]");
  if (reviewElement) return "@" + reviewElement.dataset.reviewId;
  if (element.id) return "#" + element.id;
  const semantic = element.closest("h1,h2,h3,h4,h5,h6,p,li,section,article,table,pre");
  const node = semantic || element;
  const siblings = [...node.parentElement.children].filter((item) => item.tagName === node.tagName);
  return node.tagName.toLowerCase() + ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
}

function setCount(id, count, label) {
  document.querySelector(id).textContent = count + " " + label + (count === 1 ? "" : "s");
}

function updateDocumentSummary(doc) {
  const title = doc.querySelector("[data-review-title]")?.textContent?.trim()
    || doc.querySelector("h1")?.textContent?.trim()
    || doc.title
    || "Untitled review";
  const directions = doc.querySelectorAll("[data-review-kind~=direction]").length;
  const decisions = doc.querySelectorAll("[data-review-kind~=decision]").length;
  document.querySelector("#artifact-title").textContent = title;
  document.querySelector("#artifact-kicker").textContent = doc.body.dataset.reviewKicker || "AGENT REVIEW";
  setCount("#direction-count", directions, "direction");
  setCount("#decision-count", decisions, "decision");
}

function clearHighlight() {
  if (highlighted) {
    highlighted.style.outline = previousOutline;
    highlighted.style.outlineOffset = "";
  }
  highlighted = null;
}

function closeAnnotation() {
  layer.hidden = true;
  comment.value = "";
  clearHighlight();
}

function placeCard(element) {
  layer.hidden = false;
  const frameRect = frame.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const width = Math.min(480, innerWidth - 32);
  const cardHeight = card.offsetHeight;
  let left = frameRect.left + elementRect.left;
  let top = frameRect.top + elementRect.bottom + 10;
  left = Math.max(16, Math.min(left, innerWidth - width - 16));
  if (top + cardHeight > innerHeight - 16) {
    const above = frameRect.top + elementRect.top - cardHeight - 10;
    top = above >= frameRect.top + 12
      ? above
      : Math.max(frameRect.top + 12, innerHeight - cardHeight - 16);
  }
  card.style.left = left + "px";
  card.style.top = top + "px";
}

function choose(element, selection = "") {
  clearHighlight();
  highlighted = element;
  previousOutline = highlighted.style.outline;
  highlighted.style.outline = "2px solid #d4ae4e";
  highlighted.style.outlineOffset = "2px";
  activeTarget = selectorFor(element);
  activeSelection = selection.trim().slice(0, 400);
  annotationTitle.textContent = "Annotate " + activeTarget;
  selectionPreview.textContent = activeSelection;
  selectionPreview.hidden = !activeSelection;
  placeCard(element);
  requestAnimationFrame(() => comment.focus());
}

function attachReviewEvents() {
  const doc = frame.contentDocument;
  if (!doc) return;
  closeAnnotation();
  updateDocumentSummary(doc);
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

async function queueFeedback() {
  try {
    await send("/api/feedback", {
      session,
      target: activeTarget,
      selected: activeSelection,
      comment: comment.value,
    });
    closeAnnotation();
    status.textContent = "Feedback queued for the agent.";
  } catch (error) {
    status.textContent = error.message;
  }
}

async function refreshVersion() {
  try {
    const response = await fetch("/api/version?session=" + encodeURIComponent(session), { cache: "no-store" });
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

document.querySelector("#send").addEventListener("click", queueFeedback);
document.querySelector("#cancel").addEventListener("click", closeAnnotation);
comment.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAnnotation();
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    queueFeedback();
  }
});

document.querySelector("#end").addEventListener("click", async () => {
  await send("/api/end", { session });
  closeAnnotation();
  status.textContent = "Review ended.";
});

if (!session) {
  status.textContent = "Missing session identifier.";
} else {
  frame.src = "/artifact?session=" + encodeURIComponent(session);
  frame.addEventListener("load", attachReviewEvents);
  status.textContent = "Click anything in the page to annotate it.";
  refreshVersion();
  setInterval(refreshVersion, 1200);
}

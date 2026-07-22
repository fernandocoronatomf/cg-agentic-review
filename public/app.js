const params = new URLSearchParams(location.search);
const session = params.get("session");
const frame = document.querySelector("#artifact");
const status = document.querySelector("#status");
const layer = document.querySelector("#annotation-layer");
const card = document.querySelector("#annotation-card");
const annotationTitle = document.querySelector("#annotation-title");
const selectionPreview = document.querySelector("#selection-preview");
const comment = document.querySelector("#comment");
const chatPanel = document.querySelector("#chat-panel");
const messages = document.querySelector("#messages");
const chatInput = document.querySelector("#chat-input");
const unread = document.querySelector("#unread");
const areaToggle = document.querySelector("#area-toggle");
const areaLayer = document.querySelector("#area-layer");
const areaSelection = document.querySelector("#area-selection");
const areaHint = document.querySelector(".area-hint");
const screenshotLayer = document.querySelector("#screenshot-layer");
const screenshotCanvas = document.querySelector("#screenshot-canvas");
const screenshotComment = document.querySelector("#screenshot-comment");
const screenshotFile = document.querySelector("#screenshot-file");
const dropHint = document.querySelector("#drop-hint");
const screenshotContext = screenshotCanvas.getContext("2d");
let version = null;
let highlighted = null;
let previousOutline = "";
let activeTarget = "page";
let activeSelection = "";
let activeArea = null;
let areaStart = null;
let screenshotUpload = null;
let screenshotImage = null;
let screenshotStrokes = [];
let currentStroke = null;
let dragDepth = 0;
const knownMessageIds = new Set();

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
  setCount("#direction-count", directions, "path");
  setCount("#decision-count", decisions, "decision");
}

function clearHighlight() {
  if (highlighted) {
    highlighted.style.outline = previousOutline;
    highlighted.style.outlineOffset = "";
  }
  highlighted = null;
}

function resetAreaMode() {
  areaLayer.hidden = true;
  areaSelection.hidden = true;
  areaToggle.classList.remove("active");
  areaStart = null;
  activeArea = null;
}

function activateAreaMode() {
  closeAnnotation();
  closeChat();
  const rect = frame.getBoundingClientRect();
  areaLayer.style.left = rect.left + "px";
  areaLayer.style.top = rect.top + "px";
  areaLayer.style.width = rect.width + "px";
  areaLayer.style.height = rect.height + "px";
  areaLayer.hidden = false;
  areaToggle.classList.add("active");
  areaHint.hidden = false;
  status.textContent = "Drag over any page area, including blank space.";
}

function areaPoint(event) {
  const rect = areaLayer.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
    y: Math.max(0, Math.min(event.clientY - rect.top, rect.height)),
  };
}

function areaRect(start, end) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function drawArea(rect) {
  areaSelection.hidden = false;
  areaSelection.style.left = rect.left + "px";
  areaSelection.style.top = rect.top + "px";
  areaSelection.style.width = rect.width + "px";
  areaSelection.style.height = rect.height + "px";
}

function percent(value, total) {
  return Math.round((value / total) * 1000) / 10;
}

function placeCardAtArea(rect) {
  layer.hidden = false;
  const host = areaLayer.getBoundingClientRect();
  const viewportRect = {
    left: host.left + rect.left,
    top: host.top + rect.top,
    right: host.left + rect.left + rect.width,
    bottom: host.top + rect.top + rect.height,
  };
  const width = Math.min(480, innerWidth - 32);
  const cardHeight = card.offsetHeight;
  let left = viewportRect.right + 10;
  let top = viewportRect.top;
  if (left + width > innerWidth - 16) left = viewportRect.left - width - 10;
  left = Math.max(16, Math.min(left, innerWidth - width - 16));
  if (top + cardHeight > innerHeight - 16) top = Math.max(host.top + 12, innerHeight - cardHeight - 16);
  card.style.left = left + "px";
  card.style.top = top + "px";
}

function finishAreaSelection(rect) {
  areaHint.hidden = true;
  const host = areaLayer.getBoundingClientRect();
  const doc = frame.contentDocument;
  const nearby = doc ? [...doc.querySelectorAll("[data-review-id]")]
    .filter((element) => {
      const elementRect = element.getBoundingClientRect();
      return elementRect.right >= rect.left
        && elementRect.left <= rect.left + rect.width
        && elementRect.bottom >= rect.top
        && elementRect.top <= rect.top + rect.height;
    })
    .map((element) => "@" + element.dataset.reviewId)
    .slice(0, 8) : [];
  activeTarget = "area";
  activeSelection = "";
  activeArea = {
    xPct: percent(rect.left, host.width),
    yPct: percent(rect.top, host.height),
    widthPct: percent(rect.width, host.width),
    heightPct: percent(rect.height, host.height),
    scrollX: Math.round(frame.contentWindow?.scrollX || 0),
    scrollY: Math.round(frame.contentWindow?.scrollY || 0),
    viewportWidth: Math.round(host.width),
    viewportHeight: Math.round(host.height),
    nearby,
  };
  annotationTitle.textContent = "Annotate selected area";
  selectionPreview.textContent = nearby.length
    ? "Near " + nearby.join(", ")
    : "Blank page region";
  selectionPreview.hidden = false;
  placeCardAtArea(rect);
  requestAnimationFrame(() => comment.focus());
}

function closeAnnotation() {
  layer.hidden = true;
  comment.value = "";
  clearHighlight();
  resetAreaMode();
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
  resetAreaMode();
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
  doc.addEventListener("paste", handleScreenshotPaste);
  doc.addEventListener("dragover", handleScreenshotDragover);
  doc.addEventListener("drop", handleScreenshotDrop);
}

async function send(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error((await response.json()).error || "Request failed");
}

async function sendBlob(path, blob) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": blob.type },
    body: blob,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function redrawScreenshot() {
  if (!screenshotImage) return;
  screenshotContext.clearRect(0, 0, screenshotCanvas.width, screenshotCanvas.height);
  screenshotContext.drawImage(screenshotImage, 0, 0);
  screenshotContext.lineCap = "round";
  screenshotContext.lineJoin = "round";
  screenshotContext.strokeStyle = "#ef3f2d";
  screenshotContext.lineWidth = Math.max(4, Math.min(14, screenshotCanvas.width / 220));
  for (const stroke of screenshotStrokes) {
    if (!stroke.length) continue;
    screenshotContext.beginPath();
    screenshotContext.moveTo(stroke[0].x, stroke[0].y);
    for (const point of stroke.slice(1)) screenshotContext.lineTo(point.x, point.y);
    if (stroke.length === 1) screenshotContext.lineTo(stroke[0].x + 0.1, stroke[0].y + 0.1);
    screenshotContext.stroke();
  }
}

function screenshotPoint(event) {
  const rect = screenshotCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (screenshotCanvas.width / rect.width),
    y: (event.clientY - rect.top) * (screenshotCanvas.height / rect.height),
  };
}

function closeScreenshot() {
  screenshotLayer.hidden = true;
  screenshotUpload = null;
  screenshotImage = null;
  screenshotStrokes = [];
  currentStroke = null;
  screenshotComment.value = "";
  screenshotFile.value = "";
}

async function openScreenshot(file) {
  if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    status.textContent = "Choose a PNG, JPEG, or WebP screenshot.";
    return;
  }
  try {
    closeAnnotation();
    closeChat();
    status.textContent = "Preparing screenshot…";
    const uploaded = await sendBlob(
      "/api/upload?session=" + encodeURIComponent(session),
      file,
    );
    const image = new Image();
    image.src = uploaded.url;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Could not load the screenshot"));
    });
    screenshotUpload = uploaded.upload;
    screenshotImage = image;
    screenshotStrokes = [];
    screenshotCanvas.width = image.naturalWidth;
    screenshotCanvas.height = image.naturalHeight;
    redrawScreenshot();
    screenshotLayer.hidden = false;
    screenshotComment.focus();
    status.textContent = "Draw on the screenshot and add an instruction.";
  } catch (error) {
    closeScreenshot();
    status.textContent = error.message;
  }
}

function canvasBlob() {
  return new Promise((resolve, reject) => {
    screenshotCanvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Could not save the annotation")),
      "image/png",
    );
  });
}

async function sendScreenshot() {
  const instruction = screenshotComment.value.trim();
  if (!instruction) {
    screenshotComment.focus();
    status.textContent = "Add an instruction for the agent.";
    return;
  }
  try {
    const upload = screenshotUpload;
    const annotated = await canvasBlob();
    await sendBlob(
      "/api/annotate?session=" + encodeURIComponent(session)
        + "&upload=" + encodeURIComponent(upload),
      annotated,
    );
    await send("/api/screenshot-feedback", { session, upload, comment: instruction });
    closeScreenshot();
    status.textContent = "Annotated screenshot queued for the agent.";
  } catch (error) {
    status.textContent = error.message;
  }
}

async function queueFeedback() {
  try {
    await send("/api/feedback", {
      session,
      target: activeTarget,
      selected: activeSelection,
      area: activeArea,
      comment: comment.value,
    });
    closeAnnotation();
    status.textContent = "Feedback queued for the agent.";
  } catch (error) {
    status.textContent = error.message;
  }
}

async function refreshConversation() {
  try {
    const response = await fetch("/api/conversation?session=" + encodeURIComponent(session), { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    let hasNewAgentMessage = false;
    messages.replaceChildren();
    if (!data.messages.length) {
      const empty = document.createElement("p");
      empty.className = "empty-chat";
      empty.textContent = "Messages sent here go directly to the active agent.";
      messages.append(empty);
    }
    for (const message of data.messages) {
      if (!knownMessageIds.has(message.id) && message.role === "agent") hasNewAgentMessage = true;
      knownMessageIds.add(message.id);
      const bubble = document.createElement("div");
      bubble.className = "message " + (message.kind === "annotation" ? "annotation" : message.role);
      bubble.textContent = message.text;
      messages.append(bubble);
    }
    if (hasNewAgentMessage && chatPanel.hidden) unread.hidden = false;
    if (!chatPanel.hidden) messages.scrollTop = messages.scrollHeight;
  } catch {}
}

function openChat() {
  chatPanel.hidden = false;
  unread.hidden = true;
  refreshConversation();
  requestAnimationFrame(() => chatInput.focus());
}

function closeChat() {
  chatPanel.hidden = true;
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  try {
    await send("/api/chat", { session, text });
    chatInput.value = "";
    status.textContent = "Message sent to the agent.";
    await refreshConversation();
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

areaToggle.addEventListener("click", () => {
  if (areaLayer.hidden) activateAreaMode();
  else {
    closeAnnotation();
    status.textContent = "Area selection cancelled.";
  }
});

areaLayer.addEventListener("pointerdown", (event) => {
  closeAnnotation();
  activateAreaMode();
  areaStart = areaPoint(event);
  areaLayer.setPointerCapture(event.pointerId);
  drawArea(areaRect(areaStart, areaStart));
});

areaLayer.addEventListener("pointermove", (event) => {
  if (!areaStart) return;
  drawArea(areaRect(areaStart, areaPoint(event)));
});

areaLayer.addEventListener("pointerup", (event) => {
  if (!areaStart) return;
  const rect = areaRect(areaStart, areaPoint(event));
  areaStart = null;
  if (rect.width < 12 || rect.height < 12) {
    closeAnnotation();
    status.textContent = "Drag a larger area to annotate it.";
    return;
  }
  finishAreaSelection(rect);
  status.textContent = "Describe what should change in the selected area.";
});

document.querySelector("#screenshot-toggle").addEventListener("click", () => screenshotFile.click());
document.querySelector("#screenshot-close").addEventListener("click", closeScreenshot);
document.querySelector("#screenshot-cancel").addEventListener("click", closeScreenshot);
document.querySelector("#screenshot-send").addEventListener("click", sendScreenshot);
document.querySelector("#screenshot-undo").addEventListener("click", () => {
  screenshotStrokes.pop();
  redrawScreenshot();
});
document.querySelector("#screenshot-clear").addEventListener("click", () => {
  screenshotStrokes = [];
  redrawScreenshot();
});
screenshotFile.addEventListener("change", () => openScreenshot(screenshotFile.files[0]));
screenshotComment.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeScreenshot();
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendScreenshot();
  }
});
screenshotCanvas.addEventListener("pointerdown", (event) => {
  currentStroke = [screenshotPoint(event)];
  screenshotStrokes.push(currentStroke);
  screenshotCanvas.setPointerCapture(event.pointerId);
  redrawScreenshot();
});
screenshotCanvas.addEventListener("pointermove", (event) => {
  if (!currentStroke) return;
  currentStroke.push(screenshotPoint(event));
  redrawScreenshot();
});
function finishScreenshotStroke() {
  currentStroke = null;
}
screenshotCanvas.addEventListener("pointerup", finishScreenshotStroke);
screenshotCanvas.addEventListener("pointercancel", finishScreenshotStroke);

function handleScreenshotPaste(event) {
  const item = [...(event.clipboardData?.items || [])].find((candidate) => candidate.type.startsWith("image/"));
  if (!item) return;
  event.preventDefault();
  openScreenshot(item.getAsFile());
}

function handleScreenshotDragover(event) {
  if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
  event.preventDefault();
}

function handleScreenshotDrop(event) {
  if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
  event.preventDefault();
  dragDepth = 0;
  dropHint.hidden = true;
  const file = [...(event.dataTransfer?.files || [])].find((candidate) => candidate.type.startsWith("image/"));
  if (file) openScreenshot(file);
}

document.addEventListener("paste", handleScreenshotPaste);
document.addEventListener("dragenter", (event) => {
  if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
  event.preventDefault();
  dragDepth += 1;
  dropHint.hidden = false;
});
document.addEventListener("dragover", handleScreenshotDragover);
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropHint.hidden = true;
});
document.addEventListener("drop", handleScreenshotDrop);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !screenshotLayer.hidden) {
    closeScreenshot();
    status.textContent = "Screenshot annotation cancelled.";
    return;
  }
  if (event.key === "Escape" && !areaLayer.hidden) {
    closeAnnotation();
    status.textContent = "Area selection cancelled.";
  }
});

document.querySelector("#chat-toggle").addEventListener("click", openChat);
document.querySelector("#chat-close").addEventListener("click", closeChat);
document.querySelector("#chat-send").addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendChat();
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
  status.textContent = "Click, select an area, or paste a screenshot to annotate.";
  refreshVersion();
  refreshConversation();
  setInterval(refreshVersion, 1200);
  setInterval(refreshConversation, 1200);
}

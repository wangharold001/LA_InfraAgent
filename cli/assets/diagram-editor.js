/** Injected by InfraAgent renderer (see diagram-services.js). */
const _pack =
  typeof __DIAGRAM_SERVICE_PACK__ !== "undefined" &&
  __DIAGRAM_SERVICE_PACK__ &&
  __DIAGRAM_SERVICE_PACK__.SERVICE_META
    ? __DIAGRAM_SERVICE_PACK__
    : null;
if (!_pack || !Object.keys(_pack.SERVICE_META || {}).length) {
  console.error(
    "[InfraAgent] Diagram service pack missing. Run `infra-agent` or `diagram` from the repo so the HTML is hydrated with __DIAGRAM_SERVICE_PACK__."
  );
}
const SERVICE_META = _pack?.SERVICE_META || {};
const CDK_META = _pack?.CDK_META || {};
const NODE_CDK_DEFAULTS = _pack?.NODE_CDK_DEFAULTS || {};
const EDGE_RELATIONSHIPS = _pack?.EDGE_RELATIONSHIPS || [];

const NODE_MIN_W = 140;
const NODE_H = 56;

const _textMeasureCanvas = document.createElement("canvas");
const _textMeasureCtx = _textMeasureCanvas.getContext("2d");

function nodeWidth(n) {
  const meta = SERVICE_META[n.type] || { label: n.type };
  const label = n.label || meta.label;
  const sub = meta.label.toLowerCase();
  _textMeasureCtx.font = "500 13px ui-sans-serif, -apple-system, system-ui, sans-serif";
  const titleW = _textMeasureCtx.measureText(label).width;
  _textMeasureCtx.font = "11px ui-monospace, 'SF Mono', Consolas, monospace";
  const subW = _textMeasureCtx.measureText(sub).width;
  const needed = 40 + Math.max(titleW, subW) + 16;
  return Math.max(NODE_MIN_W, Math.ceil(needed / 10) * 10);
}

function measureEdgeLabelWidth(text) {
  _textMeasureCtx.font = "12px ui-sans-serif, -apple-system, system-ui, sans-serif";
  return _textMeasureCtx.measureText(text).width;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// __STATE_JSON_PATH__ and __SERVER_PORT__ are injected by the CLI via the
// inline <script id="cli-config"> block in the HTML shell.
let state = __DIAGRAM_STATE__ || freshState();
let selection = null;
let viewport = { x: 0, y: 0, z: 1 };
let fileName = "untitled.arch.json";

// ── Auto-save (CLI server mode) ───────────────────────────────────────────
let _saveTimer = null;

function _scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_doSave, 600);
}

async function _doSave() {
  if (!__SERVER_PORT__) return;
  const el = document.getElementById("saveStatus");
  try {
    const res = await fetch(`http://127.0.0.1:${__SERVER_PORT__}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state, null, 2),
    });
    el.textContent = res.ok ? "✓ saved" : "⚠ save failed";
    el.style.color  = res.ok ? "#1d9e75" : "#d85a30";
  } catch {
    el.textContent = "⚠ server unreachable";
    el.style.color  = "#d85a30";
  }
}

// ── JSON editor (bottom pane) ─────────────────────────────────────────────
function _applyJsonEdit() {
  const ta = document.getElementById("jsonEdit");
  try {
    const parsed = JSON.parse(ta.value);
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges))
      throw new Error("Top-level 'nodes' and 'edges' arrays are required.");
    state = parsed;
    selection = null;
    render();
  } catch (e) {
    alert("Invalid JSON: " + e.message);
  }
}

function freshState() {
  return {
    schemaVersion: "0.2.0",
    metadata: {
      name: "Untitled",
      stackName: "",
      region: "us-east-1",
      account: "",
      environment: "dev",
      createdAt: new Date().toISOString()
    },
    nodes: [],
    edges: []
  };
}

function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 8);
}

function toPascalCase(str) {
  return (str || "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(" ").filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

const canvas = document.getElementById("canvas");
const nodesLayer = document.getElementById("nodes");
const edgesLayer = document.getElementById("edges");
const edgeLabelsLayer = document.getElementById("edgeLabels");
const viewportG = document.getElementById("viewport");
const edgePreview = document.getElementById("edgePreview");
const inspector = document.getElementById("inspector");
const jsonInfo = document.getElementById("jsonInfo");
const fileNameEl = document.getElementById("fileName");

function render() {
  edgesLayer.innerHTML = "";
  edgeLabelsLayer.innerHTML = "";

  for (const e of state.edges) {
    const src = state.nodes.find(n => n.id === e.from);
    const dst = state.nodes.find(n => n.id === e.to);
    if (!src || !dst) continue;
    const offset = edgePerpOffset(e);
    const path = edgePath(src, dst, offset);
    const g = svg("g");
    const hit = svg("path", { class: "edge-hit", d: path });
    hit.dataset.edgeId = e.id;
    const isSel = selection && selection.kind === "edge" && selection.id === e.id;
    const visible = svg("path", {
      class: "edge" + (isSel ? " selected" : ""),
      d: path,
      "marker-end": isSel ? "url(#arrowhead-sel)" : "url(#arrowhead)"
    });
    visible.dataset.edgeId = e.id;
    g.appendChild(hit);
    g.appendChild(visible);
    g.addEventListener("dblclick", ev => {
      ev.stopPropagation();
      const mid = pathMidpoint(src, dst, offset);
      startEdgeEdit(e, mid.x, mid.y);
    });
    edgesLayer.appendChild(g);
  }

  nodesLayer.innerHTML = "";
  for (const n of state.nodes) {
    nodesLayer.appendChild(renderNode(n));
  }

  // Render edge labels last so they always appear above nodes
  for (const e of state.edges) {
    if (!e.label) continue;
    const src = state.nodes.find(n => n.id === e.from);
    const dst = state.nodes.find(n => n.id === e.to);
    if (!src || !dst) continue;
    const mid = pathMidpoint(src, dst, edgePerpOffset(e));
    const lw = measureEdgeLabelWidth(e.label);
    const padX = 7, rh = 18;
    const rw = lw + padX * 2;
    const lg = svg("g");
    lg.appendChild(svg("rect", {
      x: mid.x - rw / 2, y: mid.y - rh / 2,
      width: rw, height: rh, rx: 3,
      fill: "white", stroke: "#d9d7ce", "stroke-width": "1"
    }));
    const text = svg("text", { class: "edge-label", x: mid.x, y: mid.y });
    text.textContent = e.label;
    lg.appendChild(text);
    edgeLabelsLayer.appendChild(lg);
  }

  viewportG.setAttribute("transform", `translate(${viewport.x} ${viewport.y}) scale(${viewport.z})`);
  renderInspector();
  renderJson();
  updateCostDisplay();
  if (activeRightPanel === "billing") renderBillingPanel();
}

function renderNode(n) {
  const meta = SERVICE_META[n.type] || { label: n.type, color: "#888" };
  const isSel = selection && selection.kind === "node" && selection.id === n.id;
  const nw = nodeWidth(n);
  const g = svg("g", {
    class: "node-group" + (isSel ? " selected" : ""),
    transform: `translate(${n.x} ${n.y})`
  });
  g.dataset.nodeId = n.id;

  g.appendChild(svg("rect", { class: "node-rect", x: 0, y: 0, width: nw, height: NODE_H, rx: 4 }));
  const iconId = "icon-" + n.type;
  const iconHref = document.getElementById(iconId) ? "#" + iconId : "#icon-generic-aws";
  g.appendChild(svg("use", { href: iconHref, x: 8, y: (NODE_H - 24) / 2, width: 24, height: 24, "pointer-events": "none" }));

  const title = svg("text", { class: "node-title", x: 40, y: NODE_H / 2 - 4 });
  title.textContent = n.label || meta.label;
  g.appendChild(title);

  const sub = svg("text", { class: "node-sub", x: 40, y: NODE_H / 2 + 10 });
  sub.textContent = meta.label.toLowerCase();
  g.appendChild(sub);

  const port = svg("circle", { class: "node-port", cx: nw, cy: NODE_H / 2, r: 5 });
  port.dataset.nodeId = n.id;
  port.dataset.role = "port";
  g.appendChild(port);

  g.addEventListener("dblclick", e => {
    e.stopPropagation();
    startNodeEdit(n);
  });

  return g;
}

const BIDIR_OFFSET = 9;

function edgePerpOffset(e) {
  const hasPair = state.edges.some(o => o.from === e.to && o.to === e.from);
  if (!hasPair) return 0;
  return e.from < e.to ? -BIDIR_OFFSET : BIDIR_OFFSET;
}

// Returns port positions + cubic bezier control points.
// perpOffset shifts the path perpendicular to its direction (for bidirectional pairs).
function getBestPorts(src, dst, perpOffset = 0) {
  const srcW = nodeWidth(src), dstW = nodeWidth(dst);
  const srcCx = src.x + srcW / 2, srcCy = src.y + NODE_H / 2;
  const dstCx = dst.x + dstW / 2, dstCy = dst.y + NODE_H / 2;
  const dx = dstCx - srcCx, dy = dstCy - srcCy;
  let p;
  if (Math.abs(dx) >= Math.abs(dy)) {
    p = dx >= 0
      ? { sx: src.x + srcW, sy: srcCy, tx: dst.x,        ty: dstCy, horiz: true,  dir: 1  }
      : { sx: src.x,        sy: srcCy, tx: dst.x + dstW, ty: dstCy, horiz: true,  dir: -1 };
    p.sy += perpOffset; p.ty += perpOffset;
  } else {
    p = dy >= 0
      ? { sx: srcCx, sy: src.y + NODE_H, tx: dstCx, ty: dst.y,          horiz: false, dir: 1  }
      : { sx: srcCx, sy: src.y,          tx: dstCx, ty: dst.y + NODE_H, horiz: false, dir: -1 };
    p.sx += perpOffset; p.tx += perpOffset;
  }
  if (p.horiz) {
    const off = Math.max(40, Math.abs(p.tx - p.sx) * 0.5);
    p.cp1x = p.sx + p.dir * off; p.cp1y = p.sy;
    p.cp2x = p.tx - p.dir * off; p.cp2y = p.ty;
  } else {
    const off = Math.max(40, Math.abs(p.ty - p.sy) * 0.5);
    p.cp1x = p.sx; p.cp1y = p.sy + p.dir * off;
    p.cp2x = p.tx; p.cp2y = p.ty - p.dir * off;
  }
  return p;
}

function edgePath(src, dst, perpOffset = 0) {
  const p = getBestPorts(src, dst, perpOffset);
  return `M${p.sx},${p.sy} C${p.cp1x},${p.cp1y} ${p.cp2x},${p.cp2y} ${p.tx},${p.ty}`;
}

// Actual bezier midpoint at t=0.5: B(t) = 0.125*P0 + 0.375*P1 + 0.375*P2 + 0.125*P3
function pathMidpoint(src, dst, perpOffset = 0) {
  const p = getBestPorts(src, dst, perpOffset);
  return {
    x: 0.125 * p.sx + 0.375 * p.cp1x + 0.375 * p.cp2x + 0.125 * p.tx,
    y: 0.125 * p.sy + 0.375 * p.cp1y + 0.375 * p.cp2y + 0.125 * p.ty,
  };
}

function applySelection(kind, id) {
  selection = kind ? { kind, id } : null;
  for (const el of nodesLayer.querySelectorAll(".node-group")) {
    el.classList.toggle("selected", kind === "node" && el.dataset.nodeId === id);
  }
  for (const el of edgesLayer.querySelectorAll(".edge")) {
    const isSel = kind === "edge" && el.dataset.edgeId === id;
    el.classList.toggle("selected", isSel);
    el.setAttribute("marker-end", isSel ? "url(#arrowhead-sel)" : "url(#arrowhead)");
  }
  renderInspector();
  renderJson();
}

function svg(name, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function renderInspector() {
  inspector.innerHTML = "<h3>Inspector</h3>";

  // ── Nothing selected → show diagram metadata ──
  if (!selection) {
    const m = state.metadata;
    inspector.appendChild(field("Diagram name", m.name       || "", v => { m.name       = v; renderJson(); }));
    inspector.appendChild(field("Stack name",   m.stackName  || "", v => { m.stackName  = v; renderJson(); }));
    inspector.appendChild(field("Region",       m.region     || "", v => { m.region     = v; renderJson(); }));
    inspector.appendChild(field("Account ID",   m.account    || "", v => { m.account    = v; renderJson(); }));
    inspector.appendChild(field("Environment",  m.environment|| "", v => { m.environment= v; renderJson(); }));
    const hint = document.createElement("div");
    hint.className = "empty";
    hint.style.marginTop = "12px";
    hint.textContent = "Click a node or edge to edit its CDK properties.";
    inspector.appendChild(hint);
    return;
  }

  // ── Node inspector ──
  if (selection.kind === "node") {
    const n = state.nodes.find(x => x.id === selection.id);
    if (!n) { selection = null; return renderInspector(); }

    inspector.appendChild(field("ID",            n.id,                                          null, true));
    inspector.appendChild(field("Service",       SERVICE_META[n.type]?.label || n.type,         null, true));
    inspector.appendChild(field("CDK Construct", n.cdkConstruct || "—",                         null, true));
    inspector.appendChild(field("CDK Module",    n.cdkModule    || "—",                         null, true));
    inspector.appendChild(field("Label",         n.label || "",    v => { n.label   = v; render(); }));
    inspector.appendChild(field("CDK ID",        n.cdkId  || "",   v => { n.cdkId  = v; renderJson(); }));
    inspector.appendChild(textareaField("Notes", n.notes  || "",   v => { n.notes  = v; renderJson(); }, 2));

    // Props JSON
    const propsField = document.createElement("div");
    propsField.className = "field";
    const propsLbl = document.createElement("label");
    propsLbl.textContent = "CDK Props (JSON)";
    const propsTa = document.createElement("textarea");
    propsTa.style.minHeight = "160px";
    propsTa.value = JSON.stringify(n.props || {}, null, 2);
    propsTa.addEventListener("change", () => {
      try   { n.props = JSON.parse(propsTa.value); render(); }
      catch (e) { alert("Invalid JSON: " + e.message); propsTa.value = JSON.stringify(n.props || {}, null, 2); }
    });
    propsField.appendChild(propsLbl);
    propsField.appendChild(propsTa);
    inspector.appendChild(propsField);

    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "Delete node";
    del.addEventListener("click", () => deleteNode(n.id));
    inspector.appendChild(del);
  }

  // ── Edge inspector ──
  if (selection.kind === "edge") {
    const e = state.edges.find(x => x.id === selection.id);
    if (!e) { selection = null; return renderInspector(); }

    const srcNode = state.nodes.find(n => n.id === e.from);
    const dstNode = state.nodes.find(n => n.id === e.to);

    inspector.appendChild(field("ID",    e.id,                                                null, true));
    inspector.appendChild(field("From",  srcNode ? `${srcNode.label} (${e.from})` : e.from,  null, true));
    inspector.appendChild(field("To",    dstNode ? `${dstNode.label} (${e.to})`   : e.to,    null, true));
    inspector.appendChild(field("Label", e.label || "", v => { e.label = v; render(); }));

    // Relationship select
    const relWrap = document.createElement("div"); relWrap.className = "field";
    const relLbl  = document.createElement("label"); relLbl.textContent = "Relationship";
    const relSel  = document.createElement("select");
    EDGE_RELATIONSHIPS.forEach(r => {
      const opt = document.createElement("option");
      opt.value = r; opt.textContent = r;
      if (r === (e.relationship || "invoke")) opt.selected = true;
      relSel.appendChild(opt);
    });
    relSel.addEventListener("change", () => { e.relationship = relSel.value; renderJson(); });
    relWrap.appendChild(relLbl); relWrap.appendChild(relSel);
    inspector.appendChild(relWrap);

    inspector.appendChild(field("Protocol", e.protocol || "", v => { e.protocol = v; renderJson(); }));
    inspector.appendChild(field("CDK Method", e.cdkMethod || "", v => { e.cdkMethod = v; renderJson(); }, false, "e.g. table.grantReadWriteData(fn)"));

    // IAM Actions textarea
    const actWrap = document.createElement("div"); actWrap.className = "field";
    const actLbl  = document.createElement("label"); actLbl.textContent = "IAM Actions (JSON array)";
    const actTa   = document.createElement("textarea");
    actTa.style.minHeight = "70px";
    actTa.value = JSON.stringify(e.iamActions || [], null, 2);
    actTa.addEventListener("change", () => {
      try   { e.iamActions = JSON.parse(actTa.value); renderJson(); }
      catch (err) { alert("Invalid JSON: " + err.message); actTa.value = JSON.stringify(e.iamActions || [], null, 2); }
    });
    actWrap.appendChild(actLbl); actWrap.appendChild(actTa);
    inspector.appendChild(actWrap);

    inspector.appendChild(textareaField("Notes", e.notes || "", v => { e.notes = v; renderJson(); }, 2));

    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "Delete edge";
    del.addEventListener("click", () => deleteEdge(e.id));
    inspector.appendChild(del);
  }
}

function field(label, value, onChange, readonly, placeholder) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const lbl = document.createElement("label");
  lbl.textContent = label;
  const input = document.createElement("input");
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  if (readonly) input.disabled = true;
  if (onChange) input.addEventListener("change", e => onChange(e.target.value));
  wrap.appendChild(lbl);
  wrap.appendChild(input);
  return wrap;
}

function textareaField(label, value, onChange, rows) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const lbl = document.createElement("label");
  lbl.textContent = label;
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.rows = rows || 3;
  if (onChange) ta.addEventListener("change", e => onChange(e.target.value));
  wrap.appendChild(lbl);
  wrap.appendChild(ta);
  return wrap;
}

function renderJson() {
  const json = JSON.stringify(state, null, 2);
  const ta = document.getElementById("jsonEdit");
  if (document.activeElement !== ta) ta.value = json;
  jsonInfo.textContent = state.nodes.length + " node" + (state.nodes.length === 1 ? "" : "s") + ", " + state.edges.length + " edge" + (state.edges.length === 1 ? "" : "s");
  fileNameEl.textContent = fileName;
  _scheduleSave();
}

function addNode(type, x, y) {
  const meta    = SERVICE_META[type] || { label: type };
  const cdkMeta = CDK_META[type]    || { construct: null, module: null };
  const label   = meta.label;
  const n = {
    id: uid("n"), type, label,
    cdkConstruct: cdkMeta.construct,
    cdkModule:    cdkMeta.module,
    cdkId:        toPascalCase(label),
    notes:        "",
    x: Math.round(x / 10) * 10,
    y: Math.round(y / 10) * 10,
    props: { ...(NODE_CDK_DEFAULTS[type] || {}) }
  };
  state.nodes.push(n);
  selection = { kind: "node", id: n.id };
  render();
}

function addEdge(from, to) {
  if (from === to) return;
  const e = { id: uid("e"), from, to, label: "" };
  state.edges.push(e);
  selection = { kind: "edge", id: e.id };
  render();
}

function deleteNode(id) {
  state.nodes = state.nodes.filter(n => n.id !== id);
  state.edges = state.edges.filter(e => e.from !== id && e.to !== id);
  selection = null;
  render();
}

function deleteEdge(id) {
  state.edges = state.edges.filter(e => e.id !== id);
  selection = null;
  render();
}

let drag = null;

function wirePalette() {
  // Service drag chips (delegated so injected palette updates still work)
  const palette = document.querySelector(".palette");
  if (palette && !palette.dataset.wired) {
    palette.dataset.wired = "true";
    palette.addEventListener("dragstart", (e) => {
      const item = e.target && e.target.closest ? e.target.closest(".palette-item") : null;
      if (!item) return;
      e.dataTransfer.setData("text/aws-type", item.dataset.type);
      e.dataTransfer.setData("text/plain", item.dataset.type);
      e.dataTransfer.effectAllowed = "copy";
    });

    palette.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest(".palette-cat") : null;
      if (!btn) return;
      const group = btn.dataset.group;
      document.querySelectorAll(".palette-cat").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      document.querySelectorAll(".palette-group-panel").forEach((p) => {
        p.classList.toggle("active", p.dataset.group === group);
      });
      // When selecting a category, expand the palette so services are visible.
      document.querySelector(".app")?.classList.add("palette-expanded");
    });
  }
}

wirePalette();
// Start with palette expanded so the default "Compute" services render clearly.
document.querySelector(".app")?.classList.add("palette-expanded");

// ── Trash drop (drag node to delete) ───────────────────────────────────────

const trashDrop = document.getElementById("trashDrop");
const ctxMenu = document.getElementById("ctxMenu");
const ctxDelete = document.getElementById("ctxDelete");
let _ctxTarget = null; // { kind: "node"|"edge", id: string }

function isPointInEl(clientX, clientY, el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

function setTrashVisible(on) {
  if (!trashDrop) return;
  trashDrop.classList.toggle("visible", !!on);
  if (!on) trashDrop.classList.remove("hot");
}

function setTrashHot(on) {
  if (!trashDrop) return;
  trashDrop.classList.toggle("hot", !!on);
}

function hideCtxMenu() {
  if (!ctxMenu) return;
  ctxMenu.style.display = "none";
  _ctxTarget = null;
}

function showCtxMenu(clientX, clientY, target) {
  if (!ctxMenu) return;
  _ctxTarget = target;
  const pad = 8;
  const vw = window.innerWidth, vh = window.innerHeight;
  ctxMenu.style.display = "";
  // Position after display so we can clamp with actual size.
  const r = ctxMenu.getBoundingClientRect();
  const left = Math.min(vw - r.width - pad, Math.max(pad, clientX));
  const top = Math.min(vh - r.height - pad, Math.max(pad, clientY));
  ctxMenu.style.left = left + "px";
  ctxMenu.style.top = top + "px";
}

// ── Right pane switching ─────────────────────────────────────────────────────

let activeRightPanel = "inspector";

const billingBody = document.getElementById("billingBody");
const chatCostEl = document.getElementById("chatCost");
const topSearch = document.getElementById("topSearch");
const topSearchSuggest = document.getElementById("topSearchSuggest");
const rightPaneMeta = document.getElementById("rightPaneMeta");

function setRightPane(panel) {
  activeRightPanel = panel;
  document.querySelectorAll(".right-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.panel === panel);
  });
  document.querySelectorAll(".right-panel").forEach((p) => {
    p.classList.toggle("active", p.dataset.panel === panel);
  });
  if (panel === "billing") renderBillingPanel();
  // Inspector renders continuously with selection; chat is its own UI.
}

document.querySelectorAll(".right-tab").forEach((b) => {
  b.addEventListener("click", () => setRightPane(b.dataset.panel));
});

// Topbar buttons removed; right-pane tabs handle switching.

// AWS public pricing (us-east-1-ish on-demand) — rough baseline
const AWS_PRICING = {
  lambda: (p) => {
    const invocations = 1_000_000;
    const memGB = (p.memorySize || 512) / 1024;
    const durSec = Math.min(p.timeout || 3, 900);
    const gbSec = invocations * memGB * durSec;
    const reqCost = Math.max(0, invocations - 1_000_000) * 0.2 / 1_000_000;
    const compCost = Math.max(0, gbSec - 400_000) * 0.0000166667;
    return reqCost + compCost;
  },
  ec2: (p) => {
    const RATES = {
      T3_NANO: 0.0052, T3_MICRO: 0.0104, T3_SMALL: 0.0208, T3_MEDIUM: 0.0416,
      T3_LARGE: 0.0832, T3_XLARGE: 0.1664, T3_2XLARGE: 0.3328,
      M5_LARGE: 0.0960, M5_XLARGE: 0.1920, M5_2XLARGE: 0.3840,
      C5_LARGE: 0.0850, C5_XLARGE: 0.1700, C5_2XLARGE: 0.3400,
    };
    const key = (p.instanceType || "T3_MICRO").toUpperCase().replace(/[.\-]/g, "_");
    return (RATES[key] || RATES.T3_MICRO) * 730;
  },
  fargate: (p) => {
    const vcpu = (p.cpu || 256) / 1024;
    const mem = (p.memoryLimitMiB || 512) / 1024;
    return (vcpu * 0.04048 + mem * 0.004445) * 730 * (p.desiredCount || 1);
  },
  rds: (p) => {
    const RATES = {
      T3_MICRO: 0.018, T3_SMALL: 0.034, T3_MEDIUM: 0.068, T3_LARGE: 0.136,
      T4G_MICRO: 0.016, T4G_SMALL: 0.032, T4G_MEDIUM: 0.064,
      M5_LARGE: 0.240, M5_XLARGE: 0.480, R5_LARGE: 0.240, R5_XLARGE: 0.480,
    };
    const key = `${p.instanceClass || "T3"}_${p.instanceSize || "MICRO"}`.toUpperCase();
    const hrRate = RATES[key] || RATES.T3_MICRO;
    return hrRate * 730 * (p.multiAz ? 2 : 1) + (p.allocatedStorage || 20) * 0.115;
  },
  dynamodb: () => 1_000_000 * 0.25 / 1_000_000 + 500_000 * 1.25 / 1_000_000 + 1 * 0.25,
  s3: () => 10 * 0.023 + 100 * 0.005 + 1000 * 0.0004,
  elasticache: (p) => {
    const RATES = {
      "CACHE.T3.MICRO": 0.017, "CACHE.T3.SMALL": 0.034, "CACHE.T3.MEDIUM": 0.068,
      "CACHE.M6G.LARGE": 0.154, "CACHE.R6G.LARGE": 0.218,
      "CACHE.T4G.MICRO": 0.016, "CACHE.T4G.SMALL": 0.032,
    };
    const key = (p.cacheNodeType || "cache.t3.micro").toUpperCase();
    return (RATES[key] || RATES["CACHE.T3.MICRO"]) * 730 * (p.numCacheNodes || 1);
  },
  sqs: (p) => (Math.max(0, 2_000_000 - 1_000_000) / 1_000_000) * (p.fifo ? 0.50 : 0.40),
  sns: () => 1_000_000 * 0.50 / 1_000_000,
  apigateway: (p) => {
    const RATES = { REST: 3.50, HTTP: 1.00, WEBSOCKET: 1.00 };
    const type = (p.apiType || "HTTP").toUpperCase();
    return 1_000_000 / 1_000_000 * (RATES[type] || 1.00);
  },
  alb: () => (0.008 + 0.008) * 730,
  vpc: (p) => {
    const nat = p.natGateways ?? 1;
    return nat === 0 ? 0 : (0.045 * 730 + 10 * 0.045) * nat;
  },
  cloudfront: () => 50 * 0.0085 + 1_000_000 / 10_000 * 0.0100,
  external: () => 0,
  user: () => 0,
};

function estimateMonthlyAWSCost() {
  return state.nodes.reduce((sum, n) => {
    const fn = AWS_PRICING[n.type];
    return sum + (fn ? fn(n.props || {}) : 0);
  }, 0);
}

function updateCostDisplay() {
  if (!chatCostEl) return;
  const awsCost = estimateMonthlyAWSCost();
  chatCostEl.textContent = `~$${awsCost.toFixed(2)}/mo`;
}

function nodeConfigSummary(n) {
  const p = n.props || {};
  switch (n.type) {
    case "lambda": return `${p.runtime || "NODEJS_20_X"} · ${p.memorySize || 512} MB · ${p.timeout || 3}s`;
    case "ec2": return p.instanceType || "T3_MICRO";
    case "fargate": return `${p.cpu || 256} CPU · ${p.memoryLimitMiB || 512} MB · ×${p.desiredCount || 1}`;
    case "rds": return `${p.engine || "POSTGRES"} ${p.instanceClass || "T3"}.${p.instanceSize || "MICRO"}${p.multiAz ? " · Multi-AZ" : ""}`;
    case "dynamodb": return `${p.billingMode || "PAY_PER_REQUEST"}${p.stream && p.stream !== "NONE" ? " · Stream" : ""}`;
    case "s3": return `${p.encryption || "S3_MANAGED"} · ${p.versioned ? "Versioned" : "Unversioned"}`;
    case "elasticache": return `${p.cacheNodeType || "cache.t3.micro"} · ×${p.numCacheNodes || 1}`;
    case "sqs": return `${p.fifo ? "FIFO" : "Standard"} · vis ${p.visibilityTimeout || 30}s`;
    case "sns": return p.fifo ? "FIFO" : "Standard";
    case "apigateway": return `${p.apiType || "HTTP"} · stage ${p.stageName || "prod"}`;
    case "alb": return `${p.internetFacing ? "Public" : "Internal"} · port ${p.listenerPort || 443}`;
    case "vpc": return `${p.cidr || "10.0.0.0/16"} · ${p.maxAzs || 2} AZ · ${p.natGateways ?? 1} NAT`;
    case "cloudfront": return `${p.priceClass || "PRICE_CLASS_100"} · ${p.httpVersion || "HTTP2"}`;
    default: return "";
  }
}

function renderBillingPanel() {
  if (!billingBody) return;
  billingBody.innerHTML = "";

  const awsCost = estimateMonthlyAWSCost();

  const summary = document.createElement("div");
  summary.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:10px;">
      <div style="color:var(--muted);font-size:12px;">Monthly AWS (rough)</div>
      <div style="font-family:var(--mono);font-size:13px;font-weight:600;">~$${awsCost.toFixed(2)}/mo</div>
    </div>
    <div style="color:var(--muted);font-size:11px;line-height:1.5;margin-bottom:10px;">
      Assumptions: Lambda 1M invocations/mo, DynamoDB 1M reads + 500K writes + 1 GB, S3 10 GB + 100K PUT + 1M GET, SQS/SNS 2M req, CloudFront 50 GB + 1M req. On-demand pricing.
    </div>
  `;
  billingBody.appendChild(summary);

  const billable = state.nodes
    .filter(n => AWS_PRICING[n.type] && n.type !== "external" && n.type !== "user")
    .map(n => ({ ...n, est: AWS_PRICING[n.type](n.props || {}) }))
    .sort((a, b) => b.est - a.est);

  const title = document.createElement("div");
  title.textContent = "AWS resources (estimated)";
  title.style.fontSize = "11px";
  title.style.letterSpacing = "0.06em";
  title.style.textTransform = "uppercase";
  title.style.color = "var(--muted)";
  title.style.margin = "8px 0 6px";
  billingBody.appendChild(title);

  if (!billable.length) {
    const empty = document.createElement("div");
    empty.textContent = "No billable AWS resources in diagram yet.";
    empty.style.color = "var(--muted)";
    empty.style.fontStyle = "italic";
    empty.style.fontSize = "13px";
    billingBody.appendChild(empty);
    return;
  }

  for (const n of billable) {
    const meta = SERVICE_META[n.type] || { label: n.type, color: "#888" };
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "10px 1fr auto";
    row.style.gap = "8px";
    row.style.alignItems = "center";
    row.style.padding = "8px 8px";
    row.style.border = "1px solid var(--line)";
    row.style.borderRadius = "8px";
    row.style.marginBottom = "6px";
    row.innerHTML = `
      <span style="width:10px;height:10px;border-radius:50%;background:${meta.color};display:inline-block"></span>
      <div style="min-width:0">
        <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.label || meta.label}</div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${meta.label} · ${nodeConfigSummary(n)}</div>
      </div>
      <div style="font-family:var(--mono);font-size:12px;white-space:nowrap">${n.est === 0 ? "free tier" : `$${n.est.toFixed(2)}/mo`}</div>
    `;
    billingBody.appendChild(row);
  }
}

// ── Locator ────────────────────────────────────────────────────────────────

function centerOnNode(id) {
  const n = state.nodes.find((x) => x.id === id);
  if (!n) return;
  const rect = canvas.getBoundingClientRect();
  const nw = nodeWidth(n);
  const cx = n.x + nw / 2;
  const cy = n.y + NODE_H / 2;
  viewport.x = rect.width / 2 - cx * viewport.z;
  viewport.y = rect.height / 2 - cy * viewport.z;
  viewportG.setAttribute("transform", `translate(${viewport.x} ${viewport.y}) scale(${viewport.z})`);
}

function findBestNodeMatch(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return null;
  let best = null;
  for (const n of state.nodes) {
    const meta = SERVICE_META[n.type] || { label: n.type };
    const name = (n.label || meta.label || n.type);
    const hay = `${name} ${n.id} ${n.type} ${meta.label}`.toLowerCase();
    if (!hay.includes(q)) continue;
    // Prefer label/name matches over id/type-only matches.
    const score =
      (name.toLowerCase().includes(q) ? 3 : 0) +
      (String(n.id).toLowerCase().includes(q) ? 2 : 0) +
      (String(n.type).toLowerCase().includes(q) ? 1 : 0);
    if (!best || score > best.score) best = { n, score };
  }
  return best?.n || null;
}

function topSearchCandidates(query) {
  const q = (query || "").trim().toLowerCase();
  const items = state.nodes.map((n) => {
    const meta = SERVICE_META[n.type] || { label: n.type, color: "#888" };
    const name = (n.label || meta.label || n.type);
    const hay = `${name} ${n.id} ${n.type} ${meta.label}`.toLowerCase();
    const score =
      (q && hay.includes(q) ? 10 : 0) +
      (q && name.toLowerCase().includes(q) ? 4 : 0) +
      (q && String(n.id).toLowerCase().includes(q) ? 2 : 0) +
      (!q ? 1 : 0);
    return { n, meta, name, hay, score };
  });
  return items
    .filter((x) => {
      if (!q) return true;
      return x.hay.includes(q);
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 8);
}

let _topSuggestIndex = -1;

function hideTopSuggest() {
  if (!topSearchSuggest) return;
  topSearchSuggest.style.display = "none";
  topSearchSuggest.innerHTML = "";
  _topSuggestIndex = -1;
}

function renderTopSuggest() {
  if (!topSearch || !topSearchSuggest) return;
  const items = topSearchCandidates(topSearch.value);
  if (!items.length) return hideTopSuggest();
  topSearchSuggest.innerHTML = "";
  topSearchSuggest.style.display = "";
  items.forEach((it, idx) => {
    const el = document.createElement("div");
    el.className = "top-suggest-item";
    el.dataset.idx = String(idx);
    el.innerHTML = `
      <span class="top-suggest-dot" style="background:${it.meta.color || "#888"}"></span>
      <div style="min-width:0">
        <div class="top-suggest-name">${escapeHtml(it.name)}</div>
        <div class="top-suggest-sub">${escapeHtml(it.meta.label || it.n.type)} · ${escapeHtml(it.n.id)}</div>
      </div>
      <div class="top-suggest-kbd">↵</div>
    `;
    el.addEventListener("mousedown", (e) => {
      // Prevent input blur before click handler runs.
      e.preventDefault();
    });
    el.addEventListener("click", () => {
      applySelection("node", it.n.id);
      centerOnNode(it.n.id);
      render();
      setRightPane("inspector");
      hideTopSuggest();
      topSearch.blur();
    });
    topSearchSuggest.appendChild(el);
  });
}

function setTopSuggestActive(idx) {
  _topSuggestIndex = idx;
  topSearchSuggest?.querySelectorAll(".top-suggest-item").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.idx) === idx);
  });
}

topSearch?.addEventListener("input", () => {
  renderTopSuggest();
});

topSearch?.addEventListener("focus", () => {
  renderTopSuggest();
});

topSearch?.addEventListener("blur", () => {
  // Small delay so clicks on suggestions register.
  setTimeout(() => hideTopSuggest(), 120);
});

topSearch?.addEventListener("keydown", (e) => {
  if (!topSearchSuggest || topSearchSuggest.style.display === "none") {
    if (e.key === "Enter") {
      const n = findBestNodeMatch(topSearch.value);
      if (!n) return;
      applySelection("node", n.id);
      centerOnNode(n.id);
      render();
      setRightPane("inspector");
      hideTopSuggest();
      topSearch.blur();
    }
    return;
  }

  const items = Array.from(topSearchSuggest.querySelectorAll(".top-suggest-item"));
  if (!items.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    const next = Math.min(items.length - 1, _topSuggestIndex + 1);
    setTopSuggestActive(next);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    const next = Math.max(0, _topSuggestIndex - 1);
    setTopSuggestActive(next);
  } else if (e.key === "Escape") {
    e.preventDefault();
    hideTopSuggest();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const pick = items[Math.max(0, _topSuggestIndex)];
    pick?.click();
  }
});

const canvasWrap = document.querySelector(".canvas-wrap");
canvasWrap.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
canvasWrap.addEventListener("drop", e => {
  e.preventDefault();
  const type = e.dataTransfer.getData("text/aws-type") || e.dataTransfer.getData("text/plain");
  if (!type) return;
  const pt = clientToWorld(e.clientX, e.clientY);
  addNode(type, pt.x - NODE_MIN_W / 2, pt.y - NODE_H / 2);
});

canvas.addEventListener("mousedown", e => {
  const target = e.target;

  if (target.dataset && target.dataset.role === "port") {
    const fromId = target.dataset.nodeId;
    const fromNode = state.nodes.find(n => n.id === fromId);
    const pt = clientToWorld(e.clientX, e.clientY);
    drag = { kind: "edge-draw", fromId };
    edgePreview.style.display = "";
    updateEdgePreview(fromNode, pt);
    e.preventDefault();
    return;
  }

  const nodeGroup = target.closest(".node-group");
  if (nodeGroup) {
    const id = nodeGroup.dataset.nodeId;
    applySelection("node", id);
    const n = state.nodes.find(x => x.id === id);
    const pt = clientToWorld(e.clientX, e.clientY);
    drag = { kind: "node-move", id, offsetX: pt.x - n.x, offsetY: pt.y - n.y };
    return;
  }

  if (target.classList.contains("edge-hit")) {
    applySelection("edge", target.dataset.edgeId);
    return;
  }

  if (target === canvas) {
    applySelection(null, null);
    drag = { kind: "pan", startX: e.clientX, startY: e.clientY, vx: viewport.x, vy: viewport.y };
    canvas.classList.add("panning");
  }
});

canvas.addEventListener("contextmenu", (e) => {
  const t = e.target;
  const nodeGroup = t && t.closest ? t.closest(".node-group") : null;
  const edgeHit = t && t.classList && t.classList.contains("edge-hit") ? t : null;
  if (!nodeGroup && !edgeHit) return; // allow default menu on empty space
  e.preventDefault();
  e.stopPropagation();

  // Close search suggestions and any prior context menu.
  hideTopSuggest();
  hideCtxMenu();

  if (nodeGroup) {
    const id = nodeGroup.dataset.nodeId;
    applySelection("node", id);
    render();
    showCtxMenu(e.clientX, e.clientY, { kind: "node", id });
    return;
  }
  if (edgeHit) {
    const id = edgeHit.dataset.edgeId;
    applySelection("edge", id);
    render();
    showCtxMenu(e.clientX, e.clientY, { kind: "edge", id });
  }
});

window.addEventListener("click", () => hideCtxMenu());
window.addEventListener("scroll", () => hideCtxMenu(), true);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideCtxMenu();
});

ctxDelete?.addEventListener("click", () => {
  if (!_ctxTarget) return;
  const { kind, id } = _ctxTarget;
  hideCtxMenu();
  if (kind === "node") deleteNode(id);
  if (kind === "edge") deleteEdge(id);
});

window.addEventListener("mousemove", e => {
  if (!drag) return;
  if (drag.kind === "node-move") {
    const pt = clientToWorld(e.clientX, e.clientY);
    const n = state.nodes.find(x => x.id === drag.id);
    n.x = Math.round((pt.x - drag.offsetX) / 10) * 10;
    n.y = Math.round((pt.y - drag.offsetY) / 10) * 10;
    render();
    setTrashVisible(true);
    setTrashHot(isPointInEl(e.clientX, e.clientY, trashDrop));
  } else if (drag.kind === "pan") {
    viewport.x = drag.vx + (e.clientX - drag.startX);
    viewport.y = drag.vy + (e.clientY - drag.startY);
    viewportG.setAttribute("transform", `translate(${viewport.x} ${viewport.y}) scale(${viewport.z})`);
  } else if (drag.kind === "edge-draw") {
    const pt = clientToWorld(e.clientX, e.clientY);
    const fromNode = state.nodes.find(n => n.id === drag.fromId);
    updateEdgePreview(fromNode, pt);
  }
});

window.addEventListener("mouseup", e => {
  if (!drag) return;
  if (drag.kind === "node-move") {
    const overTrash = isPointInEl(e.clientX, e.clientY, trashDrop);
    const id = drag.id;
    setTrashVisible(false);
    if (overTrash) deleteNode(id);
  }
  if (drag.kind === "edge-draw") {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const nodeGroup = target && target.closest ? target.closest(".node-group") : null;
    if (nodeGroup) {
      const toId = nodeGroup.dataset.nodeId;
      if (toId !== drag.fromId) addEdge(drag.fromId, toId);
    }
    edgePreview.style.display = "none";
  }
  canvas.classList.remove("panning");
  drag = null;
});

function startNodeEdit(n) {
  const nw = nodeWidth(n);
  const rect = canvas.getBoundingClientRect();
  const sx = rect.left + viewport.x + (n.x + 40) * viewport.z;
  const sy = rect.top  + viewport.y + (n.y + NODE_H / 2 - 13) * viewport.z;
  const sw = (nw - 48) * viewport.z;

  const inp = document.createElement("input");
  inp.type = "text";
  inp.value = n.label || "";
  Object.assign(inp.style, {
    position: "fixed", left: sx + "px", top: sy + "px",
    width: sw + "px", height: (24 * viewport.z) + "px",
    font: `500 ${13 * viewport.z}px ui-sans-serif,system-ui,sans-serif`,
    border: "none", outline: "2px solid #378add",
    background: "#fff", padding: "2px 4px",
    borderRadius: "2px", zIndex: "1000", boxSizing: "border-box",
  });
  document.body.appendChild(inp);
  inp.focus();
  inp.select();

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const val = inp.value.trim();
    n.label = val || (SERVICE_META[n.type] ? SERVICE_META[n.type].label : n.type);
    if (document.body.contains(inp)) document.body.removeChild(inp);
    render();
  };
  const discard = () => {
    done = true;
    if (document.body.contains(inp)) document.body.removeChild(inp);
  };
  inp.addEventListener("keydown", ev => {
    if (ev.key === "Enter")  { ev.preventDefault(); commit(); }
    if (ev.key === "Escape") { discard(); }
  });
  inp.addEventListener("blur", commit);
}

function startEdgeEdit(e, worldX, worldY) {
  const rect = canvas.getBoundingClientRect();
  const cx = rect.left + viewport.x + worldX * viewport.z;
  const cy = rect.top  + viewport.y + worldY * viewport.z;
  const sw = 120 * viewport.z;

  const inp = document.createElement("input");
  inp.type = "text";
  inp.value = e.label || "";
  inp.placeholder = "label…";
  Object.assign(inp.style, {
    position: "fixed", left: (cx - sw / 2) + "px", top: (cy - 12 * viewport.z) + "px",
    width: sw + "px", height: (24 * viewport.z) + "px",
    font: `${12 * viewport.z}px ui-sans-serif,system-ui,sans-serif`,
    border: "none", outline: "2px solid #378add",
    background: "#fff", padding: "2px 4px",
    borderRadius: "2px", zIndex: "1000", boxSizing: "border-box", textAlign: "center",
  });
  document.body.appendChild(inp);
  inp.focus();
  inp.select();

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    e.label = inp.value.trim();
    if (document.body.contains(inp)) document.body.removeChild(inp);
    render();
  };
  const discard = () => {
    done = true;
    if (document.body.contains(inp)) document.body.removeChild(inp);
  };
  inp.addEventListener("keydown", ev => {
    if (ev.key === "Enter")  { ev.preventDefault(); commit(); }
    if (ev.key === "Escape") { discard(); }
  });
  inp.addEventListener("blur", commit);
}

function updateEdgePreview(fromNode, worldPt) {
  const x1 = fromNode.x + nodeWidth(fromNode), y1 = fromNode.y + NODE_H / 2;
  const x2 = worldPt.x, y2 = worldPt.y;
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  edgePreview.setAttribute("d", `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
}

canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const delta = -e.deltaY * 0.001;
  const newZ = Math.min(3, Math.max(0.3, viewport.z * (1 + delta)));
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
  const worldBefore = { x: (cx - viewport.x) / viewport.z, y: (cy - viewport.y) / viewport.z };
  viewport.z = newZ;
  viewport.x = cx - worldBefore.x * newZ;
  viewport.y = cy - worldBefore.y * newZ;
  viewportG.setAttribute("transform", `translate(${viewport.x} ${viewport.y}) scale(${viewport.z})`);
}, { passive: false });

window.addEventListener("keydown", e => {
  if (e.key === "Delete" || e.key === "Backspace") {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (!selection) return;
    if (selection.kind === "node") deleteNode(selection.id);
    if (selection.kind === "edge") deleteEdge(selection.id);
  }
});


function clientToWorld(cx, cy) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (cx - rect.left - viewport.x) / viewport.z,
    y: (cy - rect.top - viewport.y) / viewport.z
  };
}

document.getElementById("btnNew").addEventListener("click", () => {
  if (state.nodes.length && !confirm("Discard current diagram?")) return;
  state = freshState();
  selection = null;
  fileName = "untitled.arch.json";
  render();
});

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function exportJson() {
  const name = (fileName || "diagram.arch.json").replace(/\.[^.]+$/, "") + ".arch.json";
  downloadText(name, JSON.stringify(state, null, 2), "application/json");
}

async function exportPngImage() {
  const svg = document.getElementById("canvas");
  if (!svg) return;

  // Clone SVG and inline the editor CSS so it renders correctly offscreen.
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const cssText = await fetch("/diagram-editor.css").then((r) => r.text()).catch(() => "");
  if (cssText) {
    const defs = clone.querySelector("defs") || clone.insertBefore(document.createElementNS("http://www.w3.org/2000/svg", "defs"), clone.firstChild);
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = cssText;
    defs.appendChild(style);
  }

  const rect = svg.getBoundingClientRect();
  const w = Math.max(900, Math.round(rect.width));
  const h = Math.max(600, Math.round(rect.height));
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));

  const xml = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.decoding = "async";

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));

  const canvasEl = document.createElement("canvas");
  canvasEl.width = w;
  canvasEl.height = h;
  const ctx = canvasEl.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise((resolve) => canvasEl.toBlob(resolve, "image/png"));
  if (!blob) return;

  const pngUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = pngUrl;
  a.download = (fileName || "diagram").replace(/\.[^.]+$/, "") + ".png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(pngUrl), 500);
}

const btnExport = document.getElementById("btnExport");
const exportMenu = document.getElementById("exportMenu");

function toggleExportMenu(force) {
  if (!exportMenu) return;
  const next = typeof force === "boolean" ? force : exportMenu.style.display === "none";
  exportMenu.style.display = next ? "" : "none";
}

btnExport?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleExportMenu();
});

document.getElementById("btnExportJson")?.addEventListener("click", () => {
  toggleExportMenu(false);
  exportJson();
});
document.getElementById("btnExportPng")?.addEventListener("click", async () => {
  toggleExportMenu(false);
  await exportPngImage();
});

window.addEventListener("click", () => toggleExportMenu(false));

// Focus mode: hide all menus and show only canvas
const appEl = document.querySelector(".app");
function setFocusMode(on) {
  if (!appEl) return;
  appEl.classList.toggle("focus-mode", !!on);
  const btn = document.getElementById("btnFocus");
  if (btn) btn.textContent = on ? "⤡" : "⤢";
}

document.getElementById("btnFocus")?.addEventListener("click", () => {
  const isOn = appEl?.classList.contains("focus-mode");
  setFocusMode(!isOn);
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && appEl?.classList.contains("focus-mode")) setFocusMode(false);
});

document.getElementById("btnUnfocus")?.addEventListener("click", () => setFocusMode(false));

// Cmd/Ctrl+S: apply JSON edits when textarea focused
window.addEventListener("keydown", e => {
  if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    if (document.activeElement === document.getElementById("jsonEdit")) _applyJsonEdit();
  }
});

document.getElementById("btnOpen").addEventListener("click", () => {
  document.getElementById("fileInput").click();
});

document.getElementById("fileInput").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    if (!parsed.nodes || !parsed.edges) throw new Error("Missing nodes or edges");
    state = parsed;
    fileName = file.name;
    selection = null;
    render();
  } catch (err) {
    alert("Failed to open: " + err.message);
  }
  e.target.value = "";
});

render();

// Show save status based on mode
if (__SERVER_PORT__) {
  const el = document.getElementById("saveStatus");
  el.textContent = "auto-saving";
  el.style.color = "var(--muted)";
  el.title = "Changes save automatically to the CLI";
  if (__STATE_JSON_PATH__) document.getElementById("jsonFilePath").textContent = __STATE_JSON_PATH__;
} else if (__STATE_JSON_PATH__) {
  document.getElementById("jsonFilePath").textContent = __STATE_JSON_PATH__;
  document.getElementById("saveStatus").title = "Click Save JSON to save changes";
}

// ── JSON pane resize ─────────────────────────────────────────────────────────
{
  const appEl  = document.querySelector(".app");
  const handle = document.getElementById("jsonResizeHandle");
  let resizing = false, startY = 0, startH = 0;

  handle.addEventListener("mousedown", e => {
    resizing = true;
    startY   = e.clientY;
    startH   = document.querySelector(".json-pane").offsetHeight;
    handle.classList.add("dragging");
    document.body.style.cursor    = "ns-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  window.addEventListener("mousemove", e => {
    if (!resizing) return;
    const newH = Math.max(40, Math.min(window.innerHeight - 150, startH + (startY - e.clientY)));
    appEl.style.gridTemplateRows = `44px 1fr 5px ${newH}px`;
  });

  window.addEventListener("mouseup", () => {
    if (!resizing) return;
    resizing = false;
    handle.classList.remove("dragging");
    document.body.style.cursor     = "";
    document.body.style.userSelect = "";
  });
}

// ── AI Chat ──────────────────────────────────────────────────────────────────

const chatMessages = document.getElementById("chatMessages");
const chatTyping   = document.getElementById("chatTyping");
const chatInput    = document.getElementById("chatInput");
const chatSend     = document.getElementById("chatSend");
const chatApiKey   = document.getElementById("chatApiKey");

// Restore saved API key
chatApiKey.value = localStorage.getItem("anthropic_api_key") || "";
chatApiKey.addEventListener("change", () => {
  localStorage.setItem("anthropic_api_key", chatApiKey.value.trim());
});

// Conversation history sent to the API (excludes system-note bubbles)
let chatHistory = [];

// Keep focus behavior when switching to chat via right pane tabs.
document.querySelectorAll(".right-tab").forEach((b) => {
  if (b.dataset.panel !== "chat") return;
  b.addEventListener("click", () => setTimeout(() => chatInput.focus(), 0));
});

document.getElementById("btnClearChat").addEventListener("click", () => {
  chatHistory = [];
  chatMessages.innerHTML = '<div class="chat-msg system-note">Ask me anything about your AWS architecture. I can see your current diagram when "Include diagram" is checked.</div>';
});

// Auto-resize textarea
chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
});

// Send on Enter (Shift+Enter = newline)
chatInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

chatSend.addEventListener("click", sendChat);

function appendMsg(role, text) {
  const div = document.createElement("div");
  div.className = "chat-msg " + role;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

const CLAUDE_TOOLS = [
  {
    name: "add_node",
    description: "Add an AWS service node. Populate cdkId, props, and notes fully — the props object must contain ALL fields listed in the CDK defaults for that service type so a downstream CDK agent needs zero guesswork.",
    input_schema: {
      type: "object",
      properties: {
        type:  { type: "string", description: "One of: " + Object.keys(SERVICE_META).sort().join(", ") },
        label: { type: "string", description: "Human-readable display name, e.g. 'User Auth Function'" },
        cdkId: { type: "string", description: "PascalCase CDK construct ID, e.g. 'UserAuthFunction'. Must be unique in the stack." },
        props: {
          type: "object",
          description: "Complete CDK deployment props. Always include ALL fields for the service type — use recommended defaults for anything not specified by the user. Key fields by type: lambda→{runtime,handler,code,memorySize,timeout,environment,tracing,removalPolicy}; dynamodb→{partitionKey,sortKey,billingMode,stream,pointInTimeRecovery,encryption,gsi,removalPolicy}; s3→{versioned,blockPublicAccess,encryption,removalPolicy,autoDeleteObjects}; sqs→{fifo,visibilityTimeout,messageRetentionPeriod,dlqRef,maxReceiveCount,encryption,removalPolicy}; rds→{engine,engineVersion,instanceClass,instanceSize,databaseName,multiAz,storageEncrypted,deletionProtection,vpcRef,removalPolicy}."
        },
        notes: { type: "string", description: "One or two sentences describing this resource's role in the architecture and any non-obvious configuration decisions." },
        x:     { type: "number", description: "Canvas x position (auto-placed if omitted)" },
        y:     { type: "number", description: "Canvas y position (auto-placed if omitted)" }
      },
      required: ["type", "label", "cdkId"]
    }
  },
  {
    name: "add_edge",
    description: "Connect two nodes. Always specify relationship, iamActions, cdkMethod, and protocol so a CDK agent can generate correct IAM grants and integrations without guessing.",
    input_schema: {
      type: "object",
      properties: {
        from_id:      { type: "string", description: "Source node id" },
        to_id:        { type: "string", description: "Destination node id" },
        label:        { type: "string", description: "Short display label shown on the diagram arrow, e.g. 'reads/writes'" },
        relationship: {
          type: "string",
          enum: ["iam-grant","event-source-mapping","subscription","api-integration","origin","trigger","invoke","stream-consumer","read","write","read-write"],
          description: "The AWS relationship type this arrow represents."
        },
        iamActions: {
          type: "array", items: { type: "string" },
          description: "Explicit IAM action strings needed for this connection, e.g. ['dynamodb:GetItem','dynamodb:PutItem','dynamodb:Query']. Empty array for non-IAM relationships."
        },
        cdkMethod: {
          type: "string",
          description: "The exact CDK L2 method call that wires this relationship, e.g. 'table.grantReadWriteData(fn)', 'fn.addEventSource(new SqsEventSource(queue,{batchSize:10}))', 'topic.addSubscription(new SqsSubscription(queue))'."
        },
        protocol: { type: "string", description: "Communication mechanism, e.g. 'AWS SDK v3', 'HTTPS', 'EventBridge rule', 'SQS trigger'." },
        notes:    { type: "string", description: "Any non-obvious wiring details, ordering constraints, or permission boundaries relevant for CDK generation." }
      },
      required: ["from_id", "to_id", "relationship"]
    }
  },
  {
    name: "clear_diagram",
    description: "Remove all nodes and edges. Call before building a fresh architecture.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "set_metadata",
    description: "Set diagram-level deployment metadata used by the CDK agent to initialise the Stack.",
    input_schema: {
      type: "object",
      properties: {
        name:        { type: "string", description: "Human-readable diagram/architecture name" },
        stackName:   { type: "string", description: "CloudFormation stack name, e.g. 'MyAppStack'" },
        region:      { type: "string", description: "AWS region, e.g. 'us-east-1'" },
        account:     { type: "string", description: "AWS account ID (12 digits). Use empty string if unknown." },
        environment: { type: "string", description: "'dev', 'staging', or 'prod' — affects removalPolicy defaults" }
      },
      required: ["name"]
    }
  },
  {
    name: "remove_object",
    description: "Remove a node (and its connected edges) or a single edge by id.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "The id of the node or edge to remove" } },
      required: ["id"]
    }
  }
];

function autoPlace() {
  const MIN_DIST = 300;
  const candidates = [];
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 6; col++)
      candidates.push({ x: 80 + col * 200, y: 80 + row * 180 });

  for (const pt of candidates) {
    const tooClose = state.nodes.some(n => {
      const dx = n.x - pt.x, dy = n.y - pt.y;
      return Math.sqrt(dx * dx + dy * dy) < MIN_DIST;
    });
    if (!tooClose) return pt;
  }
  const maxY = state.nodes.reduce((m, n) => Math.max(m, n.y), 0);
  return { x: 80, y: maxY + 220 };
}

function executeTool(name, input) {
  switch (name) {
    case "add_node": {
      const pos     = (input.x != null && input.y != null) ? input : autoPlace();
      const type    = input.type in SERVICE_META ? input.type : "external";
      const meta    = SERVICE_META[type] || { label: type };
      const cdkMeta = CDK_META[type]    || { construct: null, module: null };
      const label   = input.label || meta.label;
      const n = {
        id: uid("n"), type, label,
        cdkConstruct: cdkMeta.construct,
        cdkModule:    cdkMeta.module,
        cdkId:        input.cdkId || toPascalCase(label),
        notes:        input.notes || "",
        x: Math.round(pos.x / 10) * 10,
        y: Math.round(pos.y / 10) * 10,
        // merge defaults → agent-supplied props (agent values win)
        props: { ...(NODE_CDK_DEFAULTS[type] || {}), ...(input.props || {}) }
      };
      state.nodes.push(n);
      render();
      return { id: n.id, label: n.label };
    }
    case "add_edge": {
      const src = state.nodes.find(n => n.id === input.from_id);
      const dst = state.nodes.find(n => n.id === input.to_id);
      if (!src) return { error: `Node ${input.from_id} not found` };
      if (!dst) return { error: `Node ${input.to_id} not found` };
      if (src.id === dst.id) return { error: "Cannot connect a node to itself" };
      const e = {
        id: uid("e"), from: src.id, to: dst.id,
        label:        input.label        || "",
        relationship: input.relationship || "invoke",
        iamActions:   input.iamActions   || [],
        cdkMethod:    input.cdkMethod    || "",
        protocol:     input.protocol     || "",
        notes:        input.notes        || ""
      };
      state.edges.push(e);
      render();
      return { id: e.id };
    }
    case "clear_diagram":
      state = freshState(); selection = null; render();
      return { ok: true };
    case "set_metadata":
      if (input.name)        state.metadata.name        = input.name;
      if (input.stackName)   state.metadata.stackName   = input.stackName;
      if (input.region)      state.metadata.region      = input.region;
      if (input.account)     state.metadata.account     = input.account;
      if (input.environment) state.metadata.environment = input.environment;
      renderJson();
      return { ok: true };
    case "remove_object": {
      const nodeIdx = state.nodes.findIndex(n => n.id === input.id);
      if (nodeIdx !== -1) {
        state.nodes.splice(nodeIdx, 1);
        state.edges = state.edges.filter(e => e.from !== input.id && e.to !== input.id);
        if (selection?.id === input.id) selection = null;
        render();
        return { ok: true, removed: "node" };
      }
      const edgeIdx = state.edges.findIndex(e => e.id === input.id);
      if (edgeIdx !== -1) {
        state.edges.splice(edgeIdx, 1);
        if (selection?.id === input.id) selection = null;
        render();
        return { ok: true, removed: "edge" };
      }
      return { error: `No node or edge with id ${input.id}` };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  const apiKey = chatApiKey.value.trim() || localStorage.getItem("anthropic_api_key") || "";
  if (!apiKey) { appendMsg("error", "Please enter your Anthropic API key above."); return; }

  chatInput.value = ""; chatInput.style.height = "auto"; chatSend.disabled = true;
  appendMsg("user", text);
  chatHistory.push({ role: "user", content: text });
  chatTyping.classList.add("visible");
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try { await runAgentLoop(apiKey); }
  catch (err) { chatTyping.classList.remove("visible"); appendMsg("error", "Network error: " + err.message); }

  chatSend.disabled = false; chatInput.focus();
}

// After the AI finishes a turn, push same-row nodes apart so edge labels fit in the gap.
function autoSpaceNodes() {
  if (state.nodes.length < 2) return;

  const ROW_THRESH = 40;   // px: nodes within this y-distance share a row
  const COL_THRESH = 60;   // px: nodes within this x-distance share a column
  const MIN_H_GAP  = 60;   // minimum blank horizontal space between two boxes
  const MIN_V_GAP  = 50;   // minimum blank vertical space between two boxes

  let changed = false;

  // helper: find any direct edge between two nodes
  const edgeBetween = (a, b) =>
    state.edges.find(e =>
      (e.from === a.id && e.to === b.id) ||
      (e.from === b.id && e.to === a.id)
    );

  // ── Horizontal pass: space out nodes that share a row ──
  const rows = [];
  for (const n of [...state.nodes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(r => Math.abs(r[0].y - n.y) <= ROW_THRESH);
    if (row) row.push(n);
    else rows.push([n]);
  }
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      const prev = row[i - 1];
      const curr = row[i];
      const prevW = nodeWidth(prev);
      const edge = edgeBetween(prev, curr);
      let gap = MIN_H_GAP;
      if (edge && edge.label) {
        gap = Math.max(MIN_H_GAP, measureEdgeLabelWidth(edge.label) + 48);
      }
      const minX = prev.x + prevW + gap;
      if (curr.x < minX) {
        const shift = minX - curr.x;
        for (let j = i; j < row.length; j++) {
          row[j].x = Math.round((row[j].x + shift) / 10) * 10;
        }
        changed = true;
      }
    }
  }

  // ── Vertical pass: space out nodes that share a column ──
  const cols = [];
  for (const n of [...state.nodes].sort((a, b) => a.x - b.x || a.y - b.y)) {
    const col = cols.find(c => Math.abs(c[0].x - n.x) <= COL_THRESH);
    if (col) col.push(n);
    else cols.push([n]);
  }
  for (const col of cols) {
    col.sort((a, b) => a.y - b.y);
    for (let i = 1; i < col.length; i++) {
      const prev = col[i - 1];
      const curr = col[i];
      const edge = edgeBetween(prev, curr);
      let gap = MIN_V_GAP;
      if (edge && edge.label) gap = Math.max(MIN_V_GAP, 40);
      const minY = prev.y + NODE_H + gap;
      if (curr.y < minY) {
        const shift = minY - curr.y;
        for (let j = i; j < col.length; j++) {
          col[j].y = Math.round((col[j].y + shift) / 10) * 10;
        }
        changed = true;
      }
    }
  }

  if (changed) render();
}

// Strip props from add_node tool inputs before storing in history —
// props are already written to state.nodes, no need to replay them in the transcript.
function slimContent(content) {
  return content.map(block => {
    if (block.type !== "tool_use" || block.name !== "add_node") return block;
    const { props, ...rest } = block.input;
    return { ...block, input: rest };
  });
}

async function runAgentLoop(apiKey) {
  // Build system prompt once per user turn, not on every tool-use round-trip.
  const systemPrompt = buildSystemPrompt();

  // Work on a local copy. We only flush to chatHistory once the turn ends cleanly,
  // so a mid-turn API error never leaves chatHistory with an unpaired tool_use.
  const turnMessages = [...chatHistory];

  while (true) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: systemPrompt,
        tools: CLAUDE_TOOLS,
        messages: turnMessages
      })
    });

    chatTyping.classList.remove("visible");

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      appendMsg("error", "API error: " + (err.error?.message || res.statusText));
      return; // chatHistory untouched — still valid for the next user message
    }

    const data = await res.json();
    const content = data.content || [];

    const texts = content.filter(b => b.type === "text").map(b => b.text).join("\n\n");
    if (texts) appendMsg("assistant", texts);

    turnMessages.push({ role: "assistant", content: slimContent(content) });

    if (data.stop_reason !== "tool_use") {
      // Commit the completed turn to the shared history.
      chatHistory.length = 0;
      chatHistory.push(...turnMessages);
      autoSpaceNodes();
      break;
    }

    const toolResults = [];
    for (const block of content.filter(b => b.type === "tool_use")) {
      appendMsg("system-note", `⚙ ${block.name}(${block.input.label || block.input.id || block.input.name || ""})`);
      const result = executeTool(block.name, block.input);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }

    turnMessages.push({ role: "user", content: toolResults });
    chatTyping.classList.add("visible");
  }
}

const MODE_PROMPTS = {
  minimal:    "COST MODE — Minimal: prioritize zero fixed costs. Use serverless-first (Lambda, DynamoDB, S3, API Gateway). Avoid VPCs, NAT gateways, and any always-on compute unless the use case strictly requires it. Set removalPolicy DESTROY on everything.",
  simple:     "COST MODE — Simple: prefer managed serverless services but allow one always-on tier (e.g. a single-AZ RDS or a single Fargate service) if the use case needs it. No VPC unless required. removalPolicy RETAIN on stateful resources, DESTROY elsewhere.",
  standard:   "COST MODE — Standard: production-ready but cost-conscious. Use a VPC with public and private subnets and a single NAT gateway. Single-AZ for databases unless load demands otherwise. Add SQS for async decoupling where appropriate. removalPolicy SNAPSHOT for databases, RETAIN for other stateful resources.",
  enterprise: "COST MODE — Enterprise: assume high-availability and compliance requirements. Multi-AZ for all stateful resources, ElastiCache caching layer, ALB in front of compute, WAF, encryption in transit and at rest everywhere, CloudWatch alarms on all critical paths. removalPolicy SNAPSHOT for databases.",
};

function buildSystemPrompt() {
  const includeDiagram = document.getElementById("chatIncludeDiagram").checked;
  const mode = document.getElementById("chatMode").value;
  let prompt = `You are an expert AWS solutions architect embedded in a diagram editor. Your output is consumed by a downstream CDK code-generation agent — every node and edge must be filled in completely so that agent needs zero guesswork.`;

  if (mode && MODE_PROMPTS[mode]) prompt += `\n\n${MODE_PROMPTS[mode]}`;

  prompt += `

NODES — always call add_node with:
• cdkId: PascalCase unique ID (e.g. "UserAuthFunction", "OrdersTable")
• props: full CDK props object — include ALL fields for the service type, not just the ones the user mentioned. Fill unspecified fields with AWS recommended defaults. Key rules:
  - lambda: set runtime (NODEJS_20_X/PYTHON_3_12/etc), handler, code path, memorySize, timeout, environment map, tracing "Active", removalPolicy
  - dynamodb: set partitionKey {name,type}, sortKey if needed, billingMode, stream, pointInTimeRecovery true, encryption, removalPolicy "RETAIN" for prod / "DESTROY" for dev
  - s3: set versioned, blockPublicAccess "BLOCK_ALL", encryption, removalPolicy, autoDeleteObjects
  - sqs: set fifo, visibilityTimeout (match Lambda timeout if event source), messageRetentionPeriod, maxReceiveCount, dlqRef if applicable, encryption
  - rds: set engine, engineVersion, instanceClass, instanceSize, databaseName, multiAz, storageEncrypted true, deletionProtection, removalPolicy "SNAPSHOT"
  - All stateful resources (rds, dynamodb, s3, elasticache): default removalPolicy to "RETAIN" unless user says dev/demo
• notes: 1–2 sentences explaining the resource's role and any non-obvious decisions

EDGES — always call add_edge with:
• relationship: one of [iam-grant, event-source-mapping, subscription, api-integration, origin, trigger, invoke, stream-consumer, read, write, read-write]
• iamActions: explicit IAM action strings (e.g. ["dynamodb:GetItem","dynamodb:PutItem","dynamodb:Query"]). Use [] only for non-IAM relationships.
• cdkMethod: the exact CDK L2 call (e.g. "table.grantReadWriteData(fn)", "fn.addEventSource(new SqsEventSource(queue,{batchSize:10}))", "topic.addSubscription(new SqsSubscription(queue))")
• protocol: how they communicate (AWS SDK v3 / HTTPS / EventBridge rule / SQS trigger / etc.)
• notes: any wiring constraints or ordering dependencies

METADATA — call set_metadata first with name, stackName, region, environment (dev/staging/prod).

LAYOUT — left-to-right for data flow, top-to-bottom for tiers. Use x spacing ≥ 320px between same-row nodes. Always prefer too much space — a layout pass will not compress it.
Valid node types: ${Object.keys(SERVICE_META).sort().join(", ")}.
For unfamiliar services, call aws_kb_retrieve with the CDK module name (same catalog as AWS MCP / AWS documentation knowledge base) before wiring props and edges.
To remove a specific node or edge use remove_object(id). Only use clear_diagram to wipe everything.`;

  if (includeDiagram) {
    if (state.nodes.length > 0) {
      const snap = {
        name: state.metadata?.name,
        nodes: state.nodes.map(n => ({ id: n.id, type: n.type, label: n.label })),
        edges: state.edges.map(e => ({ id: e.id, from: e.from, to: e.to, label: e.label }))
      };
      prompt += `\n\nCurrent diagram:\n${JSON.stringify(snap, null, 2)}`;
    } else {
      prompt += `\n\nThe diagram is currently empty.`;
    }
  }
  return prompt;
}

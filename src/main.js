import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, theme: 'default' });

const app = document.getElementById("app");

const BASE_KEY = "insightify.trace_viewer.base_url";
const RUN_KEY = "insightify.trace_viewer.last_run_id";

const defaultBase = "http://localhost:8080";

app.innerHTML = `
  <div class="wrap">
    <div class="panel">
      <div class="toolbar">
        <input id="baseUrl" placeholder="Core API base URL" />
        <input id="runId" placeholder="run_id" />
        <button id="loadBtn" type="button">Load</button>
        <button id="refreshBtn" type="button">Refresh</button>
      </div>
      <div id="status" class="status">ready</div>
      <div id="summary" class="summary"></div>
      <div id="mermaid" class="mermaid-container" style="margin-top: 20px; padding: 10px; overflow: auto; border-top: 1px solid var(--line);"></div>
      <div id="flow" class="flow"></div>
      <div id="timeline" class="timeline"></div>
    </div>
  </div>
`;

const baseInput = document.getElementById("baseUrl");
const runInput = document.getElementById("runId");
const loadBtn = document.getElementById("loadBtn");
const refreshBtn = document.getElementById("refreshBtn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const flowEl = document.getElementById("flow");
const timelineEl = document.getElementById("timeline");
const mermaidEl = document.getElementById("mermaid");

baseInput.value = (localStorage.getItem(BASE_KEY) || defaultBase).trim();
runInput.value = (localStorage.getItem(RUN_KEY) || "").trim();

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "var(--err)" : "var(--muted)";
}

function countBySource(events) {
  let frontend = 0;
  let core = 0;
  for (const ev of events) {
    if ((ev.source || "").startsWith("frontend")) {
      frontend += 1;
    } else {
      core += 1;
    }
  }
  return { frontend, core };
}

function summarizeFlow(events) {
  const has = (predicate) => events.some(predicate);
  return [
    {
      label: "start_run",
      ok: has((e) => e.stage === "started" && e.source === "api.start_run"),
    },
    {
      label: "worker_called",
      ok: has((e) => e.stage === "call_worker" && e.source === "executor"),
    },
    {
      label: "need_input",
      ok: has(
        (e) =>
          (e.stage === "open" && e.source === "interaction") ||
          (e.stage === "resolved" &&
            e.source === "api.wait_for_input" &&
            e.fields?.waiting === true),
      ),
    },
    {
      label: "frontend_watch",
      ok: has((e) => e.stage === "stream_event" && e.source === "frontend"),
    },
    {
      label: "frontend_node",
      ok: has((e) => e.stage === "on_node" && e.source === "frontend"),
    },
    {
      label: "frontend_submit",
      ok: has((e) => e.stage === "send_message_accepted" && e.source === "frontend"),
    },
  ];
}

function renderSummary(events) {
  const { frontend, core } = countBySource(events);
  const first = events[0]?.timestamp || "-";
  const last = events[events.length - 1]?.timestamp || "-";
  summaryEl.innerHTML = `
    <div class="metric"><div class="label">total events</div><div class="value">${events.length}</div></div>
    <div class="metric"><div class="label">core events</div><div class="value">${core}</div></div>
    <div class="metric"><div class="label">frontend events</div><div class="value">${frontend}</div></div>
    <div class="metric"><div class="label">time range</div><div class="value" style="font-size:12px">${first}<br/>${last}</div></div>
  `;
}

function renderFlow(events) {
  const steps = summarizeFlow(events);
  flowEl.innerHTML = steps
    .map(
      (s) => `<span class="step ${s.ok ? "ok" : "warn"}">${s.ok ? "OK" : "MISS"} · ${s.label}</span>`,
    )
    .join("");
}

async function renderMermaid(events) {
  if (!events || events.length === 0) {
    mermaidEl.innerHTML = "";
    return;
  }

  // Limit events to avoid crashing mermaid with too many nodes
  const displayEvents = events.length > 200 ? events.slice(-200) : events;

  // 1. Identify unique sources for swimlanes
  const sources = [...new Set(displayEvents.map((e) => e.source || "unknown"))].sort();

  // 2. Build graph with subgraphs
  let graph = "graph TD\n";

  // Add subgraphs
  sources.forEach((src, idx) => {
    // Sanitize source name for mermaid ID
    const safeSrc = src.replace(/[^a-zA-Z0-9_]/g, "_");
    graph += `subgraph ${safeSrc} ["${src}"]\n`;

    // Add nodes belonging to this source
    displayEvents.forEach((ev, i) => {
      if ((ev.source || "unknown") === src) {
        const id = `N${i}`;
        const time = ev.timestamp ? ev.timestamp.split("T")[1].replace("Z", "").slice(0, 12) : "-";
        const stage = ev.stage || "-";
        // Escape quotes and generic formatting
        const label = `${time}<br/>${stage}`;
        graph += `${id}["${label}"]\n`;
      }
    });

    graph += "end\n";
  });

  // 3. Add edges (chronological flow)
  // We link N0 -> N1 -> N2 ... regardless of subgraph
  for (let i = 0; i < displayEvents.length - 1; i++) {
    graph += `N${i} --> N${i + 1}\n`;
  }

  // 4. Styles
  // Define a class for nodes
  graph += "classDef default fill:#fff,stroke:#333,stroke-width:1px;\n";
  // Highlight frontend nodes specifically if needed, or just rely on swimlanes.
  // Let's color frontend swimlane nodes differently if we want, but swimlanes provide good separation.
  // Actually, let's keep the node coloring logic for clarity.

  displayEvents.forEach((ev, i) => {
    const src = ev.source || "";
    const id = `N${i}`;
    if (src.startsWith("frontend")) {
      graph += `style ${id} fill:#e3f2fd,stroke:#0f6db6,stroke-width:2px\n`;
    } else if (src.startsWith("api") || src === "executor") {
      graph += `style ${id} fill:#e8f5e9,stroke:#0f8f5f,stroke-width:2px\n`;
    } else {
      graph += `style ${id} fill:#fff3e0,stroke:#ef6c00,stroke-width:2px\n`;
    }
  });

  try {
    const { svg } = await mermaid.render('mermaidGraph', graph);
    mermaidEl.innerHTML = svg;
  } catch (e) {
    console.error("Mermaid render error:", e);
    mermaidEl.innerHTML = `<div style="color:var(--err); padding:10px;">Failed to render flowchart: ${e.message}</div>`;
  }
}

function renderTimeline(events) {
  timelineEl.innerHTML = events
    .map((ev) => {
      const sourceClass = (ev.source || "").startsWith("frontend") ? "frontend" : "core";
      const fields = JSON.stringify(ev.fields || {}, null, 2);
      return `
        <div class="event">
          <div class="head">
            <span class="ts">${ev.timestamp || "-"}</span>
            <span class="src ${sourceClass}">${ev.source || "-"}</span>
            <span class="stage">${ev.stage || "-"}</span>
          </div>
          <pre>${fields}</pre>
        </div>
      `;
    })
    .join("");
}

async function loadTrace() {
  const baseUrl = baseInput.value.trim().replace(/\/$/, "");
  const runId = runInput.value.trim();
  if (!baseUrl || !runId) {
    setStatus("base URL and run_id are required", true);
    return;
  }
  localStorage.setItem(BASE_KEY, baseUrl);
  localStorage.setItem(RUN_KEY, runId);
  setStatus("loading...");
  try {
    const res = await fetch(`${baseUrl}/debug/run-logs?run_id=${encodeURIComponent(runId)}`, {
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error(`request failed: ${res.status}`);
    }
    const body = await res.json();
    const events = Array.isArray(body?.events) ? body.events : [];
    events.sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
    renderSummary(events);
    renderFlow(events);
    await renderMermaid(events);
    renderTimeline(events);
    setStatus(`loaded ${events.length} events for ${runId}`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

loadBtn.addEventListener("click", () => void loadTrace());
refreshBtn.addEventListener("click", () => void loadTrace());
runInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    void loadTrace();
  }
});
import { lazy, Suspense, useMemo } from "react";
import StateMessage from "./StateMessage";
import { parseJSON } from "./jsonRepair";
import { inlineMarkdownSegments } from "../brain/formatting";
// recharts (with its d3/lodash deps) is ~390 kB and only ever renders when a
// reply actually contains a [CHART] block, which most never do. Loading it on
// demand keeps it out of the startup parse on a phone.
const ChartBlock = lazy(() => import("./ChartBlock"));


// Save a generated image (a data: URL) to the user's disk. We decode it to a
// Blob first — a plain `<a download href="data:…">` can fail in the WebView2
// runtime for multi-MB images, whereas an object URL downloads reliably. The
// filename is derived from the caption so saved files are self-describing.
function downloadDataUrl(dataUrl, caption) {
  try {
    const mime = (dataUrl.match(/^data:([^;,]+)/) || [])[1] || "image/png";
    const ext = (mime.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
    const base =
      (caption || "")
        .replace(/^here'?s the image for:\s*/i, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "jarvis-image";
    const b64 = dataUrl.split(",")[1] || "";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error("[image download] failed", e);
  }
}


/* ── Charts ───────────────────────────────────────────────────────────────── */

/* ── Table ────────────────────────────────────────────────────────────────── */
function TableBlock({ body }) {
  const [data, err] = parseJSON(body);
  if (err || !Array.isArray(data?.columns) || !Array.isArray(data?.rows)) {
    return (
      <StateMessage variant="error">{err ?? "Missing or malformed columns/rows"}</StateMessage>
    );
  }
  return (
    <div className="card table-block">
      {data.title && <div className="card-title">{data.title}</div>}
      <div className="table-scroll">
        <table className="jarvis-table">
          <thead>
            <tr>
              {data.columns.map((c, i) => (
                <th key={i}>{String(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, r) => (
              <tr key={r}>
                {/* A row may not be an array (model sent an object/scalar) — coerce. */}
                {(Array.isArray(row) ? row : [row]).map((cell, c) => (
                  <td key={c}>{String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Schedule ─────────────────────────────────────────────────────────────── */
function ScheduleBlock({ body }) {
  const [data, err] = parseJSON(body);
  if (err || !Array.isArray(data?.items)) {
    return <StateMessage variant="error">{err ?? "Missing or malformed items"}</StateMessage>;
  }
  return (
    <div className="card sched-block">
      {data.title && <div className="card-title">{data.title}</div>}
      <div className="sched-timeline">
        {data.items.map((item, i) => (
          <div key={i} className="sched-row">
            <span className="sched-time">{item.time}</span>
            <div className="sched-track">
              <div className="sched-dot" />
              {i < data.items.length - 1 && <div className="sched-line" />}
            </div>
            <div className="sched-body">
              <span className="sched-task">{item.task}</span>
              {item.duration && <span className="sched-dur">{item.duration}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Flowchart ────────────────────────────────────────────────────────────── */
function FlowchartBlock({ body }) {
  const [data, err] = parseJSON(body);
  if (err || !Array.isArray(data?.nodes)) {
    return <StateMessage variant="error">{err ?? "Missing or malformed nodes"}</StateMessage>;
  }

  // Build an outgoing-edge-label map so arrows can carry "yes/no" style labels.
  const labelFor = {};
  (Array.isArray(data.edges) ? data.edges : []).forEach((e) => {
    labelFor[e.from] = e.label;
  });

  return (
    <div className="card flow-block">
      {data.title && <div className="card-title">{data.title}</div>}
      <div className="flow-nodes">
        {data.nodes.map((node, i) => {
          const isEnd = i === 0 || i === data.nodes.length - 1;
          return (
            <div key={node.id ?? i} className="flow-step">
              <div className={`flow-node${isEnd ? " flow-node--cap" : ""}`}>{node.label}</div>
              {i < data.nodes.length - 1 && (
                <div className="flow-conn">
                  <span className="flow-arrow">↓</span>
                  {labelFor[node.id] && <span className="flow-edge-lbl">{labelFor[node.id]}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Action result card ───────────────────────────────────────────────────── */
function ActionCard({ results, runAction }) {
  const icon = (t) =>
    ({
      open_app: "🪟",
      open: "🪟",
      launch: "🪟",
      close_app: "🗙",
      close: "🗙",
      kill: "🗙",
      open_url: "🌐",
      url: "🌐",
      website: "🌐",
      search_web: "🔍",
      search: "🔍",
      browse: "🔍",
      open_folder: "📁",
      folder: "📁",
      system: "⚙️",
      media: "⏯️",
      volume: "🔊",
      set_volume: "🔊",
      power: "⏻",
      shutdown: "⏻",
      restart: "🔄",
      time: "🕐",
      current_time: "🕐",
      day: "📅",
      date: "📅",
      ip_address: "🛰️",
      ip: "🛰️",
      location: "📍",
      geolocate: "📍",
      internet_speed: "📶",
      speedtest: "📶",
      qr_code: "🔳",
      qr: "🔳",
      screenshot: "📸",
      read_pdf: "📄",
      text_to_pdf: "📝",
      record: "⏺️",
      list_dir: "📂",
      read_file: "📄",
      open_file: "📂",
      generate_image: "🎨",
      image: "🎨",
      web_search: "🔍",
      web_answer: "🔍",
      schedule: "🗓️",
      silence: "🤫",
      sleep_mode: "😴",
      browser: "🌐",
      web: "🌐",
      browser_task: "🤖",
      computer: "🖱",
      computer_task: "🤖",
    })[t] ?? "⚡";
  return (
    <div className="action-cards">
      {results.map((r, i) => (
        <div key={i} className={`action-card${r.ok ? "" : " action-card--fail"}`}>
          <div className="action-card-row">
            <span className="action-ico">{icon(r.type)}</span>
            <span className="action-msg">{r.message}</span>
            <span className="action-state">{r.ok ? "✓" : "✕"}</span>
          </div>
          {r.image &&
            (r.type === "generate_image" ? (
              <div className="action-image-wrap">
                <img className="action-image" src={r.image} alt="generated image" />
                <div className="action-img-btns">
                  <button
                    type="button"
                    className="action-dl"
                    onClick={() => downloadDataUrl(r.image, r.message)}
                  >
                    ⬇ Download
                  </button>
                  {/* Reliable fallback when the in-webview download fails: the
                      backend already saved the file, so open it from disk (the
                      OS viewer can then Save-As anywhere). */}
                  {r.target && typeof runAction === "function" && (
                    <button
                      type="button"
                      className="action-dl"
                      onClick={() => runAction({ type: "open_file", target: r.target })}
                    >
                      📂 Open
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <img className="action-qr" src={r.image} alt="QR code" />
            ))}
          {Array.isArray(r.sources) && r.sources.length > 0 && (
            <div className="action-sources">
              {r.sources.map((s, j) => (
                <span key={j} className="action-source" title={s.uri || ""}>
                  {s.title || s.uri}
                </span>
              ))}
            </div>
          )}
          {Array.isArray(r.findings) && r.findings.length > 0 && (
            <div className="action-findings">
              <div className="action-findings-h">What I found</div>
              <ul>
                {r.findings.map((f, j) => (
                  <li key={j}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Segment parser ───────────────────────────────────────────────────────── */
function parseSegments(text) {
  const segments = [];
  const re =
    /\[(CHART[^\]]*|SCHEDULE|FLOWCHART|TABLE)\]([\s\S]*?)\[\/(?:CHART|SCHEDULE|FLOWCHART|TABLE)\]/g;
  let last = 0,
    match;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      const plain = text.slice(last, match.index).trim();
      if (plain) segments.push({ kind: "text", content: plain });
    }
    const tagHead = match[1];
    // SCHEDULE/TABLE/FLOWCHART tag heads equal their kind verbatim; only CHART
    // carries a variant suffix (e.g. "CHART:bar"), so collapse just that case.
    const kind = tagHead.startsWith("CHART") ? "CHART" : tagHead;
    segments.push({ kind, tagHead, content: match[2] });
    last = match.index + match[0].length;
  }

  const tail = text.slice(last).trim();
  if (tail) segments.push({ kind: "text", content: tail });
  if (segments.length === 0) segments.push({ kind: "text", content: text });
  return segments;
}

/** Render the safe Markdown subset shared with TTS. React escapes every text
 * node, so model output can never inject HTML into the chat. */
function InlineMarkdown({ text }) {
  return inlineMarkdownSegments(text).map((part, i) => {
    if (part.kind === "bold") return <strong key={i}>{part.content}</strong>;
    if (part.kind === "boldItalic") {
      return (
        <strong key={i}>
          <em>{part.content}</em>
        </strong>
      );
    }
    return part.content;
  });
}

// Block kind → renderer. Non-chart blocks ignore the extra tagHead prop.
const BLOCKS = {
  CHART: ChartBlock,
  TABLE: TableBlock,
  SCHEDULE: ScheduleBlock,
  FLOWCHART: FlowchartBlock,
};

export default function ResponseRenderer({ text, actions, runAction }) {
  // Memoize the parse so a finalized bubble doesn't re-scan its text on every
  // re-render driven by another message still streaming.
  const segments = useMemo(() => parseSegments(text), [text]);

  return (
    <div className="resp-renderer">
      {segments.map((seg, i) => {
        const Block = BLOCKS[seg.kind];
        if (Block === ChartBlock) {
          return (
            <Suspense key={i} fallback={<div className="card chart-block" style={{ height: 240 }} />}>
              <ChartBlock tagHead={seg.tagHead} body={seg.content} />
            </Suspense>
          );
        }
        if (Block) return <Block key={i} tagHead={seg.tagHead} body={seg.content} />;
        return (
          <p key={i} className="chat-text">
            <InlineMarkdown text={seg.content} />
          </p>
        );
      })}
      {actions?.length > 0 && <ActionCard results={actions} runAction={runAction} />}
    </div>
  );
}

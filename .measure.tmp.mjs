/** Scratch: measure row/plate/kit overlap on the picker. Deleted after use. */
const [, , url, w, h] = process.argv;
const list = await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json());
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
await send("Page.enable");
await send("Page.navigate", { url });
await new Promise((r) => setTimeout(r, 5000));

const expr = `(() => {
  const pitch = document.querySelector(".board.pick .pitch") || document.querySelector(".pitch");
  const rows = [...pitch.querySelectorAll(".row")];
  const out = rows.map((row, i) => {
    const kits = [...row.querySelectorAll(".kit")].map(k => k.getBoundingClientRect());
    const plates = [...row.querySelectorAll(".plate")].map(k => k.getBoundingClientRect());
    return {
      row: i,
      kitTop: Math.round(Math.min(...kits.map(r => r.top))),
      kitBottom: Math.round(Math.max(...kits.map(r => r.bottom))),
      plateTop: Math.round(Math.min(...plates.map(r => r.top))),
      plateBottom: Math.round(Math.max(...plates.map(r => r.bottom))),
      slotW: Math.round(kits[0].width),
      gapX: kits.length > 1 ? Math.round(kits[1].left - kits[0].right) : null,
      plateGapX: plates.length > 1 ? Math.round(plates[1].left - plates[0].right) : null,
    };
  });
  const gaps = [];
  for (let i = 1; i < out.length; i++) gaps.push({ between: (i-1)+"->"+i, px: out[i].kitTop - out[i-1].plateBottom });
  const p = pitch.getBoundingClientRect();
  return JSON.stringify({ pitch: { top: Math.round(p.top), bottom: Math.round(p.bottom), h: Math.round(p.height) }, rows: out, verticalGaps: gaps }, null, 1);
})()`;
const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
console.log(res.result.value);
ws.close(); process.exit(0);

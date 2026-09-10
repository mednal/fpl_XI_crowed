/** Scratch: real device-metric screenshots over CDP. Deleted after use. */
import { writeFileSync } from "node:fs";

const jobs = JSON.parse(process.argv[2]);

const list = await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json());
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
await new Promise((r) => (ws.onopen = r));
await send("Page.enable");

for (const j of jobs) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: j.w, height: j.h, deviceScaleFactor: 1, mobile: j.w < 700,
  });
  await send("Page.navigate", { url: j.url });
  await new Promise((r) => setTimeout(r, j.wait ?? 5500));
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: !!j.full,
  });
  writeFileSync(j.out, Buffer.from(shot.data, "base64"));
  console.log("wrote", j.out);
}
ws.close();
process.exit(0);

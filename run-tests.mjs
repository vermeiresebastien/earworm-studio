/* Drives the headless Chrome instance over CDP and prints the harness results. */
const port = Number(process.argv[2] || 9333);
const match = process.argv[3] || "test.html";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findTarget() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await response.json();
      const page = list.find((target) => target.type === "page" && String(target.url).includes(match));
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (error) {
      /* chrome not up yet */
    }
    await sleep(250);
  }
  throw new Error(`No Chrome page target matching "${match}" on port ${port}`);
}

const target = await findTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const events = [];
let nextId = 0;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  } else {
    events.push(message);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });

await new Promise((resolve) => socket.addEventListener("open", resolve));
await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");

/* Optional mobile emulation: pass e.g. 390x844 as the third argument. */
const metrics = process.argv[4];
if (metrics) {
  const [width, height] = metrics.split("x").map(Number);
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await new Promise((resolve) => setTimeout(resolve, 400));
  console.log(`emulating ${width}x${height} mobile viewport`);
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.result && response.result.exceptionDetails) {
    throw new Error(JSON.stringify(response.result.exceptionDetails));
  }
  if (response.result && response.result.result) return response.result.result.value;
  throw new Error(JSON.stringify(response));
}

let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const kind = await evaluate("typeof window.__runTests");
    if (kind === "function") {
      ready = true;
      break;
    }
  } catch (error) {
    /* page still loading */
  }
  await sleep(250);
}
if (!ready && !process.argv[5]) throw new Error("Harness never became available");

const consoleMessages = events
  .filter((event) => event.method === "Runtime.consoleAPICalled")
  .map((event) => `${event.params.type}: ${event.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")}`)
  .filter((text) => !/^log: /.test(text));
const exceptions = events
  .filter((event) => event.method === "Runtime.exceptionThrown")
  .map((event) => event.params.exceptionDetails.text + " " + (event.params.exceptionDetails.exception?.description || ""));

if (!ready) {
  console.log("no harness on this page — capturing screenshots only");
  // a throw inside the page's setup script would otherwise be invisible here
  if (exceptions.length) console.log("--- page exceptions ---\n" + exceptions.join("\n"));
  if (consoleMessages.length) console.log("--- console ---\n" + consoleMessages.join("\n"));
  const { writeFileSync } = await import("node:fs");
  const shotPath = process.argv[5];
  const view = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(shotPath, Buffer.from(view.result.data, "base64"));
  const full = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(`${shotPath.replace(/\.png$/, "")}.full.png`, Buffer.from(full.result.data, "base64"));
  console.log(`screenshots: ${shotPath} and ${shotPath.replace(/\.png$/, "")}.full.png`);
  socket.close();
  process.exit(exceptions.length ? 1 : 0);
}

const outcome = await evaluate("window.__runTests()");

const failures = outcome.results.filter((result) => !result.pass);
console.log(`\n=== ${outcome.results.length - failures.length}/${outcome.results.length} checks passed ===`);
for (const result of outcome.results) {
  console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail ? `  [${result.detail}]` : ""}`);
}

let dspFailures = [];
if (typeof (await evaluate("typeof window.__dspCheck")) === "string" && (await evaluate("typeof window.__dspCheck")) === "function") {
  const dsp = await evaluate("window.__dspCheck()");
  dspFailures = dsp.results.filter((result) => !result.pass);
  console.log(`\n=== audio measurements: ${dsp.results.length - dspFailures.length}/${dsp.results.length} passed (${dsp.audioContextState}, ${dsp.sampleRate} Hz) ===`);
  for (const result of dsp.results) {
    console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail ? `  [${result.detail}]` : ""}`);
  }
}

/* A real key press through Chrome's own input pipeline, not a synthetic event. */
const keyFailures = [];
try {
  await evaluate("window.earworm.stop(); true");
  const before = await evaluate("window.earworm.state.isPlaying");
  const key = { modifiers: 0, windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, code: "Space", key: " " };
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const after = await evaluate("window.earworm.state.isPlaying");
  const startedOk = before === false && after === true;
  if (!startedOk) keyFailures.push({ name: "real space press starts playback", detail: `${before} -> ${after}` });
  console.log(`\n=== real key press: ${startedOk ? "PASS" : "FAIL"} space bar started playback (${before} -> ${after}) ===`);
  await evaluate("window.earworm.stop(); true");
} catch (error) {
  keyFailures.push({ name: "real space press", detail: String(error && error.message) });
  console.log(`\n=== real key press: FAIL ${error && error.message} ===`);
}

if (consoleMessages.length) console.log("\n--- console ---\n" + consoleMessages.join("\n"));
if (exceptions.length) console.log("\n--- page exceptions ---\n" + exceptions.join("\n"));

/* Optional screenshots: <path> for the viewport, <path>+".full" for the whole page. */
const shotPath = process.argv[5];
if (shotPath) {
  const { writeFileSync } = await import("node:fs");
  const view = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(shotPath, Buffer.from(view.result.data, "base64"));
  const full = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(`${shotPath.replace(/\.png$/, "")}.full.png`, Buffer.from(full.result.data, "base64"));
  console.log(`\nscreenshots: ${shotPath} (viewport) and full page`);
}

socket.close();
process.exit(failures.length + dspFailures.length + keyFailures.length ? 1 : 0);

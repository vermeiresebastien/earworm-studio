/* Runs test.html in jsdom with a stubbed Web Audio API.
   Chrome cannot launch inside the DSH sandbox, so this is the end-to-end check. */
import { JSDOM, VirtualConsole } from "jsdom";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));

class Param {
  constructor(value = 0) {
    this.value = value;
    this.__events = []; // mirrors the scheduled automation of the real API
  }
  static check(value, time, what) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError(`${what}: non-finite value ${value}`);
    }
    if (time !== undefined && !Number.isFinite(time)) {
      throw new TypeError(`${what}: non-finite time ${time}`);
    }
  }
  setValueAtTime(value, time) {
    Param.check(value, time, "setValueAtTime");
    this.__events.push({ type: "set", value, time });
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value, time) {
    Param.check(value, time, "linearRampToValueAtTime");
    this.__events.push({ type: "linear", value, time });
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value, time) {
    Param.check(value, time, "exponentialRampToValueAtTime");
    if (value === 0) throw new Error("exponentialRampToValueAtTime target must be non-zero");
    this.__events.push({ type: "exponential", value, time });
    this.value = value;
    return this;
  }
  setTargetAtTime(value, time) {
    Param.check(value, time, "setTargetAtTime");
    this.__events.push({ type: "target", value, time });
    this.value = value;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

const started = { oscillators: 0, buffers: 0 };

function audioNode(extra = {}) {
  const checkStart = (time) => {
    if (time !== undefined && !Number.isFinite(time)) throw new TypeError(`start: non-finite time ${time}`);
  };
  return Object.assign(
    {
      __kind: "node",
      __out: [],
      connect(target) {
        // Mirror Chrome: connecting a non-node is an error, not a silent no-op.
        if (!target || typeof target !== "object") throw new TypeError("connect requires an AudioNode");
        this.__out.push(target);
        return target;
      },
      disconnect() {
        this.__out = [];
      },
      start(time) {
        checkStart(time);
        started.oscillators += 1;
      },
      stop(time) {
        checkStart(time);
      },
    },
    extra
  );
}

class StubAudioContext {
  constructor() {
    this.sampleRate = 44100;
    this._time = 0; // currentTime lives on the prototype, like the real thing
    this.state = "running";
    this.__created = [];
    this.destination = this.__tag(audioNode(), "destination");
  }
  get currentTime() {
    return this._time;
  }
  set currentTime(value) {
    this._time = value;
  }
  __tag(node, kind) {
    node.__kind = kind;
    this.__created.push(node);
    return node;
  }
  createGain() {
    return this.__tag(audioNode({ gain: new Param(1) }), "gain");
  }
  createOscillator() {
    return this.__tag(audioNode({ type: "sine", frequency: new Param(440), detune: new Param(0) }), "oscillator");
  }
  createBufferSource() {
    return this.__tag(
      audioNode({
        buffer: null,
        playbackRate: new Param(1),
        start(time) {
          if (time !== undefined && !Number.isFinite(time)) throw new TypeError(`start: non-finite time ${time}`);
          started.buffers += 1;
        },
      }),
      "bufferSource"
    );
  }
  createBuffer(channels, length, sampleRate) {
    const data = [];
    for (let channel = 0; channel < channels; channel++) data.push(new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (channel) => data[channel],
    };
  }
  createBiquadFilter() {
    return this.__tag(
      audioNode({ type: "lowpass", frequency: new Param(350), Q: new Param(1), gain: new Param(0) }),
      "biquad"
    );
  }
  createConvolver() {
    return this.__tag(audioNode({ buffer: null, normalize: true }), "convolver");
  }
  createDelay() {
    return this.__tag(audioNode({ delayTime: new Param(0) }), "delay");
  }
  createDynamicsCompressor() {
    return this.__tag(
      audioNode({
        threshold: new Param(-24),
        knee: new Param(30),
        ratio: new Param(12),
        attack: new Param(0.003),
        release: new Param(0.25),
        reduction: 0,
      }),
      "compressor"
    );
  }
  createWaveShaper() {
    return this.__tag(audioNode({ curve: null, oversample: "none" }), "waveshaper");
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  decodeAudioData(data, success, failure) {
    try {
      // Mirror the WAV payload length so duration assertions stay meaningful.
      const length = Math.max(1, Math.floor((data.byteLength - 44) / 2));
      const buffer = this.createBuffer(1, length, this.sampleRate);
      if (success) success(buffer);
      return Promise.resolve(buffer);
    } catch (error) {
      if (failure) failure(error);
      return Promise.reject(error);
    }
  }
}

const virtualConsole = new VirtualConsole();
const pageMessages = [];
virtualConsole.on("jsdomError", (error) => pageMessages.push(`jsdomError: ${error.message}`));
virtualConsole.on("error", (message) => pageMessages.push(`console.error: ${message}`));
virtualConsole.on("warn", (message) => pageMessages.push(`console.warn: ${message}`));

const dom = await JSDOM.fromFile(path.join(dir, "test.html"), {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) {
    window.AudioContext = StubAudioContext;
    window.__stubAudio = true; // tells the harness there is no layout engine or real audio
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  },
});

const { window } = dom;
await new Promise((resolve) => {
  if (window.document.readyState === "complete") resolve();
  else window.addEventListener("load", resolve);
});

let outcome = null;
let harnessError = null;
try {
  outcome = await window.__runTests();
} catch (error) {
  harnessError = error;
}

if (pageMessages.length) console.log("\n--- page messages ---\n" + pageMessages.join("\n"));

if (!outcome) {
  console.log("\n=== the harness never ran — the page failed to start ===");
  console.log(String((harnessError && harnessError.message) || harnessError));
  if (typeof window.earworm === "undefined") console.log("window.earworm is undefined: app.js threw while loading.");
  window.close();
  process.exit(1);
}

const failures = outcome.results.filter((result) => !result.pass);
console.log(`\n=== ${outcome.results.length - failures.length}/${outcome.results.length} checks passed ===`);
for (const result of outcome.results) {
  console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail ? `  [${result.detail}]` : ""}`);
}
console.log(`\naudio nodes started: ${started.oscillators} oscillator/source starts`);
window.close();
process.exit(failures.length ? 1 : 0);

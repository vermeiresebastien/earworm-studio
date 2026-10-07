/* ============================================================================
   Earworm Studio
   16-step sequencer.

   Two things this version adds on top of the original:
     1. SWING        - a groove amount that pushes the off-beat notes later,
                       on a 1/8 or 1/16 grid. Notes are scheduled ahead of
                       time on the Web Audio clock, so swing is sample-accurate
                       instead of "roughly whenever setTimeout fires".
     2. DRUM SOUNDS  - the three drum lanes can each play a built-in synth kit
                       voice or any sample. Samples come from a folder you pick
                       once (remembered when the browser allows it) or from
                       individual files you import.
   ========================================================================== */

"use strict";

const STEPS = 16;
const NOTES = [220, 261.63, 293.66, 329.63, 392, 440];
const INSTRUMENTS = [
  { id: "drums", name: "Drums", color: "#FD8EFF" },
  { id: "bass", name: "Bass", color: "#56BEFF" },
  { id: "synth", name: "Synth", color: "#99ff71" },
  { id: "strings", name: "Strings", color: "#C06BFF" },
  { id: "drop", name: "Drop", color: "#ff9a00" },
];
const DROP_LABELS = ["Epic", "Long", "Medium", "Short"];
const DROP_DURATIONS = [0.3, 0.6, 1, 1.5];

/* ---------------------------------------------------------------------------
   Drum lanes and built-in kits
   Every kit voice is a small parameter set for one of three synth engines
   (kick / snare / hat), so kits stay cheap to add.
   ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
   Drum lanes
   The three below are only the starting set: lanes are data now, so you can
   add as many as you like, each with its own name, colour, sound and pitch.
   ------------------------------------------------------------------------- */

const DRUM_COLORS = ["#FD8EFF", "#56BEFF", "#99ff71", "#C06BFF", "#ff9a00", "#ff5a5a", "#56ffd5", "#ffe066"];
const MAX_DRUM_LANES = 12;
const DEFAULT_DRUM_COLOR = DRUM_COLORS[0];
const MAX_LANE_NAME = 14;

const DRUM_LANES = [
  { id: "kick", name: "Kick", color: DEFAULT_DRUM_COLOR, pitch: 0 },
  { id: "snare", name: "Snare", color: DEFAULT_DRUM_COLOR, pitch: 0 },
  { id: "hihat", name: "Hat", color: DEFAULT_DRUM_COLOR, pitch: 0 },
];

const defaultDrumLanes = () => DRUM_LANES.map((lane) => ({ ...lane }));

const KITS = [
  {
    id: "analog",
    name: "Analog 808",
    voices: {
      kick: { engine: "kick", type: "sine", start: 160, end: 45, pitchTime: 0.06, decay: 0.55 },
      snare: { engine: "snare", tone: 185, toneDecay: 0.16, noiseDecay: 0.22, hp: 900, toneLevel: 0.45, noiseLevel: 0.85 },
      hihat: { engine: "hat", decay: 0.09, hp: 8000, q: 1, level: 0.34 },
    },
  },
  {
    id: "nine",
    name: "Nine-Oh-Nine",
    voices: {
      kick: { engine: "kick", type: "sine", start: 230, end: 52, pitchTime: 0.03, decay: 0.34, click: 0.45 },
      snare: { engine: "snare", tone: 210, toneDecay: 0.12, noiseDecay: 0.16, hp: 1500, toneLevel: 0.6, noiseLevel: 1 },
      hihat: { engine: "hat", decay: 0.055, hp: 9500, q: 1.2, level: 0.4 },
    },
  },
  {
    id: "acoustic",
    name: "Acoustic Room",
    voices: {
      kick: { engine: "kick", type: "sine", start: 120, end: 42, pitchTime: 0.1, decay: 0.8, click: 0.12 },
      snare: { engine: "snare", tone: 175, toneDecay: 0.3, noiseDecay: 0.36, hp: 700, toneLevel: 0.4, noiseLevel: 0.75 },
      hihat: { engine: "hat", decay: 0.17, hp: 6500, bp: 11000, q: 0.8, level: 0.3 },
    },
  },
  {
    id: "lofi",
    name: "Lo-Fi Tape",
    voices: {
      kick: { engine: "kick", type: "sine", start: 135, end: 38, pitchTime: 0.09, decay: 0.6, click: 0.05 },
      snare: { engine: "snare", tone: 150, toneDecay: 0.2, noiseDecay: 0.26, hp: 500, toneLevel: 0.5, noiseLevel: 0.65 },
      hihat: { engine: "hat", decay: 0.12, hp: 5000, q: 0.7, level: 0.26 },
    },
  },
  {
    id: "chip",
    name: "Chip",
    voices: {
      kick: { engine: "kick", type: "square", start: 420, end: 70, pitchTime: 0.02, decay: 0.13 },
      snare: { engine: "snare", tone: 330, toneDecay: 0.06, noiseDecay: 0.05, hp: 2500, toneLevel: 0.45, noiseLevel: 0.55 },
      hihat: { engine: "hat", decay: 0.04, hp: 11000, q: 1, level: 0.3 },
    },
  },
];

const kitById = (id) => KITS.find((kit) => kit.id === id) || null;

/* ---------------------------------------------------------------------------
   Melodic voices
   The three pitched instruments share a transpose and an FM section.
   `octaveOffset` is where the row sits relative to the base scale.
   ------------------------------------------------------------------------- */

const MELODIC_VOICES = [
  { id: "synth", name: "Synth", octaveOffset: 0, base: "sawtooth" },
  { id: "bass", name: "Bass", octaveOffset: -1, base: "sine" },
  { id: "strings", name: "Strings", octaveOffset: 0, base: "sine + triangle" },
];

const isMelodic = (id) => MELODIC_VOICES.some((voice) => voice.id === id);
const melodicMeta = (id) => MELODIC_VOICES.find((voice) => voice.id === id) || null;

/** Modulator : carrier frequency ratios offered in the FM section. */
const FM_RATIOS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 7, 8];

/* ---------------------------------------------------------------------------
   Modules and racks
   Every instrument is its own module with its own insert chain; the master rack
   sits at the end of all of them.
   ------------------------------------------------------------------------- */

const MODULE_IDS = ["drums", "bass", "synth", "strings", "drop"];
const RACK_IDS = [...MODULE_IDS, "master"];
const MODULE_LABELS = { drums: "Drums", bass: "Bass", synth: "Synth", strings: "Strings", drop: "Drop", master: "Master" };
const MAX_RACK_EFFECTS = 8;

const MAX_FM_INDEX = 8; // FM amount 100% == modulation index 8
const TRANSPOSE_MIN = -36; // semitones down
const TRANSPOSE_MAX = 12; // semitones up

/* ---------------------------------------------------------------------------
   Amplitude envelopes
   One ADSR per module. It multiplies each voice's own character envelope, so
   the defaults below leave the built-in sounds exactly as they were.
   ------------------------------------------------------------------------- */

const formatSeconds = (value) =>
  value >= 1 ? `${value.toFixed(2)} s` : `${Math.round(value * 1000)} ms`;

const ENVELOPE_SPEC = {
  attack: { label: "Attack", min: 0.001, max: 2, curve: "log", format: formatSeconds },
  decay: { label: "Decay", min: 0.01, max: 3, curve: "log", format: formatSeconds },
  sustain: { label: "Sustain", min: 0, max: 1, curve: "linear", format: (value) => `${Math.round(value * 100)}%` },
  release: { label: "Release", min: 0.01, max: 3, curve: "log", format: formatSeconds },
};

const ENVELOPE_KEYS = ["attack", "decay", "sustain", "release"];

const defaultEnvelopes = () => ({
  // the drum decays live in the voices, so the amp envelope stays out of the way
  drums: { attack: 0.001, decay: 1.5, sustain: 0, release: 0.05 },
  bass: { attack: 0.012, decay: 0.45, sustain: 0, release: 0.08 },
  synth: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.05 },
  strings: { attack: 0.1, decay: 0.3, sustain: 0.85, release: 0.5 },
  drop: { attack: 0.01, decay: 0.1, sustain: 1, release: 0.2 },
});

/* ---------------------------------------------------------------------------
   FM 2
   A second FM operator on every module, in its own section after the inserts.
   Melodic voices run it alongside the one in their voice panel; the drums and
   the drop get their modulation from here.
   ------------------------------------------------------------------------- */

/** Modulation runs at an audio rate even when the target is a playback ratio. */
const FM_RATE_BASE_HZ = 110;
const FM_RATE_DEPTH = 0.5; // up to +/- 50% of normal speed

const defaultFm2 = () =>
  Object.fromEntries(MODULE_IDS.map((moduleId) => [moduleId, { amount: 0, ratio: 2, decay: 0.2 }]));

/** Seconds below which the release tail is inaudible anyway. */
const ENVELOPE_FLOOR = 1e-4;

/**
 * Write an ADSR onto a gain param and report how long the note lasts.
 * `gate` is how long the key is held; the release starts after that (or after
 * the decay, whichever is later, so a short gate still lets the attack finish).
 */
function applyAmpEnvelope(param, envelope, time, gate, peak) {
  const attack = Math.max(0.001, envelope.attack);
  const decay = Math.max(0.005, envelope.decay);
  const sustain = clamp(envelope.sustain, 0, 1);
  const release = Math.max(0.005, envelope.release);
  const sustainLevel = Math.max(ENVELOPE_FLOOR, peak * sustain);

  param.cancelScheduledValues(time);
  param.setValueAtTime(0, time);
  param.linearRampToValueAtTime(peak, time + attack);
  param.exponentialRampToValueAtTime(sustainLevel, time + attack + decay);
  const gateEnd = Math.max(time + attack + decay, time + gate);
  if (sustain > 0) param.setValueAtTime(sustainLevel, gateEnd); // hold while the key is down
  param.exponentialRampToValueAtTime(ENVELOPE_FLOOR, gateEnd + release);
  return Math.max(gate, attack + decay) + release;
}

const formatHz = (value) =>
  value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`;

/* ---------------------------------------------------------------------------
   Effects rack
   A serial chain placed after every instrument and before the output.
   Each type describes its parameters once; the UI and the audio nodes are
   both generated from that description. Every effect is wired as a parallel
   dry/wet pair, so `mix` works the same way for all of them.
   ------------------------------------------------------------------------- */

/** Reverb and delay are insert effects only: they never appear on the master. */
const INSERT_ONLY_TYPES = ["reverb", "delay"];

const mixParam = (defaultValue) => ({
  kind: "range",
  label: "Dry / wet",
  min: 0,
  max: 1,
  curve: "linear",
  default: defaultValue,
  format: (value) => `${Math.round(value * 100)}% wet`,
});

const EFFECT_TYPES = {
  filter: {
    name: "Filter",
    hint: "Shapes the tone",
    defaultMix: 1,
    params: {
      mode: {
        kind: "select",
        label: "Type",
        options: [
          ["lowpass", "Low-pass"],
          ["highpass", "High-pass"],
          ["bandpass", "Band-pass"],
        ],
        default: "lowpass",
      },
      cutoff: {
        kind: "range",
        label: "Cutoff",
        min: 40,
        max: 16000,
        curve: "log",
        default: 900,
        format: formatHz,
      },
      resonance: {
        kind: "range",
        label: "Resonance",
        min: 0.1,
        max: 18,
        curve: "log",
        default: 1,
        format: (value) => value.toFixed(1),
      },
      mix: mixParam(1),
    },
    create(ctx) {
      const node = ctx.createBiquadFilter();
      return {
        input: node,
        output: node,
        update(params) {
          node.type = params.mode;
          node.frequency.value = params.cutoff;
          node.Q.value = params.resonance;
        },
      };
    },
  },
  distortion: {
    name: "Distortion",
    hint: "Adds harmonics",
    defaultMix: 1,
    params: {
      drive: {
        kind: "range",
        label: "Drive",
        min: 1,
        max: 40,
        curve: "linear",
        default: 6,
        format: (value) => `${value.toFixed(1)}×`,
      },
      tone: {
        kind: "range",
        label: "Tone",
        min: 300,
        max: 16000,
        curve: "log",
        default: 6000,
        format: formatHz,
      },
      level: {
        kind: "range",
        label: "Level",
        min: 0,
        max: 1.4,
        curve: "linear",
        default: 0.6,
        format: (value) => `${Math.round(value * 100)}%`,
      },
      mix: mixParam(1),
    },
    create(ctx) {
      const shaper = ctx.createWaveShaper();
      shaper.oversample = "4x";
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      const level = ctx.createGain();
      shaper.connect(tone);
      tone.connect(level);
      return {
        input: shaper,
        output: level,
        update(params) {
          shaper.curve = distortionCurve(params.drive);
          tone.frequency.value = params.tone;
          level.gain.value = params.level;
        },
      };
    },
  },
  delay: {
    name: "Delay",
    hint: "Repeats, insert only",
    defaultMix: 0.35,
    params: {
      time: {
        kind: "range",
        label: "Time",
        min: 20,
        max: 1400,
        curve: "log",
        default: 280,
        format: (value) => `${Math.round(value)} ms`,
      },
      feedback: {
        kind: "range",
        label: "Feedback",
        min: 0,
        max: 0.95,
        curve: "linear",
        default: 0.4,
        format: (value) => `${Math.round(value * 100)}%`,
      },
      tone: {
        kind: "range",
        label: "Tone",
        min: 400,
        max: 16000,
        curve: "log",
        default: 4000,
        format: formatHz,
      },
      mix: mixParam(0.35),
    },
    create(ctx) {
      const delay = ctx.createDelay(1.5);
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      const feedback = ctx.createGain();
      delay.connect(tone);
      tone.connect(feedback);
      feedback.connect(delay);
      return {
        input: delay,
        output: delay,
        update(params) {
          delay.delayTime.value = clamp(params.time / 1000, 0.02, 1.4);
          feedback.gain.value = clamp(params.feedback, 0, 0.95);
          tone.frequency.value = params.tone;
        },
      };
    },
  },
  reverb: {
    name: "Reverb",
    hint: "Room, insert only",
    defaultMix: 0.4,
    params: {
      size: {
        kind: "range",
        label: "Size",
        min: 0.25,
        max: 6,
        curve: "log",
        default: 2,
        format: (value) => `${value.toFixed(2)} s`,
      },
      damping: {
        kind: "range",
        label: "Damping",
        min: 400,
        max: 16000,
        curve: "log",
        default: 5000,
        format: formatHz,
      },
      mix: mixParam(0.4),
    },
    create(ctx) {
      const convolver = ctx.createConvolver();
      const damping = ctx.createBiquadFilter();
      damping.type = "lowpass";
      convolver.connect(damping);
      let builtSize = 0;
      return {
        input: convolver,
        output: damping,
        update(params) {
          // regenerate the impulse only when the size really changes
          const size = Math.max(0.2, Math.round(params.size * 4) / 4);
          if (size !== builtSize) {
            convolver.buffer = impulse(ctx, size);
            builtSize = size;
          }
          damping.frequency.value = params.damping;
        },
      };
    },
  },
};

/** Which effect types a rack may hold: the master cannot take reverb or delay. */
const effectTypesFor = (rackId) =>
  Object.keys(EFFECT_TYPES).filter((type) => rackId !== "master" || !INSERT_ONLY_TYPES.includes(type));


/** Soft-clipping transfer curve, peak-normalised so drive does not jump level. */
function distortionCurve(drive) {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const amount = Math.max(0.001, drive);
  const norm = Math.tanh(amount) || 1;
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / norm;
  }
  return curve;
}

function ratioToValue(spec, ratio) {
  const r = clamp(ratio, 0, 1);
  if (spec.curve === "log") return spec.min * Math.pow(spec.max / spec.min, r);
  return spec.min + (spec.max - spec.min) * r;
}

function valueToRatio(spec, value) {
  const v = clamp(Number.isFinite(value) ? value : spec.min, spec.min, spec.max);
  if (spec.curve === "log") return Math.log(v / spec.min) / Math.log(spec.max / spec.min);
  return (v - spec.min) / (spec.max - spec.min);
}

function defaultEffectParams(type) {
  const spec = EFFECT_TYPES[type];
  const params = {};
  for (const [key, paramSpec] of Object.entries(spec.params)) params[key] = paramSpec.default;
  return params;
}

/* ---------------------------------------------------------------------------
   Sequence helpers
   ------------------------------------------------------------------------- */

const emptyRow = () => Array(STEPS).fill(false);
const emptyNoteGrid = (rows) => Array.from({ length: rows }, emptyRow);
/** An empty drum grid for a given lane list (used before `state` exists). */
const emptyDrumsFor = (lanes) => Object.fromEntries(lanes.map((lane) => [lane.id, emptyRow()]));

const emptySequenceFor = (lanes) => ({
  drums: emptyDrumsFor(lanes),
  bass: emptyNoteGrid(6),
  synth: emptyNoteGrid(6),
  strings: emptyNoteGrid(6),
  drop: emptyNoteGrid(4),
});

/** The lanes the project currently has. */
const drumLanes = () => state.drums.lanes;
const laneById = (laneId) => drumLanes().find((lane) => lane.id === laneId) || null;
/** The colour painted for one drum row. */
const laneColor = (laneId) => (laneById(laneId) || {}).color || DEFAULT_DRUM_COLOR;
/** The label shown beside one drum row. */
const laneName = (laneId) => (laneById(laneId) || {}).name || laneId;

const emptyDrums = () => emptyDrumsFor(drumLanes());
const emptySequence = () => emptySequenceFor(drumLanes());

function demoSequence() {
  const sequence = emptySequence();
  const hit = (laneId, steps) => {
    const row = sequence.drums[laneId];
    if (row) for (const step of steps) row[step] = true;
  };
  hit("kick", [0, 4, 8, 12]);
  hit("snare", [4, 12]);
  const hats = [];
  for (let step = 0; step < STEPS; step += 2) hats.push(step);
  hit("hihat", hats);
  sequence.bass[0][0] = true;
  sequence.bass[0][8] = true;
  sequence.bass[1][4] = true;
  sequence.bass[2][12] = true;
  sequence.synth[4][2] = true;
  sequence.synth[3][6] = true;
  sequence.synth[2][10] = true;
  sequence.synth[1][14] = true;
  sequence.drop[0][0] = true;
  sequence.drop[1][4] = true;
  sequence.drop[2][8] = true;
  sequence.drop[3][12] = true;
  sequence.strings[5][0] = true;
  sequence.strings[3][4] = true;
  sequence.strings[4][8] = true;
  sequence.strings[2][12] = true;
  return sequence;
}

/* ---------------------------------------------------------------------------
   State
   ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
   Defaults
   One source of truth, so the Reset button lands on exactly the state a fresh
   page starts in.
   ------------------------------------------------------------------------- */

const DEFAULT_TEMPO = 120;
const DEFAULT_VOLUME = 0.7;
const DEFAULT_SWING_GRID = 8;

const zeroByModule = (value) => Object.fromEntries(MODULE_IDS.map((moduleId) => [moduleId, value]));

const defaultVoices = () => ({
  bass: { fmAmount: 0, fmRatio: 1, fmDecay: 0.2 },
  synth: { fmAmount: 0, fmRatio: 2, fmDecay: 0.15 },
  strings: { fmAmount: 0, fmRatio: 1, fmDecay: 0.4 },
});

const defaultDrums = () => ({
  kit: "analog",
  lanes: defaultDrumLanes(),
  voices: Object.fromEntries(DRUM_LANES.map((lane) => [lane.id, ""])),
});

const defaultRacks = () => Object.fromEntries(RACK_IDS.map((rackId) => [rackId, []]));

const state = {
  activeInstrument: "synth",
  sequence: emptySequenceFor(DRUM_LANES),
  isPlaying: false,
  currentStep: 0,
  tempo: DEFAULT_TEMPO,
  volume: DEFAULT_VOLUME,
  swing: 0, // 0 .. 1  (0 = straight, 1 = maximum swing)
  swingGrid: DEFAULT_SWING_GRID, // 8 = swing the 8th notes, 16 = swing the 16th notes
  transpose: 0, // semitones, TRANSPOSE_MIN .. TRANSPOSE_MAX, for every melodic instrument
  // Per-module pitch, on top of the global transpose. Every module can be tuned
  // on its own: melodic voices, drum kits and samples, and the drop.
  pitch: zeroByModule(0),
  // Mixer: one level and one mute per module. 1 = unity gain, up to 1.5 for makeup.
  levels: zeroByModule(1),
  muted: zeroByModule(false),
  // Post-insert output level per module: the last gain before the master rack.
  outputs: zeroByModule(1),
  voices: defaultVoices(),
  // One serial effect chain per module, plus the master rack at the end:
  // instrument -> its own inserts -> master rack -> output
  racks: defaultRacks(),
  drums: defaultDrums(),
  // one ADSR per module, applied on top of each voice's own character
  envelopes: defaultEnvelopes(),
  // a second FM operator per module, in its own section after the inserts
  fm2: defaultFm2(),
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const esc = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

/* ---------------------------------------------------------------------------
   Audio context + master out
   ------------------------------------------------------------------------- */

let audioCtx = null;
let masterIn = null; // every module chain lands here; volume lives here
let masterOut = null; // stable end of the master rack, always connected to the speakers
let effectNodes = new Map(); // effect id -> { type, input, output, update }
let moduleBuses = new Map(); // module id -> the gain node its voices play into
let moduleOutputs = new Map(); // module id -> the post-insert output fader
let effectCounter = 0;

/**
 * While a WAV export runs, these globals point at a throwaway graph built in an
 * OfflineAudioContext, so every voice and effect renders offline untouched.
 */
const isOfflineContext = (ctx) => Boolean(ctx) && typeof ctx.startRendering === "function";
const impulseCache = new Map();

function getContext() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

const nextEffectId = () => `fx${++effectCounter}`;

/**
 * Build the audio for one effect: a dry path and a wet path summed into the
 * effect's output, so every type shares the same dry/wet control.
 */
function createEffectRuntime(type, ctx) {
  const spec = EFFECT_TYPES[type];
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const processor = spec.build ? spec.build(ctx) : spec.create(ctx);
  input.connect(dry);
  dry.connect(output);
  input.connect(processor.input);
  processor.output.connect(wet);
  wet.connect(output);
  return {
    type,
    input,
    output,
    dry,
    wet,
    processor,
    update(params) {
      processor.update(params);
      const mix = clamp(Number.isFinite(params.mix) ? params.mix : spec.defaultMix ?? 1, 0, 1);
      dry.gain.value = 1 - mix;
      wet.gain.value = mix;
    },
  };
}

/** Create or refresh the audio nodes for one effect. */
function effectRuntime(effect) {
  const spec = EFFECT_TYPES[effect.type];
  if (!spec) return null;
  const ctx = getContext();
  let entry = effectNodes.get(effect.id);
  if (!entry || entry.type !== effect.type) {
    if (entry) disposeEffect(entry);
    entry = createEffectRuntime(effect.type, ctx);
    effectNodes.set(effect.id, entry);
  }
  entry.update(effect.params);
  return entry;
}

/**
 * Detach an effect from the chain. Only the output is disconnected: the
 * incoming link is always dropped by whoever was feeding it, and disconnecting
 * the input of a multi-node effect (distortion) would tear its internal
 * wiring apart.
 */
function disposeEffect(entry) {
  try {
    entry.output.disconnect();
  } catch (error) {
    /* already detached */
  }
}

/** Rewire one rack: its source -> [enabled effects in order] -> its destination. */
function rebuildRack(rackId) {
  const source = rackSource(rackId);
  const destination = rackDestination(rackId);
  if (!source || !destination) return;
  const list = state.racks[rackId] || [];
  for (const effect of list) {
    const entry = effectNodes.get(effect.id);
    if (entry) disposeEffect(entry);
  }
  try {
    source.disconnect();
  } catch (error) {
    /* nothing attached yet */
  }
  let node = source;
  for (const effect of list) {
    if (!effect.enabled) continue;
    const runtime = effectRuntime(effect);
    if (!runtime) continue;
    node.connect(runtime.input);
    node = runtime.output;
  }
  node.connect(destination);
}

function rebuildAllRacks() {
  for (const rackId of RACK_IDS) rebuildRack(rackId);
}

/** Where a module's own chain starts (the master rack starts at masterIn). */
function rackSource(rackId) {
  return rackId === "master" ? masterIn : moduleBuses.get(rackId) || null;
}

/**
 * Where a module's own chain ends. Each module lands on its own post-insert
 * output gain (the channel's output fader), which feeds the master rack.
 */
function rackDestination(rackId) {
  return rackId === "master" ? masterOut : moduleOutputs.get(rackId) || masterIn;
}

/** The gain a module's inserts feed: its channel output, after the inserts. */
function moduleOutput(moduleId) {
  return moduleOutputs.get(moduleId) || masterIn;
}

/** The node an instrument should play into: its own module insert chain. */
function moduleInput(moduleId) {
  const bus = moduleBuses.get(moduleId);
  return bus || getMaster();
}

/** A module's mixer level: muted modules are silent, otherwise the fader value. */
const moduleGain = (moduleId) => (state.muted[moduleId] ? 0 : state.levels[moduleId]);

/** A module's post-insert output level. */
const moduleOutputGain = (moduleId) => state.outputs[moduleId];

/** Ramp a gain param without clicking, whether or not the clock is running. */
function rampGain(param, target) {
  if (audioCtx && audioCtx.state === "running") {
    param.setValueAtTime(param.value, audioCtx.currentTime);
    param.linearRampToValueAtTime(target, audioCtx.currentTime + 0.015);
  } else {
    param.value = target;
  }
}

/** Push the mixer levels to the module buses, ramping so mutes do not click. */
function applyModuleLevels() {
  for (const moduleId of MODULE_IDS) {
    const bus = moduleBuses.get(moduleId);
    if (bus) rampGain(bus.gain, moduleGain(moduleId));
  }
}

/** Push the post-insert output levels to each channel. */
function applyModuleOutputs() {
  for (const moduleId of MODULE_IDS) {
    const output = moduleOutputs.get(moduleId);
    if (output) rampGain(output.gain, moduleOutputGain(moduleId));
  }
}

/** True when this module should make a sound at all. */
const moduleAudible = (moduleId) => !state.muted[moduleId];

/** The current end of the chain (useful for meters and debugging). */
const getChainOutput = () => masterOut || getMaster();

function ensureAudioGraph() {
  const ctx = getContext();
  if (masterIn) return;
  masterIn = ctx.createGain();
  masterOut = ctx.createGain();
  masterOut.connect(ctx.destination);
  for (const moduleId of MODULE_IDS) {
    const bus = ctx.createGain();
    bus.gain.value = moduleGain(moduleId);
    moduleBuses.set(moduleId, bus);
    // the channel's output fader sits after the inserts, feeding the master
    const output = ctx.createGain();
    output.gain.value = moduleOutputGain(moduleId);
    output.connect(masterIn);
    moduleOutputs.set(moduleId, output);
  }
  rebuildAllRacks();
}

function getMaster(volume = state.volume) {
  const ctx = getContext();
  ensureAudioGraph();
  if (ctx.state === "running") {
    masterIn.gain.setValueAtTime(masterIn.gain.value, ctx.currentTime);
    masterIn.gain.exponentialRampToValueAtTime(Math.max(1e-4, volume), ctx.currentTime + 0.02);
  } else {
    masterIn.gain.value = volume;
  }
  // never resume an OfflineAudioContext: startRendering owns its clock
  if (ctx.state === "suspended" && !isOfflineContext(ctx)) ctx.resume();
  return masterIn;
}

const at = (time) => (time == null ? getContext().currentTime : time);

/** Noise buffer source with a freshly generated buffer of `seconds` length. */
function noiseSource(ctx, seconds) {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < buffer.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

/* ---------------------------------------------------------------------------
   Synth drum engines
   ------------------------------------------------------------------------- */

function kickVoice(ctx, params, time, dest, pitch = 1, fm = []) {
  const out = dest || ctx.destination;
  const decay = params.decay ?? 0.5;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = params.type || "sine";
  osc.frequency.setValueAtTime(params.start * pitch, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, params.end * pitch), time + (params.pitchTime ?? 0.06));
  gain.gain.setValueAtTime(1, time);
  gain.gain.exponentialRampToValueAtTime(1e-3, time + decay);
  osc.connect(gain);
  gain.connect(out);
  for (const config of fm) fmOperator(ctx, config, params.start * pitch, [osc.frequency], time, decay);
  osc.start(time);
  osc.stop(time + decay + 0.05);

  if (params.click) {
    const click = noiseSource(ctx, 0.03);
    const filter = ctx.createBiquadFilter();
    const clickGain = ctx.createGain();
    filter.type = "highpass";
    filter.frequency.value = 1200 * pitch;
    clickGain.gain.setValueAtTime(params.click, time);
    clickGain.gain.exponentialRampToValueAtTime(1e-3, time + 0.03);
    click.connect(filter);
    filter.connect(clickGain);
    clickGain.connect(out);
    click.start(time);
  }
}

function snareVoice(ctx, params, time, dest, pitch = 1, fm = []) {
  const out = dest || ctx.destination;
  const noiseDecay = params.noiseDecay ?? 0.2;
  const toneDecay = params.toneDecay ?? 0.15;

  const noise = noiseSource(ctx, noiseDecay + 0.05);
  const filter = ctx.createBiquadFilter();
  const noiseGain = ctx.createGain();
  filter.type = "highpass";
  filter.frequency.value = (params.hp ?? 1000) * pitch;
  noiseGain.gain.setValueAtTime(params.noiseLevel ?? 0.8, time);
  noiseGain.gain.exponentialRampToValueAtTime(1e-3, time + noiseDecay);
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(out);
  noise.start(time);

  const osc = ctx.createOscillator();
  const toneGain = ctx.createGain();
  osc.type = params.toneType || "triangle";
  osc.frequency.setValueAtTime(params.tone * pitch, time);
  toneGain.gain.setValueAtTime(params.toneLevel ?? 0.5, time);
  toneGain.gain.exponentialRampToValueAtTime(1e-3, time + toneDecay);
  osc.connect(toneGain);
  toneGain.connect(out);
  for (const config of fm) fmOperator(ctx, config, params.tone * pitch, [osc.frequency], time, toneDecay);
  osc.start(time);
  osc.stop(time + toneDecay + 0.05);
}

function hatVoice(ctx, params, time, dest, pitch = 1, fm = []) {
  const out = dest || ctx.destination;
  const decay = params.decay ?? 0.1;
  const noise = noiseSource(ctx, decay + 0.05);
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = (params.hp ?? 8000) * pitch;
  highpass.Q.value = params.q ?? 1;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(params.level ?? 0.3, time);
  gain.gain.exponentialRampToValueAtTime(1e-3, time + decay);
  noise.connect(highpass);
  let tail = highpass;
  if (params.bp) {
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = params.bp * pitch;
    bandpass.Q.value = 0.8;
    tail.connect(bandpass);
    tail = bandpass;
  }
  tail.connect(gain);
  gain.connect(out);
  // a hat has no oscillator, so FM bends its noise band instead
  for (const config of fm) fmOperator(ctx, config, (params.hp ?? 8000) * pitch, [highpass.frequency], time, decay * 2);
  noise.start(time);
}

function playSynthDrum(params, time, dest, pitch = 1, fm = []) {
  const ctx = getContext();
  if (params.engine === "kick") kickVoice(ctx, params, time, dest, pitch, fm);
  else if (params.engine === "snare") snareVoice(ctx, params, time, dest, pitch, fm);
  else hatVoice(ctx, params, time, dest, pitch, fm);
}

/* ---------------------------------------------------------------------------
   Melodic voices
   ------------------------------------------------------------------------- */

/**
 * The global transpose moves the pitched instruments; the drop and the drum
 * machine keep their own tuning unless you pitch them from the Pitch panel.
 */
const globalPitchFor = (moduleId) => (isMelodic(moduleId) ? state.transpose : 0);

/** Total semitone offset of one module: its own pitch plus the global transpose. */
function pitchSemitones(moduleId) {
  return clamp(globalPitchFor(moduleId) + (state.pitch[moduleId] || 0), TRANSPOSE_MIN * 2, TRANSPOSE_MAX * 2);
}

/** Same offset as a frequency multiplier (2 semitones = 2^(2/12)). */
const pitchFactor = (moduleId) => Math.pow(2, pitchSemitones(moduleId) / 12);

/** The ADSR of one module, falling back to the defaults. */
const envelopeFor = (moduleId) => state.envelopes[moduleId] || defaultEnvelopes()[moduleId];

/** FM 2 of one module, falling back to the defaults. */
const fm2For = (moduleId) => state.fm2[moduleId] || defaultFm2()[moduleId];

/** How long a drum hit is "held" before its release begins. */
const DRUM_GATE_SECONDS = 0.5;

/** Frequency of a row of the base scale, after octave offset and transposition. */
function noteFrequency(noteIndex, octaveOffset = 0, moduleId = null) {
  const semitones = moduleId ? pitchSemitones(moduleId) : state.transpose;
  return NOTES[noteIndex] * Math.pow(2, octaveOffset + semitones / 12);
}

/**
 * One FM operator: a sine modulator whose depth starts at `index * modulator
 * frequency` and settles to 15% of that, so the attack is bright and the tail
 * stays in tune.
 *
 * `unit` says what the targets expect: "hz" for oscillator and filter
 * frequencies, "rate" for a sample's playback ratio (where the depth has to be
 * a fraction of normal speed, and the modulation runs at an audio rate so the
 * sample really does get frequency modulated).
 */
function fmOperator(ctx, config, carrierFreq, targets, time, duration, unit = "hz") {
  const amount = clamp(config.amount || 0, 0, 1);
  if (amount <= 0 || !targets.length) return null;
  const ratio = config.ratio || 1;
  const modFreq = unit === "rate" ? FM_RATE_BASE_HZ * ratio : Math.max(0.01, carrierFreq * ratio);
  const peak = unit === "rate" ? amount * FM_RATE_DEPTH : amount * MAX_FM_INDEX * modFreq;
  const decay = clamp(config.decay ?? 0.2, 0.02, 3);
  const span = Math.max(0.05, duration);

  const mod = ctx.createOscillator();
  mod.type = "sine";
  mod.frequency.setValueAtTime(modFreq, time);
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(Math.max(1e-3, peak), time);
  depth.gain.exponentialRampToValueAtTime(Math.max(1e-3, peak * 0.15), time + Math.min(decay, span));
  mod.connect(depth);
  for (const target of targets) depth.connect(target);
  mod.start(time);
  mod.stop(time + span + 0.05);
  return mod;
}

/** FM 1 of a melodic voice, kept in the voice panel. */
function fmModulate(ctx, voice, carrierFreq, targets, time, duration) {
  return fmOperator(
    ctx,
    { amount: voice.fmAmount, ratio: voice.fmRatio, decay: voice.fmDecay },
    carrierFreq,
    targets,
    time,
    duration
  );
}

/** FM 2 of any module, the section that sits after the inserts. */
function fmSecond(ctx, moduleId, carrierFreq, targets, time, duration, unit = "hz") {
  return fmOperator(ctx, fm2For(moduleId), carrierFreq, targets, time, duration, unit);
}

/** Bass: a sine carrier with a whisper of second harmonic, plus optional FM. */
function playBass(noteIndex, time, dest) {
  const ctx = getContext();
  const t = at(time);
  const out = dest || moduleInput("bass");
  const voice = state.voices.bass;
  const freq = noteFrequency(noteIndex, -1, "bass");
  const duration = 0.45;

  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.setValueAtTime(freq, t);

  const harmonic = ctx.createOscillator();
  harmonic.type = "sine";
  harmonic.frequency.setValueAtTime(freq * 2, t);
  const harmonicGain = ctx.createGain();
  harmonicGain.gain.value = 0.14;

  const amp = ctx.createGain();
  const total = applyAmpEnvelope(amp.gain, envelopeFor("bass"), t, duration, 0.6);

  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 4500;
  tone.Q.value = 0.5;

  carrier.connect(amp);
  harmonic.connect(harmonicGain);
  harmonicGain.connect(amp);
  amp.connect(tone);
  tone.connect(out);

  const bassTargets = [carrier.frequency, harmonic.frequency];
  fmModulate(ctx, voice, freq, bassTargets, t, duration);
  fmSecond(ctx, "bass", freq, bassTargets, t, duration);

  carrier.start(t);
  carrier.stop(t + total + 0.05);
  harmonic.start(t);
  harmonic.stop(t + total + 0.05);
}

function playSynth(noteIndex, time, dest) {
  const ctx = getContext();
  const t = at(time);
  const out = dest || moduleInput("synth");
  const voice = state.voices.synth;
  const freq = noteFrequency(noteIndex, 0, "synth");
  const duration = 0.3;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq, t);
  const total = applyAmpEnvelope(gain.gain, envelopeFor("synth"), t, duration, 0.3);
  osc.connect(gain);
  gain.connect(out);

  fmModulate(ctx, voice, freq, [osc.frequency], t, duration + 0.05);
  fmSecond(ctx, "synth", freq, [osc.frequency], t, duration + 0.05);

  osc.start(t);
  osc.stop(t + total + 0.05);
}

function impulse(ctx, seconds) {
  const key = `${ctx.sampleRate}:${seconds}`;
  const cached = impulseCache.get(key);
  if (cached) return cached;
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  for (let i = 0; i < length; i++) {
    const decay = Math.pow(1 - i / length, 2);
    left[i] = (Math.random() * 2 - 1) * decay;
    right[i] = (Math.random() * 2 - 1) * decay;
  }
  impulseCache.set(key, buffer);
  return buffer;
}

function playStrings(noteIndex, time, dest) {
  const ctx = getContext();
  const t = at(time);
  const output = dest || moduleInput("strings");
  const duration = 1.2;
  const sine = ctx.createOscillator();
  const tri = ctx.createOscillator();
  const lfo = ctx.createOscillator();
  const mix = ctx.createGain();
  const lfoGain = ctx.createGain();
  const harmonicGain = ctx.createGain();
  sine.type = "sine";
  tri.type = "triangle";
  lfo.type = "sine";
  const freq = noteFrequency(noteIndex, 0, "strings");
  sine.frequency.setValueAtTime(freq, t);
  tri.frequency.setValueAtTime(freq, t);
  lfo.frequency.value = 6;
  lfoGain.gain.value = 3;
  lfo.connect(lfoGain);
  lfoGain.connect(sine.frequency);
  lfoGain.connect(tri.frequency);
  mix.gain.setValueAtTime(0, t);
  mix.gain.linearRampToValueAtTime(0.35, t + 0.1);
  mix.gain.setValueAtTime(0.35, t + 0.1);
  mix.gain.exponentialRampToValueAtTime(0.3, t + 0.3);
  mix.gain.setValueAtTime(0.3, t + duration - 0.5);
  mix.gain.exponentialRampToValueAtTime(1e-3, t + duration);
  const harmonic = ctx.createOscillator();
  harmonic.type = "sine";
  harmonic.frequency.setValueAtTime(freq * 2, t);
  harmonicGain.gain.value = 0.15;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1200;
  filter.Q.value = 0.7;
  const convolver = ctx.createConvolver();
  convolver.buffer = impulse(ctx, 1.5);
  const wet = ctx.createGain();
  wet.gain.value = 0.25;
  sine.connect(mix);
  tri.connect(mix);
  harmonic.connect(harmonicGain);
  harmonicGain.connect(mix);
  mix.connect(filter);
  filter.connect(output);
  filter.connect(convolver);
  convolver.connect(wet);
  wet.connect(output);
  const stringTargets = [sine.frequency, tri.frequency, harmonic.frequency];
  fmModulate(ctx, state.voices.strings, freq, stringTargets, t, duration);
  fmSecond(ctx, "strings", freq, stringTargets, t, duration);
  const total = applyAmpEnvelope(mix.gain, envelopeFor("strings"), t, duration, 0.35);
  sine.start(t);
  tri.start(t);
  lfo.start(t);
  harmonic.start(t);
  sine.stop(t + total + 0.05);
  tri.stop(t + total + 0.05);
  lfo.stop(t + total + 0.05);
  harmonic.stop(t + total + 0.05);
}

function playDrop(duration, time, dest) {
  const ctx = getContext();
  const now = at(time);
  const output = dest || moduleInput("drop");
  const pitch = pitchFactor("drop");
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 4;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  const volume = ctx.createGain();
  volume.gain.value = 0.9;
  const hold = duration * 1.5;
  const sub = ctx.createOscillator();
  const subGain = ctx.createGain();
  sub.type = "sine";
  sub.frequency.setValueAtTime(55 * pitch, now);
  sub.frequency.exponentialRampToValueAtTime(30 * pitch, now + duration);
  subGain.gain.setValueAtTime(0, now);
  subGain.gain.linearRampToValueAtTime(0.9, now + 0.01);
  subGain.gain.exponentialRampToValueAtTime(1e-3, now + hold);
  sub.connect(subGain);
  subGain.connect(compressor);
  const growl = ctx.createOscillator();
  const growlGain = ctx.createGain();
  const growlFilter = ctx.createBiquadFilter();
  growl.type = "sawtooth";
  growl.frequency.setValueAtTime(110 * pitch, now);
  growl.frequency.exponentialRampToValueAtTime(55 * pitch, now + duration * 0.8);
  growlFilter.type = "lowpass";
  growlFilter.Q.value = 8;
  growlFilter.frequency.setValueAtTime(8000 * pitch, now);
  growlFilter.frequency.exponentialRampToValueAtTime(800 * pitch, now + duration * 0.1);
  growlFilter.frequency.exponentialRampToValueAtTime(100 * pitch, now + duration);
  growlGain.gain.setValueAtTime(0, now);
  growlGain.gain.linearRampToValueAtTime(0.6, now + 0.01);
  growlGain.gain.exponentialRampToValueAtTime(1e-3, now + duration * 0.9);
  growl.connect(growlFilter);
  growlFilter.connect(growlGain);
  growlGain.connect(compressor);
  const noise = noiseSource(ctx, hold);
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.value = 2000 * pitch;
  noiseFilter.Q.value = 1;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.3, now);
  noiseGain.gain.exponentialRampToValueAtTime(1e-3, now + duration * 0.3);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(compressor);
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 8 + duration * 5;
  lfoGain.gain.value = 50;
  lfo.connect(lfoGain);
  lfoGain.connect(growl.frequency);
  const delay = ctx.createDelay(hold);
  delay.delayTime.value = 0.1;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.3;
  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = "lowpass";
  delayFilter.frequency.value = 1000;
  compressor.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(feedback);
  feedback.connect(delay);
  feedback.connect(volume);
  compressor.connect(volume);
  volume.connect(output);
  const total = applyAmpEnvelope(volume.gain, envelopeFor("drop"), now, hold, 0.9);
  fmSecond(ctx, "drop", 55 * pitch, [sub.frequency], now, hold);
  fmSecond(ctx, "drop", 110 * pitch, [growl.frequency], now, hold);
  sub.start(now);
  growl.start(now);
  noise.start(now);
  lfo.start(now);
  sub.stop(now + total + 0.05);
  growl.stop(now + total + 0.05);
  lfo.stop(now + total + 0.05);
  noise.stop(now + total + 0.05);
}

/* ---------------------------------------------------------------------------
   Drum lanes: add, remove, rename, recolour, re-pitch
   ------------------------------------------------------------------------- */

const MAX_LANE_PITCH = 12;
const MIN_LANE_PITCH = -36;

/** Words that map an imported sample onto a lane, by id first and then name. */
function laneHints(lane) {
  if (LANE_HINTS[lane.id]) return LANE_HINTS[lane.id];
  const escaped = String(lane.name || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped ? [new RegExp(escaped, "i")] : [];
}

/** Validate a lane list that came from storage or a snapshot. */
function readLanes(raw) {
  if (!Array.isArray(raw)) return null;
  const lanes = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id || lanes.some((lane) => lane.id === id)) continue;
    const name =
      typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, MAX_LANE_NAME) : id;
    const color = /^#[0-9a-f]{6}$/i.test(entry.color || "") ? entry.color : DEFAULT_DRUM_COLOR;
    const pitch = Number.isFinite(entry.pitch) ? clamp(Math.round(entry.pitch), MIN_LANE_PITCH, MAX_LANE_PITCH) : 0;
    lanes.push({ id, name, color, pitch });
    if (lanes.length >= MAX_DRUM_LANES) break;
  }
  return lanes.length ? lanes : null;
}

/** Rearrange the whole drum model around a new lane list. */
function setDrumLanes(lanes) {
  const voices = {};
  const sequence = {};
  for (const lane of lanes) {
    const previous = state.drums.voices[lane.id];
    voices[lane.id] = typeof previous === "string" ? previous : "";
    const row = state.sequence.drums[lane.id];
    sequence[lane.id] = Array.isArray(row) ? row.slice() : emptyRow();
  }
  state.drums = { kit: state.drums.kit, lanes, voices };
  state.sequence.drums = sequence;
}

function uniqueLaneId(lanes) {
  let index = lanes.length + 1;
  while (lanes.some((lane) => lane.id === `lane${index}`)) index++;
  return `lane${index}`;
}

/** The next palette colour that is not in use yet. */
function nextLaneColor(lanes) {
  const used = new Set(lanes.map((lane) => lane.color));
  return DRUM_COLORS.find((color) => !used.has(color)) || DRUM_COLORS[lanes.length % DRUM_COLORS.length];
}

const DRUM_VOICE_NAMES = ["Drum", "Perc", "Tom", "Clap", "Rim", "Cowbell", "Conga", "Shaker", "Crash", "Ride"];

function addDrumLane(name) {
  const lanes = drumLanes();
  if (lanes.length >= MAX_DRUM_LANES) return null;
  markHistory();
  const id = uniqueLaneId(lanes);
  const fallback = DRUM_VOICE_NAMES[lanes.length % DRUM_VOICE_NAMES.length];
  const label = (typeof name === "string" && name.trim() ? name.trim() : fallback).slice(0, MAX_LANE_NAME);
  lanes.push({ id, name: label, color: nextLaneColor(lanes), pitch: 0 });
  state.sequence.drums[id] = emptyRow();
  state.drums.voices[id] = "";
  savePrefs();
  renderGrid();
  renderSounds();
  return id;
}

function removeDrumLane(laneId) {
  const lanes = drumLanes();
  if (lanes.length <= 1) return false; // always keep one drum to play
  if (!lanes.some((lane) => lane.id === laneId)) return false;
  markHistory();
  setDrumLanes(lanes.filter((lane) => lane.id !== laneId));
  savePrefs();
  renderGrid();
  renderSounds();
  renderInserts();
  renderFm2();
  renderEnvelope();
  return true;
}

function renameDrumLane(laneId, name) {
  const lane = laneById(laneId);
  if (!lane) return;
  const clean = String(name || "").trim().slice(0, MAX_LANE_NAME);
  if (clean === lane.name) return;
  markHistory();
  lane.name = clean || laneId; // an empty name would leave an unlabelled row
  savePrefsSoon();
  renderGrid();
}

function recolorDrumLane(laneId, color) {
  const lane = laneById(laneId);
  if (!lane || !/^#[0-9a-f]{6}$/i.test(color || "")) return;
  markHistory();
  lane.color = color;
  savePrefsSoon();
  renderGrid();
}

function setLanePitch(laneId, semitones) {
  const lane = laneById(laneId);
  if (!lane) return;
  const next = clamp(Math.round(semitones), MIN_LANE_PITCH, MAX_LANE_PITCH);
  if (next === lane.pitch) return;
  markHistory();
  lane.pitch = next;
  savePrefsSoon();
  renderSounds();
}

const resetLanePitch = (laneId) => setLanePitch(laneId, 0);

/* ---------------------------------------------------------------------------
   Sample library
   ------------------------------------------------------------------------- */

const AUDIO_EXT = /\.(wav|wave|mp3|ogg|oga|opus|m4a|aac|flac|aif|aiff|webm)$/i;
const SAMPLE_GAIN = 0.9;
const MAX_FOLDER_FILES = 400;

/** id -> { id, name, origin: "folder" | "import", handle?, file?, data?, buffer? } */
const samples = new Map();
let sampleFolder = { handle: null, name: null, needsPermission: false };
const decodeState = { pending: 0, failed: 0 };

const sampleIdFromVoice = (voice) => (voice.startsWith("sample:") ? voice.slice(7) : null);
const folderEntries = () => [...samples.values()].filter((entry) => entry.origin === "folder");
const importedEntries = () => [...samples.values()].filter((entry) => entry.origin === "import");

function clearFolderSamples() {
  for (const [id, entry] of samples) {
    if (entry.origin === "folder") samples.delete(id);
  }
}

/** Drop lane assignments whose sample is no longer loaded. */
function pruneSampleVoices() {
  for (const lane of drumLanes()) {
    const id = sampleIdFromVoice(state.drums.voices[lane.id] || "");
    if (id && !samples.has(id)) state.drums.voices[lane.id] = "";
  }
}

async function decodeAudio(data) {
  const ctx = getContext();
  return new Promise((resolve, reject) => {
    const promise = ctx.decodeAudioData(data, resolve, reject);
    if (promise && typeof promise.then === "function") promise.then(resolve, reject);
  });
}

/** Decode (once) and cache the AudioBuffer for a sample entry. */
async function sampleBuffer(entry) {
  if (entry.buffer) return entry.buffer;
  if (entry.pending) return entry.pending;
  decodeState.pending++;
  entry.pending = (async () => {
    try {
      const file = entry.handle ? await entry.handle.getFile() : entry.file ? entry.file : new Blob([entry.data]);
      const data = await file.arrayBuffer();
      entry.buffer = await decodeAudio(data);
      entry.error = null;
    } catch (error) {
      entry.error = error && error.message ? error.message : String(error);
      decodeState.failed++;
    } finally {
      entry.pending = null;
      decodeState.pending--;
      renderSoundsStatus();
    }
    return entry.buffer;
  })();
  return entry.pending;
}

async function decodeAll(entries) {
  const queue = entries.filter((entry) => !entry.buffer && !entry.error);
  let index = 0;
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (index < queue.length) {
      const entry = queue[index++];
      await sampleBuffer(entry);
    }
  });
  await Promise.all(workers);
  renderSoundsStatus();
}

function startSample(entry, time, dest, pitch = 1, fm = []) {
  const ctx = getContext();
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = entry.buffer;
  if (pitch !== 1) source.playbackRate.value = pitch;
  gain.gain.value = SAMPLE_GAIN;
  source.connect(gain);
  gain.connect(dest || ctx.destination);
  for (const config of fm) fmOperator(ctx, config, 1, [source.playbackRate], time, entry.buffer.duration, "rate");
  source.start(Math.max(time, ctx.currentTime));
}

/**
 * The kit voice a lane falls back to. Kits only ship kick / snare / hat voices,
 * so a drum you added yourself borrows the snare until you pick a sound for it.
 */
function kitVoiceFor(kit, laneId) {
  return kit.voices[laneId] || kit.voices.snare || kit.voices.kick || Object.values(kit.voices)[0] || null;
}

/** Which sound a drum lane should play right now. */
function resolveVoice(laneId) {
  const voice = state.drums.voices[laneId] || "";
  if (voice.startsWith("sample:")) {
    const entry = samples.get(voice.slice(7));
    if (entry) return { kind: "sample", entry };
  } else if (voice.startsWith("kit:")) {
    const kit = kitById(voice.slice(4));
    if (kit) return { kind: "synth", params: kitVoiceFor(kit, laneId) };
  }
  const kit = kitById(state.drums.kit) || KITS[0];
  return { kind: "synth", params: kitVoiceFor(kit, laneId) };
}

function playDrum(laneId, time, dest) {
  const ctx = getContext();
  const when = at(time);
  const out = dest || moduleInput("drums");
  const lane = laneById(laneId);
  // the module pitch moves the whole kit, the lane pitch moves one drum
  const pitch = pitchFactor("drums") * Math.pow(2, (lane ? lane.pitch || 0 : 0) / 12);
  // the drum amp envelope rides on top of each voice's own decay
  const amp = ctx.createGain();
  applyAmpEnvelope(amp.gain, envelopeFor("drums"), when, DRUM_GATE_SECONDS, 1);
  amp.connect(out);
  const fm = [fm2For("drums")];
  const voice = resolveVoice(laneId);
  if (voice.kind === "synth") {
    playSynthDrum(voice.params, when, amp, pitch, fm);
    return;
  }
  const { entry } = voice;
  if (entry.buffer) {
    startSample(entry, when, amp, pitch, fm);
    return;
  }
  if (entry.error) return;
  // Still decoding: play it as soon as it is ready rather than dropping the hit.
  sampleBuffer(entry).then(() => {
    if (entry.buffer) startSample(entry, null, amp, pitch, fm);
  });
}

/** Guess which lane a sample file belongs to, from its file name. */
const LANE_HINTS = {
  kick: [/kick/i, /(^|[^a-z])bd([^a-z]|$)/i, /bass.?drum/i, /808/i, /boom/i, /thump/i],
  snare: [/snare/i, /(^|[^a-z])sd([^a-z]|$)/i, /(^|[^a-z])snr([^a-z]|$)/i, /rim/i, /clap/i],
  hihat: [/hi.?hat/i, /(^|[^a-z])hh([^a-z]|$)/i, /hat/i, /shaker/i, /ride/i, /cymbal/i],
};

function guessLane(name) {
  for (const lane of drumLanes()) {
    const hints = laneHints(lane);
    if (hints.some((hint) => hint.test(name))) return lane.id;
  }
  return null;
}

/**
 * Fill in lanes that are still on "kit default" with samples guessed from
 * their file names. With { force: true } every matching lane is overwritten.
 */
function autoAssignLanes({ force = false } = {}) {
  const pool = [...samples.values()];
  if (!pool.length) return 0;
  let assigned = 0;
  for (const lane of drumLanes()) {
    const current = state.drums.voices[lane.id] || "";
    if (!force && current !== "") continue;
    const hints = laneHints(lane);
    // Walk the hints most-specific first, so "Snare tight.wav" beats "Clap.wav"
    // for the snare lane no matter what order the files are in.
    let match = null;
    for (const hint of hints) {
      match = pool.find((entry) => hint.test(entry.name));
      if (match) break;
    }
    if (!match) continue;
    state.drums.voices[lane.id] = `sample:${match.id}`;
    assigned++;
  }
  if (assigned) {
    renderSounds();
    savePrefs();
  }
  return assigned;
}

/* ---------------------------------------------------------------------------
   IndexedDB - remembers the sample folder handle and imported samples
   ------------------------------------------------------------------------- */

const DB_NAME = "earworm-studio";
const DB_STORE = "samples";
const DB_FOLDER_KEY = "__sampleFolderHandle__";
let dbPromise = null;
let storageBroken = false;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  }).catch((error) => {
    storageBroken = true;
    throw error;
  });
  return dbPromise;
}

async function idbRequest(mode, run) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const store = tx.objectStore(DB_STORE);
      const request = run(store);
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    storageBroken = true;
    return undefined;
  }
}

const idbGet = (key) => idbRequest("readonly", (store) => store.get(key));
const idbPut = (key, value) => idbRequest("readwrite", (store) => store.put(value, key));
const idbDelete = (key) => idbRequest("readwrite", (store) => store.delete(key));

async function idbAll() {
  const keys = await idbRequest("readonly", (store) => store.getAllKeys());
  const values = await idbRequest("readonly", (store) => store.getAll());
  if (!keys || !values) return [];
  return keys.map((key, index) => ({ key, value: values[index] }));
}

/* ---------------------------------------------------------------------------
   Sample sources: folder picker, folder input, file import, drag & drop
   ------------------------------------------------------------------------- */

const supportsDirectoryPicker = () => typeof window.showDirectoryPicker === "function";

const capabilities = () => ({
  protocol: location.protocol,
  secureContext: Boolean(window.isSecureContext),
  directoryPicker: supportsDirectoryPicker(),
  webkitDirectory: "webkitdirectory" in document.createElement("input"),
  indexedDb: Boolean(window.indexedDB) && !storageBroken,
});

function sortByName(entries) {
  return entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

async function addFolderEntries(entries, folderName) {
  clearFolderSamples();
  for (const entry of entries) samples.set(entry.id, entry);
  sampleFolder = { handle: sampleFolder.handle, name: folderName, needsPermission: false };
  pruneSampleVoices();
  renderSounds();
  autoAssignLanes();
  await decodeAll(entries);
}

async function loadFolderHandle(handle, { requestPermission = false } = {}) {
  try {
    let permission = "granted";
    if (handle.queryPermission) permission = await handle.queryPermission({ mode: "read" });
    if (permission !== "granted" && requestPermission && handle.requestPermission) {
      permission = await handle.requestPermission({ mode: "read" });
    }
    if (permission !== "granted") {
      sampleFolder = { handle, name: handle.name, needsPermission: true };
      renderSounds();
      return false;
    }

    const files = [];
    for await (const child of handle.values()) {
      if (child.kind === "file" && AUDIO_EXT.test(child.name)) files.push(child);
    }
    sortByName(files);
    const truncated = files.length > MAX_FOLDER_FILES;
    const kept = files.slice(0, MAX_FOLDER_FILES);
    const entries = kept.map((file) => ({
      id: `folder:${file.name}`,
      name: file.name,
      origin: "folder",
      handle: file,
      buffer: null,
    }));
    sampleFolder = { handle, name: handle.name, needsPermission: false, truncated };
    await idbPut(DB_FOLDER_KEY, handle);
    await addFolderEntries(entries, handle.name);
    return true;
  } catch (error) {
    console.warn("Could not read the sample folder:", error);
    setSoundsStatus(`Could not read that folder: ${error && error.message ? error.message : error}`);
    return false;
  }
}

async function pickSampleFolder() {
  if (supportsDirectoryPicker()) {
    try {
      const handle = await window.showDirectoryPicker({ id: "earworm-samples", mode: "read", startIn: "music" });
      const ok = await loadFolderHandle(handle, { requestPermission: true });
      if (ok) return;
    } catch (error) {
      if (error && error.name === "AbortError") return; // user closed the picker
      console.warn("Directory picker unavailable, falling back to the file input:", error);
      setSoundsStatus("This browser blocked the folder picker here — using the file-based folder picker instead.");
    }
  }
  document.getElementById("folder-input").click();
}

async function handleFolderInput(input) {
  const files = [...input.files].filter((file) => AUDIO_EXT.test(file.name));
  input.value = "";
  if (!files.length) {
    setSoundsStatus("No audio files found in that folder (looking for .wav, .mp3, .ogg, .flac, .aif, .m4a).");
    return;
  }
  sortByName(files);
  const relative = files[0].webkitRelativePath || "";
  const folderName = relative.includes("/") ? relative.split("/")[0] : "Selected folder";
  const entries = files.slice(0, MAX_FOLDER_FILES).map((file) => ({
    id: `folder:${file.name}`,
    name: file.name,
    origin: "folder",
    file,
    buffer: null,
  }));
  sampleFolder = { handle: null, name: folderName, needsPermission: false };
  await addFolderEntries(entries, folderName);
}

async function importFiles(fileList) {
  const files = [...fileList].filter((file) => AUDIO_EXT.test(file.name) || (file.type || "").startsWith("audio/"));
  if (!files.length) {
    setSoundsStatus("No audio files in that selection (looking for .wav, .mp3, .ogg, .flac, .aif, .m4a).");
    return 0;
  }
  sortByName(files);
  const added = [];
  for (const file of files) {
    const id = `import:${file.name}#${file.size}`;
    let data;
    try {
      data = await file.arrayBuffer();
    } catch (error) {
      console.warn("Could not read", file.name, error);
      continue;
    }
    const entry = { id, name: file.name, origin: "import", data, buffer: null };
    samples.set(id, entry);
    added.push(entry);
    await idbPut(id, { id, name: file.name, data });
  }
  renderSounds();
  autoAssignLanes();
  await decodeAll(added);
  return added.length;
}

async function forgetSampleFolder() {
  clearFolderSamples();
  sampleFolder = { handle: null, name: null, needsPermission: false };
  await idbDelete(DB_FOLDER_KEY);
  pruneSampleVoices();
  renderSounds();
  savePrefs();
}

/** Remove every sample that was imported as an individual file. */
async function clearImportedSamples() {
  const removed = importedEntries();
  for (const entry of removed) {
    samples.delete(entry.id);
    await idbDelete(entry.id);
  }
  pruneSampleVoices();
  renderSounds();
  savePrefs();
  return removed.length;
}

async function restoreSamples() {
  try {
    const stored = await idbAll();
    const imports = stored.filter((item) => String(item.key).startsWith("import:") && item.value && item.value.data);
    for (const item of imports) {
      samples.set(item.value.id || item.key, {
        id: item.value.id || item.key,
        name: item.value.name || String(item.key),
        origin: "import",
        data: item.value.data,
        buffer: null,
      });
    }
    if (imports.length) {
      renderSounds();
      await decodeAll(importedEntries());
    }

    const record = stored.find((item) => item.key === DB_FOLDER_KEY);
    const handle = record && record.value;
    if (handle && handle.kind === "directory") {
      sampleFolder = { handle, name: handle.name, needsPermission: false };
      renderSounds();
      const permission = handle.queryPermission ? await handle.queryPermission({ mode: "read" }) : "granted";
      if (permission === "granted") await loadFolderHandle(handle);
      else {
        sampleFolder.needsPermission = true;
        renderSounds();
      }
    }
  } catch (error) {
    storageBroken = true;
    console.warn("Could not restore samples:", error);
    renderSounds();
  }
}

/* ---------------------------------------------------------------------------
   Swing + transport clock

   Notes are scheduled a little ahead of time on the AudioContext clock, which
   keeps the groove steady while the UI stays free to repaint. Swing works by
   mapping each straight 16th position to a "swung" position: the first half of
   every pair is stretched, the second half is squeezed, so the pair length
   never changes and the loop stays 16 steps long.
   ------------------------------------------------------------------------- */

const LOOKAHEAD_S = 0.12; // how far ahead notes are scheduled
const SCHEDULER_MS = 25; // how often the scheduler tops up
const START_LEAD_S = 0.08; // small delay before the first step so it is not late

let schedulerId = null;
let playStartTime = 0; // AudioContext time of step 0 of the current pass
let scheduleCursor = 0; // step counter, keeps growing while playing
let scheduled = []; // { step, time } entries waiting to be heard
let rafId = null;

function stepMs() {
  return (60 * 1000) / (state.tempo * 4);
}

/**
 * Offset (in ms) of a step from the start of its swing group.
 * swing 0 -> perfectly straight, swing 1 -> heavy triplet-ish shuffle.
 */
function stepOnsetMs(step) {
  const grid = state.swingGrid === 16 ? 2 : 4; // steps per swing pair
  const pair = grid * stepMs();
  const fraction = 0.5 + 0.25 * clamp(state.swing, 0, 1); // where the off-beat sits
  const half = pair / 2;
  const position = (step % grid) * stepMs();
  const group = Math.floor(step / grid);
  const offset =
    position < half ? position * 2 * fraction : fraction * pair + (position - half) * 2 * (1 - fraction);
  return group * pair + offset;
}

function loopDurationMs() {
  return STEPS * stepMs();
}

function stopScheduler() {
  if (schedulerId !== null) {
    window.clearInterval(schedulerId);
    schedulerId = null;
  }
  scheduled = [];
}

function scheduleAhead() {
  const ctx = getContext();
  const horizon = ctx.currentTime + LOOKAHEAD_S;
  while (true) {
    const step = scheduleCursor % STEPS;
    const pass = Math.floor(scheduleCursor / STEPS);
    const time = playStartTime + (pass * loopDurationMs() + stepOnsetMs(step)) / 1000;
    if (time >= horizon) break;
    playStep(step, time);
    scheduled.push({ step, time });
    if (scheduled.length > 64) scheduled.splice(0, scheduled.length - 64);
    scheduleCursor++;
  }
}

function startScheduler(fromStep = 0) {
  stopScheduler();
  const ctx = getContext();
  playStartTime = ctx.currentTime + START_LEAD_S;
  scheduleCursor = fromStep;
  state.currentStep = fromStep;
  schedulerId = window.setInterval(scheduleAhead, SCHEDULER_MS);
  scheduleAhead();
}

/** Re-anchor the clock, e.g. after a tempo or swing change, without stopping. */
function restartScheduler() {
  const ctx = getContext();
  const now = ctx.currentTime;
  const upcoming = scheduled.find((item) => item.time > now);
  const fromStep = upcoming ? upcoming.step : (state.currentStep + 1) % STEPS;
  startScheduler(fromStep);
  updatePlayhead();
}

function playheadLoop() {
  const ctx = getContext();
  const now = ctx.currentTime;
  let current = state.currentStep;
  for (const item of scheduled) {
    if (item.time <= now) current = item.step;
  }
  if (current !== state.currentStep) {
    state.currentStep = current;
    updatePlayhead();
  }
  rafId = window.requestAnimationFrame(playheadLoop);
}

function togglePlayback() {
  getContext();
  if (state.isPlaying) {
    state.isPlaying = false;
    stopScheduler();
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    state.currentStep = 0;
  } else {
    state.isPlaying = true;
    startScheduler(0);
    rafId = window.requestAnimationFrame(playheadLoop);
  }
  updatePlayButton();
  updatePlayhead();
}

function playStep(step, time) {
  const ctx = getContext();
  getMaster(state.volume); // make sure the graph exists and the volume is current
  const when = time == null ? ctx.currentTime : time;
  const { sequence } = state;
  if (moduleAudible("drums")) {
    const drumsOut = moduleInput("drums");
    for (const lane of drumLanes()) {
      if (sequence.drums[lane.id] && sequence.drums[lane.id][step]) playDrum(lane.id, when, drumsOut);
    }
  }
  if (moduleAudible("bass")) {
    sequence.bass.forEach((row, index) => {
      if (row[step]) playBass(index, when, moduleInput("bass"));
    });
  }
  if (moduleAudible("synth")) {
    sequence.synth.forEach((row, index) => {
      if (row[step]) playSynth(index, when, moduleInput("synth"));
    });
  }
  if (moduleAudible("strings")) {
    sequence.strings.forEach((row, index) => {
      if (row[step]) playStrings(index, when, moduleInput("strings"));
    });
  }
  if (moduleAudible("drop")) {
    sequence.drop.forEach((row, index) => {
      if (row[step]) playDrop(DROP_DURATIONS[index], when, moduleInput("drop"));
    });
  }
}

/* ---------------------------------------------------------------------------
   Preferences (localStorage)
   ------------------------------------------------------------------------- */

const PREFS_KEY = "earworm-studio.prefs.v1";
let saveTimer = null;

function serialiseEffect(effect) {
  return { id: effect.id, type: effect.type, enabled: effect.enabled, params: { ...effect.params } };
}

function savePrefs() {
  const payload = {
    tempo: state.tempo,
    volume: state.volume,
    swing: state.swing,
    swingGrid: state.swingGrid,
    transpose: state.transpose,
    pitch: { ...state.pitch },
    envelopes: Object.fromEntries(MODULE_IDS.map((id) => [id, { ...state.envelopes[id] }])),
    fm2: Object.fromEntries(MODULE_IDS.map((id) => [id, { ...state.fm2[id] }])),
    levels: { ...state.levels },
    outputs: { ...state.outputs },
    muted: { ...state.muted },
    voices: {
      bass: { ...state.voices.bass },
      synth: { ...state.voices.synth },
      strings: { ...state.voices.strings },
    },
    racks: Object.fromEntries(RACK_IDS.map((rackId) => [rackId, (state.racks[rackId] || []).map(serialiseEffect)])),
    drums: { kit: state.drums.kit, lanes: state.drums.lanes.map((lane) => ({ ...lane })), voices: { ...state.drums.voices } },
  };
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(payload));
  } catch (error) {
    /* private mode or file:// restrictions - settings just will not persist */
  }
}

/** Validate one stored effect and fill in any missing parameters. */
function restoreEffect(effect) {
  if (!effect || !EFFECT_TYPES[effect.type]) return null;
  const params = defaultEffectParams(effect.type);
  const spec = EFFECT_TYPES[effect.type].params;
  for (const [key, paramSpec] of Object.entries(spec)) {
    const saved = effect.params ? effect.params[key] : undefined;
    if (paramSpec.kind === "select") {
      if (paramSpec.options.some(([value]) => value === saved)) params[key] = saved;
    } else if (Number.isFinite(saved)) {
      params[key] = clamp(saved, paramSpec.min, paramSpec.max);
    }
  }
  return {
    id: typeof effect.id === "string" && effect.id ? effect.id : nextEffectId(),
    type: effect.type,
    enabled: effect.enabled !== false,
    params,
  };
}

function restoreRack(rackId, saved) {
  const list = (Array.isArray(saved) ? saved : []).map(restoreEffect).filter(Boolean).slice(0, MAX_RACK_EFFECTS);
  state.racks[rackId].splice(0, state.racks[rackId].length, ...list);
}

function savePrefsSoon() {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    savePrefs();
  }, 300);
}

function loadPrefs() {
  let stored = null;
  try {
    stored = JSON.parse(window.localStorage.getItem(PREFS_KEY) || "null");
  } catch (error) {
    stored = null;
  }
  if (!stored || typeof stored !== "object") return;
  if (Number.isFinite(stored.tempo)) state.tempo = clamp(Math.round(stored.tempo), 60, 200);
  if (Number.isFinite(stored.volume)) state.volume = clamp(stored.volume, 0, 1);
  if (Number.isFinite(stored.swing)) state.swing = clamp(stored.swing, 0, 1);
  if (stored.swingGrid === 8 || stored.swingGrid === 16) state.swingGrid = stored.swingGrid;
  if (Number.isFinite(stored.transpose)) state.transpose = clamp(Math.round(stored.transpose), TRANSPOSE_MIN, TRANSPOSE_MAX);
  if (stored.pitch && typeof stored.pitch === "object") {
    for (const moduleId of MODULE_IDS) {
      if (Number.isFinite(stored.pitch[moduleId])) {
        state.pitch[moduleId] = clamp(Math.round(stored.pitch[moduleId]), TRANSPOSE_MIN, TRANSPOSE_MAX);
      }
    }
  }
  if (stored.envelopes && typeof stored.envelopes === "object") {
    for (const moduleId of MODULE_IDS) {
      const saved = stored.envelopes[moduleId];
      if (!saved || typeof saved !== "object") continue;
      for (const key of ENVELOPE_KEYS) {
        const spec = ENVELOPE_SPEC[key];
        if (Number.isFinite(saved[key])) state.envelopes[moduleId][key] = clamp(saved[key], spec.min, spec.max);
      }
    }
  }
  if (stored.fm2 && typeof stored.fm2 === "object") {
    for (const moduleId of MODULE_IDS) {
      const saved = stored.fm2[moduleId];
      if (!saved || typeof saved !== "object") continue;
      if (Number.isFinite(saved.amount)) state.fm2[moduleId].amount = clamp(saved.amount, 0, 1);
      if (FM_RATIOS.includes(saved.ratio)) state.fm2[moduleId].ratio = saved.ratio;
      if (Number.isFinite(saved.decay)) state.fm2[moduleId].decay = clamp(saved.decay, 0.02, 3);
    }
  }
  if (stored.levels && typeof stored.levels === "object") {
    for (const moduleId of MODULE_IDS) {
      if (Number.isFinite(stored.levels[moduleId])) {
        state.levels[moduleId] = clamp(stored.levels[moduleId], LEVEL_SPEC.min, LEVEL_SPEC.max);
      }
    }
  }
  if (stored.outputs && typeof stored.outputs === "object") {
    for (const moduleId of MODULE_IDS) {
      if (Number.isFinite(stored.outputs[moduleId])) {
        state.outputs[moduleId] = clamp(stored.outputs[moduleId], LEVEL_SPEC.min, LEVEL_SPEC.max);
      }
    }
  }
  if (stored.muted && typeof stored.muted === "object") {
    for (const moduleId of MODULE_IDS) state.muted[moduleId] = stored.muted[moduleId] === true;
  }
  if (stored.voices && typeof stored.voices === "object") {
    for (const voice of MELODIC_VOICES) {
      const saved = stored.voices[voice.id];
      if (!saved || typeof saved !== "object") continue;
      const target = state.voices[voice.id];
      if (Number.isFinite(saved.fmAmount)) target.fmAmount = clamp(saved.fmAmount, 0, 1);
      if (FM_RATIOS.includes(saved.fmRatio)) target.fmRatio = saved.fmRatio;
      if (Number.isFinite(saved.fmDecay)) target.fmDecay = clamp(saved.fmDecay, 0.02, 3);
    }
  }
  if (stored.racks && typeof stored.racks === "object") {
    for (const rackId of RACK_IDS) restoreRack(rackId, stored.racks[rackId]);
  } else if (Array.isArray(stored.effects)) {
    // older versions kept a single master rack under `effects`
    restoreRack("master", stored.effects);
  }
  // keep generated ids from colliding with restored ones
  for (const rackId of RACK_IDS) {
    for (const effect of state.racks[rackId]) {
      const match = /^fx(\d+)$/.exec(effect.id);
      if (match) effectCounter = Math.max(effectCounter, Number(match[1]));
    }
  }
  if (stored.drums && typeof stored.drums === "object") {
    if (kitById(stored.drums.kit)) state.drums.kit = stored.drums.kit;
    const savedLanes = readLanes(stored.drums.lanes);
    if (savedLanes) setDrumLanes(savedLanes);
    for (const lane of drumLanes()) {
      const voice = stored.drums.voices ? stored.drums.voices[lane.id] : "";
      if (typeof voice === "string") state.drums.voices[lane.id] = voice;
    }
  }
}

/* ---------------------------------------------------------------------------
   Grid rendering
   ------------------------------------------------------------------------- */

const rowIdFromDataset = (value) => (laneById(value) ? value : Number(value));
const instrumentMeta = (id) => INSTRUMENTS.find((item) => item.id === id);

function getRow(instrument, rowId) {
  return instrument === "drums" ? state.sequence.drums[rowId] : state.sequence[instrument][rowId];
}

function voiceLabel(laneId) {
  const voice = state.drums.voices[laneId] || "";
  const sampleId = sampleIdFromVoice(voice);
  if (sampleId) {
    const entry = samples.get(sampleId);
    return entry ? entry.name : "missing sample";
  }
  const kit = kitById(voice.startsWith("kit:") ? voice.slice(4) : state.drums.kit) || KITS[0];
  return `${kit.name} (synth)`;
}

function renderInstruments() {
  const nav = document.getElementById("instruments");
  nav.innerHTML = INSTRUMENTS.map(
    (item) => `
      <button
        class="instrument${item.id === state.activeInstrument ? " active" : ""}"
        data-instrument="${item.id}"
        aria-label="Select ${esc(item.name)}"
        style="${item.id === state.activeInstrument ? `background:${item.color}` : ""}"
      >${esc(item.name)}</button>
    `
  ).join("");
}

function rowsFor(instrument) {
  if (instrument === "drums") {
    return [...drumLanes()].reverse().map((lane) => ({
      id: lane.id,
      label: lane.name,
      title: voiceLabel(lane.id),
      color: lane.color,
      sequence: state.sequence.drums[lane.id] || emptyRow(),
    }));
  }
  const grid = state.sequence[instrument];
  return [...grid.keys()].reverse().map((index) => ({
    id: index,
    label: instrument === "drop" ? DROP_LABELS[index] : "",
    title: "",
    color: instrumentMeta(instrument).color,
    sequence: grid[index],
  }));
}

function renderGrid() {
  const rows = rowsFor(state.activeInstrument);
  document.getElementById("grid").innerHTML = rows
    .map(
      (row) => `
        <div class="row">
          <div class="row-label"${row.title ? ` title="${esc(row.title)}"` : ""}>${esc(row.label)}</div>
          <div class="steps">
            ${row.sequence
              .map(
                (on, step) => `
                  <button
                    class="step${on ? " on" : ""}${state.isPlaying && state.currentStep === step ? " playhead" : ""}"
                    data-instrument="${state.activeInstrument}"
                    data-row="${row.id}"
                    data-step="${step}"
                    data-step-key="step-${row.id}-${step}"
                    aria-label="Toggle step ${step + 1}"
                    aria-pressed="${on ? "true" : "false"}"
                    style="${on ? `background:${row.color}` : ""}"
                  ></button>
                `
              )
              .join("")}
          </div>
        </div>
      `
    )
    .join("");
}

function paintCell(instrument, rowId, step) {
  const button = document.querySelector(`[data-instrument="${instrument}"][data-row="${rowId}"][data-step="${step}"]`);
  if (!button) return;
  const on = getRow(instrument, rowId)[step];
  // drums paint in their own row colour, the rest use the instrument colour
  const color = instrument === "drums" ? laneColor(rowId) : instrumentMeta(instrument).color;
  button.classList.toggle("on", on);
  button.setAttribute("aria-pressed", on ? "true" : "false");
  button.style.background = on ? color : "transparent";
}

function updatePlayhead() {
  document.querySelectorAll(".step").forEach((button) => {
    const step = Number(button.dataset.step);
    button.classList.toggle("playhead", state.isPlaying && state.currentStep === step);
  });
}

function updatePlayButton() {
  const button = document.getElementById("play");
  button.textContent = state.isPlaying ? "Stop" : "Play";
  button.setAttribute("aria-label", state.isPlaying ? "Stop" : "Play (space bar)");
  button.title = state.isPlaying ? "Stop (space bar)" : "Play (space bar)";
}

function toggleStep(instrument, rowId, step) {
  markHistory();
  const row = getRow(instrument, rowId);
  row[step] = !row[step];
  if (state.isPlaying && state.currentStep === step) playStep(step);
  paintCell(instrument, rowId, step);
}

/* ---------------------------------------------------------------------------
   Sounds panel
   ------------------------------------------------------------------------- */

function setSoundsStatus(text) {
  const node = document.getElementById("sounds-status");
  if (node) node.textContent = text;
  statusOverride = text;
}

let statusOverride = null;

function renderSoundsStatus() {
  const node = document.getElementById("sounds-status");
  if (!node) return;
  const parts = [];
  const folder = folderEntries();
  const imported = importedEntries();
  if (sampleFolder.name) {
    parts.push(`Folder "${sampleFolder.name}" — ${folder.length} sample${folder.length === 1 ? "" : "s"}`);
  }
  if (imported.length) parts.push(`${imported.length} imported`);
  if (!parts.length) parts.push("No sample folder connected — using the built-in kits.");
  if (sampleFolder.truncated) parts.push(`only the first ${MAX_FOLDER_FILES} files are listed`);
  if (decodeState.pending > 0) parts.push(`decoding ${decodeState.pending}…`);
  if (decodeState.failed > 0) parts.push(`${decodeState.failed} file(s) could not be decoded`);
  if (sampleFolder.needsPermission) parts.push("folder access needs a click on Reconnect");
  const missing = drumLanes().filter((lane) => {
    const id = sampleIdFromVoice(state.drums.voices[lane.id] || "");
    return id && !samples.has(id);
  }).length;
  if (missing) parts.push(`${missing} saved sample(s) not loaded`);
  if (storageBroken) parts.push("browser storage unavailable — samples last for this session only");
  else if (location.protocol === "file:") {
    parts.push("tip: open this page from a local server (http://localhost) to have the browser remember your folder");
  }
  node.textContent = parts.join(" · ");
}

function voiceOptions(laneId) {
  const current = state.drums.voices[laneId] || "";
  const kit = kitById(state.drums.kit) || KITS[0];
  const options = [
    `<option value=""${current === "" ? " selected" : ""}>Kit default — ${esc(kit.name)}</option>`,
    '<optgroup label="Built-in kits">',
  ];
  for (const item of KITS) {
    const value = `kit:${item.id}`;
    options.push(`<option value="${esc(value)}"${current === value ? " selected" : ""}>${esc(item.name)}</option>`);
  }
  options.push("</optgroup>");
  const all = [...samples.values()];
  if (all.length) {
    options.push('<optgroup label="Samples">');
    for (const entry of all) {
      const value = `sample:${entry.id}`;
      options.push(
        `<option value="${esc(value)}"${current === value ? " selected" : ""}>${esc(entry.name)}${entry.error ? " (unreadable)" : ""}</option>`
      );
    }
    options.push("</optgroup>");
  } else {
    options.push('<optgroup label="Samples"><option value="" disabled>no samples loaded yet</option></optgroup>');
  }
  return options.join("");
}

function lanePitchMarkup(lane) {
  const total = lane.pitch;
  const label = total === 0 ? "0" : `${total > 0 ? "+" : ""}${total}`;
  return `
    <div class="lane-pitch">
      <span class="lane-pitch-label">Pitch</span>
      <div class="stepper">
        <button class="tempo-btn octave-btn" data-lane-pitch="${esc(lane.id)}" data-delta="-12" title="Down an octave">-12</button>
        <button class="tempo-btn" data-lane-pitch="${esc(lane.id)}" data-delta="-1" title="Down a semitone">-</button>
        <div class="tempo-value lane-pitch-value" id="lane-pitch-${esc(lane.id)}" aria-live="polite">${esc(label)}</div>
        <button class="tempo-btn" data-lane-pitch="${esc(lane.id)}" data-delta="1" title="Up a semitone">+</button>
        <button class="tempo-btn octave-btn" data-lane-pitch="${esc(lane.id)}" data-delta="12" title="Up an octave">+12</button>
      </div>
    </div>
  `;
}

function renderSounds() {
  const panel = document.getElementById("sounds");
  if (!panel) return;
  const visible = state.activeInstrument === "drums";
  panel.hidden = !visible;
  if (!visible) return;

  const lanes = drumLanes();
  document.getElementById("sounds-grid").innerHTML = `
    <div class="voice">
      <label for="kit-select">Kit</label>
      <select id="kit-select">
        ${KITS.map(
          (kit) => `<option value="${esc(kit.id)}"${kit.id === state.drums.kit ? " selected" : ""}>${esc(kit.name)}</option>`
        ).join("")}
      </select>
    </div>
    ${lanes
      .map(
        (lane) => `
        <div class="lane-card" data-lane-card="${esc(lane.id)}">
          <div class="lane-head">
            <input
              type="color"
              class="lane-color"
              id="lane-color-${esc(lane.id)}"
              value="${esc(lane.color)}"
              data-lane-color="${esc(lane.id)}"
              aria-label="${esc(lane.name)} colour"
              title="Row colour"
            />
            <input
              type="text"
              class="text-input lane-name"
              id="lane-name-${esc(lane.id)}"
              value="${esc(lane.name)}"
              maxlength="${MAX_LANE_NAME}"
              data-lane-name="${esc(lane.id)}"
              aria-label="${esc(lane.name)} name"
              title="Row name"
            />
            <button
              class="icon-btn lane-remove"
              data-remove-lane="${esc(lane.id)}"
              aria-label="Remove ${esc(lane.name)}"
              title="Remove this drum"
              ${lanes.length <= 1 ? "disabled" : ""}
            >✕</button>
          </div>
          <label for="voice-${esc(lane.id)}" class="lane-voice-label">${esc(lane.name)} sound</label>
          <select id="voice-${esc(lane.id)}" data-lane="${esc(lane.id)}">${voiceOptions(lane.id)}</select>
          ${lanePitchMarkup(lane)}
        </div>
      `
      )
      .join("")}
  `;

  const addButton = document.getElementById("lane-add");
  if (addButton) {
    addButton.disabled = lanes.length >= MAX_DRUM_LANES;
    addButton.title =
      lanes.length >= MAX_DRUM_LANES ? `${MAX_DRUM_LANES} drums is the limit` : "Add another drum row to the grid";
  }
  document.getElementById("folder-forget").hidden = !sampleFolder.name;
  document.getElementById("folder-reconnect").hidden = !sampleFolder.needsPermission;
  document.getElementById("samples-clear").hidden = importedEntries().length === 0;
  renderSoundsStatus();
}

function bindSoundsPanel() {
  document.getElementById("sounds-grid").addEventListener("change", (event) => {
    const select = event.target.closest("select");
    if (!select) return;
    markHistory();
    if (select.id === 'kit-select') {
      state.drums.kit = select.value;
    } else if (select.dataset.lane) {
      state.drums.voices[select.dataset.lane] = select.value;
      if (select.value.startsWith("sample:")) {
        const entry = samples.get(select.value.slice(7));
        if (entry) sampleBuffer(entry);
      }
    }
    renderSounds();
    savePrefs();
  });

  // renaming and recolouring, without rebuilding the panel under the cursor
  document.getElementById("sounds-grid").addEventListener("input", (event) => {
    const color = event.target.closest("[data-lane-color]");
    if (color) {
      const lane = laneById(color.dataset.laneColor);
      if (lane) lane.color = color.value;
      savePrefsSoon();
      renderGrid();
      return;
    }
    const name = event.target.closest("[data-lane-name]");
    if (name) renameDrumLane(name.dataset.laneName, name.value);
  });
  document.getElementById("sounds-grid").addEventListener("click", (event) => {
    const pitchButton = event.target.closest("[data-lane-pitch]");
    if (pitchButton) {
      const lane = laneById(pitchButton.dataset.lanePitch);
      if (lane) setLanePitch(lane.id, lane.pitch + Number(pitchButton.dataset.delta));
      return;
    }
    const removeButton = event.target.closest("[data-remove-lane]");
    if (removeButton && !removeButton.disabled) removeDrumLane(removeButton.dataset.removeLane);
  });
  document.getElementById("lane-add").addEventListener("click", () => {
    const id = addDrumLane();
    if (!id) return;
    const field = document.getElementById(`lane-name-${id}`);
    if (field) {
      field.focus();
      field.select();
    }
  });

  document.getElementById("folder-pick").addEventListener("click", pickSampleFolder);
  document.getElementById("folder-reconnect").addEventListener("click", async () => {
    if (sampleFolder.handle) await loadFolderHandle(sampleFolder.handle, { requestPermission: true });
  });
  document.getElementById("folder-forget").addEventListener("click", forgetSampleFolder);
  document.getElementById("files-import").addEventListener("click", () => document.getElementById("files-input").click());
  document.getElementById("samples-clear").addEventListener("click", async () => {
    const removed = await clearImportedSamples();
    setSoundsStatus(removed ? `Removed ${removed} imported sample${removed === 1 ? "" : "s"}.` : "No imported samples to remove.");
  });
  document.getElementById("samples-automap").addEventListener("click", () => {
    const assigned = autoAssignLanes({ force: true });
    setSoundsStatus(assigned ? `Mapped ${assigned} lane(s) from file names.` : "No file names matched kick / snare / hat.");
  });
  document.getElementById("folder-input").addEventListener("change", (event) => handleFolderInput(event.target));
  document.getElementById("files-input").addEventListener("change", async (event) => {
    const input = event.target;
    const count = await importFiles(input.files);
    input.value = "";
    if (count) setSoundsStatus(`Imported ${count} sample${count === 1 ? "" : "s"}.`);
  });

  const panel = document.getElementById("sounds");
  panel.addEventListener("dragover", (event) => {
    event.preventDefault();
    panel.classList.add("dragover");
  });
  panel.addEventListener("dragleave", () => panel.classList.remove("dragover"));
  panel.addEventListener("drop", async (event) => {
    event.preventDefault();
    panel.classList.remove("dragover");
    const files = [...(event.dataTransfer ? event.dataTransfer.files : [])];
    if (!files.length) return;
    const count = await importFiles(files);
    if (count) setSoundsStatus(`Imported ${count} dropped sample${count === 1 ? "" : "s"}.`);
  });
}

/* ---------------------------------------------------------------------------
   Melodic panel: transpose + FM for the selected pitched instrument
   ------------------------------------------------------------------------- */

function setMelodicStatus(text) {
  const node = document.getElementById("melodic-status");
  if (node) node.textContent = text;
}

function renderMelodicStatus() {
  const node = document.getElementById("melodic-status");
  if (!node) return;
  const voice = state.voices[state.activeInstrument];
  const meta = melodicMeta(state.activeInstrument);
  if (!voice || !meta) return;
  const parts = [`Base: ${meta.base}`];
  if (voice.fmAmount > 0) {
    parts.push(`FM ${Math.round(voice.fmAmount * 100)}% at ratio ${voice.fmRatio}, decaying over ${voice.fmDecay.toFixed(2)} s`);
  } else {
    parts.push("FM is off");
  }
  parts.push("pitch is in the Pitch panel");
  node.textContent = parts.join(" · ");
}

function renderMelodic() {
  const panel = document.getElementById("melodic");
  if (!panel) return;
  const visible = isMelodic(state.activeInstrument);
  panel.hidden = !visible;
  if (!visible) return;

  const meta = melodicMeta(state.activeInstrument);
  const voice = state.voices[state.activeInstrument];
  document.getElementById("melodic-title").textContent = `${meta.name} voice`;

  document.getElementById("melodic-grid").innerHTML = `
    <div class="voice fm-amount">
      <div class="fx-param-head"><span>FM amount</span><span class="fx-value" id="fm-amount-value">${Math.round(
        voice.fmAmount * 100
      )}%</span></div>
      ${sliderMarkup("fm-amount", voice.fmAmount, "FM amount")}
    </div>
    <div class="voice">
      <label for="fm-ratio">FM ratio</label>
      <select id="fm-ratio">
        ${FM_RATIOS.map(
          (ratio) => `<option value="${ratio}"${ratio === voice.fmRatio ? " selected" : ""}>${ratio} : 1</option>`
        ).join("")}
      </select>
    </div>
    <div class="voice fm-decay">
      <div class="fx-param-head"><span>FM decay</span><span class="fx-value" id="fm-decay-value">${voice.fmDecay.toFixed(
        2
      )} s</span></div>
      ${sliderMarkup("fm-decay", valueToRatio({ min: 0.02, max: 3, curve: "log" }, voice.fmDecay), "FM decay")}
    </div>
  `;

  const fmSpec = { min: 0.02, max: 3, curve: "log" };
  bindSliderElement(
    document.getElementById("fm-amount"),
    () => state.voices[state.activeInstrument].fmAmount,
    (ratio) => {
      markHistory();
      const target = state.voices[state.activeInstrument];
      target.fmAmount = Math.round(clamp(ratio, 0, 1) * 100) / 100;
      updateSliderUI("fm-amount", target.fmAmount);
      document.getElementById("fm-amount-value").textContent = `${Math.round(target.fmAmount * 100)}%`;
      renderMelodicStatus();
      savePrefsSoon();
    }
  );
  bindSliderElement(
    document.getElementById("fm-decay"),
    () => valueToRatio(fmSpec, state.voices[state.activeInstrument].fmDecay),
    (ratio) => {
      markHistory();
      const target = state.voices[state.activeInstrument];
      target.fmDecay = Math.round(ratioToValue(fmSpec, ratio) * 100) / 100;
      updateSliderUI("fm-decay", valueToRatio(fmSpec, target.fmDecay));
      document.getElementById("fm-decay-value").textContent = `${target.fmDecay.toFixed(2)} s`;
      renderMelodicStatus();
      savePrefsSoon();
    }
  );
  renderMelodicStatus();
}

function setTranspose(semitones) {
  markHistory();
  state.transpose = clamp(Math.round(semitones), TRANSPOSE_MIN, TRANSPOSE_MAX);
  renderPitch();
  savePrefsSoon();
}

function bindMelodicPanel() {
  document.getElementById("melodic-grid").addEventListener("change", (event) => {
    const select = event.target.closest("select");
    if (!select || select.id !== 'fm-ratio') return;
    markHistory();
    state.voices[state.activeInstrument].fmRatio = Number(select.value);
    renderMelodicStatus();
    savePrefs();
  });
}

/* ---------------------------------------------------------------------------
   FM 2 panel: the second FM operator, one per module
   ------------------------------------------------------------------------- */

function setFm2Value(moduleId, key, value) {
  markHistory();
  const current = fm2For(moduleId);
  if (key === "ratio") {
    state.fm2[moduleId] = { ...current, ratio: FM_RATIOS.includes(value) ? value : current.ratio };
  } else if (key === "amount") {
    state.fm2[moduleId] = { ...current, amount: clamp(value, 0, 1) };
  } else {
    state.fm2[moduleId] = { ...current, decay: clamp(value, 0.02, 3) };
  }
  savePrefsSoon();
}

function resetFm2(moduleId) {
  markHistory();
  state.fm2[moduleId] = defaultFm2()[moduleId];
  renderFm2();
  savePrefs();
}

function renderFm2Status() {
  const node = document.getElementById("fm2-status");
  if (!node) return;
  const moduleId = state.activeInstrument;
  const config = fm2For(moduleId);
  const parts = [];
  if (config.amount > 0) {
    parts.push(`FM ${Math.round(config.amount * 100)}% at ratio ${config.ratio}, decaying over ${config.decay.toFixed(2)} s`);
  } else {
    parts.push(isMelodic(moduleId) ? "FM 2 is off" : "FM is off");
  }
  if (isMelodic(moduleId)) {
    parts.push("a second operator, summed with the one in the voice panel");
  } else if (moduleId === "drums") {
    parts.push("bends the kick and snare tones, the hat's noise band and sample speed");
  } else {
    parts.push("bends the drop's sub and growl");
  }
  node.textContent = parts.join(" · ");
}

function renderFm2() {
  const panel = document.getElementById("fm2");
  if (!panel) return;
  const moduleId = state.activeInstrument;
  const config = fm2For(moduleId);
  const melodic = isMelodic(moduleId);
  document.getElementById("fm2-title").textContent = `${melodic ? "FM 2" : "FM"} · ${MODULE_LABELS[moduleId]}`;
  const decaySpec = { min: 0.02, max: 3, curve: "log" };

  document.getElementById("fm2-grid").innerHTML = `
    <div class="voice fm-amount">
      <div class="fx-param-head"><span>FM amount</span><span class="fx-value" id="fm2-amount-value">${Math.round(
        config.amount * 100
      )}%</span></div>
      ${sliderMarkup("fm2-amount", config.amount, "FM 2 amount")}
    </div>
    <div class="voice">
      <label for="fm2-ratio">FM ratio</label>
      <select id="fm2-ratio">
        ${FM_RATIOS.map((ratio) => `<option value="${ratio}"${ratio === config.ratio ? " selected" : ""}>${ratio} : 1</option>`).join("")}
      </select>
    </div>
    <div class="voice fm-decay">
      <div class="fx-param-head"><span>FM decay</span><span class="fx-value" id="fm2-decay-value">${config.decay.toFixed(
        2
      )} s</span></div>
      ${sliderMarkup("fm2-decay", valueToRatio(decaySpec, config.decay), "FM 2 decay")}
    </div>
  `;

  bindSliderElement(
    document.getElementById("fm2-amount"),
    () => fm2For(state.activeInstrument).amount,
    (ratio) => {
      setFm2Value(state.activeInstrument, "amount", Math.round(clamp(ratio, 0, 1) * 100) / 100);
      const current = fm2For(state.activeInstrument).amount;
      updateSliderUI("fm2-amount", current);
      document.getElementById("fm2-amount-value").textContent = `${Math.round(current * 100)}%`;
      renderFm2Status();
    }
  );
  bindSliderElement(
    document.getElementById("fm2-decay"),
    () => valueToRatio(decaySpec, fm2For(state.activeInstrument).decay),
    (ratio) => {
      setFm2Value(state.activeInstrument, "decay", Math.round(ratioToValue(decaySpec, ratio) * 100) / 100);
      const current = fm2For(state.activeInstrument).decay;
      updateSliderUI("fm2-decay", valueToRatio(decaySpec, current));
      document.getElementById("fm2-decay-value").textContent = `${current.toFixed(2)} s`;
      renderFm2Status();
    }
  );
  renderFm2Status();
}

function bindFm2Panel() {
  document.getElementById("fm2-reset").addEventListener("click", () => resetFm2(state.activeInstrument));
  document.getElementById("fm2-grid").addEventListener("change", (event) => {
    const select = event.target.closest("select");
    if (!select || select.id !== "fm2-ratio") return;
    setFm2Value(state.activeInstrument, "ratio", Number(select.value));
    renderFm2Status();
    savePrefs();
  });
}

/* ---------------------------------------------------------------------------
   Envelope panel: one ADSR per module
   ------------------------------------------------------------------------- */

function setEnvelopeValue(moduleId, key, value) {
  const spec = ENVELOPE_SPEC[key];
  if (!spec) return;
  markHistory();
  state.envelopes[moduleId][key] = clamp(value, spec.min, spec.max);
  savePrefsSoon();
}

function resetEnvelope(moduleId) {
  markHistory();
  state.envelopes[moduleId] = defaultEnvelopes()[moduleId];
  renderEnvelope();
  savePrefs();
}

function renderEnvelopeStatus() {
  const node = document.getElementById("envelope-status");
  if (!node) return;
  const env = envelopeFor(state.activeInstrument);
  const shape =
    env.sustain === 0
      ? "percussive — one shot per step"
      : env.sustain >= 0.95
        ? "sustained — holds for the whole step"
        : "sustained then fading";
  node.textContent = `${MODULE_LABELS[state.activeInstrument]} · ${shape} · attack, decay and release multiply the voice's own character`;
}

function renderEnvelope() {
  const panel = document.getElementById("envelope");
  if (!panel) return;
  const moduleId = state.activeInstrument;
  const env = envelopeFor(moduleId);
  document.getElementById("envelope-title").textContent = `Envelope · ${MODULE_LABELS[moduleId]}`;
  document.getElementById("envelope-grid").innerHTML = ENVELOPE_KEYS.map((key) => {
    const spec = ENVELOPE_SPEC[key];
    const id = `env-${key}`;
    return `
      <div class="voice">
        <div class="fx-param-head">
          <span>${esc(spec.label)}</span>
          <span class="fx-value" id="${esc(id)}-value">${esc(spec.format(env[key]))}</span>
        </div>
        ${sliderMarkup(id, valueToRatio(spec, env[key]), `${MODULE_LABELS[moduleId]} ${spec.label}`)}
      </div>
    `;
  }).join("");

  for (const key of ENVELOPE_KEYS) {
    const spec = ENVELOPE_SPEC[key];
    const id = `env-${key}`;
    bindSliderElement(
      document.getElementById(id),
      () => valueToRatio(spec, envelopeFor(state.activeInstrument)[key]),
      (ratio) => {
        setEnvelopeValue(state.activeInstrument, key, ratioToValue(spec, ratio));
        const current = envelopeFor(state.activeInstrument)[key];
        updateSliderUI(id, valueToRatio(spec, current));
        const readout = document.getElementById(`${id}-value`);
        if (readout) readout.textContent = spec.format(current);
        renderEnvelopeStatus();
      }
    );
  }
  renderEnvelopeStatus();
}

function bindEnvelopePanel() {
  document.getElementById("envelope-reset").addEventListener("click", () => resetEnvelope(state.activeInstrument));
}

/* ---------------------------------------------------------------------------
   Mixer: a level and a mute per instrument
   ------------------------------------------------------------------------- */

const LEVEL_SPEC = { min: 0, max: 1.5, curve: "linear" };

const formatLevel = (value) => `${Math.round(value * 100)}%`;

/** Mixer status: which instruments are currently silenced. */
function renderMixStatus() {
  const node = document.getElementById("mix-status");
  if (!node) return;
  const muted = MODULE_IDS.filter((moduleId) => state.muted[moduleId]);
  const parts = [];
  parts.push(muted.length ? `${muted.map((id) => MODULE_LABELS[id]).join(", ")} stopped` : "every instrument running");
  parts.push("each fader sits at the start of that module's chain, before its inserts");
  node.textContent = parts.join(" · ");
}

function renderMix() {
  const grid = document.getElementById("mix-grid");
  if (!grid) return;
  grid.innerHTML = MODULE_IDS.map((moduleId) => {
    const level = state.levels[moduleId];
    const muted = state.muted[moduleId];
    const id = `mix-level-${moduleId}`;
    const color = (instrumentMeta(moduleId) || {}).color || "#fff";
    return `
      <div class="mix-strip${muted ? " muted" : ""}" data-module="${esc(moduleId)}">
        <div class="fx-param-head">
          <span class="mix-name" style="color:${esc(color)}">${esc(MODULE_LABELS[moduleId])}</span>
          <span class="fx-value" id="${esc(id)}-value">${formatLevel(level)}</span>
        </div>
        ${sliderMarkup(id, valueToRatio(LEVEL_SPEC, level), `${MODULE_LABELS[moduleId]} volume`)}
        <button
          class="chip-btn mix-mute"
          data-mute="${esc(moduleId)}"
          aria-pressed="${muted ? "true" : "false"}"
          title="${muted ? "Start" : "Stop"} ${esc(MODULE_LABELS[moduleId])}"
        >${muted ? "Start" : "Stop"}</button>
      </div>
    `;
  }).join("");

  for (const moduleId of MODULE_IDS) {
    const id = `mix-level-${moduleId}`;
    bindSliderElement(
      document.getElementById(id),
      () => valueToRatio(LEVEL_SPEC, state.levels[moduleId]),
      (ratio) => setModuleLevel(moduleId, ratioToValue(LEVEL_SPEC, ratio))
    );
  }
  renderMixStatus();
}

function setModuleLevel(moduleId, level) {
  markHistory();
  state.levels[moduleId] = clamp(Number.isFinite(level) ? level : 1, LEVEL_SPEC.min, LEVEL_SPEC.max);
  applyModuleLevels();
  updateSliderUI(`mix-level-${moduleId}`, valueToRatio(LEVEL_SPEC, state.levels[moduleId]));
  const readout = document.getElementById(`mix-level-${moduleId}-value`);
  if (readout) readout.textContent = formatLevel(state.levels[moduleId]);
  savePrefsSoon();
}

function setModuleMuted(moduleId, muted) {
  markHistory();
  state.muted[moduleId] = Boolean(muted);
  applyModuleLevels();
  const strip = document.querySelector(`.mix-strip[data-module="${moduleId}"]`);
  if (strip) strip.classList.toggle("muted", state.muted[moduleId]);
  const button = document.querySelector(`[data-mute="${moduleId}"]`);
  if (button) {
    button.setAttribute("aria-pressed", state.muted[moduleId] ? "true" : "false");
    button.textContent = state.muted[moduleId] ? "Start" : "Stop";
    button.title = `${state.muted[moduleId] ? "Start" : "Stop"} ${MODULE_LABELS[moduleId]}`;
  }
  renderMixStatus();
  savePrefs();
}

const toggleModuleMute = (moduleId) => setModuleMuted(moduleId, !state.muted[moduleId]);

function resetLevels() {
  markHistory();
  for (const moduleId of MODULE_IDS) state.levels[moduleId] = 1;
  applyModuleLevels();
  renderMix();
  savePrefs();
}

function bindMixPanel() {
  document.getElementById("mix-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-mute]");
    if (button) toggleModuleMute(button.dataset.mute);
  });
  document.getElementById("mix-reset").addEventListener("click", resetLevels);
}

/* ---------------------------------------------------------------------------
   Pitch panel: per-module pitch on top of the global transpose
   ------------------------------------------------------------------------- */

const signed = (semitones) => (semitones > 0 ? `+${semitones}` : String(semitones));

function setModulePitch(moduleId, semitones) {
  markHistory();
  state.pitch[moduleId] = clamp(Math.round(semitones), TRANSPOSE_MIN, TRANSPOSE_MAX);
  renderPitch();
  savePrefsSoon();
}

function resetAllPitch() {
  markHistory();
  state.transpose = 0;
  for (const moduleId of MODULE_IDS) state.pitch[moduleId] = 0;
  renderPitch();
  savePrefs();
}

function renderPitchStatus() {
  const node = document.getElementById("pitch-status");
  if (!node) return;
  const moduleId = state.activeInstrument;
  const own = state.pitch[moduleId] || 0;
  const semitones = pitchSemitones(moduleId);
  const factor = pitchFactor(moduleId);
  const parts = [];
  if (isMelodic(moduleId)) {
    const hz = noteFrequency(0, 0, moduleId);
    parts.push(`${MODULE_LABELS[moduleId]} row 1 sounds at ${hz.toFixed(1)} Hz (${factor.toFixed(3)}×)`);
  } else if (moduleId === "drums") {
    parts.push(`Drums and samples play at ${factor.toFixed(3)}× speed (${signed(semitones)} semitones)`);
  } else {
    parts.push(`The drop sweeps at ${factor.toFixed(3)}× (${signed(semitones)} semitones)`);
  }
  parts.push(isMelodic(moduleId) ? `this instrument ${signed(own)} · global ${signed(state.transpose)}` : `this instrument ${signed(own)} · global ${signed(state.transpose)} (melodic only — never drums)`);
  parts.push("±12 jumps a whole octave");
  node.textContent = parts.join(" · ");
}

function renderPitch() {
  const panel = document.getElementById("pitch-panel");
  if (!panel) return;
  const moduleId = state.activeInstrument;
  const own = state.pitch[moduleId] || 0;
  document.getElementById("pitch-title").textContent = `Pitch · ${MODULE_LABELS[moduleId]}`;
  document.getElementById("pitch-readout").textContent = signed(own);
  document.getElementById("transpose-value").textContent = signed(state.transpose);
  document.getElementById("pitch-total").textContent = `total ${signed(pitchSemitones(moduleId))} semitones`;
  document.getElementById("pitch-global-note").textContent = isMelodic(moduleId)
    ? "bass · synth · strings"
    : `bass · synth · strings — not ${MODULE_LABELS[moduleId]}`;
  document.getElementById("pitch-reset").hidden = own === 0;
  const anyPitch = state.transpose !== 0 || MODULE_IDS.some((id) => state.pitch[id] !== 0);
  document.getElementById("pitch-reset-all").hidden = !anyPitch;
  renderPitchStatus();
}

function bindPitchPanel() {
  const step = (event) => (event.shiftKey ? 12 : 1);
  const pitchBy = (delta) => setModulePitch(state.activeInstrument, (state.pitch[state.activeInstrument] || 0) + delta);
  const transposeBy = (delta) => setTranspose(state.transpose + delta);

  document.getElementById("pitch-down").addEventListener("click", (event) => pitchBy(-step(event)));
  document.getElementById("pitch-up").addEventListener("click", (event) => pitchBy(step(event)));
  document.getElementById("pitch-down-12").addEventListener("click", () => pitchBy(-12));
  document.getElementById("pitch-up-12").addEventListener("click", () => pitchBy(12));
  document.getElementById("pitch-reset").addEventListener("click", () => setModulePitch(state.activeInstrument, 0));
  document.getElementById("pitch-reset-all").addEventListener("click", resetAllPitch);

  document.getElementById("transpose-down").addEventListener("click", (event) => transposeBy(-step(event)));
  document.getElementById("transpose-up").addEventListener("click", (event) => transposeBy(step(event)));
  document.getElementById("transpose-down-12").addEventListener("click", () => transposeBy(-12));
  document.getElementById("transpose-up-12").addEventListener("click", () => transposeBy(12));
  document.getElementById("transpose-reset").addEventListener("click", () => setTranspose(0));
}

/* ---------------------------------------------------------------------------
   Effects racks: one insert chain per module, plus the master chain
   ------------------------------------------------------------------------- */

function effectParamControl(effect, key, spec) {
  const id = `fx-${effect.id}-${key}`;
  if (spec.kind === "select") {
    return `
      <div class="fx-param">
        <label for="${esc(id)}">${esc(spec.label)}</label>
        <select id="${esc(id)}" data-param="${esc(key)}">
          ${spec.options
            .map(
              ([value, label]) =>
                `<option value="${esc(value)}"${effect.params[key] === value ? " selected" : ""}>${esc(label)}</option>`
            )
            .join("")}
        </select>
      </div>
    `;
  }
  return `
    <div class="fx-param">
      <div class="fx-param-head">
        <span>${esc(spec.label)}</span>
        <span class="fx-value" id="${esc(id)}-value">${esc(spec.format(effect.params[key]))}</span>
      </div>
      ${sliderMarkup(id, valueToRatio(spec, effect.params[key]), spec.label)}
    </div>
  `;
}

function effectCard(effect, index, listLength) {
  const spec = EFFECT_TYPES[effect.type];
  return `
    <article class="fx-card${effect.enabled ? "" : " bypassed"}" data-fx="${esc(effect.id)}">
      <header class="fx-head">
        <span class="fx-index">${index + 1}</span>
        <span class="fx-name">${esc(spec.name)}</span>
        <span class="fx-hint">${esc(spec.hint)}</span>
        <div class="fx-actions">
          <button class="chip-btn fx-toggle" data-action="toggle" aria-pressed="${effect.enabled ? "true" : "false"}">
            ${effect.enabled ? "On" : "Off"}
          </button>
          <button class="icon-btn" data-action="up" aria-label="Move ${esc(spec.name)} earlier" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="icon-btn" data-action="down" aria-label="Move ${esc(spec.name)} later" ${
            index === listLength - 1 ? "disabled" : ""
          }>↓</button>
          <button class="icon-btn" data-action="remove" aria-label="Remove ${esc(spec.name)}">✕</button>
        </div>
      </header>
      <div class="fx-params">
        ${Object.entries(spec.params)
          .map(([key, paramSpec]) => effectParamControl(effect, key, paramSpec))
          .join("")}
      </div>
    </article>
  `;
}

const rackList = (rackId) => state.racks[rackId] || (state.racks[rackId] = []);

/** Post-insert output level of the selected instrument. */
function setModuleOutput(moduleId, level) {
  markHistory();
  state.outputs[moduleId] = clamp(Number.isFinite(level) ? level : 1, LEVEL_SPEC.min, LEVEL_SPEC.max);
  applyModuleOutputs();
  updateSliderUI("insert-output-slider", valueToRatio(LEVEL_SPEC, state.outputs[moduleId]));
  const readout = document.getElementById("insert-output-value");
  if (readout) readout.textContent = formatLevel(state.outputs[moduleId]);
  savePrefsSoon();
}

function renderInsertOutput() {
  const moduleId = insertRackId();
  const level = state.outputs[moduleId];
  updateSliderUI("insert-output-slider", valueToRatio(LEVEL_SPEC, level));
  const readout = document.getElementById("insert-output-value");
  if (readout) readout.textContent = formatLevel(level);
  const label = document.getElementById("insert-output-label");
  if (label) label.textContent = `Output — after the ${MODULE_LABELS[moduleId]} inserts`;
}

/** Empty-chain copy, worded for a module insert or for the master rack. */
function emptyRackMessage(rackId) {
  const where =
    rackId === "master"
      ? "the whole mix goes straight to the output"
      : `${MODULE_LABELS[rackId]} goes straight into the master rack`;
  return `<p class="fx-empty">Empty chain — ${esc(where)}. Add a <strong>Filter</strong> or a <strong>Distortion</strong>, arrange them with ↑ ↓ and remove them with ✕.</p>`;
}

function renderRackInto(rackId, bodyId, statusId) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  const list = rackList(rackId);
  if (!list.length) {
    body.innerHTML = emptyRackMessage(rackId);
  } else {
    body.innerHTML = list.map((effect, index) => effectCard(effect, index, list.length)).join("");
    for (const effect of list) bindEffectControls(effect);
  }
  renderRackStatus(rackId, statusId);
}

function renderRackStatus(rackId, statusId) {
  const node = document.getElementById(statusId);
  if (!node) return;
  const list = rackList(rackId);
  const active = list.filter((effect) => effect.enabled).length;
  const parts = [];
  if (!list.length) {
    parts.push(rackId === "master" ? "Nothing on the master — the mix goes straight out" : `No inserts on ${MODULE_LABELS[rackId]}`);
  } else {
    parts.push(`${active} of ${list.length} active`);
  }
  parts.push(
    rackId === "master"
      ? "after every module, signal flows top to bottom"
      : `on ${MODULE_LABELS[rackId]} only, before the master rack`
  );
  if (!audioCtx) parts.push("wired as soon as audio starts");
  node.textContent = parts.join(" · ");
}

/** The rack currently shown in the inserts panel: whatever instrument is selected. */
const insertRackId = () => state.activeInstrument;

/** The "+ Filter / + Reverb / …" buttons for a rack, generated from EFFECT_TYPES. */
function renderRackAddButtons(rackId, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const prefix = rackId === "master" ? "fx" : "insert";
  container.innerHTML = effectTypesFor(rackId)
    .map((type) => {
      const spec = EFFECT_TYPES[type];
      return `<button class="chip-btn" id="${prefix}-add-${esc(type)}" data-add-type="${esc(type)}" title="Add a ${esc(
        spec.name.toLowerCase()
      )} to this chain">+ ${esc(spec.name)}</button>`;
    })
    .join("");
}

function renderEffects() {
  renderRackInto("master", "effects-body", "effects-status");
  renderRackAddButtons("master", "fx-add");
}

function renderInserts() {
  const panel = document.getElementById("inserts");
  if (!panel) return;
  const rackId = insertRackId();
  document.getElementById("inserts-title").textContent = `Inserts · ${MODULE_LABELS[rackId]}`;
  renderRackInto(rackId, "inserts-body", "inserts-status");
  renderRackAddButtons(rackId, "insert-add");
  renderInsertOutput();
}

function renderAllRacks() {
  renderEffects();
  renderInserts();
}


function bindEffectControls(effect) {
  const spec = EFFECT_TYPES[effect.type];
  for (const [key, paramSpec] of Object.entries(spec.params)) {
    const id = `fx-${effect.id}-${key}`;
    if (paramSpec.kind === "select") {
      const select = document.getElementById(id);
      if (!select) continue;
      select.addEventListener('change', () => {
        markHistory();
        effect.params[key] = select.value;
        applyEffectParams(effect);
        savePrefs();
      });
      continue;
    }
    bindSliderElement(
      document.getElementById(id),
      () => valueToRatio(paramSpec, effect.params[key]),
      (ratio) => {
        markHistory();
        effect.params[key] = Math.round(ratioToValue(paramSpec, ratio) * 1000) / 1000;
        updateSliderUI(id, valueToRatio(paramSpec, effect.params[key]));
        const readout = document.getElementById(`${id}-value`);
        if (readout) readout.textContent = paramSpec.format(effect.params[key]);
        applyEffectParams(effect);
        savePrefsSoon();
      }
    );
  }
}

function applyEffectParams(effect) {
  const entry = effectNodes.get(effect.id);
  if (entry && entry.type === effect.type) entry.update(effect.params);
}

function addEffect(type, rackId = "master") {
  if (!EFFECT_TYPES[type]) return null;
  if (rackId === "master" && INSERT_ONLY_TYPES.includes(type)) {
    const node = document.getElementById("effects-status");
    if (node) node.textContent = `${EFFECT_TYPES[type].name} is an insert effect — add it to an instrument instead`;
    return null;
  }
  const list = rackList(rackId);
  if (list.length >= MAX_RACK_EFFECTS) {
    renderRackStatus(rackId, rackId === "master" ? "effects-status" : "inserts-status");
    const node = document.getElementById(rackId === "master" ? "effects-status" : "inserts-status");
    if (node) node.textContent = `This rack is full (${MAX_RACK_EFFECTS} effects). Remove one first.`;
    return null;
  }
  markHistory();
  const effect = { id: nextEffectId(), type, enabled: true, params: defaultEffectParams(type) };
  list.push(effect);
  rebuildRack(rackId);
  renderAllRacks();
  savePrefs();
  return effect;
}

function removeEffect(id, rackId = "master") {
  const list = rackList(rackId);
  const index = list.findIndex((effect) => effect.id === id);
  if (index < 0) return;
  markHistory();
  list.splice(index, 1);
  const entry = effectNodes.get(id);
  if (entry) {
    disposeEffect(entry);
    effectNodes.delete(id);
  }
  rebuildRack(rackId);
  renderAllRacks();
  savePrefs();
}

function moveEffect(id, rackId = "master", delta = 0) {
  const list = rackList(rackId);
  const index = list.findIndex((effect) => effect.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return;
  markHistory();
  const [effect] = list.splice(index, 1);
  list.splice(target, 0, effect);
  rebuildRack(rackId);
  renderAllRacks();
  savePrefs();
}

function clearRack(rackId) {
  markHistory();
  for (const effect of rackList(rackId)) {
    const entry = effectNodes.get(effect.id);
    if (entry) {
      disposeEffect(entry);
      effectNodes.delete(effect.id);
    }
  }
  state.racks[rackId].splice(0);
  rebuildRack(rackId);
  renderAllRacks();
  savePrefs();
}

const clearEffects = () => clearRack("master");

function handleRackAction(rackId, effectId, action) {
  const list = rackList(rackId);
  const effect = list.find((item) => item.id === effectId);
  if (!effect) return;
  if (action === 'toggle') {
    markHistory();
    effect.enabled = !effect.enabled;
    rebuildRack(rackId);
    renderAllRacks();
    savePrefs();
  } else if (action === "remove") removeEffect(effectId, rackId);
  else if (action === "up") moveEffect(effectId, rackId, -1);
  else if (action === "down") moveEffect(effectId, rackId, 1);
}

function bindRackActions(bodyId, rackIdFor) {
  document.getElementById(bodyId).addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const card = button.closest("[data-fx]");
    if (!card) return;
    handleRackAction(rackIdFor(), card.dataset.fx, button.dataset.action);
  });
}

/** Collapse / expand a rack body, so the page stays manageable. */
function setRackCollapsed(toggleId, bodyId, collapsed) {
  const toggle = document.getElementById(toggleId);
  const body = document.getElementById(bodyId);
  if (!toggle || !body) return;
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  toggle.textContent = collapsed ? "Show" : "Hide";
  body.hidden = collapsed;
}

function bindRackCollapse(toggleId, bodyId) {
  const toggle = document.getElementById(toggleId);
  if (!toggle) return;
  toggle.addEventListener("click", () => {
    racksTouchedByUser = true;
    setRackCollapsed(toggleId, bodyId, toggle.getAttribute("aria-expanded") === "true");
  });
}

/** Phones start with the effect racks folded away so the grid comes first. */
const isNarrowScreen = () => Boolean(window.matchMedia) && window.matchMedia("(max-width: 620px)").matches;

let racksTouchedByUser = false;
let layoutTimer = null;

/**
 * Fold the racks on narrow screens, but never fight a choice the user made by
 * hand — and re-check on rotation or resize, not just at load.
 */
function applyStartupLayout() {
  if (racksTouchedByUser) return;
  const narrow = isNarrowScreen();
  setRackCollapsed("inserts-collapse", "inserts-body", narrow);
  setRackCollapsed("effects-collapse", "effects-body", narrow);
}

function bindResponsiveLayout() {
  applyStartupLayout();
  window.addEventListener("resize", () => {
    if (layoutTimer !== null) window.clearTimeout(layoutTimer);
    layoutTimer = window.setTimeout(() => {
      layoutTimer = null;
      applyStartupLayout();
    }, 150);
  });
  window.addEventListener("orientationchange", applyStartupLayout);
}

function bindEffectsPanel() {
  document.getElementById("fx-add").addEventListener("click", (event) => {
    const button = event.target.closest("[data-add-type]");
    if (button) addEffect(button.dataset.addType, "master");
  });
  document.getElementById("fx-clear").addEventListener("click", () => clearRack("master"));
  bindRackActions("effects-body", () => "master");
  bindRackCollapse("effects-collapse", "effects-body");
}

function bindInsertsPanel() {
  document.getElementById("insert-add").addEventListener("click", (event) => {
    const button = event.target.closest("[data-add-type]");
    if (button) addEffect(button.dataset.addType, insertRackId());
  });
  document.getElementById("insert-clear").addEventListener("click", () => clearRack(insertRackId()));
  bindSliderElement(
    document.getElementById("insert-output-slider"),
    () => valueToRatio(LEVEL_SPEC, state.outputs[insertRackId()]),
    (ratio) => setModuleOutput(insertRackId(), ratioToValue(LEVEL_SPEC, ratio))
  );
  bindRackActions("inserts-body", insertRackId);
  bindRackCollapse("inserts-collapse", "inserts-body");
}

/* ---------------------------------------------------------------------------
   Pattern library and WAV export
   ------------------------------------------------------------------------- */

const PATTERNS_KEY = "earworm-studio.patterns.v1";
const EXPORT_TAIL_SECONDS = 2; // room for reverb / delay tails after the last bar
let savedPatterns = [];
let patternCounter = 0;

/** Copy any stored sequence into a well-formed one, so old or odd data is safe. */
function sanitiseSequence(raw) {
  const sequence = emptySequence();
  if (!raw || typeof raw !== "object") return sequence;
  for (const lane of drumLanes()) {
    const row = raw.drums ? raw.drums[lane.id] : null;
    if (Array.isArray(row)) for (let step = 0; step < STEPS; step++) sequence.drums[lane.id][step] = row[step] === true;
  }
  for (const key of ["bass", "synth", "strings", "drop"]) {
    const grid = Array.isArray(raw[key]) ? raw[key] : [];
    sequence[key].forEach((row, index) => {
      const source = grid[index];
      if (Array.isArray(source)) for (let step = 0; step < STEPS; step++) row[step] = source[step] === true;
    });
  }
  return sequence;
}

const cloneSequence = (sequence) => sanitiseSequence(sequence);

const patternIsEmpty = () =>
  drumLanes().every((lane) => (state.sequence.drums[lane.id] || []).every((on) => !on)) &&
  ["bass", "synth", "strings", "drop"].every((key) => state.sequence[key].every((row) => row.every((on) => !on)));

function loadPatterns() {
  let stored = null;
  try {
    stored = JSON.parse(window.localStorage.getItem(PATTERNS_KEY) || "null");
  } catch (error) {
    stored = null;
  }
  if (!Array.isArray(stored)) return;
  savedPatterns = stored
    .filter((pattern) => pattern && typeof pattern === "object")
    .slice(0, 60)
    .map((pattern) => ({
      id: typeof pattern.id === "string" && pattern.id ? pattern.id : nextPatternId(),
      name: typeof pattern.name === "string" && pattern.name ? pattern.name.slice(0, 40) : "Pattern",
      sequence: sanitiseSequence(pattern.sequence),
    }));
}

function persistPatterns() {
  try {
    window.localStorage.setItem(
      PATTERNS_KEY,
      JSON.stringify(savedPatterns.map((p) => ({ id: p.id, name: p.name, sequence: p.sequence })))
    );
  } catch (error) {
    /* storage unavailable: the library lasts for this session */
  }
}

const nextPatternId = () => `p${++patternCounter}-${Date.now().toString(36)}`;

function setPatternStatus(text) {
  const node = document.getElementById("patterns-status");
  if (node) node.textContent = text;
}

function renderPatternStatus() {
  const node = document.getElementById("patterns-status");
  if (!node) return;
  const parts = [];
  parts.push(savedPatterns.length ? `${savedPatterns.length} saved pattern${savedPatterns.length === 1 ? "" : "s"}` : "no saved patterns yet");
  parts.push("saving stores the 16 steps; your sound, mixer and effects stay as they are");
  if (storageBroken) parts.push("browser storage unavailable — patterns last for this session only");
  node.textContent = parts.join(" · ");
}

function renderPatterns() {
  const list = document.getElementById("pattern-list");
  if (!list) return;
  list.innerHTML = savedPatterns.length
    ? savedPatterns
        .map(
          (pattern) => `
            <span class="pattern-chip">
              <button class="pattern-load" data-load="${esc(pattern.id)}" title="Load this pattern">${esc(pattern.name)}</button>
              <button class="pattern-remove" data-remove="${esc(pattern.id)}" aria-label="Delete ${esc(pattern.name)}">✕</button>
            </span>
          `
        )
        .join("")
    : `<span class="pattern-empty">Nothing saved yet — play something, then name it and press Save.</span>`;
  renderPatternStatus();
}

function saveCurrentPattern() {
  const input = document.getElementById("pattern-name");
  const typed = input ? input.value.trim().slice(0, 40) : "";
  if (patternIsEmpty()) {
    setPatternStatus("The pattern is empty — add some steps first.");
    return null;
  }
  const pattern = {
    id: nextPatternId(),
    name: typed || `Pattern ${savedPatterns.length + 1}`,
    sequence: cloneSequence(state.sequence),
  };
  savedPatterns.push(pattern);
  persistPatterns();
  renderPatterns();
  if (input) input.value = "";
  setPatternStatus(`Saved “${pattern.name}”.`);
  return pattern;
}

function loadPattern(id) {
  const pattern = savedPatterns.find((item) => item.id === id);
  if (!pattern) return;
  markHistory();
  state.sequence = cloneSequence(pattern.sequence);
  renderGrid();
  updatePlayhead();
  setPatternStatus(`Loaded “${pattern.name}”.`);
}

function deletePattern(id) {
  const index = savedPatterns.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [removed] = savedPatterns.splice(index, 1);
  persistPatterns();
  renderPatterns();
  setPatternStatus(`Deleted “${removed.name}”.`);
}

function clearPatterns() {
  savedPatterns = [];
  persistPatterns();
  renderPatterns();
}

/* ---- offline render + wav encoding ---- */

/**
 * Render the pattern into an OfflineAudioContext by pointing the module-level
 * audio globals at a fresh graph for the duration of the render.
 */
async function renderPatternToBuffer(bars = 4) {
  const liveCtx = getContext();
  await decodeAll(samples.values()); // make sure every sample is ready first

  const barSeconds = loopDurationMs() / 1000;
  const seconds = bars * barSeconds + EXPORT_TAIL_SECONDS;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("this browser has no OfflineAudioContext");
  const offline = new Offline(2, Math.ceil(seconds * liveCtx.sampleRate), liveCtx.sampleRate);

  const saved = { ctx: audioCtx, masterIn, masterOut, buses: moduleBuses, outputs: moduleOutputs, nodes: effectNodes };
  audioCtx = offline;
  masterIn = null;
  masterOut = null;
  moduleBuses = new Map();
  moduleOutputs = new Map();
  effectNodes = new Map();
  try {
    getMaster(state.volume); // builds buses, racks and levels inside the offline context
    for (let bar = 0; bar < bars; bar++) {
      for (let step = 0; step < STEPS; step++) {
        playStep(step, bar * barSeconds + stepOnsetMs(step) / 1000);
      }
    }
    return await offline.startRendering();
  } finally {
    audioCtx = saved.ctx;
    masterIn = saved.masterIn;
    masterOut = saved.masterOut;
    moduleBuses = saved.buses;
    moduleOutputs = saved.outputs;
    effectNodes = saved.nodes;
  }
}

const writeAscii = (view, offset, text) => {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
};

/** 16-bit PCM WAV file from a rendered AudioBuffer. */
function encodeWav(buffer) {
  const channels = Math.max(1, buffer.numberOfChannels);
  const frames = buffer.length;
  const dataBytes = frames * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true); // byte rate
  view.setUint16(32, channels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  const data = [];
  for (let channel = 0; channel < channels; channel++) data.push(buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, data[channel][frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function exportWav() {
  const button = document.getElementById("export-wav");
  const select = document.getElementById("export-bars");
  const bars = Number(select && select.value) || 4;
  if (patternIsEmpty()) {
    setPatternStatus("Nothing to export — the pattern is empty.");
    return null;
  }
  if (button) button.disabled = true;
  setPatternStatus(`Rendering ${bars} bar${bars === 1 ? "" : "s"}…`);
  try {
    const buffer = await renderPatternToBuffer(bars);
    const blob = encodeWav(buffer);
    const filename = `earworm-${bars}bar-${state.tempo}bpm.wav`;
    downloadBlob(blob, filename);
    setPatternStatus(
      `Exported ${filename} — ${bars} bar${bars === 1 ? "" : "s"} plus a ${EXPORT_TAIL_SECONDS}s tail, ${(blob.size / 1048576).toFixed(1)} MB`
    );
    return { blob, buffer, filename };
  } catch (error) {
    setPatternStatus(`Export failed: ${error && error.message ? error.message : error}`);
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

function bindPatternsPanel() {
  document.getElementById("pattern-save").addEventListener("click", () => saveCurrentPattern());
  document.getElementById("pattern-name").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveCurrentPattern();
    }
  });
  document.getElementById("pattern-list").addEventListener("click", (event) => {
    const load = event.target.closest("[data-load]");
    if (load) {
      loadPattern(load.dataset.load);
      return;
    }
    const remove = event.target.closest("[data-remove]");
    if (remove) deletePattern(remove.dataset.remove);
  });
  document.getElementById("export-wav").addEventListener("click", () => exportWav());
}

/* ---------------------------------------------------------------------------
   Undo / redo
   Every edit is captured as a snapshot of the musical state. Continuous
   controls (sliders) and drag-painting coalesce into one entry per burst,
   so Ctrl+Z steps back through meaningful edits rather than every pixel.
   ------------------------------------------------------------------------- */

const HISTORY_LIMIT = 60;
const HISTORY_DEBOUNCE_MS = 250;

const history = { past: [], future: [], last: null, timer: null, suspended: false };

/** The part of the app that undo/redo owns. */
function snapshotState() {
  return JSON.stringify({
    sequence: state.sequence,
    drums: state.drums,
    voices: state.voices,
    racks: state.racks,
    envelopes: state.envelopes,
    fm2: state.fm2,
    pitch: state.pitch,
    levels: state.levels,
    outputs: state.outputs,
    muted: state.muted,
    transpose: state.transpose,
    tempo: state.tempo,
    volume: state.volume,
    swing: state.swing,
    swingGrid: state.swingGrid,
  });
}

function renderHistoryButtons() {
  const undoButton = document.getElementById("undo");
  const redoButton = document.getElementById("redo");
  if (undoButton) {
    undoButton.disabled = history.past.length === 0;
    undoButton.title = history.past.length ? `Undo (Ctrl+Z) — ${history.past.length} step${history.past.length === 1 ? "" : "s"} back` : "Nothing to undo";
  }
  if (redoButton) {
    redoButton.disabled = history.future.length === 0;
    redoButton.title = history.future.length ? `Redo (Ctrl+Y) — ${history.future.length} step${history.future.length === 1 ? "" : "s"} forward` : "Nothing to redo";
  }
}

/** Record the state before an edit. Debounced, so a burst becomes one entry. */
function markHistory() {
  if (history.suspended) return;
  if (history.timer !== null) window.clearTimeout(history.timer);
  history.timer = window.setTimeout(flushHistory, HISTORY_DEBOUNCE_MS);
}

function flushHistory() {
  if (history.timer !== null) {
    window.clearTimeout(history.timer);
    history.timer = null;
  }
  if (history.suspended) return;
  const current = snapshotState();
  if (current === history.last) return; // nothing actually changed
  if (history.last !== null) {
    history.past.push(history.last);
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
  }
  history.last = current;
  history.future.length = 0;
  renderHistoryButtons();
}

function clearHistory() {
  if (history.timer !== null) {
    window.clearTimeout(history.timer);
    history.timer = null;
  }
  history.past.length = 0;
  history.future.length = 0;
  history.last = snapshotState();
  renderHistoryButtons();
}

/** Put a stored snapshot back into the state, the audio graph and the UI. */
function applySnapshot(text) {
  const data = JSON.parse(text);
  history.suspended = true;
  try {
    const lanes = readLanes(data.drums && data.drums.lanes) || defaultDrumLanes();
    const savedVoices = (data.drums && data.drums.voices) || {};
    state.drums = {
      kit: kitById(data.drums && data.drums.kit) ? data.drums.kit : "analog",
      lanes,
      voices: Object.fromEntries(
        lanes.map((lane) => [lane.id, typeof savedVoices[lane.id] === "string" ? savedVoices[lane.id] : ""])
      ),
    };
    state.sequence = sanitiseSequence(data.sequence);
    const voices = defaultVoices();
    for (const voice of MELODIC_VOICES) {
      const saved = data.voices ? data.voices[voice.id] : null;
      if (!saved) continue;
      if (Number.isFinite(saved.fmAmount)) voices[voice.id].fmAmount = clamp(saved.fmAmount, 0, 1);
      if (FM_RATIOS.includes(saved.fmRatio)) voices[voice.id].fmRatio = saved.fmRatio;
      if (Number.isFinite(saved.fmDecay)) voices[voice.id].fmDecay = clamp(saved.fmDecay, 0.02, 3);
    }
    state.voices = voices;
    const envelopes = defaultEnvelopes();
    for (const moduleId of MODULE_IDS) {
      const saved = data.envelopes ? data.envelopes[moduleId] : null;
      if (!saved || typeof saved !== "object") continue;
      for (const key of ENVELOPE_KEYS) {
        const spec = ENVELOPE_SPEC[key];
        if (Number.isFinite(saved[key])) envelopes[moduleId][key] = clamp(saved[key], spec.min, spec.max);
      }
    }
    state.envelopes = envelopes;
    const fm2 = defaultFm2();
    for (const moduleId of MODULE_IDS) {
      const saved = data.fm2 ? data.fm2[moduleId] : null;
      if (!saved || typeof saved !== "object") continue;
      if (Number.isFinite(saved.amount)) fm2[moduleId].amount = clamp(saved.amount, 0, 1);
      if (FM_RATIOS.includes(saved.ratio)) fm2[moduleId].ratio = saved.ratio;
      if (Number.isFinite(saved.decay)) fm2[moduleId].decay = clamp(saved.decay, 0.02, 3);
    }
    state.fm2 = fm2;
    state.pitch = zeroByModule(0);
    state.levels = zeroByModule(1);
  state.outputs = zeroByModule(1);
    state.muted = zeroByModule(false);
    for (const moduleId of MODULE_IDS) {
      if (data.pitch && Number.isFinite(data.pitch[moduleId])) state.pitch[moduleId] = clamp(Math.round(data.pitch[moduleId]), TRANSPOSE_MIN, TRANSPOSE_MAX);
      if (data.levels && Number.isFinite(data.levels[moduleId])) state.levels[moduleId] = clamp(data.levels[moduleId], LEVEL_SPEC.min, LEVEL_SPEC.max);
      if (data.outputs && Number.isFinite(data.outputs[moduleId])) state.outputs[moduleId] = clamp(data.outputs[moduleId], LEVEL_SPEC.min, LEVEL_SPEC.max);
      if (data.muted) state.muted[moduleId] = data.muted[moduleId] === true;
    }
    if (Number.isFinite(data.transpose)) state.transpose = clamp(Math.round(data.transpose), TRANSPOSE_MIN, TRANSPOSE_MAX);
    if (Number.isFinite(data.tempo)) state.tempo = clamp(Math.round(data.tempo), 60, 200);
    if (Number.isFinite(data.volume)) state.volume = clamp(data.volume, 0, 1);
    if (Number.isFinite(data.swing)) state.swing = clamp(data.swing, 0, 1);
    if (data.swingGrid === 8 || data.swingGrid === 16) state.swingGrid = data.swingGrid;

    for (const rackId of RACK_IDS) restoreRack(rackId, data.racks ? data.racks[rackId] : null);

    // rebuilding the rack audio is the only way to reflect the restored chains
    for (const entry of effectNodes.values()) disposeEffect(entry);
    effectNodes.clear();
    rebuildAllRacks();
    applyModuleLevels();
    applyModuleOutputs();
    getMaster(state.volume);

    savePrefs();
    refreshUI();
  } finally {
    history.suspended = false;
  }
}

function undo() {
  flushHistory();
  if (!history.past.length) return false;
  const previous = history.past.pop();
  history.future.push(history.last);
  history.last = previous;
  applySnapshot(previous);
  renderHistoryButtons();
  return true;
}

function redo() {
  flushHistory();
  if (!history.future.length) return false;
  const next = history.future.pop();
  history.past.push(history.last);
  history.last = next;
  applySnapshot(next);
  renderHistoryButtons();
  return true;
}

/* ---------------------------------------------------------------------------
   Complete reset
   Two-step on purpose: the first click arms, the second one wipes. It clears
   the pattern, every sound setting, all racks and the sample library.
   ------------------------------------------------------------------------- */

const RESET_CONFIRM_MS = 4000;
let resetArmed = false;
let resetTimer = null;

function renderResetButton() {
  const button = document.getElementById("reset-all");
  if (!button) return;
  button.classList.toggle("armed", resetArmed);
  button.textContent = resetArmed ? "Sure?" : "Reset";
  button.setAttribute("aria-pressed", resetArmed ? "true" : "false");
  button.setAttribute("aria-label", resetArmed ? "Confirm the complete reset" : "Reset everything");
  button.title = resetArmed
    ? "Click again to wipe the pattern, sound, mixer, effects and samples"
    : "Reset everything: pattern, sound, mixer, effects and samples";
}

function disarmReset() {
  resetArmed = false;
  if (resetTimer !== null) {
    window.clearTimeout(resetTimer);
    resetTimer = null;
  }
  renderResetButton();
}

async function resetEverything() {
  disarmReset();

  // transport
  state.isPlaying = false;
  stopScheduler();
  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
    rafId = null;
  }
  state.currentStep = 0;
  state.tempo = DEFAULT_TEMPO;
  state.volume = DEFAULT_VOLUME;
  state.swing = 0;
  state.swingGrid = DEFAULT_SWING_GRID;

  // pattern and sound
  state.sequence = emptySequence();
  state.transpose = 0;
  state.pitch = zeroByModule(0);
  state.levels = zeroByModule(1);
  state.outputs = zeroByModule(1);
  state.muted = zeroByModule(false);
  state.voices = defaultVoices();
  state.drums = defaultDrums();
  state.sequence.drums = emptyDrumsFor(state.drums.lanes);
  state.envelopes = defaultEnvelopes();
  state.fm2 = defaultFm2();

  // racks: drop the audio nodes and empty every chain
  for (const entry of effectNodes.values()) disposeEffect(entry);
  effectNodes.clear();
  state.racks = defaultRacks();
  rebuildAllRacks();
  applyModuleLevels();
  applyModuleOutputs();
  getMaster(state.volume);

  // sample library: imported samples, the folder, and any lane pointing at one
  clearFolderSamples();
  sampleFolder = { handle: null, name: null, needsPermission: false };
  await idbDelete(DB_FOLDER_KEY);
  await clearImportedSamples();

  // saved patterns go too: "complete" means complete
  clearPatterns();

  // a complete reset starts a fresh history rather than becoming an undo step
  clearHistory();

  // stored settings go back to defaults too
  savePrefs();

  refreshUI();
}

function handleResetClick() {
  if (!resetArmed) {
    resetArmed = true;
    resetTimer = window.setTimeout(disarmReset, RESET_CONFIRM_MS);
    renderResetButton();
    return;
  }
  resetEverything().catch((error) => console.warn("Reset failed:", error));
}

/* ---------------------------------------------------------------------------
   Transport controls
   ------------------------------------------------------------------------- */

function renderTempo() {
  document.getElementById("tempo-value").textContent = String(state.tempo);
}

function setTempo(tempo) {
  markHistory();
  state.tempo = clamp(tempo, 60, 200);
  renderTempo();
  if (state.isPlaying) restartScheduler();
  savePrefsSoon();
}

function updateSliderUI(id, ratio) {
  const percent = clamp(ratio, 0, 1) * 100;
  const fill = document.getElementById(`${id}-fill`);
  const thumb = document.getElementById(`${id}-thumb`);
  if (fill) fill.style.width = `${percent}%`;
  if (thumb) thumb.style.left = `${percent}%`;
  const slider = document.getElementById(id);
  if (slider) slider.setAttribute("aria-valuenow", String(Math.round(percent)));
}

function updateVolumeUI() {
  updateSliderUI("volume", state.volume);
}

function setVolume(ratio) {
  markHistory();
  state.volume = Math.round(clamp(ratio, 0, 1) * 100) / 100;
  getMaster(state.volume);
  updateVolumeUI();
  savePrefsSoon();
}

function updateSwingUI() {
  updateSliderUI("swing", state.swing);
  document.getElementById("swing-value").textContent = `${Math.round(state.swing * 100)}%`;
  document.getElementById("swing-grid-8").setAttribute("aria-pressed", String(state.swingGrid === 8));
  document.getElementById("swing-grid-16").setAttribute("aria-pressed", String(state.swingGrid === 16));
}

function setSwing(ratio) {
  markHistory();
  state.swing = Math.round(clamp(ratio, 0, 1) * 100) / 100;
  updateSwingUI();
  if (state.isPlaying) restartScheduler();
  savePrefsSoon();
}

function setSwingGrid(grid) {
  markHistory();
  state.swingGrid = grid === 16 ? 16 : 8;
  updateSwingUI();
  if (state.isPlaying) restartScheduler();
  savePrefs();
}

const drag = { active: false, target: null, visited: new Set(), slider: null };

/** Horizontal drag slider markup. Ids follow `<id>` / `<id>-fill` / `<id>-thumb`. */
function sliderMarkup(id, ratio, ariaLabel) {
  const percent = clamp(ratio, 0, 1) * 100;
  return `
    <div
      class="slider"
      id="${esc(id)}"
      role="slider"
      tabindex="0"
      aria-label="${esc(ariaLabel)}"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow="${Math.round(percent)}"
    >
      <div class="slider-track">
        <div class="slider-fill" id="${esc(id)}-fill" style="width:${percent}%"></div>
      </div>
      <div class="slider-thumb" id="${esc(id)}-thumb" style="left:${percent}%"></div>
    </div>
  `;
}

function bindSliderElement(element, getValue, setValue) {
  if (!element) return;
  const applyFromClientX = (clientX) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width) return;
    setValue((clientX - rect.left) / rect.width);
  };
  drag.slider = drag.slider || {};
  element.addEventListener("mousedown", (event) => {
    drag.slider.handler = applyFromClientX;
    applyFromClientX(event.clientX);
    event.preventDefault();
  });
  element.addEventListener(
    "touchstart",
    (event) => {
      drag.slider.handler = applyFromClientX;
      applyFromClientX(event.touches[0].clientX);
      event.preventDefault();
    },
    { passive: false }
  );
  element.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 10 : 1;
    const current = Math.round(getValue() * 100);
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") setValue((current - step) / 100);
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") setValue((current + step) / 100);
    else if (event.key === "Home") setValue(0);
    else if (event.key === "End") setValue(1);
    else return;
    event.preventDefault();
  });
}

function bindSlider(id, getValue, setValue) {
  bindSliderElement(document.getElementById(id), getValue, setValue);
}

function stepFromPoint(clientX, clientY) {
  const element = document.elementFromPoint(clientX, clientY);
  if (!element || !element.classList.contains("step")) return null;
  return {
    instrument: element.dataset.instrument,
    rowId: rowIdFromDataset(element.dataset.row),
    step: Number(element.dataset.step),
  };
}

function beginPaint(instrument, rowId, step) {
  drag.active = true;
  drag.target = getRow(instrument, rowId)[step];
  drag.visited = new Set([`${instrument}-${rowId}-${step}`]);
  toggleStep(instrument, rowId, step);
}

function continuePaint(instrument, rowId, step) {
  const key = `${instrument}-${rowId}-${step}`;
  if (drag.visited.has(key)) return;
  if (getRow(instrument, rowId)[step] === drag.target) {
    drag.visited.add(key);
    toggleStep(instrument, rowId, step);
  }
}

function bindGrid() {
  const grid = document.getElementById("grid");
  grid.addEventListener("mousedown", (event) => {
    const target = event.target.closest(".step");
    if (!target) return;
    beginPaint(target.dataset.instrument, rowIdFromDataset(target.dataset.row), Number(target.dataset.step));
  });
  grid.addEventListener("mouseover", (event) => {
    if (!drag.active) return;
    const target = event.target.closest(".step");
    if (!target) return;
    continuePaint(target.dataset.instrument, rowIdFromDataset(target.dataset.row), Number(target.dataset.step));
  });
  grid.addEventListener(
    "touchstart",
    (event) => {
      const target = event.target.closest(".step");
      if (!target) return;
      event.preventDefault();
      beginPaint(target.dataset.instrument, rowIdFromDataset(target.dataset.row), Number(target.dataset.step));
    },
    { passive: false }
  );
  grid.addEventListener(
    "touchmove",
    (event) => {
      if (!drag.active) return;
      event.preventDefault();
      const touch = event.touches[0];
      const hit = stepFromPoint(touch.clientX, touch.clientY);
      if (hit) continuePaint(hit.instrument, hit.rowId, hit.step);
    },
    { passive: false }
  );
}

function endDrag() {
  drag.active = false;
  drag.target = null;
  drag.visited.clear();
  if (drag.slider) drag.slider.handler = null;
}

/** Controls that own the space bar themselves (opening a list, typing). */
const SPACE_OWNED_TAGS = new Set(["SELECT", "OPTION", "INPUT", "TEXTAREA"]);

function isSpace(event) {
  return event.code === "Space" || event.key === " " || event.key === "Spacebar";
}

/** Space bar starts and stops the transport, from anywhere on the page. */
function handleTransportKey(event) {
  if (!isSpace(event)) return;
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target && (SPACE_OWNED_TAGS.has(target.tagName) || target.isContentEditable)) return;
  event.preventDefault(); // do not also scroll the page
  togglePlayback();
}

/** Ctrl/Cmd+Z undoes, Ctrl+Y or Ctrl/Cmd+Shift+Z redoes. */
function handleHistoryKey(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (event.repeat) return;
  const key = String(event.key || "").toLowerCase();
  if (key !== "z" && key !== "y") return;
  const target = event.target;
  // leave text fields to the browser's own undo
  if (target && (SPACE_OWNED_TAGS.has(target.tagName) || target.isContentEditable)) return;
  event.preventDefault();
  if (key === "y" || event.shiftKey) redo();
  else undo();
}

function bindKeyboard() {
  document.addEventListener("keydown", (event) => {
    handleHistoryKey(event);
    handleTransportKey(event);
  });
}

function bindControls() {
  document.getElementById("instruments").addEventListener("click", (event) => {
    const button = event.target.closest("[data-instrument]");
    if (!button) return;
    state.activeInstrument = button.dataset.instrument;
    renderInstruments();
    renderGrid();
    renderSounds();
    renderMelodic();
    renderPitch();
    renderEnvelope();
    renderFm2();
    renderInserts();
  });
  document.getElementById("play").addEventListener("click", togglePlayback);
  document.getElementById('clear').addEventListener('click', () => {
    markHistory();
    state.sequence = emptySequence();
    renderGrid();
  });
  document.getElementById('demo').addEventListener('click', () => {
    markHistory();
    state.sequence = demoSequence();
    renderGrid();
  });
  document.getElementById("tempo-down").addEventListener("click", () => setTempo(state.tempo - 10));
  document.getElementById("tempo-up").addEventListener("click", () => setTempo(state.tempo + 10));
  document.getElementById("reset-all").addEventListener("click", handleResetClick);
  document.getElementById("undo").addEventListener("click", () => undo());
  document.getElementById("redo").addEventListener("click", () => redo());
  document.getElementById("swing-grid-8").addEventListener("click", () => setSwingGrid(8));
  document.getElementById("swing-grid-16").addEventListener("click", () => setSwingGrid(16));

  bindSlider("volume", () => state.volume, setVolume);
  bindSlider("swing", () => state.swing, setSwing);

  const onPointerMove = (clientX) => {
    if (drag.slider && drag.slider.handler) drag.slider.handler(clientX);
  };
  document.addEventListener("mousemove", (event) => onPointerMove(event.clientX));
  document.addEventListener("touchmove", (event) => onPointerMove(event.touches[0].clientX), { passive: true });
  document.addEventListener("mouseup", endDrag);
  document.addEventListener("touchend", endDrag);
}

/* ---------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */

function refreshUI() {
  renderInstruments();
  renderGrid();
  renderPatterns();
  renderMix();
  renderSounds();
  renderMelodic();
  renderPitch();
  renderEnvelope();
  renderFm2();
  renderAllRacks();
  renderTempo();
  updateVolumeUI();
  updateSwingUI();
  updatePlayButton();
  renderResetButton();
}

loadPrefs();
loadPatterns();
clearHistory();
refreshUI();
bindGrid();
bindControls();
bindSoundsPanel();
bindMelodicPanel();
bindEffectsPanel();
bindInsertsPanel();
bindPitchPanel();
bindEnvelopePanel();
bindFm2Panel();
bindMixPanel();
bindPatternsPanel();
bindKeyboard();
bindResponsiveLayout();
restoreSamples().catch((error) => console.warn("Sample restore failed:", error));

window.addEventListener("beforeunload", () => {
  stopScheduler();
  savePrefs();
});

/* Small public surface: handy for the browser console and for automated checks. */
window.earworm = {
  state,
  samples,
  KITS,
  DRUM_LANES,
  MELODIC_VOICES,
  EFFECT_TYPES,
  stepMs,
  stepOnsetMs,
  loopDurationMs,
  resolveVoice,
  drumLanes,
  emptyDrums,
  emptySequence,
  laneById,
  laneColor,
  laneName,
  readLanes,
  addDrumLane,
  removeDrumLane,
  renameDrumLane,
  recolorDrumLane,
  setLanePitch,
  resetLanePitch,
  setDrumLanes,
  laneHints,
  playStep,
  playDrum,
  playBass,
  playSynth,
  playStrings,
  playDrop,
  noteFrequency,
  fmModulate,
  distortionCurve,
  ratioToValue,
  valueToRatio,
  importFiles,
  handleFolderInput,
  pickSampleFolder,
  loadFolderHandle,
  autoAssignLanes,
  forgetSampleFolder,
  clearImportedSamples,
  pruneSampleVoices,
  renderSounds,
  renderGrid,
  paintCell,
  renderMelodic,
  renderPitch,
  renderMix,
  renderPatterns,
  renderEffects,
  renderInserts,
  renderAllRacks,
  refreshUI,
  capabilities,
  setTempo,
  setSwing,
  setSwingGrid,
  setVolume,
  setTranspose,
  setModulePitch,
  resetAllPitch,
  pitchSemitones,
  pitchFactor,
  envelopeFor,
  applyAmpEnvelope,
  renderEnvelope,
  renderFm2,
  fm2For,
  fmOperator,
  fmSecond,
  setFm2Value,
  resetFm2,
  setEnvelopeValue,
  resetEnvelope,
  setModuleLevel,
  setModuleMuted,
  toggleModuleMute,
  moduleGain,
  moduleOutputGain,
  moduleOutput,
  applyModuleOutputs,
  setModuleOutput,
  renderInsertOutput,
  moduleAudible,
  applyModuleLevels,
  resetLevels,
  saveCurrentPattern,
  loadPattern,
  deletePattern,
  clearPatterns,
  sanitiseSequence,
  encodeWav,
  renderPatternToBuffer,
  exportWav,
  undo,
  redo,
  snapshotState,
  flushHistory,
  clearHistory,
  markHistory,
  history,
  setRackCollapsed,
  applyStartupLayout,
  isNarrowScreen,
  savedPatterns: () => savedPatterns,
  addEffect,
  removeEffect,
  moveEffect,
  clearRack,
  clearEffects,
  rebuildRack,
  rebuildAllRacks,
  effectNodes,
  moduleInput,
  rackSource,
  rackDestination,
  getContext,
  getMaster,
  getChainOutput,
  start: () => {
    state.isPlaying = true;
    startScheduler(0);
    rafId = window.requestAnimationFrame(playheadLoop);
    refreshUI();
  },
  stop: () => {
    state.isPlaying = false;
    stopScheduler();
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    rafId = null;
    state.currentStep = 0;
    refreshUI();
  },
};

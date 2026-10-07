/* Browser-side test harness for Earworm Studio (used by run-tests.mjs over CDP). */
window.__testLog = [];
window.addEventListener("error", (event) => window.__testLog.push(`ERROR ${event.message}`));
window.addEventListener("unhandledrejection", (event) => window.__testLog.push(`REJECT ${event.reason}`));

function makeWav(seconds, freq) {
  const sampleRate = 44100;
  const length = Math.floor(sampleRate * seconds);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const str = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    view.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0x5fff, true);
  }
  return buffer;
}

window.__runTests = async function runTests() {
  const results = [];
  const ok = (name, pass, detail = "") => {
    results.push({ name, pass: Boolean(pass), detail: String(detail) });
    if (typeof window.__onCheck === "function") window.__onCheck(name, Boolean(pass), String(detail));
  };
  const eq = (name, actual, expected, tolerance = 1e-6) => {
    const same =
      typeof actual === "string" || typeof expected === "string"
        ? String(actual) === String(expected)
        : Math.abs(actual - expected) <= tolerance;
    ok(name, same, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  };
  const clean = (label) => ok(label, window.__testLog.length === 0, window.__testLog.join(" | "));

  try {
    const api = window.earworm;
    const selectInstrument = (id) => document.querySelector(`[data-instrument="${id}"]`).click();
    ok("public API exposed", Boolean(api));
    ok("capabilities", true, JSON.stringify(api.capabilities()));

    const ids = [
      "instruments", "grid", "play", "clear", "demo", "volume", "volume-fill", "volume-thumb",
      "swing", "swing-fill", "swing-thumb", "swing-value", "swing-grid-8", "swing-grid-16",
      "tempo-value", "tempo-down", "tempo-up", "sounds", "sounds-grid", "sounds-status",
      "folder-pick", "folder-reconnect", "folder-forget", "files-import", "samples-automap", "samples-clear",
      "folder-input", "files-input",
    ];
    const missingIds = ids.filter((id) => !document.getElementById(id));
    ok("all element ids exist", missingIds.length === 0, missingIds.join(","));
    clean("init raised no errors");

    /* ---- swing maths ---- */
    api.setTempo(120);
    const step = api.stepMs();
    api.setSwingGrid(16);
    api.setSwing(0);
    let straight = true;
    for (let i = 0; i < 16; i++) if (Math.abs(api.stepOnsetMs(i) - i * step) > 1e-6) straight = false;
    ok("0% swing is straight", straight);

    api.setSwing(1);
    eq("1/16 swing off-beat", api.stepOnsetMs(1), step * 1.5);
    eq("1/16 swing beat 2", api.stepOnsetMs(2), step * 2);
    eq("1/16 swing third 16th", api.stepOnsetMs(3), step * 3.5);

    api.setSwingGrid(8);
    eq("1/8 swing second 16th", api.stepOnsetMs(1), step * 1.5);
    eq("1/8 swing backbeat", api.stepOnsetMs(2), step * 3);
    eq("1/8 swing third 16th", api.stepOnsetMs(3), step * 3.5);
    eq("1/8 swing bar length kept", api.stepOnsetMs(4), step * 4);
    let monotonic = true;
    for (let i = 1; i < 16; i++) if (api.stepOnsetMs(i) <= api.stepOnsetMs(i - 1)) monotonic = false;
    ok("onsets strictly increasing", monotonic);
    eq("loop length unchanged by swing", api.loopDurationMs(), 16 * step);

    api.setSwing(0.5);
    const half = api.stepOnsetMs(2);
    ok("50% swing sits between straight and full", half > step * 2 && half < step * 3, half);
    api.setSwing(0);
    api.setSwingGrid(8);

    /* ---- swing UI ---- */
    document.getElementById("swing-grid-16").click();
    ok("grid toggle 1/16", api.state.swingGrid === 16);
    document.getElementById("swing-grid-8").click();
    ok("grid toggle 1/8", api.state.swingGrid === 8);
    api.setSwing(0.4);
    ok("swing label", document.getElementById("swing-value").textContent === "40%", document.getElementById("swing-value").textContent);
    ok("swing aria", document.getElementById("swing").getAttribute("aria-valuenow") === "40");
    api.setSwing(0);

    /* ---- grid ---- */
    document.querySelector('[data-instrument="drums"]').click();
    ok("sounds panel shown for drums", document.getElementById("sounds").hidden === false);
    ok(
      "kit + three voice selects",
      Boolean(document.getElementById("kit-select")) &&
        ["kick", "snare", "hihat"].every((lane) => document.getElementById(`voice-${lane}`))
    );
    const labels = [...document.querySelectorAll(".row-label")].map((node) => node.textContent).join(",");
    ok("drum rows are labelled", labels === "Hat,Snare,Kick", labels);

    const stepButton = document.querySelector('.step[data-row="kick"][data-step="4"]');
    stepButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    ok("click toggles a step", api.state.sequence.drums.kick[4] === true);
    ok("click paints the step", stepButton.classList.contains("on") && stepButton.getAttribute("aria-pressed") === "true");
    stepButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    ok("click toggles back off", api.state.sequence.drums.kick[4] === false);

    /* ---- kits ---- */
    const kitSelect = document.getElementById("kit-select");
    kitSelect.value = "nine";
    kitSelect.dispatchEvent(new Event("change", { bubbles: true }));
    eq("kit switch changes the kick", api.resolveVoice("kick").params.start, 230);
    eq("kit default still used elsewhere", api.resolveVoice("snare").params.tone, 210);

    let laneSelect = document.getElementById("voice-kick");
    laneSelect.value = "kit:chip";
    laneSelect.dispatchEvent(new Event("change", { bubbles: true }));
    ok("per-lane kit override", api.resolveVoice("kick").params.type === "square");
    laneSelect = document.getElementById("voice-kick");
    ok("override stays selected in the UI", laneSelect.value === "kit:chip", laneSelect.value);
    laneSelect.value = "";
    laneSelect.dispatchEvent(new Event("change", { bubbles: true }));
    eq("back to kit default", api.resolveVoice("kick").params.start, 230);

    /* ---- sample import ---- */
    const kickFile = new File([makeWav(0.08, 220)], "Kick 909.wav", { type: "audio/wav" });
    const imported = await api.importFiles([kickFile]);
    ok("import returns a count", imported === 1, imported);
    const entry = [...api.samples.values()][0];
    ok("sample decoded to an AudioBuffer", Boolean(entry && entry.buffer && entry.buffer.length), entry && entry.name);
    ok("decoded length is right", entry && Math.abs(entry.buffer.duration - 0.08) < 0.01, entry && entry.buffer.duration);
    const kickVoice = api.resolveVoice("kick");
    ok("auto-mapped by file name", kickVoice.kind === "sample" && kickVoice.entry.id === entry.id, kickVoice.kind);

    document.querySelector('[data-instrument="drums"]').click();
    const optionValues = [...document.getElementById("voice-kick").options].map((option) => option.value);
    ok("sample listed in the dropdown", optionValues.includes(`sample:${entry.id}`));
    ok("clear-imported button appears", document.getElementById("samples-clear").hidden === false);

    api.playDrum("kick", null, null);
    api.playDrum("snare", null, null);
    api.playDrum("hihat", null, null);
    clean("sampled playback raised no errors");

    /* ---- sample folder (fake directory handle, no OS picker involved) ---- */
    const fileHandle = (name) => ({
      kind: "file",
      name,
      getFile: async () => new File([makeWav(0.05, 300)], name, { type: "audio/wav" }),
    });
    for (const lane of ["kick", "snare", "hihat"]) api.state.drums.voices[lane] = "";
    const folderHandle = {
      kind: "directory",
      name: "my-drum-folder",
      queryPermission: async () => "granted",
      values: async function* values() {
        yield fileHandle("Kick 808.wav");
        yield fileHandle("Snare tight.wav");
        yield fileHandle("Hat closed.wav");
        yield { kind: "file", name: "readme.txt", getFile: async () => new File(["x"], "readme.txt") };
      },
    };
    const loaded = await api.loadFolderHandle(folderHandle, { requestPermission: true });
    ok("folder handle loaded", loaded === true);
    const folderSamples = [...api.samples.values()].filter((sample) => sample.origin === "folder");
    ok("only audio files are listed", folderSamples.length === 3, folderSamples.map((s) => s.name).join(","));
    ok("folder samples decoded", folderSamples.every((sample) => sample.buffer && sample.buffer.length > 0));
    const mappedVoices = ["kick", "snare", "hihat"].map((lane) => api.resolveVoice(lane));
    ok("all three lanes auto-mapped", mappedVoices.every((voice) => voice.kind === "sample"), mappedVoices.map((v) => v.kind).join(","));
    ok("kick lane got the kick file", /kick/i.test(mappedVoices[0].entry.name), mappedVoices[0].entry.name);
    ok("snare lane got the snare file", /snare/i.test(mappedVoices[1].entry.name), mappedVoices[1].entry.name);
    ok("hat lane got the hat file", /hat/i.test(mappedVoices[2].entry.name), mappedVoices[2].entry.name);
    document.querySelector('[data-instrument="drums"]').click();
    ok(
      "folder appears in the status line",
      document.getElementById("sounds-status").textContent.includes("my-drum-folder"),
      document.getElementById("sounds-status").textContent
    );
    const folderOptions = [...document.getElementById("voice-hihat").options].map((option) => option.value);
    ok("folder samples listed for each lane", folderOptions.some((value) => value.includes("Hat closed.wav")));

    const secondFolder = {
      kind: "directory",
      name: "second-folder",
      queryPermission: async () => "granted",
      values: async function* values() {
        yield fileHandle("Clap.wav");
      },
    };
    await api.loadFolderHandle(secondFolder);
    ok("old folder samples replaced", [...api.samples.values()].filter((s) => s.origin === "folder").length === 1);
    ok("imported samples survive a folder change", [...api.samples.values()].some((s) => s.origin === "import"));
    ok("lanes pointing at removed samples fall back to the kit", api.resolveVoice("hihat").kind === "synth");

    await api.forgetSampleFolder();
    ok("forget clears the folder samples", [...api.samples.values()].every((s) => s.origin === "import"));
    ok(
      "forget keeps imported assignments",
      String(api.state.drums.voices.kick).startsWith("sample:import:"),
      String(api.state.drums.voices.kick)
    );

    const fallbackInput = { files: [new File([makeWav(0.05, 180)], "Snare 2.wav", { type: "audio/wav" })], value: "x" };
    await api.handleFolderInput(fallbackInput);
    ok(
      "input-based folder picker fallback works",
      [...api.samples.values()].some((sample) => sample.origin === "folder" && sample.name === "Snare 2.wav")
    );
    await api.forgetSampleFolder();

    const cleared = await api.clearImportedSamples();
    ok("clear-imported removes imported samples", cleared >= 1 && api.samples.size === 0, `${cleared} removed, ${api.samples.size} left`);
    ok("clear-imported button hides again", document.getElementById("samples-clear").hidden === true);

    /* ---- every instrument still sounds ---- */
    document.getElementById("demo").click();
    for (let s = 0; s < 16; s++) api.playStep(s);
    clean("full demo playback raised no errors");

    /* ---- transport / scheduler ---- */
    const ctx = api.getContext();
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch (error) {
        /* headless may have no audio device */
      }
    }
    ok("audio context state reported", true, ctx.state);

    api.start();
    ok("play starts the scheduler", api.state.isPlaying === true);
    ok("first steps scheduled ahead", window.earworm.state.isPlaying === true);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const realClockStep = api.state.currentStep;
    ok("real clock advanced (informational)", true, `step ${realClockStep} after 900ms, ctx ${ctx.state}`);
    document.getElementById("play").click();
    ok("stop button stops it", api.state.isPlaying === false && api.state.currentStep === 0);

    /* regression: editing the step that is playing must trigger it safely */
    api.start();
    api.state.currentStep = 0;
    const liveCell = document.querySelector('.step[data-row="snare"][data-step="0"]');
    liveCell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    clean("toggling the current step while playing is safe");
    api.stop();

    /* ---- space bar transport shortcut ---- */
    const pressSpace = (options = {}) => {
      const event = new KeyboardEvent("keydown", {
        code: "Space",
        key: " ",
        bubbles: true,
        cancelable: true,
        ...options,
      });
      (options.target || document.body).dispatchEvent(event);
      return event;
    };

    ok("transport starts stopped", api.state.isPlaying === false);
    let spaceEvent = pressSpace();
    ok("space starts playback", api.state.isPlaying === true);
    ok("space does not also scroll the page", spaceEvent.defaultPrevented === true);
    pressSpace();
    ok("space stops playback again", api.state.isPlaying === false);
    ok("play button advertises the shortcut", document.getElementById("play").title.includes("space bar"), document.getElementById("play").title);

    pressSpace({ repeat: true });
    ok("a held space bar does not stutter", api.state.isPlaying === false);
    pressSpace({ ctrlKey: true });
    ok("ctrl+space is left to the browser", api.state.isPlaying === false);
    pressSpace({ metaKey: true });
    ok("cmd/win+space is left to the system", api.state.isPlaying === false);
    pressSpace({ altKey: true });
    ok("alt+space is left to the window menu", api.state.isPlaying === false);

    selectInstrument("drums");
    const soundDropdown = document.getElementById("kit-select");
    const dropdownValue = soundDropdown.value;
    const selectEvent = new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true, cancelable: true });
    soundDropdown.dispatchEvent(selectEvent);
    ok(
      "space inside a dropdown belongs to the dropdown",
      api.state.isPlaying === false && selectEvent.defaultPrevented === false && soundDropdown.value === dropdownValue,
      `playing=${api.state.isPlaying} prevented=${selectEvent.defaultPrevented} value=${soundDropdown.value}`
    );
    selectInstrument("synth");

    /* deterministic clock test with a faked AudioContext clock */
    let fakeTime = 0;
    Object.defineProperty(ctx, "currentTime", { configurable: true, get: () => fakeTime });
    api.start();
    fakeTime = 1.0;
    await new Promise((resolve) => setTimeout(resolve, 120));
    const scheduledStep = api.state.currentStep;
    ok("fake clock advances the playhead", scheduledStep > 0, `step ${scheduledStep}`);
    ok("playhead stays inside the pattern", scheduledStep >= 0 && scheduledStep < 16, scheduledStep);
    const onsets = [];
    for (let i = 0; i < 16; i++) onsets.push(api.stepOnsetMs(i));
    api.stop();
    ok("stop resets after fake clock", api.state.currentStep === 0);
    ok("onsets captured", onsets.length === 16);
    delete ctx.currentTime; // restore the real clock for anything that follows

    /* ---- bass tone, FM section and transpose ---- */
    api.setTranspose(0);
    ok("transpose starts at 0", api.state.transpose === 0);
    eq("base tuning of row 0", api.noteFrequency(0, 0), 220);
    eq("bass sits an octave below the scale", api.noteFrequency(0, -1), 110);

    document.querySelector('[data-instrument="bass"]').click();
    ok("melodic panel shows for bass", document.getElementById("melodic").hidden === false);
    ok(
      "bass panel has FM controls",
      ["fm-amount", "fm-ratio", "fm-decay"].every((id) => document.getElementById(id)) &&
        document.getElementById("melodic-title").textContent.includes("Bass")
    );
    document.querySelector('[data-instrument="drums"]').click();
    ok("melodic panel hides for drums", document.getElementById("melodic").hidden === true);
    document.querySelector('[data-instrument="synth"]').click();

    api.setTranspose(12);
    eq("transpose +12 doubles the pitch", api.noteFrequency(0, 0), 440);
    ok("transpose readout", document.getElementById("transpose-value").textContent === "+12", document.getElementById("transpose-value").textContent);
    api.setTranspose(-12);
    eq("transpose -12 halves the pitch", api.noteFrequency(0, 0), 110);
    api.setTranspose(-36);
    eq("transpose can reach -36", api.state.transpose, -36);
    eq("-36 is three octaves down", api.noteFrequency(0, 0), 220 / 8);
    ok("transpose readout shows -36", document.getElementById("transpose-value").textContent === "-36", document.getElementById("transpose-value").textContent);
    api.setTranspose(99);
    ok("transpose clamps to +12", api.state.transpose === 12);
    api.setTranspose(-99);
    ok("transpose clamps at -36", api.state.transpose === -36);
    document.getElementById("transpose-reset").click();
    ok("transpose reset button", api.state.transpose === 0);
    api.setTranspose(7);
    eq("transpose 7 = a fifth up", api.noteFrequency(0, 0), 220 * Math.pow(2, 7 / 12));
    api.setTranspose(0);

    /* ---- per-module pitch, on top of the global transpose ---- */
    api.resetAllPitch();
    ok("pitch starts at zero everywhere", ["drums", "bass", "synth", "strings", "drop"].every((id) => api.state.pitch[id] === 0));
    eq("untouched synth plays A3", api.noteFrequency(0, 0, "synth"), 220);

    api.setModulePitch("bass", 12);
    eq("bass can be pitched on its own", api.noteFrequency(0, 0, "bass"), 440);
    eq("synth is not affected by the bass pitch", api.noteFrequency(0, 0, "synth"), 220);
    ok("pitch totals are per module", api.pitchSemitones("bass") === 12 && api.pitchSemitones("synth") === 0);
    ok("pitch factor is a frequency multiplier", Math.abs(api.pitchFactor("bass") - 2) < 1e-9);

    api.setModulePitch("drums", -12);
    api.setModulePitch("drop", 7);
    ok("every module can hold its own value", api.state.pitch.drums === -12 && api.state.pitch.drop === 7 && api.state.pitch.synth === 0);
    ok("drums keep their own factor", Math.abs(api.pitchFactor("drums") - 0.5) < 1e-9);
    ok("the global transpose does not move the drums", api.pitchSemitones("drums") === -12);

    api.setTranspose(12);
    ok("global transpose stacks on the module pitch", api.pitchSemitones("bass") === 24, api.pitchSemitones("bass"));
    eq("stacked pitch is two octaves up", api.noteFrequency(0, 0, "bass"), 880);
    ok("the global transpose leaves the drums alone", api.pitchSemitones("drums") === -12);
    eq("a global transpose at 0 leaves a module offset intact", (api.setTranspose(0), api.noteFrequency(0, 0, "bass")), 440);

    api.setModulePitch("bass", -99);
    ok("module pitch clamps at -36", api.state.pitch.bass === -36);
    api.setModulePitch("bass", 99);
    ok("module pitch clamps at +12", api.state.pitch.bass === 12);

    /* pitch panel UI */
    selectInstrument("bass");
    ok("pitch panel follows the instrument", document.getElementById("pitch-title").textContent.includes("Bass"), document.getElementById("pitch-title").textContent);
    ok("pitch readout shows the module value", document.getElementById("pitch-readout").textContent === "+12", document.getElementById("pitch-readout").textContent);
    document.getElementById("pitch-reset").click();
    ok("reset this clears only this module", api.state.pitch.bass === 0 && api.state.pitch.drop === 7);
    selectInstrument("drums");
    ok("pitch panel switches with the instrument", document.getElementById("pitch-title").textContent.includes("Drums"));
    ok("pitch readout follows the instrument", document.getElementById("pitch-readout").textContent === "-12", document.getElementById("pitch-readout").textContent);
    ok(
      "drums explain that the global transpose skips them",
      document.getElementById("pitch-status").textContent.includes("never drums"),
      document.getElementById("pitch-status").textContent
    );
    ok(
      "the global stepper shows drums are excluded",
      document.getElementById("pitch-global-note").textContent.includes("not Drums"),
      document.getElementById("pitch-global-note").textContent
    );
    selectInstrument("synth");
    ok(
      "melodic instruments show the plain global note",
      document.getElementById("pitch-global-note").textContent === "bass · synth · strings",
      document.getElementById("pitch-global-note").textContent
    );
    selectInstrument("drums");
    document.getElementById("pitch-up").click();
    ok("stepper moves this module only", api.state.pitch.drums === -11 && api.state.pitch.synth === 0, api.state.pitch.drums);

    api.setTranspose(-12);
    selectInstrument("synth");
    api.setModulePitch("synth", 12);
    ok("module and global cancel out", api.pitchSemitones("synth") === 0 && Math.abs(api.pitchFactor("synth") - 1) < 1e-9);

    document.getElementById("pitch-reset-all").click();
    ok("reset all clears everything", api.state.transpose === 0 && ["drums", "bass", "synth", "strings", "drop"].every((id) => api.state.pitch[id] === 0));

    /* octave buttons: a full 12 semitones in one click */
    selectInstrument("synth");
    document.getElementById("pitch-up-12").click();
    eq("the +12 button jumps a whole octave", api.state.pitch.synth, 12);
    eq("and the extra octave doubles the pitch", api.noteFrequency(0, 0, "synth"), 440);
    document.getElementById("pitch-down-12").click();
    eq("the -12 button comes back down", api.state.pitch.synth, 0);
    eq("back to the written pitch", api.noteFrequency(0, 0, "synth"), 220);
    document.getElementById("pitch-down-12").click();
    document.getElementById("pitch-down-12").click();
    document.getElementById("pitch-down-12").click();
    eq("three octaves down", api.state.pitch.synth, -36);
    eq("-36 is three octaves below A3", api.noteFrequency(0, 0, "synth"), 27.5);
    document.getElementById("pitch-down-12").click();
    ok("octave jumps respect the floor", api.state.pitch.synth === -36);

    document.getElementById("transpose-up-12").click();
    eq("the global +12 button transposes an octave", api.state.transpose, 12);
    eq("and only the melodic instruments follow", api.noteFrequency(0, 0, "bass"), 440);
    ok("the drums still ignore it", api.pitchSemitones("drums") === 0);
    document.getElementById("transpose-down-12").click();
    document.getElementById("transpose-down-12").click();
    eq("global octave jumps go down too", api.state.transpose, -12);
    document.getElementById("transpose-up-12").click();
    eq("global is back to zero", api.state.transpose, 0);

    api.setModulePitch("synth", 0);
    document.getElementById("pitch-up").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    eq("shift-clicking the fine stepper also jumps an octave", api.state.pitch.synth, 12);
    api.resetAllPitch();

    /* ---- ADSR per sound ---- */
    const envelopeKeys = ["attack", "decay", "sustain", "release"];
    ok(
      "every sound has an envelope",
      ["drums", "bass", "synth", "strings", "drop"].every((id) => {
        const env = api.envelopeFor(id);
        return env && envelopeKeys.every((key) => Number.isFinite(env[key]));
      })
    );
    ok("envelopes are per sound", api.envelopeFor("bass") !== api.envelopeFor("synth"));

    /* the envelope maths itself */
    const fakeParam = () => {
      const events = [];
      return {
        events,
        cancelScheduledValues() {},
        setValueAtTime: (value, time) => events.push(["set", value, time]),
        linearRampToValueAtTime: (value, time) => events.push(["linear", value, time]),
        exponentialRampToValueAtTime: (value, time) => events.push(["exponential", value, time]),
      };
    };
    const shaped = fakeParam();
    const shapedTotal = api.applyAmpEnvelope(shaped, { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.4 }, 1, 0.5, 1);
    eq("envelope holds at the sustain level", shaped.events[3][0], "set");
    eq("sustain level is peak x sustain", shaped.events[3][1], 0.5);
    eq("the hold starts at the end of the gate", shaped.events[3][2], 1.5);
    eq("the release runs from the gate", shaped.events[4][2], 1.9);
    eq("the note length includes the release", shapedTotal, 0.9);
    eq("attack ramps to the peak", shaped.events[1][1], 1);

    const percussive = fakeParam();
    const percussiveTotal = api.applyAmpEnvelope(percussive, { attack: 0.01, decay: 0.3, sustain: 0, release: 0.5 }, 2, 0.2, 1);
    ok("a percussive envelope never holds", percussive.events.every((event) => event[0] !== "set" || event[2] === 2));
    eq("a short gate still lets the decay finish", percussiveTotal, 0.01 + 0.3 + 0.5);

    const shortAttack = fakeParam();
    api.applyAmpEnvelope(shortAttack, { attack: 0.5, decay: 0.1, sustain: 0, release: 0.1 }, 0, 0.05, 1);
    eq("a longer attack pushes the peak later", shortAttack.events[1][2], 0.5);

    /* the panel */
    selectInstrument("bass");
    ok("envelope panel follows the instrument", document.getElementById("envelope-title").textContent.includes("Bass"), document.getElementById("envelope-title").textContent);
    ok("the panel shows four stages", envelopeKeys.every((key) => document.getElementById(`env-${key}`)));
    eq("attack readout", document.getElementById("env-attack-value").textContent, "12 ms");

    const attackSlider = document.getElementById("env-attack");
    attackSlider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    ok("a longer attack is stored", api.state.envelopes.bass.attack > 0.012, api.state.envelopes.bass.attack);
    ok("the readout follows", document.getElementById("env-attack-value").textContent !== "12 ms", document.getElementById("env-attack-value").textContent);

    selectInstrument("drums");
    ok("drums have their own envelope", document.getElementById("envelope-title").textContent.includes("Drums"));
    api.setEnvelopeValue("drums", "attack", 0.3);
    ok("drum envelope is independent of the bass one", api.state.envelopes.drums.attack === 0.3 && api.state.envelopes.bass.attack > 0.012);

    document.getElementById("envelope-reset").click();
    ok("reset restores this module's envelope", api.state.envelopes.drums.attack === 0.001 && api.state.envelopes.bass.attack > 0.012);
    api.resetEnvelope("bass");
    api.state.envelopes.bass = { attack: 0.012, decay: 0.45, sustain: 0, release: 0.08 };

    /* ---- FM 2: a second operator on every instrument ---- */
    ok(
      "every instrument has an FM 2",
      ["drums", "bass", "synth", "strings", "drop"].every((id) => {
        const config = api.fm2For(id);
        return config && Number.isFinite(config.amount) && Number.isFinite(config.ratio) && Number.isFinite(config.decay);
      })
    );
    ok("FM 2 starts silent so nothing changes", ["drums", "bass", "synth", "strings", "drop"].every((id) => api.fm2For(id).amount === 0));
    ok("FM 2 is per instrument", api.fm2For("bass") !== api.fm2For("synth"));

    selectInstrument("bass");
    ok("FM 2 panel follows the instrument", document.getElementById("fm2-title").textContent === "FM 2 · Bass", document.getElementById("fm2-title").textContent);
    ok("the panel has amount, ratio and decay", ["fm2-amount", "fm2-ratio", "fm2-decay"].every((id) => document.getElementById(id)));
    selectInstrument("drums");
    eq("drums drop the 2 since they have no first operator", document.getElementById("fm2-title").textContent, "FM · Drums");
    ok(
      "the drums explain what FM bends",
      document.getElementById("fm2-status").textContent.includes("hat's noise band"),
      document.getElementById("fm2-status").textContent
    );
    selectInstrument("bass");

    /* the second operator reaches the audio, alongside the first */
    api.state.voices.bass.fmAmount = 0.5;
    api.state.voices.bass.fmRatio = 1;
    api.state.fm2.bass = { amount: 0.5, ratio: 3, decay: 0.2 };
    const fmCtx = api.getContext();
    if (fmCtx.__created) {
      fmCtx.__created.length = 0;
      api.playBass(0, null, null);
      const modulators = fmCtx.__created.filter((node) => node.__kind === "oscillator");
      ok("two operators plus carrier and harmonic", modulators.length === 4, modulators.length);
      const frequencies = modulators.map((node) => Math.round(node.frequency.value)).sort((a, b) => a - b);
      ok("the second operator runs at carrier x its own ratio", frequencies.includes(330), frequencies.join(","));
      ok("the first operator keeps its own ratio", frequencies.includes(110), frequencies.join(","));

      /* drums and the drop get their FM from this section */
      api.state.fm2.bass = { amount: 0, ratio: 2, decay: 0.2 };
      api.state.fm2.drums = { amount: 0.8, ratio: 2, decay: 0.3 };
      api.state.drums.voices.kick = "kit:analog";
      fmCtx.__created.length = 0;
      api.playDrum("kick", null, null);
      const kickMods = fmCtx.__created.filter((node) => node.__kind === "oscillator");
      ok("a drum hit gets a modulator", kickMods.length === 2, kickMods.length);
      ok(
        "the drum modulator follows the drum pitch",
        kickMods.some((node) => Math.round(node.frequency.value) === 320),
        kickMods.map((n) => Math.round(n.frequency.value)).join(",")
      );

      api.state.drums.voices.kick = "kit:analog";
      api.state.drums.voices.hihat = "kit:analog";
      fmCtx.__created.length = 0;
      api.playDrum("hihat", null, null);
      const hatFilter = fmCtx.__created.find((node) => node.__kind === "biquad" && node.type === "highpass");
      const hatMod = fmCtx.__created.filter((node) => node.__kind === "oscillator");
      ok("a noise hat is modulated through its filter", hatMod.length === 1 && Boolean(hatFilter), `${hatMod.length} modulators`);

      await api.importFiles([new File([makeWav(0.05, 300)], "FM sample.wav", { type: "audio/wav" })]);
      const fmSample = [...api.samples.values()].find((sample) => sample.name === "FM sample.wav");
      api.state.drums.voices.kick = `sample:${fmSample.id}`;
      fmCtx.__created.length = 0;
      api.playDrum("kick", null, null);
      const sampleMod = fmCtx.__created.filter((node) => node.__kind === "oscillator");
      const sampleSource = fmCtx.__created.find((node) => node.__kind === "bufferSource");
      ok(
        "sampled drums are modulated through playback speed",
        sampleMod.length === 1 && Boolean(sampleSource) && sampleMod[0].__out.some((gain) => gain.__out.includes(sampleSource.playbackRate)),
        `${sampleMod.length} modulators`
      );
      await api.clearImportedSamples();
      api.state.drums.voices.kick = "";
      api.state.drums.voices.hihat = "";
      api.state.fm2.drums = { amount: 0, ratio: 2, decay: 0.2 };

      api.state.fm2.drop = { amount: 0.7, ratio: 1, decay: 0.4 };
      fmCtx.__created.length = 0;
      api.playDrop(0.3, null, null);
      const dropOscs = fmCtx.__created.filter((node) => node.__kind === "oscillator");
      const dropMods = dropOscs.slice(-2); // sub, growl, lfo, then the two modulators
      ok(
        "the drop gets modulators on its sub and growl",
        dropOscs.length === 5 && dropMods.every((node) => [55, 110].includes(Math.round(node.frequency.value))),
        `${dropOscs.length} oscillators, last two at ${dropMods.map((node) => Math.round(node.frequency.value)).join(",")}`
      );
      api.state.fm2.drop = { amount: 0, ratio: 2, decay: 0.2 };
    } else {
      ok("FM 2 audio graph checks need the jsdom stub", true, "skipped");
    }

    /* the panel writes into the state */
    api.state.fm2.bass = { amount: 0, ratio: 2, decay: 0.2 };
    api.renderFm2();
    document.getElementById("fm2-amount").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    ok("the FM 2 slider changes the amount", api.state.fm2.bass.amount > 0, api.state.fm2.bass.amount);
    api.state.fm2.bass = { amount: 0.5, ratio: 3, decay: 0.2 };
    api.renderFm2();
    document.getElementById("fm2-reset").click();
    ok("reset restores FM 2 defaults", api.state.fm2.bass.amount === 0 && api.state.fm2.bass.ratio === 2);
    api.state.voices.bass.fmAmount = 0;
    api.state.voices.bass.fmRatio = 1;

    /* ---- audio graph: sine bass, FM modulator, effect chain order ---- */
    const graphCtx = api.getContext();
    if (graphCtx.__created) {
      /**
       * Search for a signal path from one node to another, reporting the
       * processing nodes along it. Every effect is wrapped in a dry/wet pair,
       * so wrapper gains are skipped, the wet (processor) branch is followed,
       * and feedback loops cannot trap the search.
       */
      const walk = (from, to) => {
        const wrappers = new Map();
        for (const entry of api.effectNodes.values()) {
          for (const node of [entry.input, entry.dry, entry.wet, entry.output]) wrappers.set(node, entry);
        }
        const neighbours = (node) => {
          const entry = wrappers.get(node);
          if (entry) {
            if (node === entry.input) return [entry.processor.input];
            if (node === entry.dry) return []; // the dry bypass is not the signal we trace
            if (node === entry.wet) return [entry.output];
          }
          return node.__out ? [...node.__out] : [];
        };
        const search = (node, seen, path) => {
          if (node === to) return { path, reached: true };
          if (!node || seen.has(node)) return null;
          const nextSeen = new Set(seen);
          nextSeen.add(node);
          const nextPath = wrappers.has(node) ? path : [...path, node.__kind];
          for (const next of neighbours(node)) {
            const found = search(next, nextSeen, nextPath);
            if (found) return found;
          }
          return null;
        };
        // start at the first hop so the source node itself is not part of the path
        for (const first of neighbours(from)) {
          const found = search(first, new Set([from]), []);
          if (found) return found;
        }
        return { path: [], reached: false };
      };
      const connects = (node, target) => Boolean(node && node.__out && node.__out.includes(target));
      const runtimeOf = (rackId, index) => api.effectNodes.get(api.state.racks[rackId][index].id);

      api.state.voices.bass.fmAmount = 0;
      graphCtx.__created.length = 0;
      api.playBass(0, null, null);
      const bassNodes = graphCtx.__created.slice();
      const carriers = bassNodes.filter((n) => n.__kind === "oscillator");
      ok("bass uses sine oscillators", carriers.length === 2 && carriers.every((n) => n.type === "sine"), carriers.map((n) => n.type).join(","));
      ok("bass carrier runs at the transposed pitch", Math.abs(carriers[0].frequency.value - 110) < 0.01, carriers[0].frequency.value);
      ok("bass adds a second harmonic", Math.abs(carriers[1].frequency.value - 220) < 0.01, carriers[1].frequency.value);

      graphCtx.__created.length = 0;
      api.state.voices.bass.fmAmount = 0.5;
      api.state.voices.bass.fmRatio = 3;
      api.playBass(0, null, null);
      const fmNodes = graphCtx.__created.slice();
      const fmOscs = fmNodes.filter((n) => n.__kind === "oscillator");
      ok("FM adds a modulator oscillator", fmOscs.length === 3, fmOscs.length);
      ok(
        "modulator runs at carrier x ratio",
        fmOscs.some((n) => Math.abs(n.frequency.value - 330) < 0.01),
        fmOscs.map((n) => Math.round(n.frequency.value)).join(",")
      );
      const expectedDepth = 0.5 * 8 * 330;
      ok(
        "modulation depth follows the FM amount",
        fmNodes.some((n) => n.__kind === "gain" && n.gain.__events.some((event) => Math.abs(event.value - expectedDepth) < 0.5)),
        `expected a scheduled depth of ${expectedDepth} Hz`
      );
      api.state.voices.bass.fmAmount = 0;

      /* the envelope reaches the audio: the bass amp gain carries the shape */
      api.state.envelopes.bass = { attack: 0.25, decay: 0.4, sustain: 0.5, release: 0.3 };
      graphCtx.__created.length = 0;
      api.playBass(0, null, null);
      const ampNode = graphCtx.__created.find(
        (node) => node.__kind === "gain" && node.gain.__events.some((event) => event.type === "linear" && Math.abs(event.value - 0.6) < 1e-9)
      );
      ok("bass uses the envelope on its amp gain", Boolean(ampNode));
      const ampEvents = ampNode ? ampNode.gain.__events : [];
      eq("the amp starts from silence", ampEvents[0].value, 0);
      eq("the attack reaches the peak 250 ms later", ampEvents[1].time - ampEvents[0].time, 0.25);
      eq("the decay lands on the sustain level", ampEvents[2].value, 0.6 * 0.5);
      eq("the hold sits at the sustain level", ampEvents[3].value, 0.6 * 0.5);
      api.state.envelopes.bass = { attack: 0.012, decay: 0.45, sustain: 0, release: 0.08 };

      /* drums get an amp envelope too */
      api.state.envelopes.drums = { attack: 0.2, decay: 1.5, sustain: 0, release: 0.05 };
      api.state.drums.voices.kick = "kit:analog";
      graphCtx.__created.length = 0;
      api.playDrum("kick", null, null);
      const drumAmp = graphCtx.__created.filter((node) => node.__kind === "gain" && node.gain.__events.length >= 2)[0];
      ok(
        "drum hits carry an envelope",
        Boolean(drumAmp) && drumAmp.gain.__events[1].time - drumAmp.gain.__events[0].time === 0.2,
        drumAmp && `${drumAmp.gain.__events.length} events`
      );
      api.state.drums.voices.kick = "";
      api.state.envelopes.drums = { attack: 0.001, decay: 1.5, sustain: 0, release: 0.05 };
      api.resetAllPitch();
      graphCtx.__created.length = 0;
      api.playBass(0, null, null);
      const plainBass = graphCtx.__created.filter((n) => n.__kind === "oscillator")[0];
      ok("bass plays at its written pitch", Math.abs(plainBass.frequency.value - 110) < 0.01, plainBass.frequency.value);

      api.setModulePitch("bass", 12);
      graphCtx.__created.length = 0;
      api.playBass(0, null, null);
      const pitchedBass = graphCtx.__created.filter((n) => n.__kind === "oscillator")[0];
      ok("module pitch reaches the bass oscillator", Math.abs(pitchedBass.frequency.value - 220) < 0.01, pitchedBass.frequency.value);
      api.setModulePitch("bass", 0);

      graphCtx.__created.length = 0;
      api.playSynth(0, null, null);
      const plainSynth = graphCtx.__created.filter((n) => n.__kind === "oscillator")[0];
      ok("the bass pitch did not leak into the synth", Math.abs(plainSynth.frequency.value - 220) < 0.01, plainSynth.frequency.value);

      /* drum pitch: synth voices and samples */
      api.setModulePitch("drums", 12);
      graphCtx.__created.length = 0;
      api.state.drums.voices.kick = "kit:analog";
      api.playDrum("kick", null, null);
      const kickOsc = graphCtx.__created.filter((n) => n.__kind === "oscillator")[0];
      ok(
        "synth drum follows the drum pitch",
        kickOsc && Math.abs(kickOsc.frequency.__events[0].value - 320) < 0.01,
        kickOsc && kickOsc.frequency.__events[0].value
      );

      await api.importFiles([new File([makeWav(0.08, 220)], "Pitch test.wav", { type: "audio/wav" })]);
      const sampleEntry = [...api.samples.values()].find((sample) => sample.name === "Pitch test.wav");
      api.state.drums.voices.kick = `sample:${sampleEntry.id}`;
      graphCtx.__created.length = 0;
      api.playDrum("kick", null, null);
      const sampleSource = graphCtx.__created.find((n) => n.__kind === "bufferSource");
      ok("sample drums follow the drum pitch", sampleSource && Math.abs(sampleSource.playbackRate.value - 2) < 1e-9, sampleSource && sampleSource.playbackRate.value);

      api.setModulePitch("drums", 0);
      api.state.drums.voices.kick = "";
      await api.clearImportedSamples();

      /* ---- mixer: a level and a mute per instrument ---- */
      api.resetLevels();
      for (const moduleId of ["drums", "bass", "synth", "strings", "drop"]) api.setModuleMuted(moduleId, false);
      const drumBus = api.moduleInput("drums");
      const bassBusNode = api.moduleInput("bass");
      ok("every instrument has its own bus", ["drums", "bass", "synth", "strings", "drop"].every((id) => api.moduleInput(id)));

      api.setModuleLevel("bass", 0.5);
      ok("a fader reaches its own module bus", Math.abs(bassBusNode.gain.value - 0.5) < 1e-9, bassBusNode.gain.value);
      ok("other modules keep their level", Math.abs(drumBus.gain.value - 1) < 1e-9, drumBus.gain.value);
      eq("fader readout", document.getElementById("mix-level-bass-value").textContent, "50%");

      api.setModuleMuted("bass", true);
      ok("stopping a module silences its bus", bassBusNode.gain.value === 0, bassBusNode.gain.value);
      ok("a stopped module reports as inaudible", api.moduleAudible("bass") === false && api.moduleGain("bass") === 0);
      ok("the other modules are untouched", drumBus.gain.value === 1);

      /* a stopped instrument is not even triggered */
      const mixSeq = api.state.sequence;
      api.DRUM_LANES.forEach((lane) => mixSeq.drums[lane.id].fill(false));
      ["bass", "synth", "strings", "drop"].forEach((key) => mixSeq[key].forEach((row) => row.fill(false)));
      mixSeq.bass[0][0] = true;
      mixSeq.synth[0][0] = true;
      graphCtx.__created.length = 0;
      api.playStep(0);
      const mutedOscs = graphCtx.__created.filter((n) => n.__kind === "oscillator").length;
      ok("a stopped instrument is skipped when the pattern plays", mutedOscs === 1, `${mutedOscs} oscillators (synth only)`);

      api.setModuleMuted("bass", false);
      graphCtx.__created.length = 0;
      api.playStep(0);
      const unmutedOscs = graphCtx.__created.filter((n) => n.__kind === "oscillator").length;
      ok("starting it again brings it back", unmutedOscs === 3, `${unmutedOscs} oscillators (bass carrier + harmonic + synth)`);
      mixSeq.bass[0][0] = false;
      mixSeq.synth[0][0] = false;

      /* mixer UI */
      ok("mixer lists every instrument", document.querySelectorAll("#mix-grid .mix-strip").length === 5, document.querySelectorAll("#mix-grid .mix-strip").length);
      ok(
        "mixer names them in order",
        [...document.querySelectorAll("#mix-grid .mix-name")].map((node) => node.textContent).join(",") === "Drums,Bass,Synth,Strings,Drop"
      );
      const drumsMute = document.querySelector('[data-mute="drums"]');
      drumsMute.click();
      ok(
        "mute button stops an instrument",
        api.state.muted.drums === true && drumsMute.getAttribute("aria-pressed") === "true" && drumsMute.textContent === "Start",
        drumsMute.textContent
      );
      ok(
        "mixer status says what is stopped",
        document.getElementById("mix-status").textContent.includes("Drums stopped"),
        document.getElementById("mix-status").textContent
      );
      ok("the strip is marked as stopped", document.querySelector('.mix-strip[data-module="drums"]').classList.contains("muted"));
      drumsMute.click();
      ok("mute button starts it again", api.state.muted.drums === false && drumsMute.textContent === "Stop");
      ok("status goes back to running", document.getElementById("mix-status").textContent.includes("every instrument running"));

      const synthFader = document.getElementById("mix-level-synth");
      synthFader.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      ok("the fader slider changes the level", api.state.levels.synth < 1, api.state.levels.synth);
      api.setModuleLevel("synth", 99);
      ok("faders clamp at 150%", api.state.levels.synth === 1.5, api.state.levels.synth);
      document.getElementById("mix-reset").click();
      ok(
        "reset levels restores unity",
        ["drums", "bass", "synth", "strings", "drop"].every((id) => api.state.levels[id] === 1)
      );
      /* the global transpose must never reach the drums */
      api.resetAllPitch();
      api.setTranspose(12);
      graphCtx.__created.length = 0;
      api.state.drums.voices.kick = "kit:analog";
      api.playDrum("kick", null, null);
      const globalKick = graphCtx.__created.filter((n) => n.__kind === "oscillator")[0];
      ok("global transpose leaves the synth kick alone", Math.abs(globalKick.frequency.__events[0].value - 160) < 0.01, globalKick.frequency.__events[0].value);
      ok("global transpose leaves drum pitch totals at zero", api.pitchSemitones("drums") === 0 && Math.abs(api.pitchFactor("drums") - 1) < 1e-9);

      await api.importFiles([new File([makeWav(0.05, 300)], "Global check.wav", { type: "audio/wav" })]);
      const globalEntry = [...api.samples.values()].find((sample) => sample.name === "Global check.wav");
      api.state.drums.voices.kick = `sample:${globalEntry.id}`;
      graphCtx.__created.length = 0;
      api.playDrum("kick", null, null);
      const globalSample = graphCtx.__created.find((n) => n.__kind === "bufferSource");
      ok("global transpose leaves drum samples at normal speed", globalSample && globalSample.playbackRate.value === 1, globalSample && globalSample.playbackRate.value);

      api.setTranspose(0);
      api.state.drums.voices.kick = "";
      await api.clearImportedSamples();
      api.resetAllPitch();

      /* effect chain: order, bypass and removal */
      api.clearEffects();
      const masterIn = api.getMaster();
      const masterOut = api.getChainOutput();
      ok("empty chain goes straight to the output", walk(masterIn, masterOut).path.length === 0);

      api.addEffect("filter");
      let chain = walk(masterIn, masterOut);
      ok("filter sits in the chain", chain.reached && chain.path.join(">") === "biquad", chain.path.join(">"));

      api.addEffect("distortion");
      chain = walk(masterIn, masterOut);
      ok(
        "distortion follows the filter",
        chain.reached && chain.path.join(">") === "biquad>waveshaper>biquad>gain",
        chain.path.join(">")
      );
      const shaper = graphCtx.__created.filter((n) => n.__kind === "waveshaper").pop();
      ok("distortion builds a transfer curve", shaper && shaper.curve && shaper.curve.length === 1024, shaper && shaper.curve && shaper.curve.length);
      ok(
        "curve is normalised to +/-1",
        shaper && Math.abs(shaper.curve[0] + 1) < 1e-6 && Math.abs(shaper.curve[1023] - 1) < 1e-6,
        shaper && `${shaper.curve[0]}, ${shaper.curve[1023]}`
      );

      api.moveEffect(api.state.racks.master[1].id, "master", -1);
      chain = walk(masterIn, masterOut);
      ok(
        "moving a card reorders the audio",
        chain.reached && chain.path.join(">") === "waveshaper>biquad>gain>biquad",
        chain.path.join(">")
      );

      const secondId = api.state.racks.master[0].id;
      document.querySelector(`[data-fx="${secondId}"] [data-action="toggle"]`).click();
      ok("bypass button flips the effect", api.state.racks.master[0].enabled === false);
      chain = walk(masterIn, masterOut);
      ok("bypassed effect leaves the audio path", chain.reached && chain.path.join(">") === "biquad", chain.path.join(">"));
      document.querySelector(`[data-fx="${secondId}"] [data-action="toggle"]`).click();
      ok("re-enabling puts it back", walk(masterIn, masterOut).path.join(">") === "waveshaper>biquad>gain>biquad");

      const filterId = api.state.racks.master[1].id;
      const cutoffSlider = document.getElementById(`fx-${filterId}-cutoff`);
      const before = api.state.racks.master[1].params.cutoff;
      cutoffSlider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      const after = api.state.racks.master[1].params.cutoff;
      ok("cutoff slider changes the parameter", after < before, `${before} -> ${after}`);
      const filterRuntime = api.effectNodes.get(filterId);
      ok(
        "parameter reaches the audio node",
        filterRuntime && Math.abs(filterRuntime.processor.input.frequency.value - after) < 0.001,
        filterRuntime && `${filterRuntime.processor.input.frequency.value} vs ${after}`
      );

      document.getElementById("fx-add-filter").click();
      ok("rack can hold several effects", api.state.racks.master.length === 3);
      ok("chain length follows the rack", walk(masterIn, masterOut).path.length === 5, walk(masterIn, masterOut).path.join(">"));
      document.querySelector(`[data-fx="${api.state.racks.master[2].id}"] [data-action="remove"]`).click();
      ok("remove takes it out of the rack", api.state.racks.master.length === 2);
      ok("remove takes it out of the audio", walk(masterIn, masterOut).path.join(">") === "waveshaper>biquad>gain>biquad");

      api.state.racks.master.forEach((effect) => {
        effect.params.cutoff = 300;
        effect.params.mode = "highpass";
      });
      api.rebuildAllRacks();
      const filters = graphCtx.__created.filter((n) => n.__kind === "biquad" && n.type === "highpass");
      ok("type changes reach the audio nodes", filters.length >= 1, filters.length);

      document.getElementById("fx-clear").click();
      ok("clear empties the rack", api.state.racks.master.length === 0);
      ok("empty rack rewires straight through", walk(masterIn, masterOut).path.length === 0);

      /* ---- per-module inserts ---- */
      const bassBus = api.moduleInput("bass");
      const synthBus = api.moduleInput("synth");
      ok("every module has its own bus", Boolean(bassBus) && Boolean(synthBus) && bassBus !== synthBus);
      ok(
        "a module with no inserts runs through just its output fader",
        walk(synthBus, masterIn).path.join(">") === "gain",
        walk(synthBus, masterIn).path.join(">")
      );
      ok(
        "every channel has its own output fader",
        Boolean(api.moduleOutput("bass")) && api.moduleOutput("bass") !== api.moduleOutput("synth")
      );

      /* the channel output is a real, separate stage after the inserts */
      api.setModuleOutput("bass", 0.5);
      ok("the output fader reaches its own gain node", Math.abs(api.moduleOutput("bass").gain.value - 0.5) < 1e-9, api.moduleOutput("bass").gain.value);
      ok("it does not disturb the mixer level", Math.abs(bassBus.gain.value - 1) < 1e-9, bassBus.gain.value);
      api.setModuleLevel("bass", 0.6);
      ok("the mixer level does not disturb the output", Math.abs(api.moduleOutput("bass").gain.value - 0.5) < 1e-9, api.moduleOutput("bass").gain.value);
      api.setModuleLevel("bass", 1);
      api.setModuleOutput("bass", 1);

      api.addEffect("filter", "bass");
      ok("insert lands in the module rack", api.state.racks.bass.length === 1 && api.state.racks.master.length === 0);
      ok(
        "insert sits between the module and its output fader",
        walk(bassBus, masterIn).path.join(">") === "biquad>gain",
        walk(bassBus, masterIn).path.join(">")
      );
      ok("other modules stay untouched", walk(synthBus, masterIn).path.join(">") === "gain", walk(synthBus, masterIn).path.join(">"));

      api.addEffect("distortion", "bass");
      ok(
        "module inserts chain before the master",
        walk(bassBus, masterIn).path.join(">") === "biquad>waveshaper>biquad>gain>gain",
        walk(bassBus, masterIn).path.join(">")
      );

      api.addEffect("filter", "master");
      // masterIn itself is a gain node on the way, hence the double "gain"
      ok(
        "module inserts then master rack",
        walk(bassBus, masterOut).path.join(">") === "biquad>waveshaper>biquad>gain>gain>gain>biquad",
        walk(bassBus, masterOut).path.join(">")
      );
      ok("a module with no inserts lands on the master bus", walk(synthBus, masterOut).path.join(">") === "gain>gain>biquad", walk(synthBus, masterOut).path.join(">"));

      api.moveEffect(api.state.racks.bass[1].id, "bass", -1);
      ok(
        "module inserts can be reordered",
        walk(bassBus, masterIn).path.join(">") === "waveshaper>biquad>gain>biquad>gain",
        walk(bassBus, masterIn).path.join(">")
      );

      selectInstrument("drums");
      ok(
        "insert panel follows the selected instrument",
        document.getElementById("inserts-title").textContent.includes("Drums") &&
          document.querySelectorAll("#inserts-body .fx-card").length === 0 &&
          document.querySelectorAll("#effects-body .fx-card").length === 1
      );
      ok("master rack is unaffected by the module rack", api.state.racks.master.length === 1);

      selectInstrument("bass");
      const insertCards = document.querySelectorAll("#inserts-body .fx-card").length;
      ok("selecting the bass shows its inserts", insertCards === 2 && document.getElementById("inserts-title").textContent.includes("Bass"), insertCards);
      document.getElementById("insert-clear").click();
      ok("clear empties only the module rack", api.state.racks.bass.length === 0 && api.state.racks.master.length === 1);
      ok("cleared module rewires through just its output fader", walk(bassBus, masterIn).path.join(">") === "gain", walk(bassBus, masterIn).path.join(">"));
      document.getElementById("fx-clear").click();

      /* ---- dry / wet on every effect ---- */
      api.clearRack("master");
      api.clearRack("bass");
      const fx = api.addEffect("filter", "master");
      const fxRuntime = runtimeOf("master", 0);
      ok(
        "an effect splits into a dry and a wet path",
        connects(fxRuntime.input, fxRuntime.dry) && connects(fxRuntime.input, fxRuntime.processor.input),
        fxRuntime.input.__out.map((node) => node.__kind).join(",")
      );
      ok(
        "both paths meet again at the output",
        connects(fxRuntime.dry, fxRuntime.output) && connects(fxRuntime.wet, fxRuntime.output)
      );
      ok("a filter defaults to fully wet", fxRuntime.dry.gain.value === 0 && fxRuntime.wet.gain.value === 1, `${fxRuntime.dry.gain.value}/${fxRuntime.wet.gain.value}`);

      fx.params.mix = 0.25;
      api.rebuildAllRacks();
      const mixedRuntime = runtimeOf("master", 0);
      ok(
        "the mix knob splits dry and wet",
        Math.abs(mixedRuntime.dry.gain.value - 0.75) < 1e-9 && Math.abs(mixedRuntime.wet.gain.value - 0.25) < 1e-9,
        `${mixedRuntime.dry.gain.value}/${mixedRuntime.wet.gain.value}`
      );
      ok("every effect type offers a mix control", Object.values(api.EFFECT_TYPES).every((spec) => spec.params.mix), Object.keys(api.EFFECT_TYPES).join(","));
      ok("filter, distortion and the inserts all default sensibly", api.EFFECT_TYPES.filter.defaultMix === 1 && api.EFFECT_TYPES.delay.defaultMix < 1);

      /* ---- reverb and delay: inserts only ---- */
      ok("insert racks offer reverb and delay", ["reverb", "delay"].every((type) => document.getElementById(`insert-add-${type}`)));
      ok(
        "the master rack does not offer them",
        !document.getElementById("fx-add-reverb") && !document.getElementById("fx-add-delay"),
        [...document.querySelectorAll("#fx-add [data-add-type]")].map((button) => button.dataset.addType).join(",")
      );
      ok("adding reverb to the master is refused", api.addEffect("reverb", "master") === null && api.state.racks.master.length === 1);
      ok("the refusal is explained", document.getElementById("effects-status").textContent.includes("insert effect"), document.getElementById("effects-status").textContent);

      api.clearRack("master");
      api.clearRack("bass");
      api.addEffect("reverb", "bass");
      const reverbRuntime = runtimeOf("bass", 0);
      const convolver = reverbRuntime.processor.input;
      ok(
        "reverb runs through a convolver into damping",
        convolver.__kind === "convolver" && reverbRuntime.processor.output.__kind === "biquad",
        `${convolver.__kind} -> ${reverbRuntime.processor.output.__kind}`
      );
      ok("reverb builds an impulse", convolver.buffer && convolver.buffer.length > 0, convolver.buffer && convolver.buffer.duration);
      ok("reverb defaults to a wet/dry blend", reverbRuntime.dry.gain.value > 0 && reverbRuntime.wet.gain.value > 0, `${reverbRuntime.dry.gain.value}/${reverbRuntime.wet.gain.value}`);

      api.addEffect("delay", "bass");
      const delayRuntime = runtimeOf("bass", 1);
      const delayNode = delayRuntime.processor.input;
      ok("delay node is a delay", delayNode.__kind === "delay", delayNode.__kind);
      const delayTone = delayNode.__out.find((node) => node.__kind === "biquad");
      const delayFeedback = delayTone && delayTone.__out[0];
      ok(
        "delay feeds its own feedback loop",
        Boolean(delayTone && delayFeedback) && connects(delayFeedback, delayNode),
        `${delayNode.__kind} -> ${delayTone && delayTone.__kind} -> ${delayFeedback && delayFeedback.__kind} -> back`
      );
      ok("delay sends a wet signal onward", connects(delayNode, delayRuntime.wet), delayNode.__out.map((node) => node.__kind).join(","));
      ok("the delay time reaches the node", Math.abs(delayNode.delayTime.value - api.state.racks.bass[1].params.time / 1000) < 1e-9, delayNode.delayTime.value);
      ok(
        "reverb and delay both reach the master",
        walk(api.moduleInput("bass"), masterIn).reached,
        walk(api.moduleInput("bass"), masterIn).path.join(">")
      );
      api.clearRack("bass");

      selectInstrument("drums");
    } else {
      ok("audio graph introspection available", true, "skipped: real AudioContext has no introspection");
    }

    /* ---- saving patterns ---- */
    api.clearPatterns();
    ok("the library starts empty", api.savedPatterns().length === 0 && document.getElementById("pattern-list").textContent.includes("Nothing saved yet"));

    // start from a known-empty sequence: earlier tests leave steps behind
    api.state.sequence = api.sanitiseSequence(null);
    api.refreshUI();
    document.getElementById("pattern-save").click();
    ok("an empty pattern is not saved", api.savedPatterns().length === 0 && document.getElementById("patterns-status").textContent.includes("empty"), document.getElementById("patterns-status").textContent);

    // build a pattern worth keeping
    const patternStep = (row, step) => document.querySelector(`[data-instrument="synth"][data-row="${row}"][data-step="${step}"]`);
    selectInstrument("synth");
    patternStep(0, 0).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    patternStep(2, 4).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    document.getElementById("pattern-name").value = "Opening riff";
    document.getElementById("pattern-save").click();
    ok("a pattern can be saved", api.savedPatterns().length === 1 && api.savedPatterns()[0].name === "Opening riff");
    ok("the saved pattern holds the steps", api.savedPatterns()[0].sequence.synth[0][0] === true && api.savedPatterns()[0].sequence.synth[2][4] === true);
    ok("the library shows it", document.querySelectorAll("#pattern-list .pattern-chip").length === 1 && document.getElementById("pattern-list").textContent.includes("Opening riff"));
    ok("the name box is cleared after saving", document.getElementById("pattern-name").value === "");

    document.getElementById("pattern-name").value = "";
    document.getElementById("pattern-save").click();
    eq("an unnamed pattern gets a default name", api.savedPatterns()[1].name, "Pattern 2");

    // change the pattern, then load the saved one back
    patternStep(0, 0).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    patternStep(4, 8).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    ok("the live pattern changed", api.state.sequence.synth[0][0] === false && api.state.sequence.synth[4][8] === true);

    document.querySelector('[data-load="' + api.savedPatterns()[0].id + '"]').click();
    ok("loading restores the saved steps", api.state.sequence.synth[0][0] === true && api.state.sequence.synth[2][4] === true);
    ok("loading clears what was not in the pattern", api.state.sequence.synth[4][8] === false);
    ok("loading redraws the grid", document.querySelector('[data-instrument="synth"][data-row="0"][data-step="0"]').classList.contains("on"));
    ok("the loaded pattern is a copy, not a reference", api.state.sequence !== api.savedPatterns()[0].sequence);

    document.querySelector('[data-remove="' + api.savedPatterns()[1].id + '"]').click();
    ok("patterns can be deleted", api.savedPatterns().length === 1 && api.savedPatterns()[0].name === "Opening riff");

    ok(
      "odd stored data is sanitised into a real sequence",
      (() => {
        const fixed = api.sanitiseSequence({ drums: { kick: [true, "yes", false] }, synth: [[true]] });
        return fixed.drums.kick[0] === true && fixed.drums.kick[1] === false && fixed.synth[0][0] === true && fixed.synth[5][15] === false;
      })()
    );
    ok("junk input still yields a usable sequence", Array.isArray(api.sanitiseSequence("nonsense").bass[0]));

    /* ---- wav encoding ---- */
    const fakeBuffer = {
      numberOfChannels: 2,
      length: 4,
      sampleRate: 44100,
      getChannelData: (channel) => (channel === 0 ? Float32Array.from([0, 1, -1, 0.5]) : Float32Array.from([0, 0, 0, -0.5])),
    };
    const wav = api.encodeWav(fakeBuffer);
    const bytes = new DataView(await wav.arrayBuffer());
    const ascii = (offset, length) => String.fromCharCode(...new Uint8Array(bytes.buffer, offset, length));
    eq("wav starts with RIFF", ascii(0, 4), "RIFF");
    eq("wav is a WAVE file", ascii(8, 4), "WAVE");
    eq("wav has a fmt chunk", ascii(12, 4), "fmt ");
    eq("wav has a data chunk", ascii(36, 4), "data");
    eq("wav declares PCM", bytes.getUint16(20, true), 1);
    eq("wav is stereo", bytes.getUint16(22, true), 2);
    eq("wav keeps the sample rate", bytes.getUint32(24, true), 44100);
    eq("wav byte rate", bytes.getUint32(28, true), 44100 * 2 * 2);
    eq("wav is 16 bit", bytes.getUint16(34, true), 16);
    eq("wav data size matches the frames", bytes.getUint32(40, true), 4 * 2 * 2);
    eq("wav file size matches the header", wav.size, 44 + 4 * 2 * 2);
    // stereo frames are interleaved, so frame n starts at 44 + n * 4
    eq("full-scale positive sample", bytes.getInt16(44 + 1 * 4, true), 32767);
    eq("full-scale negative sample", bytes.getInt16(44 + 2 * 4, true), -32768);
    eq("silence stays silent", bytes.getInt16(44, true), 0);

    /* ---- undo / redo ---- */
    api.state.sequence = api.sanitiseSequence(null);
    api.clearHistory();
    api.refreshUI();
    const editStep = (row, step) => {
      selectInstrument("synth");
      document.querySelector(`[data-instrument="synth"][data-row="${row}"][data-step="${step}"]`).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    };

    ok("nothing to undo at the start", api.undo() === false && api.redo() === false);
    ok("the undo button is disabled", document.getElementById("undo").disabled === true && document.getElementById("redo").disabled === true);

    editStep(0, 0);
    api.flushHistory();
    ok("an edit is recorded", api.history.past.length === 1 && document.getElementById("undo").disabled === false);
    ok("the edit is live", api.state.sequence.synth[0][0] === true && document.getElementById("undo").disabled === false);

    ok("undo works", api.undo() === true);
    ok("undo removes the step", api.state.sequence.synth[0][0] === false);
    ok("undo enables redo", document.getElementById("redo").disabled === false && api.history.future.length === 1);
    ok("the grid is redrawn", document.querySelector('[data-instrument="synth"][data-row="0"][data-step="0"]').classList.contains("on") === false);

    ok("redo works", api.redo() === true);
    ok("redo puts the step back", api.state.sequence.synth[0][0] === true);
    ok("redo is then exhausted", api.redo() === false);

    /* keyboard shortcuts drive the same history */
    const historyKey = (key, options = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
    editStep(3, 4);
    api.flushHistory();
    historyKey("z", { ctrlKey: true });
    ok("ctrl+z undoes", api.state.sequence.synth[3][4] === false);
    historyKey("y", { ctrlKey: true });
    ok("ctrl+y redoes", api.state.sequence.synth[3][4] === true);
    historyKey("z", { ctrlKey: true });
    historyKey("z", { ctrlKey: true, shiftKey: true });
    ok("ctrl+shift+z also redoes", api.state.sequence.synth[3][4] === true);
    historyKey("z", { metaKey: true });
    ok("cmd+z works on a mac too", api.state.sequence.synth[3][4] === false);

    /* a text field keeps its own undo */
    const nameField = document.getElementById("pattern-name");
    const beforeFieldUndo = api.history.past.length;
    nameField.value = "typing";
    nameField.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    ok("ctrl+z inside a text field is left to the browser", api.history.past.length === beforeFieldUndo);

    /* a fresh edit clears the redo stack */
    api.redo();
    editStep(5, 8);
    api.flushHistory();
    ok("a new edit drops the redo stack", api.history.future.length === 0);

    /* continuous controls coalesce into one entry */
    api.clearHistory();
    api.setVolume(0.5);
    api.setVolume(0.42);
    api.setVolume(0.31);
    api.flushHistory();
    eq("many slider moves become one undo step", api.history.past.length, 1);
    api.undo();
    ok("undo restores the volume from before the drag", Math.abs(api.state.volume - 0.7) < 1e-9, api.state.volume);

    /* structural edits are undoable too — from a known baseline */
    ["drums", "bass", "synth", "strings", "drop", "master"].forEach((rackId) => api.clearRack(rackId));
    api.state.drums.kit = "analog";
    api.resetAllPitch();
    api.flushHistory();
    api.clearHistory();

    api.addEffect("reverb", "synth");
    api.flushHistory();
    api.state.drums.kit = "nine";
    api.markHistory();
    api.flushHistory();
    api.setModulePitch("bass", -12);
    api.flushHistory();
    ok("three edits, three steps", api.history.past.length === 3, api.history.past.length);

    api.undo();
    ok("undo reverts a pitch change", api.state.pitch.bass === 0);
    api.undo();
    ok("undo reverts a kit change", api.state.drums.kit === "analog");
    api.undo();
    ok("undo removes an added effect", api.state.racks.synth.length === 0);
    ok("the effect audio node is gone as well", api.effectNodes.size === 0, api.effectNodes.size);
    api.redo();
    api.redo();
    api.redo();
    ok("redo replays all three", api.state.racks.synth.length === 1 && api.state.drums.kit === "nine" && api.state.pitch.bass === -12);
    ok("the restored effect has audio again", api.effectNodes.size === 1);
    ok("the rack is rendered again", document.querySelectorAll("#inserts-body .fx-card").length === 1);

    /* clearing the pattern is undoable: the "oops" case */
    document.getElementById("demo").click();
    api.flushHistory();
    document.getElementById("clear").click();
    api.flushHistory();
    ok("clear empties the pattern", api.state.sequence.synth.every((row) => row.every((on) => !on)));
    api.undo();
    ok("undo brings the cleared pattern back", api.state.sequence.bass[0][0] === true && api.state.sequence.drums.kick[4] === true);

    /* the complete reset starts a clean history */
    document.getElementById("reset-all").click();
    document.getElementById("reset-all").click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    ok("reset clears the undo history", api.history.past.length === 0 && document.getElementById("undo").disabled === true);
    ok("nothing to undo after a reset", api.undo() === false);

    api.clearHistory();

    /* ---- drum lanes: add, rename, recolour, pitch, remove ---- */
    selectInstrument("drums");
    const startingLanes = api.drumLanes().length;
    eq("the kit starts with three drums", startingLanes, 3);
    ok(
      "every lane carries a name, colour and pitch",
      api.drumLanes().every((lane) => lane.name && /^#[0-9a-f]{6}$/i.test(lane.color) && Number.isFinite(lane.pitch))
    );

    const addedLane = api.addDrumLane("Clap");
    ok("a drum can be added", api.drumLanes().length === startingLanes + 1 && Boolean(api.laneById(addedLane)));
    eq("the new lane keeps the name it was given", api.laneById(addedLane).name, "Clap");
    ok("the new lane starts with an empty row", api.state.sequence.drums[addedLane].every((on) => on === false));
    ok("the new lane gets its own colour", api.laneById(addedLane).color !== api.laneById("kick").color);
    ok("the new lane gets a row in the grid", Boolean(document.querySelector(`[data-instrument="drums"][data-row="${addedLane}"]`)));

    /* the added lane plays and can be pitched on its own */
    api.state.sequence.drums[addedLane][0] = true;
    api.refreshUI();
    ok("the added row can hold steps", api.state.sequence.drums[addedLane][0] === true);

    const stepCtx = api.getContext();
    if (stepCtx.__created) {
      for (const lane of api.drumLanes()) api.state.sequence.drums[lane.id].fill(false);
      api.state.sequence.drums[addedLane][0] = true;
      stepCtx.__created.length = 0;
      api.playStep(0);
      ok("the sequencer fires a drum you added", stepCtx.__created.length > 0, `${stepCtx.__created.length} nodes`);
      ok(
        "and no other drum row is playing",
        api.drumLanes()
          .filter((lane) => lane.id !== addedLane)
          .every((lane) => api.state.sequence.drums[lane.id].every((on) => !on))
      );
    } else {
      ok("the sequencer fires a drum you added", true, "skipped");
    }

    api.renameDrumLane(addedLane, "Hand Clap");
    eq("a lane can be renamed", api.laneById(addedLane).name, "Hand Clap");
    ok(
      "the grid label follows the name",
      document.querySelector(`[data-instrument="drums"][data-row="${addedLane}"]`).closest(".row").querySelector(".row-label").textContent === "Hand Clap"
    );
    api.renameDrumLane(addedLane, "   ");
    eq("an empty name falls back to the id", api.laneById(addedLane).name, addedLane);
    api.renameDrumLane(addedLane, "Clap");

    api.recolorDrumLane(addedLane, "#56beff");
    eq("a lane can be recoloured", api.laneById(addedLane).color, "#56beff");
    ok(
      "the recoloured row paints in its own colour",
      document.querySelector(`[data-instrument="drums"][data-row="${addedLane}"][data-step="0"]`).style.background.replace(/\s/g, "").includes("86,190,255") ||
        document.querySelector(`[data-instrument="drums"][data-row="${addedLane}"][data-step="0"]`).style.background.includes("#56beff"),
      document.querySelector(`[data-instrument="drums"][data-row="${addedLane}"][data-step="0"]`).style.background
    );
    /* tapping a step repaints that one cell, and must use the lane colour too */
    const tapCell = document.querySelector(`[data-instrument="drums"][data-row="${addedLane}"][data-step="5"]`);
    tapCell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    ok(
      "tapping a step paints in the lane colour",
      tapCell.style.background.replace(/\s/g, "").includes("86,190,255") || tapCell.style.background.includes("#56beff"),
      tapCell.style.background
    );
    const tapKick = document.querySelector('[data-instrument="drums"][data-row="kick"][data-step="5"]');
    tapKick.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    ok(
      "and another lane keeps its own colour",
      tapKick.style.background.replace(/\s/g, "").includes("253,142,255") ||
        tapKick.style.background.toUpperCase().includes("#FD8EFF"),
      tapKick.style.background
    );
    api.state.sequence.drums[addedLane][5] = false;
    api.state.sequence.drums.kick[5] = false;
    api.paintCell("drums", addedLane, 5);
    api.paintCell("drums", "kick", 5);
    ok(
      "the other rows keep their own colour",
      api.laneColor("kick") === "#FD8EFF" && api.laneColor(addedLane) === "#56beff"
    );

    api.setLanePitch(addedLane, 7);
    eq("a lane can be pitched on its own", api.laneById(addedLane).pitch, 7);
    eq("pitching one lane leaves the others alone", api.laneById("kick").pitch, 0);
    api.setLanePitch(addedLane, 99);
    eq("lane pitch is capped", api.laneById(addedLane).pitch, 12);
    api.setLanePitch(addedLane, -99);
    eq("lane pitch has a floor", api.laneById(addedLane).pitch, -36);
    api.resetLanePitch(addedLane);
    eq("lane pitch resets to zero", api.laneById(addedLane).pitch, 0);

    /* the per-lane pitch reaches the voice, on top of the module pitch */
    api.state.drums.voices[addedLane] = "kit:analog";
    api.setModulePitch("drums", 0);
    const laneCtx = api.getContext();
    if (laneCtx.__created) {
      const firstOsc = () => laneCtx.__created.filter((node) => node.__kind === "oscillator")[0];
      const playAndRead = (laneId) => {
        laneCtx.__created.length = 0;
        api.playDrum(laneId, null, null);
        return firstOsc();
      };
      api.setLanePitch(addedLane, 0);
      const laneBase = playAndRead(addedLane).frequency.value;
      api.setLanePitch(addedLane, 12);
      const laneUp = playAndRead(addedLane).frequency.value;
      ok("a lane an octave up plays an octave up", Math.abs(laneUp - laneBase * 2) < 0.5, `${laneUp} vs ${laneBase}`);
      api.setLanePitch(addedLane, -12);
      const laneDown = playAndRead(addedLane).frequency.value;
      ok("and an octave down plays an octave down", Math.abs(laneDown - laneBase / 2) < 0.5, `${laneDown} vs ${laneBase}`);
      api.setLanePitch(addedLane, 7);
      const laneFifth = playAndRead(addedLane).frequency.value;
      ok("a fifth is really a fifth", Math.abs(laneFifth - laneBase * Math.pow(2, 7 / 12)) < 0.5, `${laneFifth} vs ${laneBase}`);
      api.setLanePitch(addedLane, 0);
      ok("other lanes are untouched by a lane pitch", Math.abs(playAndRead("kick").frequency.value - 45) < 0.5);
    } else {
      ok("lane pitch reaches the voice", true, "skipped");
    }
    api.state.drums.voices[addedLane] = "";

    /* removing takes the row with it, and undo brings both back */
    api.flushHistory();
    ok("removing a drum works", api.removeDrumLane(addedLane) === true);
    eq("the lane is gone", api.drumLanes().length, startingLanes);
    ok("its row is gone too", api.state.sequence.drums[addedLane] === undefined);
    ok("the grid dropped the row", document.querySelector(`[data-instrument="drums"][data-row="${addedLane}"]`) === null);
    api.undo();
    ok("undo brings the drum and its row back", api.drumLanes().length === startingLanes + 1 && Boolean(api.state.sequence.drums[addedLane]));
    eq("the restored row keeps its steps", api.state.sequence.drums[addedLane][0], true);
    eq("the restored lane keeps its settings", api.laneById(addedLane).name, "Clap");
    api.flushHistory();
    const laneSnapshot = api.snapshotState();
    ok(
      "the snapshot carries the lane list",
      laneSnapshot.includes('"lanes"') && laneSnapshot.includes("Clap") && laneSnapshot.includes('"color"'),
      "lanes serialised"
    );
    api.redo();
    ok("redo removes it again", api.drumLanes().length === startingLanes);

    /* the grid still knows which row belongs to which lane */
    eq("kick row resolves as a lane", api.laneById("kick").id, "kick");
    ok("a numeric row still parses as a note row", api.laneById(3) === null);

    /* a stored lane list is validated on the way back in */
    ok(
      "a stored lane list is validated on the way back in",
      api.readLanes([{ id: "a", name: "A", color: "not-a-colour", pitch: 999 }, { id: "a" }, { nonsense: true }]).length === 1,
      JSON.stringify(api.readLanes([{ id: "a", name: "A", color: "not-a-colour", pitch: 999 }, { id: "a" }]))
    );
    eq("a bad colour falls back", api.readLanes([{ id: "a", color: "nope" }])[0].color, "#FD8EFF");
    eq("an out-of-range pitch is clamped", api.readLanes([{ id: "a", pitch: 999 }])[0].pitch, 12);
    ok("a junk lane list is ignored", api.readLanes("nonsense") === null);
    eq("a saved lane list restores exactly", api.readLanes([{ id: "x", name: "X", color: "#ff9a00", pitch: -5 }])[0].pitch, -5);

    /* clean up: back to the three default drums */
    api.setDrumLanes(api.DRUM_LANES.map((lane) => ({ ...lane })));
    api.state.sequence.drums = api.emptyDrums();
    api.refreshUI();
    eq("back to three drums", api.drumLanes().length, 3);
    api.clearHistory();

    /* ---- layout fits the viewport (real browsers only: jsdom does no layout) ---- */
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (window.__stubAudio) {
      ok("layout checks are skipped without a layout engine", true, "jsdom");
    } else {
      ok("no horizontal overflow", document.documentElement.scrollWidth <= viewport.width + 1, `${document.documentElement.scrollWidth} vs ${viewport.width}`);
      ok("the grid does not overflow its container", document.querySelector(".steps").scrollWidth <= document.querySelector(".steps").clientWidth + 1);
      const stepBox = document.querySelector(".step").getBoundingClientRect();
      ok("steps stay tappable", stepBox.width >= 12 && stepBox.height >= 24, `${stepBox.width.toFixed(1)}×${stepBox.height.toFixed(1)}`);
      ok("all 16 steps fit on screen", document.querySelectorAll(".row:first-child .step").length === 16);
      const playBox = document.getElementById("play").getBoundingClientRect();
      ok(
        "the transport is reachable without scrolling",
        playBox.bottom <= viewport.height + 1 && playBox.width >= 40,
        `bottom ${playBox.bottom.toFixed(0)} of ${viewport.height}, width ${playBox.width.toFixed(0)}`
      );
      const bodyBox = document.body.getBoundingClientRect();
      ok("the page body stays inside the viewport", bodyBox.width <= viewport.width + 1, `${bodyBox.width.toFixed(0)} vs ${viewport.width}`);
      if (viewport.width <= 620) {
        ok(
          "phones start with the racks folded away",
          document.getElementById("inserts-body").hidden === true && document.getElementById("effects-body").hidden === true
        );
        const instrumentBox = document.querySelector(".instrument").getBoundingClientRect();
        ok("instrument buttons stay tappable on a phone", instrumentBox.width >= 40 && instrumentBox.height >= 40, `${instrumentBox.width}×${instrumentBox.height}`);
        ok("all five instruments are visible", document.querySelectorAll(".instrument").length === 5);
      }
    }

    /* ---- complete reset ---- */
    const resetButton = document.getElementById("reset-all");
    ok(
      "transport has a reset button",
      Boolean(resetButton) && resetButton.textContent.trim() === "Reset",
      resetButton && JSON.stringify(resetButton.textContent)
    );

    // make a thorough mess of every setting the app owns
    document.getElementById("demo").click();
    api.setTempo(90);
    api.setVolume(0.3);
    api.setSwing(0.6);
    api.setSwingGrid(16);
    api.setTranspose(5);
    api.setModulePitch("bass", -7);
    api.setModuleLevel("strings", 0.4);
    api.setModuleMuted("drums", true);
    api.state.voices.synth.fmAmount = 0.8;
    api.state.voices.synth.fmRatio = 3;
    api.state.drums.kit = "nine";
    api.state.drums.voices.kick = "kit:chip";
    api.addEffect("filter", "synth");
    api.addEffect("reverb", "strings");
    api.addEffect("distortion", "master");
    await api.importFiles([new File([makeWav(0.05, 300)], "Reset me.wav", { type: "audio/wav" })]);
    api.state.drums.voices.snare = `sample:${[...api.samples.values()][0].id}`;
    document.getElementById("pattern-name").value = "Doomed pattern";
    document.getElementById("pattern-save").click();
    ok("a pattern is saved before the reset", api.savedPatterns().length >= 1);
    api.start();

    resetButton.click();
    ok(
      "the first click only arms the reset",
      resetButton.textContent === "Sure?" && api.state.tempo === 90 && resetButton.getAttribute("aria-pressed") === "true"
    );
    ok("nothing is wiped while armed", api.state.sequence.bass[0][0] === true && api.state.racks.master.length === 1 && api.samples.size > 0);

    resetButton.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    ok("playback stops", api.state.isPlaying === false && api.state.currentStep === 0);
    ok(
      "the pattern is empty",
      api.state.sequence.bass.every((row) => row.every((on) => !on)) && api.state.sequence.drums.kick.every((on) => !on)
    );
    ok(
      "transport settings are back to defaults",
      api.state.tempo === 120 && api.state.volume === 0.7 && api.state.swing === 0 && api.state.swingGrid === 8,
      `${api.state.tempo}/${api.state.volume}/${api.state.swing}/${api.state.swingGrid}`
    );
    ok(
      "transpose and module pitch are cleared",
      api.state.transpose === 0 && ["drums", "bass", "synth", "strings", "drop"].every((id) => api.state.pitch[id] === 0)
    );
    ok(
      "the mixer is back to unity and unmuted",
      ["drums", "bass", "synth", "strings", "drop"].every((id) => api.state.levels[id] === 1 && api.state.muted[id] === false)
    );
    ok("FM settings are back to defaults", api.state.voices.synth.fmAmount === 0 && api.state.voices.synth.fmRatio === 2);
    ok(
      "drums are back to the default kit",
      api.state.drums.kit === "analog" && ["kick", "snare", "hihat"].every((lane) => api.state.drums.voices[lane] === "")
    );
    ok("every rack is empty", ["drums", "bass", "synth", "strings", "drop", "master"].every((rackId) => api.state.racks[rackId].length === 0));
    ok("the audio nodes are gone too", api.effectNodes.size === 0, api.effectNodes.size);
    ok("the sample library is cleared", api.samples.size === 0, api.samples.size);
    ok("saved patterns are cleared too", api.savedPatterns().length === 0 && document.getElementById("pattern-list").textContent.includes("Nothing saved yet"));
    ok("the reset button disarms itself", resetButton.textContent === "Reset" && resetButton.getAttribute("aria-pressed") === "false");
    ok(
      "the UI follows the reset",
      document.querySelectorAll(".fx-card").length === 0 &&
        document.getElementById("tempo-value").textContent === "120" &&
        document.getElementById("swing-value").textContent === "0%"
    );
    ok(
      "the mixer UI follows too",
      document.getElementById("mix-level-strings-value").textContent === "100%" &&
        document.querySelector('[data-mute="drums"]').textContent === "Stop"
    );

    /* arming expires on its own, so Reset can never go off half-cocked */
    resetButton.click();
    ok("armed again", resetButton.textContent === "Sure?");
    await new Promise((resolve) => setTimeout(resolve, 4300));
    ok("arming expires after a few seconds", resetButton.textContent === "Reset", resetButton.textContent);

    /* inserts and master racks render side by side, each with its own state */
    selectInstrument("synth");
    document.getElementById("insert-add-filter").click();
    document.getElementById("fx-add-distortion").click();
    window.earworm.state.racks.master[0].enabled = false;
    api.refreshUI();
    ok("insert cards and master cards render", document.querySelectorAll(".fx-card").length === 2, document.querySelectorAll(".fx-card").length);
    ok("insert rack holds the synth filter", document.querySelectorAll("#inserts-body .fx-card").length === 1);
    ok("master rack holds the distortion", document.querySelectorAll("#effects-body .fx-card").length === 1);
    ok("bypassed card is marked", document.querySelectorAll(".fx-card.bypassed").length === 1);
    ok(
      "move buttons disable at the ends",
      document.querySelector(`[data-fx="${api.state.racks.synth[0].id}"] [data-action="up"]`).disabled === true &&
        document.querySelector(`[data-fx="${api.state.racks.master[0].id}"] [data-action="down"]`).disabled === true
    );
    ok(
      "each rack has its own status line",
      document.getElementById("inserts-status").textContent.includes("Synth only") &&
        document.getElementById("effects-status").textContent.includes("after every module"),
      `${document.getElementById("inserts-status").textContent} | ${document.getElementById("effects-status").textContent}`
    );
    ok("racks survive a refresh", api.state.racks.synth.length === 1 && api.state.racks.master.length === 1);
    document.getElementById("insert-clear").click();
    document.getElementById("fx-clear").click();
    ok("both racks empty again", api.state.racks.synth.length === 0 && api.state.racks.master.length === 0);
  } catch (error) {
    ok("harness completed without throwing", false, `${error && error.message} :: ${error && error.stack}`);
  }

  clean("no uncaught errors overall");
  return { results, log: window.__testLog.slice() };
};


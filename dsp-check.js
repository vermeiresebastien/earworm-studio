/* Real-browser audio verification: taps the rack output with an AnalyserNode and
   measures pitch, harmonic content and level, so transpose / FM / filters /
   distortion are checked as sound rather than as state.

   Notes are played one at a time and allowed to die away between triggers: a
   rapid retrigger comb smears the spectrum and hides the fundamental. */
window.__dspCheck = async function dspCheck() {
  const api = window.earworm;
  const ctx = api.getContext();
  if (ctx.state !== "running") {
    try {
      await ctx.resume();
    } catch (error) {
      /* no audio device in this environment */
    }
  }

  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: Boolean(pass), detail: String(detail) });

  // Stop the sequencer and trigger voices directly, so the pattern can never
  // leak other instruments into the measurement, then let any reverb / delay
  // tails from earlier playback die away before measuring.
  api.stop();
  api.clearEffects();
  Object.keys(api.state.racks).forEach((rackId) => api.clearRack(rackId));
  await new Promise((resolve) => setTimeout(resolve, 3200));
  // No destination argument: each voice plays into its own module insert chain.
  let trigger = () => api.playSynth(0);

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  api.getChainOutput().connect(analyser);

  const timeData = new Float32Array(analyser.fftSize);
  const freqData = new Float32Array(analyser.frequencyBinCount);
  const binHz = ctx.sampleRate / analyser.fftSize;
  const spectrum = new Float32Array(analyser.frequencyBinCount);

  const capture = () => {
    analyser.getFloatFrequencyData(freqData);
    for (let i = 0; i < freqData.length; i++) spectrum[i] += Math.pow(10, freqData[i] / 20);
  };
  const peakHz = () => {
    let best = -1;
    let at = 0;
    for (let i = 1; i < spectrum.length; i++) {
      if (spectrum[i] > best) {
        best = spectrum[i];
        at = i;
      }
    }
    return at * binHz;
  };
  const energyAbove = (hz) => {
    let sum = 0;
    for (let i = Math.ceil(hz / binHz); i < spectrum.length; i++) sum += spectrum[i];
    return sum;
  };
  const energyTotal = () => {
    let sum = 0;
    for (let i = 1; i < spectrum.length; i++) sum += spectrum[i];
    return sum;
  };
  const topPeaks = (count = 4, upTo = 1200) => {
    const limit = Math.min(spectrum.length, Math.ceil(upTo / binHz));
    const bins = [];
    for (let i = 1; i < limit; i++) bins.push({ hz: i * binHz, value: spectrum[i] });
    bins.sort((a, b) => b.value - a.value);
    const loudest = bins[0] ? bins[0].value : 1;
    return bins
      .slice(0, count)
      .map((bin) => `${bin.hz.toFixed(0)}Hz ${(20 * Math.log10(Math.max(bin.value, 1e-12) / loudest)).toFixed(1)}dB`)
      .join(", ");
  };
  const rms = () => {
    analyser.getFloatTimeDomainData(timeData);
    let sum = 0;
    for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
    return Math.sqrt(sum / timeData.length);
  };
  const snapshot = () => Float32Array.from(spectrum);
  /** Normalised spectral distance: ~0 for the same sound, large when it is re-pitched. */
  const spectraDiff = (a, b) => {
    let numerator = 0;
    let denominator = 0;
    for (let i = 1; i < a.length; i++) {
      numerator += Math.abs(a[i] - b[i]);
      denominator += a[i] + b[i];
    }
    return denominator > 0 ? numerator / denominator : 0;
  };
  /** Fundamental estimate straight from the waveform, independent of the FFT. */
  const zeroCrossHz = () => {
    analyser.getFloatTimeDomainData(timeData);
    let crossings = 0;
    for (let i = 1; i < timeData.length; i++) {
      if ((timeData[i - 1] <= 0 && timeData[i] > 0) || (timeData[i - 1] >= 0 && timeData[i] < 0)) crossings++;
    }
    return (crossings / 2) * (ctx.sampleRate / timeData.length);
  };
  const binsAt = (list) =>
    list
      .map((hz) => {
        const index = Math.round(hz / binHz);
        const loudest = Math.max(...spectrum);
        return `${hz}Hz ${(20 * Math.log10(Math.max(spectrum[index], 1e-12) / Math.max(loudest, 1e-12))).toFixed(1)}dB`;
      })
      .join(", ");

  /** Play a note a few times in isolation, averaging the spectrum of each. */
  const measure = async (notes = 4, gapMs = 180) => {
    spectrum.fill(0);
    let peakRms = 0;
    for (let n = 0; n < notes; n++) {
      trigger();
      for (let frame = 0; frame < 8; frame++) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        capture();
        peakRms = Math.max(peakRms, rms());
      }
      await new Promise((resolve) => setTimeout(resolve, gapMs)); // let the tail die
    }
    return peakRms;
  };

  api.clearEffects();
  api.setVolume(0.7);
  api.setTranspose(0);
  api.state.voices.bass.fmAmount = 0;

  /** Peak level in the first ~60 ms after the trigger: how hard the note starts. */
  const onsetRms = async (notes = 3) => {
    let peak = 0;
    for (let n = 0; n < notes; n++) {
      trigger();
      for (let frame = 0; frame < 2; frame++) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        peak = Math.max(peak, rms());
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    return peak;
  };

  /** Peak level in the gap *after* each note, i.e. what tail an effect leaves. */
  const tailRms = async (repeats = 3, decayMs = 320, windowMs = 200) => {
    let peak = 0;
    for (let i = 0; i < repeats; i++) {
      trigger();
      await new Promise((resolve) => setTimeout(resolve, decayMs));
      const start = performance.now();
      while (performance.now() - start < windowMs) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        peak = Math.max(peak, rms());
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return peak;
  };

  /* ---- transpose ---- */
  let lastZeroCross = 0;
  const measureZeroCross = async (notes = 4) => {
    let best = 0;
    for (let n = 0; n < notes; n++) {
      trigger();
      for (let frame = 0; frame < 8; frame++) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        const hz = zeroCrossHz();
        if (hz > 20 && hz < 4000) best = Math.max(best, hz);
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    return best;
  };

  await measure();
  lastZeroCross = await measureZeroCross();
  const baseHz = peakHz();
  check(
    "synth note 0 sounds at A3 (220 Hz)",
    Math.abs(baseHz - 220) < 25 && Math.abs(lastZeroCross - 220) < 30,
    `${baseHz.toFixed(1)} Hz :: zero-cross ${lastZeroCross.toFixed(1)} Hz :: bins ${binsAt([110, 220, 330, 440])}`
  );

  api.setTranspose(12);
  await measure();
  const upHz = peakHz();
  check("+12 semitones doubles the pitch", Math.abs(upHz - 440) < 45, `${upHz.toFixed(1)} Hz`);

  api.setTranspose(-12);
  await measure();
  const downHz = peakHz();
  check("-12 semitones halves the pitch", Math.abs(downHz - 110) < 25, `${downHz.toFixed(1)} Hz`);

  api.setTranspose(-24);
  await measure();
  const deepHz = peakHz();
  check("-24 semitones is two octaves down", Math.abs(deepHz - 55) < 18, `${deepHz.toFixed(1)} Hz`);
  api.setTranspose(0);

  /* ---- independent module pitch, stacked with the global transpose ---- */
  api.resetAllPitch();
  api.setModulePitch("bass", 12);
  trigger = () => api.playBass(0);
  await measure();
  const bassUpHz = peakHz();
  check("bass module pitch lifts the bass an octave", Math.abs(bassUpHz - 220) < 25, `${bassUpHz.toFixed(1)} Hz`);

  trigger = () => api.playSynth(0);
  await measure();
  const synthUnmovedHz = peakHz();
  check("the synth stays put while the bass moves", Math.abs(synthUnmovedHz - 220) < 25, `${synthUnmovedHz.toFixed(1)} Hz`);

  api.setModulePitch("synth", -12);
  await measure();
  const synthDownHz = peakHz();
  check("the synth can be pitched independently", Math.abs(synthDownHz - 110) < 25, `${synthDownHz.toFixed(1)} Hz`);

  trigger = () => api.playBass(0);
  await measure();
  const bassStillUpHz = peakHz();
  check("the bass keeps its own pitch", Math.abs(bassStillUpHz - 220) < 25, `${bassStillUpHz.toFixed(1)} Hz`);

  api.setTranspose(12); // -12 + 12 = 0 for the synth
  trigger = () => api.playSynth(0);
  await measure();
  const stackedHz = peakHz();
  check("the global transpose stacks on module pitch", Math.abs(stackedHz - 220) < 25, `${stackedHz.toFixed(1)} Hz`);
  api.resetAllPitch();

  /* ---- sine-like bass and FM ---- */
  trigger = () => api.playBass(0);
  api.state.voices.bass.fmAmount = 0;
  await measure();
  const bassHz = peakHz();
  const bassCleanHigh = energyAbove(600) / Math.max(1e-9, energyTotal());
  check("bass note 0 sounds at A2 (110 Hz)", Math.abs(bassHz - 110) < 22, `${bassHz.toFixed(1)} Hz`);
  check("clean bass is nearly a pure tone", bassCleanHigh < 0.1, `energy above 600 Hz = ${(bassCleanHigh * 100).toFixed(2)}%`);

  api.state.voices.bass.fmAmount = 1;
  api.state.voices.bass.fmRatio = 3;
  api.state.voices.bass.fmDecay = 1.5;
  await measure();
  const bassFmHigh = energyAbove(600) / Math.max(1e-9, energyTotal());
  check(
    "FM sidebands change the bass spectrum",
    bassFmHigh > bassCleanHigh * 3,
    `${(bassFmHigh * 100).toFixed(2)}% vs ${(bassCleanHigh * 100).toFixed(2)}%`
  );
  api.state.voices.bass.fmAmount = 0;

  /* ---- distortion ---- */
  api.clearEffects();
  api.addEffect("distortion");
  api.state.racks.master[0].params.drive = 20;
  api.state.racks.master[0].params.tone = 12000;
  api.state.racks.master[0].params.level = 0.6;
  api.rebuildRack("master");
  await measure();
  const bassDistHigh = energyAbove(600) / Math.max(1e-9, energyTotal());
  check(
    "distortion adds harmonics to the sine bass",
    bassDistHigh > bassCleanHigh * 3,
    `${(bassDistHigh * 100).toFixed(2)}% vs ${(bassCleanHigh * 100).toFixed(2)}%`
  );

  /* ---- filter ---- */
  api.clearEffects();
  trigger = () => api.playSynth(0);
  const cleanRms = await measure();
  api.addEffect("filter");
  api.state.racks.master[0].params.mode = "lowpass";
  api.state.racks.master[0].params.cutoff = 120;
  api.state.racks.master[0].params.resonance = 1;
  api.rebuildRack("master");
  const filteredRms = await measure();
  check(
    "low-pass below the note quietens it",
    filteredRms < cleanRms * 0.6,
    `${filteredRms.toFixed(5)} vs ${cleanRms.toFixed(5)} clean`
  );

  /* ---- order matters ---- */
  api.clearEffects();
  api.addEffect("filter");
  api.addEffect("distortion");
  api.state.racks.master[0].params.mode = "lowpass";
  api.state.racks.master[0].params.cutoff = 400;
  api.state.racks.master[1].params.drive = 20;
  api.rebuildRack("master");
  await measure();
  const filterThenDistortion = energyAbove(1500);
  api.moveEffect(api.state.racks.master[1].id, "master", -1); // distortion now first
  await measure();
  const distortionThenFilter = energyAbove(1500);
  check(
    "reordering the rack changes the result",
    filterThenDistortion > distortionThenFilter * 1.5,
    `${filterThenDistortion.toFixed(2)} vs ${distortionThenFilter.toFixed(2)} above 1.5 kHz`
  );

  /* ---- the global transpose must leave the drums completely alone ---- */
  Object.keys(api.state.racks).forEach((rackId) => api.clearRack(rackId));
  api.resetAllPitch();
  const previousKick = api.state.drums.voices.kick;
  api.state.drums.voices.kick = "kit:analog";
  trigger = () => api.playDrum("kick");
  await measure();
  const kickNeutral = snapshot();
  const kickNeutralRms = rms();

  api.setTranspose(12);
  await measure();
  const kickUp = snapshot();
  const globalDiff = spectraDiff(kickNeutral, kickUp);

  api.setTranspose(-12);
  await measure();
  const kickDown = snapshot();
  const globalDiffDown = spectraDiff(kickNeutral, kickDown);
  const worstGlobal = Math.max(globalDiff, globalDiffDown);
  check(
    "the global transpose does not touch the drums",
    worstGlobal < 0.1,
    `spectral change ${worstGlobal.toFixed(4)} (RMS ${kickNeutralRms.toFixed(5)})`
  );

  api.setTranspose(0);
  api.setModulePitch("drums", 12);
  await measure();
  const kickPitched = snapshot();
  const ownDiff = spectraDiff(kickNeutral, kickPitched);
  check(
    "the drum's own pitch does move it (control)",
    ownDiff > 0.3,
    `spectral change ${ownDiff.toFixed(4)}`
  );
  api.resetAllPitch();
  api.state.drums.voices.kick = previousKick;

  /* ---- per-instrument volume and stop/start, measured ---- */
  Object.keys(api.state.racks).forEach((rackId) => api.clearRack(rackId));
  api.resetAllPitch();
  api.setModuleMuted("bass", false);
  api.setModuleLevel("bass", 1);
  trigger = () => api.playBass(0);
  const bassFullRms = await measure();
  api.setModuleLevel("bass", 0.5);
  const bassHalfRms = await measure();
  check(
    "a fader at 50% halves that instrument",
    Math.abs(bassHalfRms / bassFullRms - 0.5) < 0.1,
    `${bassHalfRms.toFixed(5)} vs ${bassFullRms.toFixed(5)} at 100%`
  );

  api.setModuleLevel("bass", 1);
  trigger = () => api.playSynth(0);
  const synthBaselineRms = await measure();

  api.setModuleMuted("bass", true);
  await new Promise((resolve) => setTimeout(resolve, 600)); // let the previous tail die
  trigger = () => api.playBass(0);
  const bassStoppedRms = await measure();
  check(
    "stopping an instrument silences it",
    bassStoppedRms < bassFullRms * 0.05,
    `${bassStoppedRms.toFixed(6)} vs ${bassFullRms.toFixed(5)} running`
  );

  trigger = () => api.playSynth(0);
  const synthWhileBassStopped = await measure();
  check(
    "stopping one instrument leaves the others playing",
    Math.abs(synthWhileBassStopped - synthBaselineRms) < synthBaselineRms * 0.25,
    `${synthWhileBassStopped.toFixed(5)} vs ${synthBaselineRms.toFixed(5)} before`
  );

  api.setModuleMuted("bass", false);
  trigger = () => api.playBass(0);
  const bassRestarted = await measure();
  check(
    "starting it again restores the level",
    Math.abs(bassRestarted / bassFullRms - 1) < 0.1,
    `${bassRestarted.toFixed(5)} vs ${bassFullRms.toFixed(5)}`
  );
  api.setModuleLevel("bass", 1);

  /* ---- per-module inserts, measured ---- */
  Object.keys(api.state.racks).forEach((rackId) => api.clearRack(rackId));
  trigger = () => api.playBass(0);
  const bassCleanRms = await measure();
  trigger = () => api.playSynth(0);
  const synthCleanRms = await measure();

  api.addEffect("filter", "bass");
  api.state.racks.bass[0].params.mode = "highpass";
  api.state.racks.bass[0].params.cutoff = 600; // well above the 110 Hz bass fundamental
  api.state.racks.bass[0].params.resonance = 0.7;
  api.rebuildRack("bass");

  trigger = () => api.playBass(0);
  const bassInsertRms = await measure();
  trigger = () => api.playSynth(0);
  const synthAfterInsertRms = await measure();

  check(
    "a bass insert filter quiets the bass",
    bassInsertRms < bassCleanRms * 0.6,
    `${bassInsertRms.toFixed(5)} vs ${bassCleanRms.toFixed(5)} clean`
  );
  check(
    "the same insert leaves the synth untouched",
    Math.abs(synthAfterInsertRms - synthCleanRms) < synthCleanRms * 0.25,
    `${synthAfterInsertRms.toFixed(5)} vs ${synthCleanRms.toFixed(5)} clean`
  );

  api.addEffect("filter", "master");
  api.state.racks.master[0].params.mode = "lowpass";
  api.state.racks.master[0].params.cutoff = 120;
  api.rebuildRack("master");
  trigger = () => api.playSynth(0);
  const synthMasterFilteredRms = await measure();
  check(
    "a master filter does affect the synth",
    synthMasterFilteredRms < synthCleanRms * 0.6,
    `${synthMasterFilteredRms.toFixed(5)} vs ${synthCleanRms.toFixed(5)} clean`
  );

  /* ---- dry/wet, reverb and delay, measured ---- */
  Object.keys(api.state.racks).forEach((rackId) => api.clearRack(rackId));
  trigger = () => api.playSynth(0);
  const dryTail = await tailRms();

  api.addEffect("filter", "synth");
  api.state.racks.synth[0].params.mode = "highpass";
  api.state.racks.synth[0].params.cutoff = 900;
  api.state.racks.synth[0].params.resonance = 0.7;
  api.state.racks.synth[0].params.mix = 0; // fully dry: should be as if it were not there
  api.rebuildRack("synth");
  const bypassedFilterRms = await measure();
  check(
    "dry/wet at 0% bypasses the effect",
    Math.abs(bypassedFilterRms - synthCleanRms) < synthCleanRms * 0.15,
    `${bypassedFilterRms.toFixed(5)} vs ${synthCleanRms.toFixed(5)} with no insert`
  );

  api.state.racks.synth[0].params.mix = 1;
  api.rebuildRack("synth");
  const fullFilterRms = await measure();
  check(
    "dry/wet at 100% applies it fully",
    fullFilterRms < synthCleanRms * 0.6,
    `${fullFilterRms.toFixed(5)} vs ${synthCleanRms.toFixed(5)} with no insert`
  );

  api.clearRack("synth");
  api.addEffect("reverb", "synth");
  api.state.racks.synth[0].params.size = 4;
  api.state.racks.synth[0].params.damping = 12000;
  api.state.racks.synth[0].params.mix = 0.9;
  api.rebuildRack("synth");
  const reverbTail = await tailRms();
  check(
    "reverb leaves a tail after the note stops",
    reverbTail > Math.max(dryTail * 3, 5e-5),
    `${reverbTail.toExponential(2)} vs ${dryTail.toExponential(2)} dry`
  );

  api.clearRack("synth");
  api.addEffect("delay", "synth");
  api.state.racks.synth[0].params.time = 300;
  api.state.racks.synth[0].params.feedback = 0.6;
  api.state.racks.synth[0].params.mix = 0.8;
  api.rebuildRack("synth");
  const delayTail = await tailRms();
  check(
    "delay repeats after the note stops",
    delayTail > Math.max(dryTail * 3, 5e-5),
    `${delayTail.toExponential(2)} vs ${dryTail.toExponential(2)} dry`
  );

  /* ---- adsr: the envelope really shapes the sound ---- */
  Object.keys(api.state.racks).forEach((rackId) => api.clearRack(rackId));
  api.resetAllPitch();
  trigger = () => api.playSynth(0);

  api.state.envelopes.synth = { attack: 0.005, decay: 0.3, sustain: 0, release: 0.05 };
  const fastAttackOnset = await onsetRms();

  api.state.envelopes.synth = { attack: 0.28, decay: 0.3, sustain: 0, release: 0.05 };
  const slowAttackOnset = await onsetRms();
  check(
    "a long attack softens the onset",
    slowAttackOnset < fastAttackOnset * 0.5,
    `onset ${slowAttackOnset.toFixed(5)} vs ${fastAttackOnset.toFixed(5)} with a fast attack`
  );

  api.state.envelopes.synth = { attack: 0.005, decay: 0.3, sustain: 0, release: 0.05 };
  const fastAttackRms = await measure(4, 700);

  api.state.envelopes.synth = { attack: 0.005, decay: 0.3, sustain: 0, release: 0.05 };
  const dryTailForAdsr = await tailRms();

  api.state.envelopes.synth = { attack: 0.005, decay: 0.05, sustain: 1, release: 1.2 };
  const sustainedTail = await tailRms();
  check(
    "sustain and release leave a tail after the note",
    sustainedTail > Math.max(dryTailForAdsr * 3, 5e-5),
    `${sustainedTail.toExponential(2)} vs ${dryTailForAdsr.toExponential(2)} percussive`
  );

  api.state.envelopes.synth = { attack: 0.005, decay: 0.3, sustain: 0, release: 0.05 };
  const backToDefault = await measure(4, 700);
  check(
    "restoring the envelope restores the sound",
    Math.abs(backToDefault - fastAttackRms) < fastAttackRms * 0.15,
    `${backToDefault.toFixed(5)} vs ${fastAttackRms.toFixed(5)}`
  );

  /* drums have their own envelope */
  api.state.drums.voices.kick = "kit:analog";
  trigger = () => api.playDrum("kick");
  api.state.envelopes.drums = { attack: 0.001, decay: 1.5, sustain: 0, release: 0.05 };
  const tightKickRms = await measure(4, 700);
  api.state.envelopes.drums = { attack: 0.4, decay: 1.5, sustain: 0, release: 0.05 };
  const softKickRms = await measure(4, 700);
  check(
    "the drum envelope softens a hit",
    softKickRms < tightKickRms * 0.6,
    `${softKickRms.toFixed(5)} vs ${tightKickRms.toFixed(5)} with a fast attack`
  );
  api.state.envelopes.drums = { attack: 0.001, decay: 1.5, sustain: 0, release: 0.05 };
  api.state.drums.voices.kick = "";

  /* ---- fm 2: the second operator, on every instrument ---- */
  Object.keys(api.state.racks).forEach((rackId) => api.clearRack(rackId));
  api.resetAllPitch();
  api.state.envelopes.bass = { attack: 0.012, decay: 0.45, sustain: 0, release: 0.08 };
  trigger = () => api.playBass(0);

  api.state.fm2.bass = { amount: 0, ratio: 2, decay: 0.2 };
  await measure(3, 400);
  const bassFm2Off = energyAbove(600) / Math.max(1e-9, energyTotal());

  api.state.fm2.bass = { amount: 1, ratio: 3, decay: 1.5 };
  await measure(3, 400);
  const bassFm2On = energyAbove(600) / Math.max(1e-9, energyTotal());
  check(
    "FM 2 adds sidebands to the bass on its own",
    bassFm2On > bassFm2Off * 3,
    `${(bassFm2On * 100).toFixed(2)}% vs ${(bassFm2Off * 100).toFixed(2)}%`
  );

  /* it stacks with the voice panel's operator */
  api.state.voices.bass.fmAmount = 1;
  api.state.voices.bass.fmRatio = 1;
  await measure(3, 400);
  const bothOperators = energyAbove(600) / Math.max(1e-9, energyTotal());
  check(
    "FM 1 and FM 2 stack",
    bothOperators > bassFm2On * 0.5,
    `${(bothOperators * 100).toFixed(2)}% with both vs ${(bassFm2On * 100).toFixed(2)}% with FM 2 alone`
  );
  api.state.voices.bass.fmAmount = 0;
  api.state.voices.bass.fmRatio = 1;
  api.state.fm2.bass = { amount: 0, ratio: 2, decay: 0.2 };

  /* drums and the drop are modulated from this section too */
  api.state.drums.voices.kick = "kit:analog";
  trigger = () => api.playDrum("kick");
  api.state.fm2.drums = { amount: 0, ratio: 2, decay: 0.2 };
  await measure(3, 400);
  const kickFmOff = energyAbove(1000) / Math.max(1e-9, energyTotal());
  api.state.fm2.drums = { amount: 1, ratio: 4, decay: 0.6 };
  await measure(3, 400);
  const kickFmOn = energyAbove(1000) / Math.max(1e-9, energyTotal());
  check(
    "FM bends a drum hit",
    kickFmOn > kickFmOff * 1.5,
    `${(kickFmOn * 100).toFixed(2)}% vs ${(kickFmOff * 100).toFixed(2)}% above 1 kHz`
  );
  api.state.fm2.drums = { amount: 0, ratio: 2, decay: 0.2 };
  api.state.drums.voices.kick = "";

  /* ---- post-insert output fader per channel ---- */
  Object.keys(api.state.racks).forEach((rackId) => api.clearRack(rackId));
  api.resetAllPitch();
  trigger = () => api.playBass(0);
  api.setModuleOutput("bass", 1);
  const outputFull = await measure();
  api.setModuleOutput("bass", 0.5);
  const outputHalf = await measure();
  check(
    "the output fader halves the channel",
    Math.abs(outputHalf / outputFull - 0.5) < 0.08,
    `${outputHalf.toFixed(5)} vs ${outputFull.toFixed(5)} at 100%`
  );
  api.setModuleOutput("bass", 1);

  /* pre-insert level drives the inserts, post-insert level does not */
  api.addEffect("distortion", "bass");
  api.state.racks.bass[0].params.drive = 20;
  api.state.racks.bass[0].params.level = 1;
  api.state.racks.bass[0].params.mix = 1;
  api.rebuildRack("bass");
  api.setModuleLevel("bass", 1);
  await measure(3, 400);
  const drivenHard = energyAbove(600) / Math.max(1e-9, energyTotal());

  api.setModuleOutput("bass", 0.4);
  await measure(3, 400);
  const outputLowered = energyAbove(600) / Math.max(1e-9, energyTotal());
  check(
    "the output fader does not change how hard the inserts are driven",
    Math.abs(outputLowered - drivenHard) < drivenHard * 0.2,
    `${(outputLowered * 100).toFixed(2)}% vs ${(drivenHard * 100).toFixed(2)}% harmonics`
  );

  api.setModuleOutput("bass", 1);
  api.setModuleLevel("bass", 0.2);
  await measure(3, 400);
  const fedQuietly = energyAbove(600) / Math.max(1e-9, energyTotal());
  check(
    "the mixer fader does change the drive",
    fedQuietly < drivenHard * 0.8,
    `${(fedQuietly * 100).toFixed(2)}% vs ${(drivenHard * 100).toFixed(2)}% harmonics`
  );
  api.setModuleLevel("bass", 1);
  api.setModuleOutput("bass", 1);
  api.clearRack("bass");

  /* ---- per-lane drum pitch ---- */
  api.state.drums.voices.kick = "kit:analog";
  trigger = () => api.playDrum("kick");
  api.setLanePitch("kick", 0);
  await measure(3, 400);
  const kickLow = energyAbove(300) / Math.max(1e-9, energyTotal());

  api.setLanePitch("kick", 12);
  await measure(3, 400);
  const kickHigh = energyAbove(300) / Math.max(1e-9, energyTotal());
  check(
    "pitching one drum up an octave moves it up the spectrum",
    kickHigh > kickLow * 2,
    `${(kickHigh * 100).toFixed(1)}% vs ${(kickLow * 100).toFixed(1)}% above 300 Hz`
  );

  api.setLanePitch("kick", 0);
  await measure(3, 400);
  const kickBack = energyAbove(300) / Math.max(1e-9, energyTotal());
  check(
    "and pitching it back restores the drum",
    Math.abs(kickBack - kickLow) < kickLow * 0.2,
    `${(kickBack * 100).toFixed(1)}% vs ${(kickLow * 100).toFixed(1)}%`
  );
  api.state.drums.voices.kick = "";

  /* ---- wav export: offline render, then a round trip ---- */
  Object.keys(api.state.racks).forEach((rackId) => api.clearRack(rackId));
  api.resetAllPitch();
  for (const moduleId of ["drums", "bass", "synth", "strings", "drop"]) api.setModuleMuted(moduleId, false);
  api.setTempo(120);

  const exportSeq = api.state.sequence;
  api.DRUM_LANES.forEach((lane) => exportSeq.drums[lane.id].fill(false));
  ["bass", "synth", "strings", "drop"].forEach((key) => exportSeq[key].forEach((row) => row.fill(false)));
  exportSeq.synth[0][0] = true;
  exportSeq.synth[0][8] = true;

  const peakOf = (buffer) => {
    let max = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i]));
    }
    return max;
  };

  const rendered = await api.renderPatternToBuffer(1);
  const expectedSeconds = api.loopDurationMs() / 1000 + 2;
  check(
    "export renders one bar plus a tail",
    Math.abs(rendered.duration - expectedSeconds) < 0.05,
    `${rendered.duration.toFixed(3)}s vs ${expectedSeconds.toFixed(3)}s`
  );
  check("the export is stereo", rendered.numberOfChannels === 2, rendered.numberOfChannels);
  const exportedPeak = peakOf(rendered);
  check("the render contains audio", exportedPeak > 0.01, exportedPeak.toFixed(4));

  /* ---- the render must begin exactly at the loop start ---- */
  const firstSoundMs = (buffer, threshold = 1e-4, fromMs = 0) => {
    const start = Math.max(0, Math.floor((fromMs / 1000) * buffer.sampleRate));
    for (let i = start; i < buffer.length; i++) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        if (Math.abs(buffer.getChannelData(channel)[i]) > threshold) return (i / buffer.sampleRate) * 1000;
      }
    }
    return Infinity;
  };

  const leadIn = firstSoundMs(rendered);
  check(
    "the export starts at the very start of the loop",
    leadIn < 10,
    `${leadIn.toFixed(2)} ms before the first step`
  );

  /* swing must not push the downbeat late */
  api.setSwing(1);
  api.setSwingGrid(8);
  const swungRender = await api.renderPatternToBuffer(1);
  const swungLeadIn = firstSoundMs(swungRender);
  check(
    "swing does not delay the first step",
    swungLeadIn < 10,
    `${swungLeadIn.toFixed(2)} ms with full swing`
  );
  api.setSwing(0);

  /* neither should an insert with a tail */
  api.addEffect("delay", "synth");
  api.state.racks.synth[0].params.mix = 0.6;
  api.rebuildRack("synth");
  const wetRender = await api.renderPatternToBuffer(1);
  check(
    "a delay insert does not push the start back",
    firstSoundMs(wetRender) < 10,
    `${firstSoundMs(wetRender).toFixed(2)} ms with a delay`
  );
  api.clearRack("synth");

  /* and the timeline is aligned: step 8 lands where step 8 is */
  exportSeq.synth[0][0] = false;
  const eighthBar = await api.renderPatternToBuffer(1);
  const eighthMs = firstSoundMs(eighthBar);
  const expectedEighth = api.stepOnsetMs ? api.stepOnsetMs(8) : (8 * 60 * 1000) / (120 * 4);
  check(
    "a note on step 8 lands at step 8 of the loop",
    Math.abs(eighthMs - expectedEighth) < 15,
    `${eighthMs.toFixed(1)} ms vs ${expectedEighth.toFixed(1)} ms`
  );
  exportSeq.synth[0][0] = true;

  /* a pattern that starts with a drum must also start on the downbeat */
  exportSeq.synth[0].fill(false);
  const kickLane = api.drumLanes()[0];
  api.state.drums.kit = "analog";
  exportSeq.drums[kickLane.id][0] = true;
  const drumFirst = await api.renderPatternToBuffer(1);
  const drumLead = firstSoundMs(drumFirst);
  check(
    "a drum on step 1 starts the file on the downbeat",
    drumLead < 10,
    `${drumLead.toFixed(2)} ms before the kick`
  );

  /* exporting while the transport runs must not shift the file either */
  api.togglePlayback();
  await new Promise((resolve) => setTimeout(resolve, 260)); // land mid-loop
  const whilePlaying = await api.renderPatternToBuffer(1);
  const playingLead = firstSoundMs(whilePlaying);
  api.togglePlayback();
  check(
    "exporting mid-playback still starts at the loop start",
    playingLead < 10,
    `${playingLead.toFixed(2)} ms while the transport was running`
  );

  /* multi-bar exports restart the loop exactly on every bar line */
  exportSeq.drums[kickLane.id][8] = false;
  exportSeq.synth[0].fill(false);
  exportSeq.drums[kickLane.id][0] = true;
  const twoBars = await api.renderPatternToBuffer(2);
  const barMs = api.loopDurationMs();
  check("a multi-bar export opens on the downbeat", firstSoundMs(twoBars, 1e-3) < 10, `${firstSoundMs(twoBars, 1e-3).toFixed(2)} ms`);
  const restartMs = firstSoundMs(twoBars, 1e-3, barMs * 0.5);
  check(
    "and restarts exactly on the second bar line",
    Math.abs(restartMs - barMs) < 10,
    `${restartMs.toFixed(1)} ms vs the ${barMs.toFixed(0)} ms bar line`
  );
  exportSeq.drums[kickLane.id][0] = false;
  exportSeq.synth[0][0] = true;

  for (const moduleId of ["drums", "bass", "synth", "strings", "drop"]) api.setModuleMuted(moduleId, true);
  const silentRender = await api.renderPatternToBuffer(1);
  check("a fully stopped mix renders silence", peakOf(silentRender) < 1e-4, peakOf(silentRender).toExponential(2));
  for (const moduleId of ["drums", "bass", "synth", "strings", "drop"]) api.setModuleMuted(moduleId, false);

  const wav = api.encodeWav(rendered);
  const expectedBytes = 44 + rendered.length * rendered.numberOfChannels * 2;
  check("the wav file is the size it claims", wav.size === expectedBytes, `${wav.size} vs ${expectedBytes}`);
  const decoded = await api.getContext().decodeAudioData(await wav.arrayBuffer());
  check(
    "the exported wav decodes back",
    decoded.numberOfChannels === 2 && Math.abs(decoded.duration - rendered.duration) < 0.01,
    `${decoded.duration.toFixed(3)}s, ${decoded.numberOfChannels}ch`
  );
  check(
    "the file itself starts at the very start of the loop",
    firstSoundMs(decoded) < 10,
    `${firstSoundMs(decoded).toFixed(2)} ms into the file`
  );
  check(
    "the decoded wav carries the same audio",
    Math.abs(peakOf(decoded) - exportedPeak) < 0.01,
    `${peakOf(decoded).toFixed(4)} vs ${exportedPeak.toFixed(4)}`
  );

  /* the live graph must be intact after the render swapped the globals out */
  trigger = () => api.playSynth(0);
  const afterExportRms = await measure();
  check("live playback still works after an export", afterExportRms > synthCleanRms * 0.5, `${afterExportRms.toFixed(5)} vs ${synthCleanRms.toFixed(5)} before`);

  exportSeq.synth[0][0] = false;
  exportSeq.synth[0][8] = false;

  Object.keys(api.state.racks).forEach((rackId) => api.clearRack(rackId));
  api.setTranspose(0);
  api.state.voices.bass.fmAmount = 0;

  return { results, audioContextState: ctx.state, sampleRate: ctx.sampleRate };
};


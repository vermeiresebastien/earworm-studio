/* Screenshot page: four drum lanes, each with its own name, colour and pitch. */
window.addEventListener("DOMContentLoaded", () => {
  const api = window.earworm;
  document.querySelector('[data-instrument="drums"]').click();
  document.getElementById("demo").click();
  api.setSwing(0.35);
  api.setSwingGrid(8);

  // three extra drums alongside the default kick / snare / hat
  const clap = api.addDrumLane("Clap");
  const tom = api.addDrumLane("Tom");
  const rim = api.addDrumLane("Rim");
  api.recolorDrumLane("kick", "#FD8EFF");
  api.recolorDrumLane("snare", "#56BEFF");
  api.recolorDrumLane("hihat", "#99ff71");
  api.recolorDrumLane(clap, "#C06BFF");
  api.recolorDrumLane(tom, "#ff9a00");
  api.recolorDrumLane(rim, "#56ffd5");
  api.setLanePitch("hihat", 7);
  api.setLanePitch(tom, -12);
  api.setLanePitch(rim, 5);
  api.state.drums.voices[tom] = "kit:deep";
  api.state.drums.voices[rim] = "kit:nine";

  api.state.sequence.drums[clap][4] = true;
  api.state.sequence.drums[clap][12] = true;
  api.state.sequence.drums[tom][6] = true;
  api.state.sequence.drums[tom][14] = true;
  api.state.sequence.drums[rim][3] = true;
  api.state.sequence.drums[rim][11] = true;
  api.flushHistory();

  api.renderGrid();
  api.renderSounds();

  const focus = new URLSearchParams(location.search).get("focus");
  if (focus) {
    const panel = document.getElementById(focus);
    if (panel) {
      const box = panel.getBoundingClientRect();
      window.scrollTo(0, Math.max(0, box.top + window.scrollY - 60));
    }
  } else {
    window.scrollTo(0, 0);
  }
});

/* Runs the harness automatically and writes a JSON summary into the DOM,
   so `chrome --headless --dump-dom` can report the result.
   Uses DOMContentLoaded (not load) so a slow or blocked webfont request can
   never starve the run, and reports progress check by check. */
window.addEventListener("DOMContentLoaded", async () => {
  const output = document.createElement("pre");
  output.id = "__results";
  document.body.appendChild(output);

  const progress = [];
  window.__onCheck = (name, pass) => {
    progress.push(`${pass ? "PASS" : "FAIL"} ${name}`);
    output.textContent = JSON.stringify({ status: "running", completed: progress.length, last: progress.slice(-3) }, null, 2);
  };

  try {
    const outcome = await window.__runTests();
    const failures = outcome.results.filter((result) => !result.pass);
    output.textContent = JSON.stringify(
      {
        status: "done",
        passed: outcome.results.length - failures.length,
        total: outcome.results.length,
        failures,
        capabilities: window.earworm.capabilities(),
        audioContextState: window.earworm.getContext().state,
        showDirectoryPicker: typeof window.showDirectoryPicker,
        indexedDbAvailable: Boolean(window.indexedDB),
        isSecureContext: window.isSecureContext,
        protocol: location.protocol,
        log: outcome.log,
      },
      null,
      2
    );
  } catch (error) {
    output.textContent = `HARNESS ERROR: ${error && error.message}\nprogress: ${progress.slice(-6).join(" | ")}`;
  }
});

// The page.
//
// Five sections, in the order you have to do them: which phone, which OS,
// which build, which files, then the procedure itself. Each one unlocks the
// next; nothing is hidden, so you can read the whole procedure before
// committing to any of it.

import type {
  Artifact, BuildInfo, DeviceDatabase, DeviceRecord, Distro, Plan, ResolvedArtifact,
  Step, StepContext,
} from "../types";
import { allDistros } from "../distros";
import { AdbSession } from "../core/adb";
import { FastbootSession, describeFastbootError } from "../core/fastboot";
import { sha256File } from "../core/sha256";
import { methodInfo } from "../core/methods";
import { add, bytes, clear, el } from "./dom";

interface Detection {
  source: "adb" | "fastboot";
  codename: string | null;
  detail: string[];
}

const state = {
  db: null as DeviceDatabase | null,
  distros: [] as Distro[],
  device: null as DeviceRecord | null,
  detection: null as Detection | null,
  distro: null as Distro | null,
  builds: null as BuildInfo[] | null,
  build: null as BuildInfo | null,
  plan: null as Plan | null,
  files: new Map<string, ResolvedArtifact>(),
  done: new Set<string>(),
  running: null as string | null,
  fastbootSession: null as FastbootSession | null,
  adbSession: null as AdbSession | null,
};

const view = {
  device: el("div"),
  os: el("div"),
  files: el("div"),
  procedure: el("div"),
  console: el("div", { id: "console" }),
};

// --------------------------------------------------------------------- log

function log(line: string, level: "info" | "warn" | "error" | "ok" = "info"): void {
  const time = new Date().toTimeString().slice(0, 8);
  view.console.append(
    el("div", { class: level }, el("span", { class: "t" }, `${time}  `), line),
  );
  view.console.scrollTop = view.console.scrollHeight;
}

// ------------------------------------------------------------------- start

export async function start(root: HTMLElement): Promise<void> {
  const response = await fetch(new URL("data/devices.json", document.baseURI));
  state.db = (await response.json()) as DeviceDatabase;
  state.distros = await allDistros();

  root.append(
    el("header", { class: "top" },
      el("div", { class: "wrap" },
        el("h1", {}, "openflash"),
        el("p", {},
          "Install LineageOS and other alternative Android systems from a browser. " +
          "It talks to the phone over WebUSB, does the parts a machine should do, " +
          "and tells you plainly which parts only you can do.",
        ),
      ),
    ),
    el("div", { class: "wrap" },
      support(),
      card("1 — Device", view.device),
      card("2 — Operating system", view.os),
      card("3 — Files", view.files),
      card("4 — Procedure", view.procedure),
      card("Log", view.console),
      el("footer", {},
        el("p", {},
          `Device data generated from the LineageOS wiki (${state.db.count} devices, ` +
          `${state.db.source.repo}@${state.db.source.commit.slice(0, 8)}, ` +
          `${state.db.generated}). `,
          el("a", { href: "https://wiki.lineageos.org/", target: "_blank", rel: "noreferrer" },
            "The wiki is the authority"),
          " — where this page and the wiki disagree, the wiki is right.",
        ),
        el("p", {},
          "Nothing is uploaded anywhere. The files you supply are read in the page " +
          "and sent to your phone over USB.",
        ),
      ),
    ),
  );

  renderDevice();
  renderOs();
  renderFiles();
  renderProcedure();
  log(`loaded ${state.db.count} devices and ${state.distros.length} systems`);
  await applyUrl();
}

/**
 * `?device=sunfish&os=lineageos` selects both up front. Worth having so a link
 * can point somebody straight at the procedure for their exact phone, rather
 * than at a search box and a hope they pick the right variant.
 */
async function applyUrl(): Promise<void> {
  const params = new URLSearchParams(location.search);

  const wanted = params.get("device");
  if (wanted) {
    const device = matchCodename(wanted);
    if (device) selectDevice(device, null);
    else log(`the URL asks for device "${wanted}", which is not in the database`, "warn");
    renderDevice();
  }

  const os = params.get("os");
  if (os && state.device) {
    const distro = state.distros.find((d) => d.id === os || d.id === `profile:${os}`);
    if (distro) await selectDistro(distro);
    else log(`the URL asks for system "${os}", which this build does not know about`, "warn");
  }
}

/** Keep the address bar in step, so the page can be linked or reloaded. */
function syncUrl(): void {
  const params = new URLSearchParams();
  if (state.device) params.set("device", state.device.id);
  if (state.distro) params.set("os", state.distro.id.replace(/^profile:/, ""));
  const query = params.toString();
  history.replaceState(null, "", query ? `?${query}` : location.pathname);
}

function card(title: string, body: HTMLElement): HTMLElement {
  return el("section", { class: "card" },
    el("h2", {}, title),
    el("div", { class: "body" }, body),
  );
}

function support(): HTMLElement {
  if (navigator.usb) {
    return el("div", { class: "banner good" },
      el("h3", {}, "WebUSB available"),
      el("p", {}, "This browser can talk to the phone directly, so the flashing steps run from here."),
    );
  }
  return el("div", { class: "banner bad" },
    el("h3", {}, "No WebUSB in this browser"),
    el("p", {},
      "Firefox and Safari do not implement WebUSB, so this page cannot drive your " +
      "phone. Everything else still works: pick your device and system, and you get " +
      "the exact adb and fastboot commands for it, in order, with the manual steps " +
      "in the right places.",
    ),
    el("p", {}, "For the automated version, use Chrome, Edge, or another Chromium browser."),
  );
}

// ------------------------------------------------------------------ device

function renderDevice(): void {
  clear(view.device);

  if (state.device) {
    const d = state.device;
    const method = methodInfo(d.install_method);
    view.device.append(
      el("div", { class: "row" },
        el("div", { class: "grow" },
          el("div", {}, el("strong", {}, `${d.vendor} ${d.name}`), " ",
            el("span", { class: "codename" }, d.codename)),
          el("div", { class: "small dim" },
            [
              d.architecture.cpu,
              d.is_ab_device ? "A/B slots" : "single slot",
              `install method: ${d.install_method ?? "none"}`,
              d.maintained ? "maintained" : "no current maintainer",
            ].join(" · "),
          ),
        ),
        el("button", { class: "ghost", onclick: () => { state.device = null; resetFrom("device"); syncUrl(); } }, "Change"),
      ),
      state.detection
        ? el("div", { class: "banner good" },
            el("h3", {}, `Detected over ${state.detection.source}`),
            ...state.detection.detail.map((line) => el("p", { class: "small" }, line)),
          )
        : el("p", { class: "small dim" }, "Selected by hand. Connect the phone below to have it checked against the hardware."),
      method.engine === "unsupported"
        ? el("div", { class: "banner bad" },
            el("h3", {}, "This tool cannot flash this device"),
            el("p", {}, method.why ?? ""),
            el("p", {}, "The procedure below will not be offered. Follow the wiki page for this device instead."),
          )
        : el("div"),
    );
    renderOs();
    return;
  }

  const results = el("ul", { class: "devices" });
  const search = el("input", {
    type: "search",
    placeholder: "Search 700+ devices by name or codename — 'Pixel 4a', 'sunfish', 'FP4'",
    oninput: () => showMatches(search.value, results),
  });

  add(view.device,
    el("div", { class: "row" },
      navigator.usb
        ? el("button", { class: "primary", onclick: detectViaAdb },
            "Detect — phone booted, USB debugging on")
        : null,
      navigator.usb
        ? el("button", { onclick: detectViaFastboot }, "Detect — phone in bootloader")
        : null,
    ),
    navigator.usb
      ? el("p", { class: "small dim" },
          "Detection reads the codename and lock state off the phone. The two buttons " +
          "exist because a booted phone and a bootloader are different USB devices — " +
          "pick the one matching what is on screen.")
      : null,
    el("p", { class: "small dim" }, "Or find it by hand:"),
    search,
    results,
  );

  showMatches("", results);
}

function showMatches(query: string, into: HTMLElement): void {
  clear(into);
  const devices = state.db?.devices ?? [];
  const q = query.trim().toLowerCase();

  const matches = (q
    ? devices.filter((d) =>
        d.name.toLowerCase().includes(q) ||
        d.codename.toLowerCase().includes(q) ||
        d.vendor.toLowerCase().includes(q) ||
        (d.models ?? []).some((m) => m.toLowerCase().includes(q)))
    : devices
  ).slice(0, 200);

  if (matches.length === 0) {
    into.append(el("li", {}, el("div", { class: "small dim", style: "padding:10px 14px" },
      "Nothing matches. Devices are listed by the codename the wiki uses, which is " +
      "often not the marketing name.")));
    return;
  }

  for (const device of matches) {
    into.append(el("li", {},
      el("button", { onclick: () => selectDevice(device, null) },
        el("span", {}, `${device.vendor} ${device.name}`), " ",
        el("span", { class: "codename" }, device.id),
        device.maintained ? null : el("span", { class: "small dim" }, "  · unmaintained"),
      ),
    ));
  }
}

function selectDevice(device: DeviceRecord, detection: Detection | null): void {
  state.device = device;
  state.detection = detection;
  resetFrom("device");
  syncUrl();
  log(`device: ${device.vendor} ${device.name} (${device.codename})`, "ok");
}

/** Look the detected codename up in the database. */
function matchCodename(codename: string): DeviceRecord | null {
  const devices = state.db?.devices ?? [];
  // Prefer an exact id match, then any variant sharing the codename. Variants
  // differ in things like modem bands, so if there is more than one we cannot
  // pick for the user.
  const exact = devices.find((d) => d.id === codename);
  if (exact) return exact;
  const variants = devices.filter((d) => d.codename === codename);
  return variants.length === 1 ? variants[0]! : null;
}

async function detectViaAdb(): Promise<void> {
  try {
    log("asking for an ADB device");
    const session = await AdbSession.open();
    state.adbSession = session;
    const props = await session.props();

    if (props.recovery) {
      log("this device is in recovery, not a booted system", "warn");
    }

    const detail = [
      `serial ${session.serial}`,
      `codename ${props.device ?? "unreported"}`,
      `model ${props.model ?? "unreported"}`,
      props.androidVersion ? `stock Android ${props.androidVersion}` : "Android version unreported",
      props.securityPatch ? `security patch ${props.securityPatch}` : "",
      props.locked === null ? "lock state unreported" : props.locked ? "bootloader locked" : "bootloader unlocked",
    ].filter(Boolean);

    for (const line of detail) log(line);
    finishDetection(props.device, { source: "adb", codename: props.device, detail });
  } catch (err) {
    log(`ADB detection failed: ${(err as Error).message}`, "error");
    log("if the phone is showing an 'Allow USB debugging' prompt, accept it and try again", "warn");
  }
}

async function detectViaFastboot(): Promise<void> {
  try {
    log("asking for a fastboot device");
    const session = await FastbootSession.open();
    state.fastbootSession = session;
    const vars = await session.probe();
    const unlocked = await session.unlocked();

    const detail = [
      `product ${vars.product ?? "unreported"}`,
      `serial ${vars.serialno ?? "unreported"}`,
      vars["version-bootloader"] ? `bootloader ${vars["version-bootloader"]}` : "",
      vars["slot-count"] ? `${vars["slot-count"]} slots, current ${vars["current-slot"] ?? "?"}` : "",
      unlocked === null ? "lock state unreported" : unlocked ? "bootloader unlocked" : "bootloader locked",
    ].filter(Boolean);

    for (const line of detail) log(line);
    finishDetection(vars.product, { source: "fastboot", codename: vars.product, detail });
  } catch (err) {
    log(`fastboot detection failed: ${describeFastbootError(err)}`, "error");
  }
}

function finishDetection(codename: string | null | undefined, detection: Detection): void {
  if (!codename) {
    log("the device did not report a codename; pick it from the list below", "warn");
    return;
  }
  const device = matchCodename(codename);
  if (!device) {
    log(
      `"${codename}" is not a single entry in the wiki's device list — it may be a ` +
        `device with several variants, or one LineageOS does not build for. Search ` +
        `for it below.`,
      "warn",
    );
    return;
  }
  selectDevice(device, detection);
  renderDevice();
}

// ---------------------------------------------------------------------- os

function renderOs(): void {
  clear(view.os);
  const device = state.device;

  if (!device) {
    view.os.append(el("p", { class: "dim" }, "Pick a device first."));
    return;
  }
  if (methodInfo(device.install_method).engine === "unsupported") {
    view.os.append(el("p", { class: "dim" }, "Not applicable — this device cannot be flashed from a browser."));
    return;
  }

  const grid = el("div", { class: "os-grid" });
  view.os.append(grid);

  for (const distro of state.distros) {
    const cardEl = el("div", { class: `os${state.distro === distro ? " selected" : ""}` },
      el("h3", {}, distro.name),
      el("div", { class: "blurb" }, distro.blurb),
      el("div", { class: "small dim" }, "checking support…"),
    );
    grid.append(cardEl);

    void distro.supports(device).then((support) => {
      const tag = el("span", {
        class: `tag ${support.supported ? "ok" : "warn"}`,
      }, support.supported ? "supported" : "check first");

      cardEl.replaceChildren(
        el("div", { class: "row" }, el("h3", { class: "grow" }, distro.name), tag),
        el("div", { class: "blurb" }, distro.blurb),
        el("div", { class: "small dim" }, support.detail),
        el("div", { class: "row" },
          el("button", {
            class: state.distro === distro ? "primary" : "",
            onclick: () => void selectDistro(distro),
          }, state.distro === distro ? "Selected" : "Use this"),
          support.href
            ? el("a", { class: "small", href: support.href, target: "_blank", rel: "noreferrer" }, "Project page")
            : null,
        ),
      );
    });
  }
}

async function selectDistro(distro: Distro): Promise<void> {
  state.distro = distro;
  resetFrom("os");
  syncUrl();
  log(`system: ${distro.name}`, "ok");

  if (distro.builds && state.device) {
    try {
      log(`looking up builds for ${state.device.codename}`);
      state.builds = await distro.builds(state.device);
      state.build = state.builds[0] ?? null;
      log(
        state.build
          ? `newest build: ${state.build.version}, ${state.build.date}`
          : "no builds published for this device",
        state.build ? "ok" : "warn",
      );
    } catch (err) {
      log(`could not read the build list: ${(err as Error).message}`, "warn");
      log("falling back to unverified downloads — you will have to check the checksums yourself", "warn");
      state.builds = null;
      state.build = null;
    }
  }

  await rebuildPlan();
  renderOs();
  renderFiles();
  renderProcedure();
}

async function rebuildPlan(): Promise<void> {
  if (!state.device || !state.distro) {
    state.plan = null;
    return;
  }
  state.plan = await state.distro.plan(state.device, state.build);
}

// ------------------------------------------------------------------- files

function renderFiles(): void {
  clear(view.files);
  const plan = state.plan;

  if (!plan) {
    view.files.append(el("p", { class: "dim" }, "Pick a device and a system first."));
    return;
  }
  if (plan.unsupported) {
    view.files.append(el("p", { class: "dim" }, "Not applicable."));
    return;
  }

  if (state.builds && state.builds.length > 1) {
    const select = el("select", {
      onchange: async () => {
        state.build = state.builds![Number(select.value)] ?? null;
        state.files.clear();
        await rebuildPlan();
        renderFiles();
        renderProcedure();
      },
    });
    state.builds.forEach((build, index) => {
      select.append(el("option", { value: index, selected: build === state.build },
        `${build.version} — ${build.date}`));
    });
    view.files.append(el("div", { class: "row" }, el("span", { class: "small dim" }, "Build:"), el("div", { class: "grow" }, select)));
  }

  view.files.append(
    el("div", { class: "banner" },
      el("h3", {}, "Why you download these yourself"),
      el("p", {},
        "The OS projects' download mirrors do not permit a web page to fetch from " +
        "them, so this page cannot download the files for you. Follow each link, then " +
        "drop the file back in here.",
      ),
      state.build
        ? el("p", {},
            "LineageOS does publish a machine-readable manifest, so every file you drop " +
            "in is hashed here and checked against the SHA-256 for this exact build. A " +
            "file that does not match will not be flashed.",
          )
        : el("p", {},
            "No manifest is available for this system, so the hash of each file is shown " +
            "for you to compare against the project's own checksum. Do compare it.",
          ),
    ),
  );

  for (const artifact of plan.artifacts) {
    view.files.append(artifactRow(artifact));
  }
}

function artifactRow(artifact: Artifact): HTMLElement {
  const resolved = state.files.get(artifact.key);
  const status = resolved?.status;
  const row = el("div", {
    class: `artifact${status === "verified" ? " verified" : status === "mismatch" ? " mismatch" : ""}`,
  });

  const input = el("input", {
    type: "file",
    style: "display:none",
    onchange: () => {
      const file = input.files?.[0];
      if (file) void acceptFile(artifact, file);
    },
  });

  const drop = el("div", { class: "drop", onclick: () => input.click() },
    resolved ? "Replace file" : "Choose a file, or drop it here");

  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("over");
    const file = (event as DragEvent).dataTransfer?.files[0];
    if (file) void acceptFile(artifact, file);
  });

  add(row,
    el("div", { class: "row" },
      el("div", { class: "grow" },
        el("div", { class: "name" }, artifact.label, artifact.optional ? el("span", { class: "dim small" }, "  (optional)") : null),
        artifact.filename ? el("div", { class: "file" }, artifact.filename, artifact.size ? `  ·  ${bytes(artifact.size)}` : "") : null,
      ),
      artifact.url
        ? el("a", { href: artifact.url, target: "_blank", rel: "noreferrer", class: "small" }, "Download ↗")
        : null,
    ),
    artifact.note ? el("p", { class: "small dim" }, artifact.note) : null,
    drop,
    input,
  );

  if (resolved) {
    const tag =
      resolved.status === "verified" ? el("span", { class: "tag ok" }, "sha-256 verified")
      : resolved.status === "mismatch" ? el("span", { class: "tag bad" }, "sha-256 mismatch")
      : el("span", { class: "tag warn" }, "unverified");

    add(row,
      el("div", { class: "row", style: "margin-top:10px" }, tag,
        el("span", { class: "small dim" }, `${resolved.file.name} · ${bytes(resolved.file.size)}`)),
      el("div", { class: "file", style: "margin-top:6px" }, resolved.sha256),
      resolved.status === "mismatch"
        ? el("div", { class: "banner bad", style: "margin-top:10px" },
            el("p", {},
              "This is not the file the manifest describes. Re-download it — a truncated " +
              "or tampered image is exactly what verification exists to catch. It will " +
              "not be flashed."),
            artifact.sha256 ? el("p", { class: "file" }, `expected ${artifact.sha256}`) : null)
        : null,
    );
  }

  return row;
}

async function acceptFile(artifact: Artifact, file: File): Promise<void> {
  log(`hashing ${file.name} (${bytes(file.size)})`);

  if (artifact.size !== undefined && file.size !== artifact.size) {
    log(`size is ${file.size}, manifest says ${artifact.size}`, "warn");
  }

  const digest = await sha256File(file, () => {});
  const status: ResolvedArtifact["status"] = artifact.sha256
    ? digest === artifact.sha256 ? "verified" : "mismatch"
    : "unverified";

  state.files.set(artifact.key, { artifact, file, sha256: digest, status });

  log(
    status === "verified" ? `${file.name} matches the manifest`
    : status === "mismatch" ? `${file.name} does NOT match the manifest`
    : `${file.name}: sha256 ${digest} (nothing to check it against)`,
    status === "verified" ? "ok" : status === "mismatch" ? "error" : "warn",
  );

  renderFiles();
  renderProcedure();
}

// --------------------------------------------------------------- procedure

function renderProcedure(): void {
  clear(view.procedure);
  const plan = state.plan;

  if (!plan) {
    view.procedure.append(el("p", { class: "dim" }, "Pick a device and a system first."));
    return;
  }

  if (plan.unsupported) {
    view.procedure.append(
      el("div", { class: "banner bad" },
        el("h3", {}, "No procedure for this device"),
        el("p", {}, plan.unsupported),
        plan.reference ? el("p", {}, el("a", { href: plan.reference.href, target: "_blank", rel: "noreferrer" }, plan.reference.label)) : null,
      ),
    );
    return;
  }

  view.procedure.append(
    el("div", { class: "row" },
      el("div", { class: "grow" },
        el("strong", {}, `${plan.os}${plan.osVersion ? ` ${plan.osVersion}` : ""}`),
        el("span", { class: "dim" }, ` on ${plan.device.vendor} ${plan.device.name}`),
      ),
      plan.reference
        ? el("a", { href: plan.reference.href, target: "_blank", rel: "noreferrer", class: "small" }, plan.reference.label)
        : null,
    ),
  );

  let index = 0;
  for (const phase of plan.phases) {
    const phaseEl = el("div", { class: "phase" },
      el("h3", {}, phase.title),
      phase.summary ? el("p", { class: "summary" }, phase.summary) : null,
    );
    for (const step of phase.steps) {
      index += 1;
      phaseEl.append(stepRow(step, index));
    }
    view.procedure.append(phaseEl);
  }
}

function stepRow(step: Step, index: number): HTMLElement {
  const done = state.done.has(step.id);
  const running = state.running === step.id;
  const missing = (step.needs ?? []).filter((key) => {
    const resolved = state.files.get(key);
    if (!resolved) {
      // An optional artefact that was never supplied is not "missing".
      const artifact = state.plan?.artifacts.find((a) => a.key === key);
      return !artifact?.optional;
    }
    return resolved.status === "mismatch";
  });

  const row = el("div", {
    class: `step${done ? " done" : ""}${running ? " active" : ""}${step.danger ? " danger-step" : ""}`,
  });

  const detail = el("div", { class: "detail" });
  const head = el("div", { class: "head", onclick: () => detail.toggleAttribute("hidden") },
    el("span", { class: "idx" }, String(index).padStart(2, "0")),
    el("span", { class: "title" }, step.title, step.optional ? el("span", { class: "dim" }, "  (optional)") : null),
    el("span", { class: "state" }, done ? "done" : running ? "running…" : step.run ? "automatic" : "manual"),
  );

  for (const body of step.body ?? []) {
    if ("text" in body) detail.append(el("p", {}, body.text));
    else if ("warn" in body) detail.append(el("p", { class: "body-warn" }, body.warn));
    else if ("note" in body) detail.append(el("p", { class: "body-note small" }, body.note));
    else if ("code" in body) detail.append(el("pre", { class: "cmd" }, body.code));
    else detail.append(el("p", {}, el("a", { href: body.href, target: "_blank", rel: "noreferrer" }, body.link)));
  }

  if (step.commands?.length) {
    detail.append(
      el("div", { class: "cmds" },
        el("h4", {}, step.run ? "Equivalent commands, if you would rather do it yourself" : "Commands"),
        el("pre", { class: "cmd" }, step.commands.join("\n")),
      ),
    );
  }

  if (missing.length > 0) {
    detail.append(
      el("p", { class: "body-warn small" },
        `Needs a verified file first: ${missing.join(", ")}. Supply it in section 3.`),
    );
  }

  const progress = el("progress", { max: 1, value: 0, hidden: true });
  const progressLabel = el("span", { class: "small dim" });
  detail.append(el("div", { class: "row" }, progress, progressLabel));

  const actions = el("div", { class: "row" });

  if (step.run && navigator.usb) {
    actions.append(
      el("button", {
        class: step.danger ? "danger" : "primary",
        disabled: running || missing.length > 0,
        onclick: () => void runStep(step, progress, progressLabel),
      }, step.danger === "wipe" ? "Run — this erases the phone" : "Run"),
    );
  } else if (step.run && !navigator.usb) {
    actions.append(el("span", { class: "small dim" }, "Run the commands above; this browser cannot do it for you."));
  }

  if (step.confirm || !step.run) {
    actions.append(
      el("button", {
        class: "ghost",
        onclick: () => {
          if (state.done.has(step.id)) state.done.delete(step.id);
          else state.done.add(step.id);
          renderProcedure();
        },
      }, done ? "Undo" : (step.confirm ?? "Mark done")),
    );
  }

  detail.append(actions);
  if (done) detail.setAttribute("hidden", "");
  row.append(head, detail);
  return row;
}

async function runStep(
  step: Step,
  progress: HTMLProgressElement,
  label: HTMLElement,
): Promise<void> {
  if (state.running) return;

  if (step.danger === "wipe") {
    const ok = confirm(
      `${step.title}\n\nThis erases everything on the phone, including internal ` +
        `storage. It cannot be undone.\n\nContinue?`,
    );
    if (!ok) {
      log("cancelled", "warn");
      return;
    }
  }

  state.running = step.id;
  renderProcedure();
  log(`— ${step.title}`);

  const ctx: StepContext = {
    device: state.device!,
    file: (key) => {
      const resolved = state.files.get(key);
      if (!resolved) throw new Error(`No file supplied for "${key}".`);
      if (resolved.status === "mismatch") {
        throw new Error(`The file for "${key}" failed verification; refusing to flash it.`);
      }
      return resolved.file;
    },
    has: (key) => state.files.has(key),
    log,
    progress: (fraction, text) => {
      if (fraction === null) {
        progress.hidden = true;
        label.textContent = "";
        return;
      }
      progress.hidden = false;
      progress.value = fraction;
      label.textContent = `${text ?? ""} ${Math.round(fraction * 100)}%`;
    },
    fastboot: getFastboot,
    adb: getAdb,
  };

  try {
    await step.run!(ctx);
    state.done.add(step.id);
    log(`${step.title} — done`, "ok");
  } catch (err) {
    log(`${step.title} — failed: ${describeFastbootError(err)}`, "error");
    log("stop here. Do not run the next step on top of a failure.", "warn");
  } finally {
    state.running = null;
    progress.hidden = true;
    renderProcedure();
  }
}

/**
 * Sessions do not survive the phone rebooting, which it does several times
 * during an install. Both getters re-open on demand — and because they are
 * only ever reached from a button click, the browser still counts it as the
 * user gesture that WebUSB requires.
 */
async function getFastboot(): Promise<FastbootSession> {
  if (state.fastbootSession?.connected) return state.fastbootSession;
  log("connecting to fastboot");
  state.fastbootSession = await FastbootSession.open();
  return state.fastbootSession;
}

async function getAdb(): Promise<AdbSession> {
  if (state.adbSession?.alive) return state.adbSession;
  if (state.adbSession) log("the previous ADB connection is gone; reconnecting");
  log("connecting over ADB");
  state.adbSession = await AdbSession.open();
  return state.adbSession;
}

/** Clear everything downstream of whatever the user just changed. */
function resetFrom(level: "device" | "os"): void {
  if (level === "device") {
    state.distro = null;
    state.builds = null;
    state.build = null;
  }
  state.plan = null;
  state.files.clear();
  state.done.clear();
  renderDevice();
  renderOs();
  renderFiles();
  renderProcedure();
}

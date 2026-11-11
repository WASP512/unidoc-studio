/**
 * Updates from the web interface (server installs made by deploy/provision-debian.sh).
 *
 * The app runs as an unprivileged user and cannot update itself. It can only
 * (1) create an empty request file, which a root-owned systemd path unit turns
 * into a run of /usr/local/sbin/unidoc-studio-update, and (2) read the progress
 * that run writes into a root-owned folder. Nothing the app writes is read by
 * the updater, so the app cannot choose what gets installed.
 *
 * The feature is on only when the service sets UNIDOC_UPDATE_DIR; a desktop or
 * Docker install has no updater and reports `supported: false`.
 *
 * On those server installs the app also asks GitHub which commit is the latest,
 * so the page can say when an update is waiting. That is one anonymous request
 * for a commit id, at most every 30 minutes, and it sends nothing about this
 * install. Set UNIDOC_UPDATE_CHECK=off on the service to switch it off.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import pkg from "../../package.json";

export type UpdateState = "idle" | "running" | "done" | "uptodate" | "failed";

export interface UpdateStep {
  at: number; // epoch seconds
  percent: number | null;
  label: string;
}

export interface UpdateStatus {
  supported: boolean;
  version: string;
  /** Installed commit, "" when unknown. */
  commit: string;
  /** Identifies one run of the updater; changes when a new run starts. */
  run: string;
  state: UpdateState;
  startedAt: number | null;
  finishedAt: number | null;
  from: string;
  to: string;
  error: string;
  steps: UpdateStep[];
  log: string[];
  /** Latest commit on the update source, "" when not known (not checked yet, check failed or switched off). */
  latest: string;
  /** True when the latest commit is known and is not the installed one. */
  updateAvailable: boolean;
  checkedAt: number | null;
}

const STALE_AFTER_S = 45 * 60;
const LOG_LINES = 14;
const SHA = /^[0-9a-f]{40}$/;

const CHECK_EVERY_MS = 30 * 60 * 1000;
const RETRY_AFTER_MS = 5 * 60 * 1000;
const CHECK_TIMEOUT_MS = 6000;
const DEFAULT_SOURCE = { repo: "WASP512/unidoc-studio", ref: "main" };

/** Kept in memory: a page refresh reuses the last answer instead of asking GitHub again. */
let latestCache: { key: string; sha: string; at: number; ok: boolean } | null = null;
let latestInFlight: Promise<void> | null = null;

const base = (): string | null => {
  const dir = process.env.UNIDOC_UPDATE_DIR;
  return dir && path.isAbsolute(dir) ? dir : null;
};

async function read(file: string, maxBytes = 64 * 1024): Promise<{ text: string; mtime: number } | null> {
  try {
    const handle = await fs.open(file, "r");
    try {
      const stat = await handle.stat();
      const length = Math.min(stat.size, maxBytes);
      const buffer = Buffer.alloc(length);
      if (length) await handle.read(buffer, 0, length, stat.size - length); // the tail
      return { text: buffer.toString("utf8"), mtime: Math.floor(stat.mtimeMs / 1000) };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

const clean = (line: string) =>
  line
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trimEnd()
    .slice(0, 220);

const tail = (text: string, lines: number) =>
  text
    .split(/\r?\n|\r/)
    .map(clean)
    .filter((l) => l.trim())
    .slice(-lines);

export async function updateSupported(): Promise<boolean> {
  const dir = base();
  if (!dir) return false;
  try {
    const [update, request] = await Promise.all([fs.stat(path.join(dir, "update")), fs.stat(path.join(dir, "request"))]);
    return update.isDirectory() && request.isDirectory();
  } catch {
    return false;
  }
}

export async function readUpdateStatus(): Promise<UpdateStatus> {
  const status: UpdateStatus = {
    supported: false,
    version: pkg.version,
    commit: "",
    run: "",
    state: "idle",
    startedAt: null,
    finishedAt: null,
    from: "",
    to: "",
    error: "",
    steps: [],
    log: [],
    latest: "",
    updateAvailable: false,
    checkedAt: null,
  };
  const dir = base();
  if (!dir || !(await updateSupported())) return status;
  status.supported = true;
  const upd = path.join(dir, "update");

  const installed = (await read(path.join(upd, "installed"), 64))?.text.trim() ?? "";
  if (SHA.test(installed)) status.commit = installed;
  const withLatest = () => {
    if (!latestCache?.ok) return status;
    status.latest = latestCache.sha;
    status.checkedAt = Math.floor(latestCache.at / 1000);
    status.updateAvailable = Boolean(status.commit) && latestCache.sha !== status.commit;
    return status;
  };

  const raw = await read(path.join(upd, "status"), 4096);
  if (!raw) return withLatest();
  const field: Record<string, string> = {};
  for (const line of raw.text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) field[line.slice(0, i)] = line.slice(i + 1);
  }
  const num = (v: string | undefined) => (v && /^\d{1,12}$/.test(v) ? Number(v) : null);
  status.run = /^[\w-]{1,40}$/.test(field.run ?? "") ? field.run : "";
  status.state = (["running", "done", "uptodate", "failed"] as const).find((s) => s === field.state) ?? "idle";
  status.startedAt = num(field.started);
  status.finishedAt = num(field.finished);
  status.from = SHA.test(field.from ?? "") ? field.from : "";
  status.to = SHA.test(field.to ?? "") ? field.to : "";
  status.error = clean(field.error ?? "").slice(0, 600);

  const steps = await read(path.join(upd, "steps"), 16 * 1024);
  let lastActivity = Math.max(status.startedAt ?? 0, raw.mtime, steps?.mtime ?? 0);
  for (const line of steps?.text.split("\n") ?? []) {
    const [at, percent, ...label] = line.split("\t");
    if (!label.length || !/^\d+$/.test(at)) continue;
    status.steps.push({ at: Number(at), percent: /^\d{1,3}$/.test(percent) ? Math.min(100, Number(percent)) : null, label: clean(label.join(" ")) });
  }

  if (status.state === "running" || status.state === "failed") {
    const [own, build] = await Promise.all([read(path.join(upd, "log")), read(path.join(upd, "build.log"))]);
    // The build log is shared with earlier runs; show it only once this run has written to it.
    const buildIsCurrent = build && status.startedAt !== null && build.mtime >= status.startedAt;
    if (buildIsCurrent) lastActivity = Math.max(lastActivity, build.mtime);
    const building = buildIsCurrent && status.state === "running" && /build/i.test(status.steps.at(-1)?.label ?? "");
    status.log = tail(building ? build.text : `${buildIsCurrent && status.state === "failed" ? `${build.text}\n` : ""}${own?.text ?? ""}`, LOG_LINES);
  }

  // The updater has just looked for itself: what it found is newer than a remembered answer.
  if (latestCache && status.to && status.finishedAt !== null && (status.state === "done" || status.state === "uptodate") && status.finishedAt * 1000 > latestCache.at) {
    latestCache = { ...latestCache, sha: status.to, at: status.finishedAt * 1000, ok: true };
  }
  withLatest();

  // A run that was cut off (power loss, reboot) leaves "running" behind for ever.
  if (status.state === "running" && Date.now() / 1000 - lastActivity > STALE_AFTER_S) {
    status.state = "failed";
    status.error = "The update stopped without finishing. Start it again.";
  }
  return status;
}

/** Where the machine's updater takes updates from: recorded by the updater, GitHub main until it has run. */
async function updateSource(dir: string): Promise<{ repo: string; ref: string } | null> {
  const raw = await read(path.join(dir, "update", "source"), 1024);
  if (!raw) return DEFAULT_SOURCE;
  const field: Record<string, string> = {};
  for (const line of raw.text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) field[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  if (field.custom) return null; // a custom archive address: there is nothing to ask GitHub about
  const repo = field.repo ?? "";
  const ref = field.ref ?? "";
  if (!/^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(repo) || !/^[\w./-]{1,200}$/.test(ref) || ref.includes("..")) return DEFAULT_SOURCE;
  return { repo, ref };
}

/**
 * Finds the latest commit of the update source, at most once per CHECK_EVERY_MS.
 * Never throws: when GitHub cannot be reached the page simply shows no notice.
 */
export async function refreshLatest(): Promise<void> {
  const dir = base();
  if (!dir || /^(off|0|false|no)$/i.test(process.env.UNIDOC_UPDATE_CHECK ?? "") || !(await updateSupported())) return;
  const source = await updateSource(dir);
  if (!source) {
    latestCache = null;
    return;
  }
  const key = `${source.repo}@${source.ref}`;
  const age = latestCache && latestCache.key === key ? Date.now() - latestCache.at : Infinity;
  if (age < (latestCache?.ok ? CHECK_EVERY_MS : RETRY_AFTER_MS)) return;
  if (SHA.test(source.ref)) {
    latestCache = { key, sha: source.ref, at: Date.now(), ok: true }; // pinned to one commit
    return;
  }
  latestInFlight ??= (async () => {
    let sha = "";
    try {
      const res = await fetch(`https://api.github.com/repos/${source.repo}/commits/${encodeURIComponent(source.ref)}`, {
        headers: { Accept: "application/vnd.github.sha", "User-Agent": "unidoc-studio-update-check" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      const text = res.ok ? (await res.text()).trim() : "";
      if (SHA.test(text)) sha = text;
    } catch {
      /* offline, blocked or rate-limited: try again later */
    }
    latestCache = { key, sha, at: Date.now(), ok: Boolean(sha) };
  })().finally(() => {
    latestInFlight = null;
  });
  await latestInFlight;
}

/** Asks the updater to run. Resolves once the request file exists. */
export async function requestUpdate(): Promise<void> {
  const dir = base();
  if (!dir) throw new Error("Updates from the web interface are not set up on this install.");
  await fs.writeFile(path.join(dir, "request", "update"), "", { mode: 0o600 });
}

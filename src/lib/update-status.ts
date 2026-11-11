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
}

const STALE_AFTER_S = 45 * 60;
const LOG_LINES = 14;
const SHA = /^[0-9a-f]{40}$/;

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
  };
  const dir = base();
  if (!dir || !(await updateSupported())) return status;
  status.supported = true;
  const upd = path.join(dir, "update");

  const installed = (await read(path.join(upd, "installed"), 64))?.text.trim() ?? "";
  if (SHA.test(installed)) status.commit = installed;

  const raw = await read(path.join(upd, "status"), 4096);
  if (!raw) return status;
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

  // A run that was cut off (power loss, reboot) leaves "running" behind for ever.
  if (status.state === "running" && Date.now() / 1000 - lastActivity > STALE_AFTER_S) {
    status.state = "failed";
    status.error = "The update stopped without finishing. Start it again.";
  }
  return status;
}

/** Asks the updater to run. Resolves once the request file exists. */
export async function requestUpdate(): Promise<void> {
  const dir = base();
  if (!dir) throw new Error("Updates from the web interface are not set up on this install.");
  await fs.writeFile(path.join(dir, "request", "update"), "", { mode: 0o600 });
}

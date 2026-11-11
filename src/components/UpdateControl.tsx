"use client";

/**
 * Version label and one-click update for server installs.
 *
 * The button asks the machine's updater to install the latest version, shows
 * its progress, and reloads the page when the new version is running. The app
 * goes away for a few seconds while it is swapped, so a failed status request
 * during a run means "restarting", not "broken": polling simply carries on.
 * On installs without the updater (desktop, Docker) only the version is shown.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, CheckCircle2, Loader2, RefreshCw, X } from "lucide-react";
import type { UpdateStatus } from "@/lib/update-status";

type Phase = "closed" | "confirm" | "starting" | "running" | "reloading" | "uptodate" | "failed" | "nostart";

const POLL_MS = 1500;
const START_TIMEOUT_MS = 25_000;
const UPDATED_KEY = "unidoc-updated-to";
const short = (sha: string) => sha.slice(0, 7);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function fetchStatus(check = false): Promise<UpdateStatus | null> {
  try {
    const res = await fetch(check ? "/api/update?check=1" : "/api/update", { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return null;
    const body = (await res.json()) as UpdateStatus;
    return typeof body?.supported === "boolean" ? body : null;
  } catch {
    return null;
  }
}

/**
 * Renders at the end of <body>. The control sits in the page header, whose
 * backdrop blur makes it the containing block for `position: fixed`: a dialog
 * rendered in place would be squeezed into the 60px header and cut off.
 */
function Overlay({ children }: { children: ReactNode }) {
  return typeof document === "undefined" ? null : createPortal(children, document.body);
}

export function UpdateControl({ hasWork }: { hasWork: boolean }) {
  const [info, setInfo] = useState<UpdateStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("closed");
  const [hidden, setHidden] = useState(false);
  const [offline, setOffline] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [updatedTo, setUpdatedTo] = useState("");
  const ignoreRun = useRef(""); // the run that was already finished when the button was clicked
  const clickedAt = useRef(0);

  useEffect(() => {
    let alive = true;
    try {
      const done = sessionStorage.getItem(UPDATED_KEY);
      if (done !== null) {
        sessionStorage.removeItem(UPDATED_KEY);
        setUpdatedTo(done || "the latest version");
        setTimeout(() => alive && setUpdatedTo(""), 8000);
      }
    } catch {
      /* storage is unavailable in some private modes; the note is optional */
    }
    void fetchStatus().then((s) => {
      if (!alive || !s) return;
      setInfo(s);
      // An update started elsewhere (another tab, the command line) is shown here too.
      if (s.supported && s.state === "running") {
        ignoreRun.current = "";
        clickedAt.current = Date.now();
        setPhase("running");
      } else if (s.supported) {
        // Each time the page is opened or refreshed, ask whether a newer version is waiting.
        // The server keeps the answer for 30 minutes, so this is usually instant.
        void fetchStatus(true).then((checked) => {
          if (alive && checked) setInfo((current) => (current && current.run !== checked.run ? current : checked));
        });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const polling = phase === "starting" || phase === "running";
  useEffect(() => {
    if (!polling) return;
    let alive = true;
    const tick = async () => {
      const s = await fetchStatus();
      if (!alive) return;
      setNow(Date.now());
      if (!s) {
        setOffline(true);
        return;
      }
      setOffline(false);
      setInfo(s);
      if (s.run && s.run !== ignoreRun.current) {
        if (s.state === "running") setPhase("running");
        else if (s.state === "done") {
          setPhase("reloading");
          try {
            sessionStorage.setItem(UPDATED_KEY, s.to ? short(s.to) : "");
          } catch {
            /* optional */
          }
          setTimeout(() => window.location.reload(), 900);
        } else if (s.state === "uptodate") setPhase("uptodate");
        else if (s.state === "failed") setPhase("failed");
      } else if (Date.now() - clickedAt.current > START_TIMEOUT_MS) {
        setMessage("The updater on the server did not start. On the server, check: systemctl status unidoc-studio-update.path");
        setPhase("nostart");
      }
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [polling]);

  const start = useCallback(async () => {
    setHidden(false);
    setOffline(false);
    setMessage("");
    // Note the last finished run before anything is polled, so its "done" is not taken for this one.
    const before = await fetchStatus();
    ignoreRun.current = before?.run ?? info?.run ?? "";
    if (before) setInfo({ ...before, steps: [], log: [] });
    clickedAt.current = Date.now();
    setNow(Date.now());
    setPhase("starting");
    try {
      const res = await fetch("/api/update", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "X-UniDoc-Update": "1" } });
      if (res.status === 409) return; // already running: just follow it
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(body.error ?? `The update could not be started (${res.status}).`);
        setPhase("nostart");
      }
    } catch {
      setMessage("The update could not be started: the server did not answer.");
      setPhase("nostart");
    }
  }, [info]);

  if (!info) return null;
  const version = `v${info.version}${info.commit ? ` · ${short(info.commit)}` : ""}`;
  if (!info.supported) {
    return (
      <span className="hidden shrink-0 text-[11px] whitespace-nowrap text-slate-400 tabular-nums lg:inline" title="Installed version">
        {version}
      </span>
    );
  }

  const last = info.steps.at(-1);
  const sinceStep = last ? Math.max(0, now / 1000 - last.at) : 0;
  // Building is one long step with nothing to count, so let the bar creep while it runs.
  const creep = last && /build/i.test(last.label) ? 50 * (1 - Math.exp(-sinceStep / 120)) : 0;
  const percent = phase === "reloading" ? 100 : phase === "starting" || !last ? 1 : Math.min(99, Math.round((last.percent ?? 1) + creep));
  const elapsed = info.startedAt && phase === "running" ? Math.max(0, now / 1000 - info.startedAt) : 0;
  const busy = polling || phase === "reloading";
  const waiting = info.updateAvailable && !busy && phase !== "uptodate";

  return (
    <>
      <div className="flex shrink-0 items-center gap-2.5">
        <span className="hidden text-[11px] whitespace-nowrap text-slate-400 tabular-nums lg:inline" title="Installed version">
          {version}
        </span>
        <button
          type="button"
          onClick={() => {
            if (busy) setHidden(false);
            else if (hasWork) setPhase("confirm");
            else void start();
          }}
          data-update-available={waiting ? "true" : undefined}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition ${
            waiting ? "border-emerald-600 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          }`}
          title={
            waiting
              ? `A new version (${short(info.latest)}) is available. Click to install it. Installed: ${version}`
              : `Install the latest version of UniDoc Studio on this server (installed: ${version})`
          }
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : waiting ? (
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {busy ? (
            `Updating… ${percent}%`
          ) : waiting ? (
            <>
              Update<span className="hidden lg:inline"> available</span>
            </>
          ) : (
            "Update"
          )}
        </button>
      </div>

      {updatedTo && phase === "closed" && (
        <Overlay>
          <div role="status" className="fixed right-6 bottom-6 z-50 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-lg">
            <CheckCircle2 className="h-4 w-4" /> Updated to {updatedTo}
          </div>
        </Overlay>
      )}

      {phase !== "closed" && !hidden && (
        <Overlay>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-6" role="dialog" aria-modal="true" aria-label="Update UniDoc Studio">
          <div className="max-h-[calc(100vh-3rem)] w-full max-w-[520px] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
            {phase === "confirm" && (
              <>
                <h2 className="text-base font-semibold">Update UniDoc Studio?</h2>
                <p className="mt-2 text-sm text-slate-600">
                  The page reloads when the update finishes, which clears the site you have loaded. Save it as a snapshot first if you want to keep it.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button type="button" className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => setPhase("closed")}>
                    Cancel
                  </button>
                  <button type="button" className="rounded-lg bg-[#0f1e36] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#1b2f52]" onClick={() => void start()}>
                    Update now
                  </button>
                </div>
              </>
            )}

            {(busy || phase === "failed") && (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold">
                      {phase === "failed" ? "The update did not complete" : phase === "reloading" ? "Updated. Reloading…" : "Updating UniDoc Studio"}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                      {info.to && phase !== "starting" ? `${info.from ? short(info.from) : "installed version"} → ${short(info.to)}` : "Checking for a new version"}
                      {elapsed > 0 && ` · ${clock(elapsed)}`}
                    </p>
                  </div>
                  {polling && (
                    <button type="button" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={() => setHidden(true)} title="Hide (the update carries on)">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {phase !== "failed" && (
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                    <div className="h-full rounded-full bg-[#0f1e36] transition-[width] duration-700" style={{ width: `${percent}%` }} />
                  </div>
                )}

                <ol className="mt-4 space-y-1.5 text-sm" data-testid="update-steps">
                  {info.steps.map((s, i) => {
                    const current = i === info.steps.length - 1 && phase !== "reloading";
                    return (
                      <li key={`${s.at}-${i}`} className={`flex items-center gap-2 ${current ? "font-medium text-slate-900" : "text-slate-500"}`}>
                        {!current ? (
                          <Check className="h-4 w-4 text-emerald-600" />
                        ) : phase === "failed" ? (
                          <AlertTriangle className="h-4 w-4 text-red-600" />
                        ) : (
                          <Loader2 className="h-4 w-4 animate-spin text-[#0f1e36]" />
                        )}
                        {s.label}
                      </li>
                    );
                  })}
                </ol>

                {phase === "failed" && (
                  <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" data-testid="update-error">
                    {info.error || "The update stopped unexpectedly."}
                  </p>
                )}
                {polling && (
                  <p className="mt-4 text-xs text-slate-500">
                    {offline
                      ? "UniDoc Studio is restarting. Reconnecting…"
                      : "The current version keeps running until the new one is ready, then restarts for a few seconds. This page reloads by itself."}
                  </p>
                )}

                {info.log.length > 0 && (
                  <details className="mt-3" open={phase === "failed"}>
                    <summary className="cursor-pointer text-xs text-slate-500 select-none">Details</summary>
                    <pre className="mt-2 max-h-44 overflow-auto rounded-lg bg-slate-900 p-3 text-[10.5px] leading-[1.5] whitespace-pre-wrap text-slate-200">{info.log.join("\n")}</pre>
                  </details>
                )}

                {phase === "failed" && (
                  <div className="mt-5 flex justify-end gap-2">
                    <button type="button" className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => setPhase("closed")}>
                      Close
                    </button>
                    <button type="button" className="rounded-lg bg-[#0f1e36] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#1b2f52]" onClick={() => void start()}>
                      Try again
                    </button>
                  </div>
                )}
              </>
            )}

            {(phase === "uptodate" || phase === "nostart") && (
              <>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  {phase === "uptodate" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
                  {phase === "uptodate" ? "Already up to date" : "The update did not start"}
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  {phase === "uptodate" ? `This server is running the latest version (${version}).` : message}
                </p>
                <div className="mt-5 flex justify-end">
                  <button type="button" className="rounded-lg bg-[#0f1e36] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#1b2f52]" onClick={() => setPhase("closed")}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        </Overlay>
      )}
    </>
  );
}

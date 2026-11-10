"use client";

/**
 * UniDoc Studio — 3-step studio.
 *   1. Ephemeral import wizard (UniFi Cloud Proxy / UniFi Direct Local /
 *      MikroTik RouterOS / demo sites / snapshot file)
 *   2. Customization: branding, notes, template, theme, device identification
 *   3. Live paginated A4 preview + one-click PDF export
 *
 * Credentials (UniFi API key, RouterOS username/password) exist only in this
 * component's state and the password inputs, are sent only as request headers
 * (`X-UniFi-Api-Key` / `X-RouterOS-Credentials`), and are wiped on import
 * completion, cancel, tab close and refresh. Nothing is written to storage,
 * cookies or URLs.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Download,
  FileJson,
  FileText,
  Fingerprint,
  ImagePlus,
  KeyRound,
  Loader2,
  Minus,
  Plus,
  Router,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
  XCircle,
} from "lucide-react";
import type {
  ConnectionMode,
  DiscoveryResponse,
  ExportPayload,
  ImportResponse,
  MikrotikDiscoveryResponse,
  ReportConfig,
  SiteDocumentationSnapshot,
  TemplateId,
  ThemeId,
} from "@/types/unifi-documentation";
import { ReportDocument, countPages } from "@/components/report/ReportDocument";
import { isSnapshot, sanitizeSnapshot } from "@/lib/normalize-common";
import { THEMES } from "@/lib/themes";
import { cleanConfig, DEFAULT_CONFIG, LOGO_MAX_BYTES, LOGO_TYPES } from "@/lib/report-config";

/* ================================================================== defaults */

/** Loading a demo resets document details but keeps the chosen template, theme and options. */
const demoDefaults = (c: ReportConfig): ReportConfig => ({ ...DEFAULT_CONFIG, template: c.template, theme: c.theme, includeIdentification: c.includeIdentification });

/** base64(UTF-8 "user:password") for the X-RouterOS-Credentials header. */
function encodeCredentials(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

const parseList = (v: string) =>
  v
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

const TEMPLATES: { id: TemplateId; label: string; description: string }[] = [
  { id: "technical", label: "Technical", description: "Every table: all switch ports, all clients, all firewall rules." },
  { id: "professional", label: "Professional", description: "Client handover: no per-port tables, user-defined firewall rules only." },
  { id: "executive", label: "Executive", description: "KPIs, WAN health, topology and hardware inventory." },
];


type Busy = null | "discover" | "import" | "pdf";

async function postJson<T>(url: string, body: unknown, apiKey: string | null, signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { "X-UniFi-Api-Key": apiKey } : {}), ...(extraHeaders ?? {}) },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
  return json as T;
}

/* ================================================================== page */

export default function StudioPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // ---- ephemeral connection state (memory only)
  const [mode, setMode] = useState<ConnectionMode>("cloud");
  const [apiKey, setApiKey] = useState("");
  const [controllerUrl, setControllerUrl] = useState("");
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);
  const [hostId, setHostId] = useState("");
  const [siteKey, setSiteKey] = useState("");
  const keyInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // MikroTik (memory only)
  const [mtAddresses, setMtAddresses] = useState("");
  const [mtUser, setMtUser] = useState("");
  const [mtPassword, setMtPassword] = useState("");
  const [mtAllowHttp, setMtAllowHttp] = useState(false);
  const [mtDiscovery, setMtDiscovery] = useState<MikrotikDiscoveryResponse | null>(null);
  const mtPasswordRef = useRef<HTMLInputElement>(null);
  // shared
  const [pins, setPins] = useState("");
  const [historyDays, setHistoryDays] = useState(30);

  // ---- document state
  const [snapshot, setSnapshot] = useState<SiteDocumentationSnapshot | null>(null);
  const [config, setConfig] = useState<ReportConfig>(DEFAULT_CONFIG);
  const [issuedAt, setIssuedAt] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyWiped, setKeyWiped] = useState(false);
  const [zoom, setZoom] = useState(0.72);

  const wipeKey = useCallback(() => {
    setApiKey("");
    setMtPassword("");
    setMtUser("");
    if (keyInputRef.current) keyInputRef.current.value = "";
    if (mtPasswordRef.current) mtPasswordRef.current.value = "";
  }, []);

  // Wipe on tab close / refresh / bfcache.
  useEffect(() => {
    const handler = () => {
      abortRef.current?.abort();
      if (keyInputRef.current) keyInputRef.current.value = "";
      if (mtPasswordRef.current) mtPasswordRef.current.value = "";
    };
    window.addEventListener("pagehide", handler);
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("pagehide", handler);
      window.removeEventListener("beforeunload", handler);
    };
  }, []);

  const patch = useCallback((p: Partial<ReportConfig>) => setConfig((c) => ({ ...c, ...p })), []);

  const demoSeeded = useRef(false);
  const loadSnapshot = useCallback(
    (s: SiteDocumentationSnapshot, next: (current: ReportConfig) => Partial<ReportConfig> = (c) => c) => {
      setSnapshot(s);
      // Document details seeded by a demo site (fictional client/integrator) never carry over to the next site.
      const wasDemo = demoSeeded.current;
      demoSeeded.current = s.meta.source === "demo";
      // cleanConfig whitelists keys, caps lengths and only accepts real image data URIs for logos
      setConfig((c) => {
        const merged = { ...DEFAULT_CONFIG, ...next(wasDemo ? demoDefaults(c) : c) };
        return cleanConfig({ ...merged, siteName: merged.siteName || s.meta.siteName });
      });
      setIssuedAt(new Date().toISOString());
      setError(null);
      setStep(2);
    },
    [],
  );

  /* ---------------- step 1 actions */

  const discover = async () => {
    setError(null);
    setDiscovery(null);
    setBusy("discover");
    abortRef.current = new AbortController();
    try {
      const res = await postJson<DiscoveryResponse>("/api/unifi/discover", { mode, controllerUrl, pinSha256: parseList(pins) }, apiKey, abortRef.current.signal);
      setDiscovery(res);
      const firstSite = res.sites[0];
      setHostId(firstSite?.hostId ?? res.consoles[0]?.hostId ?? "");
      setSiteKey(firstSite ? `${firstSite.hostId}|${firstSite.siteId}` : "");
      if (!res.sites.length) setError("The key is valid but no UniFi Network sites were returned.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    if (!discovery) return;
    const site = discovery.sites.find((s) => `${s.hostId}|${s.siteId}` === siteKey);
    if (!site) return setError("Choose a site to import.");
    const consoleInfo = discovery.consoles.find((c) => c.hostId === site.hostId);
    setError(null);
    setBusy("import");
    abortRef.current = new AbortController();
    try {
      const res = await postJson<ImportResponse>(
        "/api/unifi/import",
        {
          mode,
          controllerUrl,
          hostId: site.hostId,
          siteId: site.siteId,
          cloudSiteId: site.cloudSiteId,
          siteName: site.name,
          consoleName: consoleInfo?.name,
          historyDays,
          pinSha256: parseList(pins),
        },
        apiKey,
        abortRef.current.signal,
      );
      wipeKey();
      setKeyWiped(true);
      setDiscovery(null);
      loadSnapshot(res.snapshot, (c) => ({ ...c, siteName: res.snapshot.meta.siteName }));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /* ---------------- MikroTik */

  const mtHeaders = () => ({ "X-RouterOS-Credentials": encodeCredentials(mtUser, mtPassword) });

  const mtDiscover = async () => {
    setError(null);
    setMtDiscovery(null);
    setBusy("discover");
    abortRef.current = new AbortController();
    try {
      const res = await postJson<MikrotikDiscoveryResponse>(
        "/api/mikrotik/discover",
        { addresses: parseList(mtAddresses), allowHttp: mtAllowHttp, pinSha256: parseList(pins) },
        null,
        abortRef.current.signal,
        mtHeaders(),
      );
      setMtDiscovery(res);
      if (!res.devices.some((d) => d.ok)) setError("No device answered. Check the addresses, www-ssl service, and the user's group policy.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const addSuggestion = (address: string) => setMtAddresses((v) => (parseList(v).includes(address) ? v : `${v.trim()}\n${address}`.trim()));

  const mtImport = async () => {
    setError(null);
    setBusy("import");
    abortRef.current = new AbortController();
    try {
      const reachable = mtDiscovery ? mtDiscovery.devices.filter((d) => d.ok).map((d) => d.address) : [];
      const addresses = [...new Set([...reachable, ...parseList(mtAddresses)])];
      const res = await postJson<ImportResponse>(
        "/api/mikrotik/import",
        { addresses, allowHttp: mtAllowHttp, pinSha256: parseList(pins), historyDays },
        null,
        abortRef.current.signal,
        mtHeaders(),
      );
      wipeKey();
      setKeyWiped(true);
      setMtDiscovery(null);
      loadSnapshot(res.snapshot, (c) => ({ ...c, siteName: res.snapshot.meta.siteName }));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    wipeKey();
    setDiscovery(null);
    setMtDiscovery(null);
    setHostId("");
    setSiteKey("");
    setBusy(null);
    setError(null);
  };

  const loadDemo = async (vendor: "unifi" | "mikrotik") => {
    wipeKey();
    setDiscovery(null);
    setMtDiscovery(null);
    setKeyWiped(false);
    setError(null);
    try {
      const res = await fetch(`/api/demo?vendor=${vendor}`, { cache: "no-store", credentials: "omit" });
      if (!res.ok) throw new Error(`Demo failed to load (${res.status})`);
      const { snapshot: s, config: demoConfig } = (await res.json()) as ImportResponse & { config?: Partial<ReportConfig> };
      loadSnapshot(s, (c) => ({ ...demoDefaults(c), ...(demoConfig ?? {}) }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openSnapshotFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const candidate = parsed?.snapshot ?? parsed;
      if (!isSnapshot(candidate)) throw new Error("This file is not a UniDoc snapshot.");
      wipeKey();
      setKeyWiped(false);
      const cfg = parsed?.config && typeof parsed.config === "object" ? (parsed.config as Partial<ReportConfig>) : {};
      loadSnapshot(sanitizeSnapshot(candidate), () => cfg);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveSnapshotFile = () => {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify({ snapshot, config }, null, 2)], { type: "application/json" });
    triggerDownload(blob, `unidoc-${(config.siteName || snapshot.meta.siteName).replace(/[^\w.-]+/g, "_")}.json`);
  };

  /* ---------------- PDF */

  const downloadPdf = async () => {
    if (!snapshot) return;
    setBusy("pdf");
    setError(null);
    try {
      const payload: ExportPayload = { snapshot, config, issuedAt };
      const res = await fetch("/api/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        credentials: "omit",
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Export failed (${res.status})`);
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "Documentation.pdf";
      triggerDownload(blob, name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pageCount = useMemo(() => (snapshot ? countPages(snapshot, config) : 0), [snapshot, config]);

  /* ---------------- render */

  return (
    <div className="min-h-screen text-slate-900">
      <TopBar step={step} canNavigate={Boolean(snapshot)} onStep={setStep} />

      <main className="mx-auto max-w-[1500px] px-6 pt-6 pb-16">
        {error && (
          <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1 break-words">{error}</div>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {step > 1 && keyWiped && snapshot && snapshot.meta.source === "mikrotik" && (
          <Banner tone="info" icon={<ShieldCheck className="h-4 w-4" />}>
            Import complete — the RouterOS username and password have been wiped from this tab&apos;s memory and were never stored. If you
            created a temporary read-only user, you can remove it now (<code>/user remove</code>). Re-theming and re-exporting use the
            sanitized snapshot only.
          </Banner>
        )}

        {step > 1 && keyWiped && snapshot && (snapshot.meta.source === "cloud" || snapshot.meta.source === "local") && (
          <Banner tone="info" icon={<ShieldCheck className="h-4 w-4" />}>
            Import complete — the API key has been wiped from this tab&apos;s memory and was never stored. You can revoke it now in{" "}
            {snapshot.meta.source === "cloud" ? (
              <>
                <b>UniFi Site Manager → API</b> (unifi.ui.com)
              </>
            ) : (
              <>
                <b>UniFi Network → Settings → Control Plane → Integrations</b>
              </>
            )}
            . Re-theming and re-exporting use the sanitized snapshot only.
          </Banner>
        )}

        {step === 1 && (
          <StepImport
            mode={mode}
            setMode={(m) => {
              cancel();
              setMode(m);
            }}
            apiKey={apiKey}
            setApiKey={setApiKey}
            keyInputRef={keyInputRef}
            controllerUrl={controllerUrl}
            setControllerUrl={setControllerUrl}
            discovery={discovery}
            hostId={hostId}
            setHostId={(h) => {
              setHostId(h);
              const first = discovery?.sites.find((s) => s.hostId === h);
              setSiteKey(first ? `${first.hostId}|${first.siteId}` : "");
            }}
            siteKey={siteKey}
            setSiteKey={setSiteKey}
            busy={busy}
            onDiscover={discover}
            onImport={runImport}
            onCancel={cancel}
            onDemo={loadDemo}
            mt={{
              addresses: mtAddresses,
              setAddresses: setMtAddresses,
              user: mtUser,
              setUser: setMtUser,
              password: mtPassword,
              setPassword: setMtPassword,
              passwordRef: mtPasswordRef,
              allowHttp: mtAllowHttp,
              setAllowHttp: setMtAllowHttp,
              discovery: mtDiscovery,
              onDiscover: mtDiscover,
              onImport: mtImport,
              onAddSuggestion: addSuggestion,
            }}
            pins={pins}
            setPins={setPins}
            historyDays={historyDays}
            setHistoryDays={setHistoryDays}
            onOpenFile={openSnapshotFile}
            hasSnapshot={Boolean(snapshot)}
            onResume={() => setStep(2)}
          />
        )}

        {step === 2 && snapshot && (
          <div className="grid gap-6 lg:grid-cols-[440px_minmax(0,1fr)]">
            <div className="space-y-5">
              <CustomizePanel config={config} patch={patch} onError={setError} />
              <ImportReport snapshot={snapshot} />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setStep(1)} className={btn("ghost")}>
                  <ArrowLeft className="h-4 w-4" /> Import
                </button>
                <button onClick={saveSnapshotFile} className={btn("ghost")} title="Sanitized snapshot + settings, no credentials">
                  <FileJson className="h-4 w-4" /> Save snapshot
                </button>
                <button onClick={() => setStep(3)} className={btn("primary")}>
                  Preview &amp; export <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="min-w-0">
              <div className="sticky top-[76px]">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                  <span>Live preview · first 4 of {pageCount} pages</span>
                  <button onClick={() => setStep(3)} className="font-medium text-blue-700 hover:underline">
                    Open full preview →
                  </button>
                </div>
                <div className="h-[calc(100vh-130px)] overflow-auto rounded-xl border border-slate-200 bg-slate-200/60 p-5">
                  <div style={{ zoom: 0.56 }}>
                    <ReportDocument snapshot={snapshot} config={config} issuedAt={issuedAt} gapPx={28} only={[1, 2, 3, 4]} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 3 && snapshot && (
          <div>
            <div className="sticky top-[60px] z-10 -mx-6 mb-5 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-[#eef1f5]/95 px-6 py-3 backdrop-blur">
              <button onClick={() => setStep(2)} className={btn("ghost")}>
                <ArrowLeft className="h-4 w-4" /> Customize
              </button>
              <div className="text-sm text-slate-600">
                <b className="text-slate-900">{pageCount}</b> A4 pages · {TEMPLATES.find((x) => x.id === config.template)?.label} ·{" "}
                {THEMES[config.theme].label}
                {config.includeIdentification ? " · with device identification" : ""}
              </div>
              <div className="ml-auto flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
                <button className="rounded p-1.5 hover:bg-slate-100" onClick={() => setZoom((z) => Math.max(0.35, +(z - 0.1).toFixed(2)))} aria-label="Zoom out">
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
                <button className="rounded p-1.5 hover:bg-slate-100" onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(2)))} aria-label="Zoom in">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <button onClick={saveSnapshotFile} className={btn("ghost")}>
                <FileJson className="h-4 w-4" /> Save snapshot
              </button>
              <button onClick={downloadPdf} disabled={busy === "pdf"} className={btn("primary")}>
                {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {busy === "pdf" ? "Rendering PDF…" : "Download PDF"}
              </button>
            </div>
            <div className="overflow-x-auto pb-10">
              <div style={{ zoom }}>
                <ReportDocument snapshot={snapshot} config={config} issuedAt={issuedAt} gapPx={32} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ================================================================== chrome */

function btn(kind: "primary" | "ghost" | "subtle") {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
  if (kind === "primary") return `${base} bg-[#0f1e36] text-white shadow-sm hover:bg-[#1b2f52]`;
  if (kind === "subtle") return `${base} bg-blue-50 text-blue-800 hover:bg-blue-100`;
  return `${base} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
}

function TopBar({ step, canNavigate, onStep }: { step: number; canNavigate: boolean; onStep: (s: 1 | 2 | 3) => void }) {
  const steps = ["Import", "Customize", "Preview & export"];
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-[60px] max-w-[1500px] items-center gap-6 px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f1e36] text-white">
            <FileText className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[15px] leading-tight font-semibold">UniDoc Studio</div>
            <div className="text-[11px] leading-tight text-slate-500">UniFi &amp; MikroTik network documentation</div>
          </div>
        </div>
        <nav className="ml-auto flex items-center gap-1">
          {steps.map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            const active = step === n;
            const enabled = n === 1 || canNavigate;
            return (
              <button
                key={label}
                disabled={!enabled}
                onClick={() => onStep(n)}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition ${
                  active ? "bg-[#0f1e36] text-white" : enabled ? "text-slate-700 hover:bg-slate-100" : "text-slate-400"
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                    active ? "bg-white text-[#0f1e36]" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {n}
                </span>
                {label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

function Banner({ tone, icon, children }: { tone: "info" | "warn"; icon: ReactNode; children: ReactNode }) {
  const cls = tone === "info" ? "border-blue-200 bg-blue-50 text-blue-900" : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div className={`mb-5 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${cls}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>{children}</div>
    </div>
  );
}

function Panel({ title, icon, children, right }: { title: string; icon?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
        {icon && <span className="text-slate-500">{icon}</span>}
        <h2 className="text-sm font-semibold">{title}</h2>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

/* ================================================================== step 1 */

interface StepImportProps {
  mode: ConnectionMode;
  setMode: (m: ConnectionMode) => void;
  apiKey: string;
  setApiKey: (k: string) => void;
  keyInputRef: React.RefObject<HTMLInputElement | null>;
  controllerUrl: string;
  setControllerUrl: (v: string) => void;
  discovery: DiscoveryResponse | null;
  hostId: string;
  setHostId: (h: string) => void;
  siteKey: string;
  setSiteKey: (k: string) => void;
  busy: Busy;
  onDiscover: () => void;
  onImport: () => void;
  onCancel: () => void;
  onDemo: (vendor: "unifi" | "mikrotik") => void;
  mt: MikrotikFormProps;
  pins: string;
  setPins: (v: string) => void;
  historyDays: number;
  setHistoryDays: (n: number) => void;
  onOpenFile: (f: File) => void;
  hasSnapshot: boolean;
  onResume: () => void;
}

function StepImport(p: StepImportProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const consoleOptions = (p.discovery?.consoles ?? []).map((c) => ({
    value: c.hostId,
    label: c.name,
    hint: [c.model, c.ip, c.hostId.length > 24 ? `${c.hostId.slice(0, 10)}…${c.hostId.slice(-8)}` : c.hostId].filter(Boolean).join(" · "),
  }));
  const siteOptions = (p.discovery?.sites ?? [])
    .filter((s) => !p.hostId || s.hostId === p.hostId)
    .map((s) => ({ value: `${s.hostId}|${s.siteId}`, label: s.name, hint: `site: ${s.siteId}` }));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <Banner tone="info" icon={<ShieldCheck className="h-4 w-4" />}>
          <b>Zero-persistence import.</b> API keys and RouterOS credentials live only in this tab&apos;s memory and travel only as request
          headers (<code className="rounded bg-white/70 px-1 text-[12px]">X-UniFi-Api-Key</code> /{" "}
          <code className="rounded bg-white/70 px-1 text-[12px]">X-RouterOS-Credentials</code>) to stateless API routes. They are never
          written to disk, storage, cookies, URLs or logs, and are wiped on import, cancel, refresh or tab close. Secrets (PSKs, passwords,
          RADIUS/WireGuard/IPsec keys, tokens) are stripped server-side before anything reaches the browser.
        </Banner>

        <Panel title="1 · Connect" icon={<KeyRound className="h-4 w-4" />}>
          <div className="mb-5 grid grid-cols-3 gap-3">
            <ModeCard
              active={p.mode === "cloud"}
              onClick={() => p.setMode("cloud")}
              icon={<Cloud className="h-5 w-5" />}
              title="UniFi Cloud Proxy"
              text="Site Manager API key via api.ui.com Cloud Connector. No VPN or port-forwarding."
            />
            <ModeCard
              active={p.mode === "local"}
              onClick={() => p.setMode("local")}
              icon={<Server className="h-5 w-5" />}
              title="UniFi Direct Local"
              text="Local Network API key against https://{console}. Data stays on your LAN."
            />
            <ModeCard
              active={p.mode === "mikrotik"}
              onClick={() => p.setMode("mikrotik")}
              icon={<Router className="h-5 w-5" />}
              title="MikroTik RouterOS"
              text="RouterOS 7 REST API on each router/switch, read-only user. Data stays on your LAN."
            />
          </div>

          {p.mode === "mikrotik" ? (
            <MikrotikForm mt={p.mt} busy={p.busy} pins={p.pins} setPins={p.setPins} historyDays={p.historyDays} setHistoryDays={p.setHistoryDays} onCancel={p.onCancel} />
          ) : (
          <>
          <form
            className="space-y-4"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              p.onDiscover();
            }}
          >
            {p.mode === "local" && (
              <Field label="Controller address" hint="IP or hostname of the UniFi OS console. Self-signed certificates are accepted for this connection only.">
                <input
                  className={inputCls}
                  placeholder="192.168.1.1"
                  value={p.controllerUrl}
                  onChange={(e) => p.setControllerUrl(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            )}
            {p.mode === "local" && (
              <Field
                label="Pin certificate fingerprint (optional)"
                hint="SHA-256, from the console or from a previous 'Test Key'. When set, the key is only sent if the console presents this certificate."
              >
                <input className={`${inputCls} font-mono text-xs`} placeholder="AB:CD:…" value={p.pins} onChange={(e) => p.setPins(e.target.value)} spellCheck={false} />
              </Field>
            )}
            <Field
              label={p.mode === "cloud" ? "Site Manager API key" : "Local Network API key"}
              hint={
                p.mode === "cloud"
                  ? "unifi.ui.com → API → Create API key (create it as the console Owner; delete it after the import)."
                  : "UniFi Network → Settings → Control Plane → Integrations → Create API key."
              }
            >
              <input
                ref={p.keyInputRef}
                type="password"
                name="unidoc-ephemeral-key"
                className={`${inputCls} font-mono`}
                placeholder="Paste key — held in memory only"
                value={p.apiKey}
                onChange={(e) => p.setApiKey(e.target.value.trim())}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className={btn("primary")}
                disabled={!p.apiKey || p.busy !== null || (p.mode === "local" && !p.controllerUrl)}
              >
                {p.busy === "discover" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Test Key &amp; Load Consoles
              </button>
              {(p.apiKey || p.discovery || p.busy) && (
                <button type="button" className={btn("ghost")} onClick={p.onCancel}>
                  <Trash2 className="h-4 w-4" /> Cancel &amp; wipe key
                </button>
              )}
            </div>
          </form>

          {p.discovery && (
            <div className="mt-6 space-y-4 border-t border-slate-100 pt-5">
              <div className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Key accepted · {p.discovery.consoles.length} console(s), {p.discovery.sites.length} site(s)
              </div>
              {p.discovery.consoles[0]?.certSha256 && (
                <div className="text-[11px] break-all text-slate-500">
                  Console certificate SHA-256: <code>{p.discovery.consoles[0].certSha256}</code>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Console">
                  <SearchSelect options={consoleOptions} value={p.hostId} onChange={p.setHostId} placeholder="Choose a console" />
                </Field>
                <Field label="Site">
                  <SearchSelect options={siteOptions} value={p.siteKey} onChange={p.setSiteKey} placeholder="Choose a site" />
                </Field>
              </div>
              <button className={btn("primary")} disabled={!p.siteKey || p.busy !== null} onClick={p.onImport}>
                {p.busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {p.busy === "import" ? "Importing site…" : "Import site"}
              </button>
            </div>
          )}
          </>
          )}
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel title="No network handy?" icon={<Sparkles className="h-4 w-4" />}>
          <p className="mb-4 text-sm text-slate-600">
            Load a complete, realistic sample site. Both run through the same sanitizer, normalizer and device identification as a live
            import.
          </p>
          <button onClick={() => p.onDemo("unifi")} className={`${btn("subtle")} w-full`}>
            <Sparkles className="h-4 w-4" /> Load Realistic Demo Site (UniFi)
          </button>
          <p className="mt-1.5 mb-4 text-[11px] text-slate-500">UDM SE, two Pro Max switches, three U7 APs, 7 networks, 4 SSIDs, 52 clients, 88 zone policies.</p>
          <button onClick={() => p.onDemo("mikrotik")} className={`${btn("subtle")} w-full`}>
            <Router className="h-4 w-4" /> Load MikroTik Demo Site
          </button>
          <p className="mt-1.5 text-[11px] text-slate-500">
            RB5009 + two CRS switches, 2 CAPsMAN cAP ax, an LLDP-only Cisco switch, 8 networks, 44 devices, filter/NAT rules, WireGuard.
          </p>
        </Panel>
        <Panel title="Re-open a saved snapshot" icon={<FileJson className="h-4 w-4" />}>
          <p className="mb-4 text-sm text-slate-600">
            Snapshots are sanitized JSON (no credentials). Re-theme or re-export without querying the console again.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onOpenFile(f);
              e.target.value = "";
            }}
          />
          <button onClick={() => fileRef.current?.click()} className={`${btn("ghost")} w-full`}>
            <Upload className="h-4 w-4" /> Open snapshot (.json)
          </button>
          {p.hasSnapshot && (
            <button onClick={p.onResume} className={`${btn("ghost")} mt-2 w-full`}>
              Continue with current snapshot <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </Panel>
      </div>
    </div>
  );
}

function ModeCard({ active, onClick, icon, title, text }: { active: boolean; onClick: () => void; icon: ReactNode; title: string; text: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition ${
        active ? "border-[#0f1e36] bg-slate-50 ring-1 ring-[#0f1e36]" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className={`mb-2 ${active ? "text-[#0f1e36]" : "text-slate-500"}`}>{icon}</div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-slate-500">{text}</div>
    </button>
  );
}

function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: { value: string; label: string; hint?: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const selected = options.find((o) => o.value === value);
  const filtered = options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${inputCls} flex items-center justify-between text-left`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`truncate ${selected ? "" : "text-slate-400"}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full text-sm outline-none" />
          </div>
          <ul role="listbox" className="max-h-64 overflow-auto py-1">
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matches</li>}
            {filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    setQ("");
                  }}
                  className={`block w-full px-3 py-2 text-left hover:bg-slate-50 ${o.value === value ? "bg-blue-50" : ""}`}
                >
                  <div className="truncate text-sm">{o.label}</div>
                  {o.hint && <div className="truncate text-[11px] text-slate-500">{o.hint}</div>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ================================================================== step 2 */

function LogoField({ label, value, onChange, onError }: { label: string; value: string; onChange: (v: string) => void; onError: (e: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const onFile = (file: File) => {
    if (!LOGO_TYPES.includes(file.type)) return onError("Logo must be PNG, JPEG, WebP or SVG.");
    if (file.size > LOGO_MAX_BYTES) return onError("Logo must be smaller than 600 kB.");
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.onerror = () => onError("The logo file could not be read.");
    reader.readAsDataURL(file);
  };
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-14 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={label} className="max-h-12 max-w-24 object-contain" />
        ) : (
          <span className="text-[11px] text-slate-400">No logo</span>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept={LOGO_TYPES.join(",")}
        className="hidden"
        aria-label={`${label} file`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button type="button" className={btn("ghost")} onClick={() => ref.current?.click()}>
        <Upload className="h-4 w-4" /> {value ? "Replace" : label}
      </button>
      {value && (
        <button type="button" className="text-sm text-slate-500 hover:text-red-600" onClick={() => onChange("")}>
          Remove
        </button>
      )}
    </div>
  );
}

function CustomizePanel({ config, patch, onError }: { config: ReportConfig; patch: (p: Partial<ReportConfig>) => void; onError: (e: string) => void }) {
  const text = (key: keyof ReportConfig, placeholder?: string, type = "text") => (
    <input
      className={inputCls}
      type={type}
      placeholder={placeholder}
      value={String(config[key] ?? "")}
      onChange={(e) => patch({ [key]: e.target.value } as Partial<ReportConfig>)}
    />
  );

  return (
    <>
      <Panel title="2 · Document" icon={<FileText className="h-4 w-4" />}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client name" hint='Printed as "--" when empty'>
            {text("clientName")}
          </Field>
          <Field label="Site name">{text("siteName")}</Field>
          <Field label="Secondary site label" hint='"--" when empty'>
            {text("siteLabel")}
          </Field>
          <Field label="Device identification" hint="Every device seen, with vendor, type and evidence">
            <button
              type="button"
              onClick={() => patch({ includeIdentification: !config.includeIdentification })}
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                config.includeIdentification ? "border-[#0f1e36] bg-slate-50 text-[#0f1e36]" : "border-slate-300 text-slate-500"
              }`}
              aria-pressed={config.includeIdentification}
            >
              <Fingerprint className="h-4 w-4" />
              {config.includeIdentification ? "Included in report" : "Not included"}
            </button>
          </Field>
        </div>
      </Panel>

      <Panel title="Client (cover page)" icon={<Users className="h-4 w-4" />}>
        <div className="space-y-3">
          <LogoField label="Client logo" value={config.clientLogoDataUri} onChange={(v) => patch({ clientLogoDataUri: v })} onError={onError} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact name">{text("clientContactName")}</Field>
            <Field label="Email">{text("clientEmail", "it@client.example", "email")}</Field>
            <Field label="Phone">{text("clientPhone", undefined, "tel")}</Field>
            <Field label="Address">{text("clientAddress")}</Field>
          </div>
        </div>
      </Panel>

      <Panel title="Integrator (cover and page header)" icon={<ImagePlus className="h-4 w-4" />}>
        <div className="space-y-3">
          <LogoField label="Integrator logo" value={config.logoDataUri} onChange={(v) => patch({ logoDataUri: v })} onError={onError} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Integrator name">{text("integratorName")}</Field>
            <Field label="Email">{text("integratorEmail", "support@integrator.example", "email")}</Field>
            <Field label="Phone">{text("integratorPhone", undefined, "tel")}</Field>
            <Field label="Website">{text("integratorWebsite", "www.integrator.example")}</Field>
          </div>
          <Field label="Address">{text("integratorAddress")}</Field>
        </div>
      </Panel>

      <Panel title="Notes (Markdown)" icon={<FileText className="h-4 w-4" />}>
        <div className="space-y-3">
          <Field label="Introduction" hint="Printed on the Contents page. **bold**, *italic*, `code`, - lists, # headings. Long text is clipped to its card.">
            <textarea
              rows={5}
              className={`${inputCls} font-mono text-[13px]`}
              value={config.introduction}
              onChange={(e) => patch({ introduction: e.target.value })}
            />
          </Field>
          <Field label="Additional notes">
            <textarea
              rows={4}
              className={`${inputCls} font-mono text-[13px]`}
              value={config.additionalNotes}
              onChange={(e) => patch({ additionalNotes: e.target.value })}
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Template & theme" icon={<Sparkles className="h-4 w-4" />}>
        <div className="space-y-2">
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => patch({ template: tpl.id })}
              className={`block w-full rounded-lg border px-3.5 py-2.5 text-left transition ${
                config.template === tpl.id ? "border-[#0f1e36] bg-slate-50 ring-1 ring-[#0f1e36]" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="text-sm font-semibold">{tpl.label}</div>
              <div className="text-xs text-slate-500">{tpl.description}</div>
            </button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {(Object.keys(THEMES) as ThemeId[]).map((id) => {
            const th = THEMES[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => patch({ theme: id })}
                className={`rounded-lg border p-2 text-left transition ${
                  config.theme === id ? "border-[#0f1e36] ring-1 ring-[#0f1e36]" : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="mb-2 flex h-10 overflow-hidden rounded" style={{ background: th.vars["--r-soft"] }}>
                  <div className="w-2" style={{ background: th.vars["--r-accent"] }} />
                  <div className="flex flex-1 flex-col justify-end">
                    <div className="h-2" style={{ background: th.vars["--r-thead-bg"] }} />
                    <div className="h-2.5" style={{ background: th.vars["--r-navy"] }} />
                  </div>
                </div>
                <div className="text-xs font-semibold">{th.label}</div>
                <div className="text-[10.5px] leading-tight text-slate-500">{th.description}</div>
              </button>
            );
          })}
        </div>
      </Panel>
    </>
  );
}

function ImportReport({ snapshot }: { snapshot: SiteDocumentationSnapshot }) {
  const [open, setOpen] = useState(false);
  const failed = snapshot.meta.endpoints.filter((e) => !e.ok);
  const src = { cloud: "UniFi Cloud Proxy", local: "UniFi Direct Local", mikrotik: "MikroTik RouterOS", demo: "Demo dataset", file: "Snapshot file" }[snapshot.meta.source];
  const identified = snapshot.clients.filter((c) => c.identity && (c.identity.confidence === "High" || c.identity.confidence === "Medium")).length;
  return (
    <Panel
      title="Import report"
      icon={failed.length ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
      right={
        <button onClick={() => setOpen((o) => !o)} className="text-xs font-medium text-blue-700 hover:underline">
          {open ? "Hide" : "Details"}
        </button>
      }
    >
      <div className="grid grid-cols-3 gap-2 text-center">
        {(
          [
            ["Infra devices", snapshot.kpis.devices],
            ["Devices seen", snapshot.kpis.devicesSeen],
            ["Identified", identified],
            ["Connected now", snapshot.kpis.clients],
            ["Undetermined", snapshot.undeterminedClients.length],
            ["FW / NAT rules", snapshot.firewallRules.length + snapshot.chainRules.length],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-lg bg-slate-50 py-2">
            <div className="text-lg font-semibold tabular-nums">{v}</div>
            <div className="text-[11px] text-slate-500">{k}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-slate-600">
        {src} · {snapshot.meta.consoleName || snapshot.meta.siteName} · site <code>{snapshot.meta.siteId}</code> ·{" "}
        {snapshot.meta.endpoints.length - failed.length}/{snapshot.meta.endpoints.length} endpoints ·{" "}
        {snapshot.meta.sanitizedFields.length} secret field type(s) stripped
      </div>
      {open && (
        <div className="mt-3 space-y-1.5">
          {[...snapshot.meta.endpoints].sort((a, b) => Number(a.ok) - Number(b.ok)).map((e) => (
            <div key={`${e.key}|${e.path}`} className="flex items-start gap-2 text-xs">
              {e.ok ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />}
              <div className="min-w-0">
                <code className="break-all text-slate-700">{e.path}</code>
                <span className="text-slate-500">
                  {" "}
                  {e.ok ? `· ${e.records ?? "?"} records` : `· ${e.error ?? `HTTP ${e.httpStatus}`}`}
                </span>
              </div>
            </div>
          ))}
          {snapshot.meta.sanitizedFields.length > 0 && (
            <div className="pt-2 text-[11px] text-slate-500">
              Stripped field names: <code>{snapshot.meta.sanitizedFields.join(", ")}</code>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ================================================================== MikroTik form */

interface MikrotikFormProps {
  addresses: string;
  setAddresses: (v: string) => void;
  user: string;
  setUser: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  passwordRef: React.RefObject<HTMLInputElement | null>;
  allowHttp: boolean;
  setAllowHttp: (v: boolean) => void;
  discovery: MikrotikDiscoveryResponse | null;
  onDiscover: () => void;
  onImport: () => void;
  onAddSuggestion: (address: string) => void;
}

function MikrotikForm({
  mt,
  busy,
  pins,
  setPins,
  historyDays,
  setHistoryDays,
  onCancel,
}: {
  mt: MikrotikFormProps;
  busy: Busy;
  pins: string;
  setPins: (v: string) => void;
  historyDays: number;
  setHistoryDays: (n: number) => void;
  onCancel: () => void;
}) {
  const ready = parseList(mt.addresses).length > 0 && mt.user && mt.password;
  const okCount = mt.discovery?.devices.filter((d) => d.ok).length ?? 0;
  return (
    <div>
      <form
        className="space-y-4"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          mt.onDiscover();
        }}
      >
        <Field
          label="Devices (one per line)"
          hint="Gateway first is not required — the gateway is detected from NAT, DHCP client and default route. Add every MikroTik router and switch you want documented; CAPsMAN APs and LLDP/CDP neighbors are discovered automatically."
        >
          <textarea
            rows={4}
            className={`${inputCls} font-mono text-[13px]`}
            placeholder={"10.20.99.1\n10.20.99.2\nswitch2.lan:8443"}
            value={mt.addresses}
            onChange={(e) => mt.setAddresses(e.target.value)}
            spellCheck={false}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="RouterOS username" hint="A read-only group without the 'sensitive' policy is enough.">
            <input
              className={inputCls}
              value={mt.user}
              onChange={(e) => mt.setUser(e.target.value.trim())}
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
            />
          </Field>
          <Field label="Password" hint="Held in memory only.">
            <input
              ref={mt.passwordRef}
              type="password"
              name="unidoc-ephemeral-routeros"
              className={`${inputCls} font-mono`}
              value={mt.password}
              onChange={(e) => mt.setPassword(e.target.value)}
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Recently-seen window" hint="DHCP leases seen within this many days are listed as 'Recently seen'.">
            <select className={inputCls} value={historyDays} onChange={(e) => setHistoryDays(Number(e.target.value))}>
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pin certificate fingerprints (optional)" hint="SHA-256 values; credentials are only sent to devices presenting one of them.">
            <input className={`${inputCls} font-mono text-xs`} placeholder="AB:CD:…" value={pins} onChange={(e) => setPins(e.target.value)} spellCheck={false} />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-600">
          <input type="checkbox" className="mt-0.5" checked={mt.allowHttp} onChange={(e) => mt.setAllowHttp(e.target.checked)} />
          <span>
            Allow plain HTTP (<code>www</code> service). Not recommended — the password would cross the LAN unencrypted. Prefer{" "}
            <code>www-ssl</code> with a certificate.
          </span>
        </label>
        <details className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">RouterOS setup (read-only user)</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-[11px] leading-relaxed">{`/user group add name=unidoc-ro policy=read,api,rest-api,!write,!policy,!sensitive,!ftp,!reboot
/user add name=unidoc group=unidoc-ro address=<your-workstation-ip>/32 password=<long-random>
/certificate add name=webfig common-name=<router-ip> key-usage=key-cert-sign,tls-server
/certificate sign webfig
/ip service set www-ssl certificate=webfig disabled=no address=<mgmt-subnet>`}</pre>
          <p className="mt-2">
            Without <code>sensitive</code>, RouterOS itself hides keys and passphrases; UniDoc strips them again server-side either way.
          </p>
        </details>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={btn("primary")} disabled={!ready || busy !== null}>
            {busy === "discover" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Test Devices
          </button>
          <button type="button" className={btn("ghost")} disabled={!ready || busy !== null} onClick={mt.onImport}>
            {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {busy === "import" ? "Importing…" : "Import site"}
          </button>
          {(mt.password || mt.discovery || busy) && (
            <button type="button" className={btn("ghost")} onClick={onCancel}>
              <Trash2 className="h-4 w-4" /> Cancel &amp; wipe credentials
            </button>
          )}
        </div>
      </form>

      {mt.discovery && (
        <div className="mt-6 space-y-3 border-t border-slate-100 pt-5">
          <div className={`flex items-center gap-2 text-sm ${okCount ? "text-emerald-700" : "text-amber-700"}`}>
            {okCount ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {okCount} of {mt.discovery.devices.length} device(s)
            answered
          </div>
          <ul className="space-y-1.5">
            {mt.discovery.devices.map((d) => (
              <li key={d.address} className="flex items-start gap-2 text-xs">
                {d.ok ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-red-500" />}
                <div className="min-w-0">
                  <code>{d.address}</code>{" "}
                  {d.ok ? (
                    <span className="text-slate-600">
                      · <b>{d.identity}</b> · {d.board} · RouterOS {d.version}
                      {d.certSha256 && <span className="block break-all text-[10.5px] text-slate-400">cert SHA-256 {d.certSha256}</span>}
                    </span>
                  ) : (
                    <span className="text-red-700">· {d.error}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {mt.discovery.suggestions.length > 0 && (
            <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs">
              <div className="mb-2 font-medium text-blue-900">MikroTik neighbors not in your list</div>
              <div className="flex flex-wrap gap-1.5">
                {mt.discovery.suggestions.map((s) => (
                  <button key={s.address} type="button" onClick={() => mt.onAddSuggestion(s.address)} className="rounded-full border border-blue-200 bg-white px-2.5 py-1 hover:bg-blue-50">
                    + {s.identity || s.address} <span className="text-slate-500">({s.address} · {s.board} · via {s.seenBy})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

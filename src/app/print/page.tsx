"use client";

/**
 * Print surface for headless Chrome. The export route injects the sanitized
 * payload with `evaluateOnNewDocument` (never via URL), this page renders the
 * exact same <ReportDocument> as the preview and flags readiness once fonts
 * and layout have settled.
 */
import { useEffect, useState } from "react";
import type { ExportPayload } from "@/types/unifi-documentation";
import { ReportDocument } from "@/components/report/ReportDocument";

declare global {
  interface Window {
    __UNIDOC_PAYLOAD__?: ExportPayload;
  }
}

export default function PrintPage() {
  const [payload, setPayload] = useState<ExportPayload | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const p = window.__UNIDOC_PAYLOAD__;
    if (p) {
      // Read once after hydration: the payload is injected into the window by the PDF renderer, not available on the server.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPayload(p);
      delete window.__UNIDOC_PAYLOAD__;
    }
  }, []);

  useEffect(() => {
    if (!payload) return;
    let cancelled = false;
    (async () => {
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const imgs = Array.from(document.images);
      await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.addEventListener("load", r, { once: true }); img.addEventListener("error", r, { once: true }); }))));
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (!payload) {
    return <div className="p-8 text-sm text-slate-500">UniDoc print surface — waiting for payload.</div>;
  }
  return (
    <div className="print-surface" data-report-ready={ready ? "true" : "false"}>
      <ReportDocument snapshot={payload.snapshot} config={payload.config} issuedAt={payload.issuedAt} gapPx={0} />
    </div>
  );
}

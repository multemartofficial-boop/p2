import { useEffect, useRef, useState } from "react";
import { Check, ZoomIn, ZoomOut } from "lucide-react";

/**
 * A tick mark placed on a PDF page. x/y are fractions (0..1) of the page
 * width/height measured from the top-left, so they are independent of the
 * zoom level used while reading and can be redrawn onto the real PDF later.
 */
export type TickMark = { page: number; x: number; y: number; type?: "tick" };

const TICK_SIZE_FRACTION = 0.028; // tick box ≈ 2.8% of page width
const HIT_RADIUS_FRACTION = 0.02;

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
const loadPdfjs = () => {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      return mod;
    });
  }
  return pdfjsPromise;
};

type PageInfo = { num: number; width: number; height: number };

function PdfPage({
  pdf, info, scale, ticks, editable, onToggle,
}: {
  pdf: any;
  info: PageInfo;
  scale: number;
  ticks: TickMark[];
  editable: boolean;
  onToggle: (t: TickMark) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTask = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(info.num);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderTask.current?.cancel?.();
      renderTask.current = page.render({ canvasContext: ctx, viewport });
      try { await renderTask.current.promise; } catch { /* cancelled */ }
    })();
    return () => { cancelled = true; renderTask.current?.cancel?.(); };
  }, [pdf, info.num, scale]);

  const w = info.width * scale;
  const h = info.height * scale;
  const tickPx = Math.max(14, TICK_SIZE_FRACTION * w);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editable) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    onToggle({ page: info.num, x, y, type: "tick" });
  };

  return (
    <div className="relative mx-auto" style={{ width: w, height: h }}>
      <canvas ref={canvasRef} className="block rounded border border-border bg-white shadow-sm" />
      <div
        onClick={handleClick}
        className={`absolute inset-0 ${editable ? "cursor-crosshair" : ""}`}
        title={editable ? "Click to place a tick mark; click a tick to remove it" : undefined}
      >
        {ticks.map((t, i) => (
          <span
            key={i}
            className="pointer-events-none absolute grid place-items-center rounded-sm border-2 border-primary bg-white/80 text-primary shadow"
            style={{ left: t.x * w - tickPx / 2, top: t.y * h - tickPx / 2, width: tickPx, height: tickPx }}
          >
            <Check strokeWidth={3.5} style={{ width: tickPx * 0.8, height: tickPx * 0.8 }} />
          </span>
        ))}
      </div>
      <span className="absolute right-1 bottom-1 rounded bg-foreground/60 px-1.5 py-0.5 text-[10px] text-white">
        Page {info.num}
      </span>
    </div>
  );
}

/**
 * Renders a full PDF (every page, scrollable) from a blob URL. When `editable`
 * the signer can click anywhere to drop a tick mark — e.g. on a Yes/No box —
 * and click the same spot again to remove it.
 */
export function PdfAnnotator({
  url, ticks, onChange, editable = true, className, maxHeight = "60vh",
}: {
  url: string;
  ticks: TickMark[];
  onChange?: (ticks: TickMark[]) => void;
  editable?: boolean;
  className?: string;
  maxHeight?: string;
}) {
  const [pdf, setPdf] = useState<any>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let doc: any = null;
    setPdf(null);
    setPages([]);
    setError(null);
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) { doc.destroy(); return; }
        const infos: PageInfo[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const p = await doc.getPage(i);
          const vp = p.getViewport({ scale: 1 });
          infos.push({ num: i, width: vp.width, height: vp.height });
        }
        if (cancelled) { doc.destroy(); return; }
        setPdf(doc);
        setPages(infos);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Could not render this PDF");
      }
    })();
    return () => { cancelled = true; doc?.destroy?.(); };
  }, [url]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toggle = (t: TickMark) => {
    if (!onChange) return;
    const idx = ticks.findIndex((x) =>
      x.page === t.page && Math.hypot(x.x - t.x, x.y - t.y) < HIT_RADIUS_FRACTION);
    onChange(idx >= 0 ? ticks.filter((_, i) => i !== idx) : [...ticks, t]);
  };

  // Fit-to-width base scale, then apply the user zoom.
  const baseW = pages[0]?.width || 612;
  const fit = containerW > 0 ? Math.min((containerW - 24) / baseW, 1.6) : 1;
  const scale = fit * zoom;

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {pages.length ? `${pages.length} page${pages.length === 1 ? "" : "s"}` : error ? "" : "Loading PDF…"}
          {editable && pages.length > 0 && " · click on the document to place a tick mark, click a tick to remove it"}
          {!editable && ticks.length > 0 && ` · ${ticks.length} tick mark${ticks.length === 1 ? "" : "s"}`}
        </span>
        <span className="flex items-center gap-1">
          {editable && ticks.length > 0 && (
            <>
              <span className="rounded-full bg-primary-soft px-2 py-0.5 font-medium text-primary">{ticks.length} tick{ticks.length === 1 ? "" : "s"}</span>
              <button type="button" onClick={() => onChange?.([])} className="rounded px-2 py-0.5 hover:bg-secondary hover:text-foreground">Clear ticks</button>
            </>
          )}
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(2)))} className="rounded p-1 hover:bg-secondary"><ZoomOut className="size-3.5" /></button>
          <span className="w-9 text-center">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.2).toFixed(2)))} className="rounded p-1 hover:bg-secondary"><ZoomIn className="size-3.5" /></button>
        </span>
      </div>
      <div ref={containerRef} className="nice-scrollbar overflow-auto rounded-lg border border-border bg-secondary/40 p-3" style={{ maxHeight }}>
        {error && <p className="p-4 text-sm text-danger">{error}</p>}
        {!error && pdf && pages.map((p) => (
          <div key={p.num} className="mb-3 last:mb-0">
            <PdfPage
              pdf={pdf}
              info={p}
              scale={scale}
              ticks={ticks.filter((t) => t.page === p.num)}
              editable={editable}
              onToggle={toggle}
            />
          </div>
        ))}
        {!error && !pdf && <div className="h-40 animate-pulse rounded bg-secondary" />}
      </div>
    </div>
  );
}

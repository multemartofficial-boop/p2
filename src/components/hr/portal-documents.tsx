import { useEffect, useRef, useState } from "react";
import { FileSignature, Eraser, Download, Eye, FileText } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { downloadSignedPdf } from "@/lib/signed-pdf";
import { type TickMark } from "@/components/hr/pdf-annotator";
import { FilePreview } from "@/components/hr/file-preview";

/*
 * Document signing UI shared by the Worker Dashboard and the Contractor
 * Portal. Both talk to the same /api/documents/requests/* endpoints — the
 * backend scopes every call to the signed-in worker or contractor.
 */

export type PortalDocRequest = {
  id: string;
  document_id: string;
  document_name: string;
  document_type: string;
  status: "pending" | "worker_signed" | "signed" | "declined" | "cancelled";
  sent_at: string;
  viewed_at: string | null;
  signed_at: string | null;
  declined_at: string | null;
  has_file?: boolean | number;
};

export const loadMyDocRequests = () => apiClient.get<PortalDocRequest[]>("/api/documents/requests/mine");

/* ---------- Signature pad (draw on canvas) ---------- */
export function DrawPad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = ref.current!;
    c.width = c.offsetWidth;
    c.height = 160;
    const ctx = c.getContext("2d")!;
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <canvas
        ref={ref}
        className="w-full h-40 rounded-lg border border-border bg-white touch-none cursor-crosshair"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = ref.current!.getContext("2d")!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext("2d")!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          onChange(ref.current!.toDataURL("image/png"));
        }}
      />
      <button
        type="button"
        onClick={() => {
          const c = ref.current!;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          onChange(null);
        }}
        className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Eraser className="size-3" /> Clear
      </button>
    </div>
  );
}

/* ---------- Pending documents — tick to agree, sign selected ---------- */
export function PendingDocs({
  docs, agreed, onToggle, onView, onSignSelected, onChanged, emptyText,
}: {
  docs: PortalDocRequest[];
  agreed: string[];
  onToggle: (id: string) => void;
  onView: (doc: PortalDocRequest) => void;
  onSignSelected: () => void;
  onChanged: () => void;
  emptyText?: string;
}) {
  const [declining, setDeclining] = useState<string | null>(null);

  const decline = async (d: PortalDocRequest) => {
    if (!window.confirm(`Decline "${d.document_name}"? The admin team will be notified.`)) return;
    setDeclining(d.id);
    try {
      await apiClient.post(`/api/documents/requests/${d.id}/decline`, {});
      onChanged();
    } catch (e: any) {
      alert(e.message || "Failed to decline");
    } finally {
      setDeclining(null);
    }
  };

  const allTicked = docs.length > 0 && docs.every((d) => agreed.includes(d.id));

  return (
    <div className="bg-card rounded-xl p-6 mb-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FileSignature className="size-5" />
          Documents to Sign
        </h2>
        {docs.length > 0 && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={allTicked}
              onChange={(e) => {
                const checkAll = e.target.checked;
                docs.forEach((d) => {
                  if (agreed.includes(d.id) !== checkAll) onToggle(d.id);
                });
              }}
              className="size-4 accent-primary"
            />
            Select all
          </label>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Open each document to read it, then tick the ones you agree with and sign them together. On PDF documents you can also place tick marks (e.g. on Yes/No boxes) while signing.
      </p>
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText || "Nothing waiting for your signature."}</p>
      ) : (
        <>
          <div className="divide-y divide-border">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 py-3">
                <input
                  type="checkbox"
                  checked={agreed.includes(d.id)}
                  onChange={() => onToggle(d.id)}
                  title="I agree to this document"
                  className="size-4 shrink-0 cursor-pointer accent-primary"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{d.document_name}</p>
                  <p className="text-xs text-muted-foreground">
                    Sent {new Date(d.sent_at).toLocaleDateString("en-GB")}
                    {agreed.includes(d.id) ? " · agreed" : " · not agreed yet"}
                  </p>
                </div>
                <button
                  onClick={() => onView(d)}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                >
                  <Eye className="size-3.5" /> View
                </button>
                <button
                  onClick={() => decline(d)}
                  disabled={declining === d.id}
                  className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
                >
                  {declining === d.id ? "Declining…" : "Decline"}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={onSignSelected}
              disabled={agreed.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              <FileSignature className="size-4" />
              Sign {agreed.length} selected document{agreed.length === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Past / completed documents ---------- */
export function PastDocs({ docs }: { docs: PortalDocRequest[] }) {
  const [downloading, setDownloading] = useState<string | null>(null);
  return (
    <div className="bg-card rounded-xl p-6">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <FileText className="size-5" />
        My Documents
      </h2>
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No signed or past documents yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">{d.document_name}</p>
                <p className="text-xs text-muted-foreground">
                  {d.status === "signed" && d.signed_at
                    ? `Completed ${new Date(d.signed_at).toLocaleDateString("en-GB")}`
                    : `Sent ${new Date(d.sent_at).toLocaleDateString("en-GB")}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  d.status === "signed" ? "bg-success-soft text-success"
                  : d.status === "worker_signed" ? "bg-primary-soft text-primary"
                  : d.status === "declined" ? "bg-danger-soft text-danger"
                  : "bg-secondary text-muted-foreground"
                }`}>
                  {d.status === "worker_signed" ? "Awaiting company" : d.status.charAt(0).toUpperCase() + d.status.slice(1)}
                </span>
                {d.status === "signed" && (
                  <button
                    onClick={async () => {
                      setDownloading(d.id);
                      try { await downloadSignedPdf(d); }
                      catch (e: any) { alert(e.message || "Failed to download"); }
                      finally { setDownloading(null); }
                    }}
                    disabled={downloading === d.id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-secondary disabled:opacity-50"
                  >
                    <Download className="size-4" />
                    {downloading === d.id ? "Preparing…" : "PDF"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Read-only document preview ---------- */
export function ViewDocModal({ request, onClose }: { request: PortalDocRequest; onClose: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [file, setFile] = useState<{ url: string; blob: Blob } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const d = await apiClient.get<any>(`/api/documents/requests/${request.id}`);
        if (cancelled) return;
        setDetail(d);
        await apiClient.post(`/api/documents/requests/${request.id}/view`, {});
        if (d.has_file) {
          const blob = await apiClient.getBlob(`/api/documents/requests/${request.id}/file`);
          url = URL.createObjectURL(blob);
          if (!cancelled) setFile({ url, blob });
        }
      } catch {
        if (!cancelled) setDetail({ error: true });
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [request.id]);

  const savedTicks: TickMark[] = Array.isArray(detail?.annotations) ? detail.annotations : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="font-semibold">{request.document_name}</h3>
            <p className="text-xs text-muted-foreground">Read through the whole document before you agree to it.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {detail === null && <p className="text-sm text-muted-foreground">Loading document...</p>}
          {detail?.error && <p className="text-sm text-danger">Failed to load document.</p>}
          {detail?.rendered_content && (
            <pre className="whitespace-pre-wrap rounded-lg border border-border bg-secondary/50 p-4 text-sm">{detail.rendered_content}</pre>
          )}
          {!detail?.rendered_content && file && (
            <FilePreview file={file} name={request.document_name} ticks={savedTicks} editable={false} maxHeight="62vh" />
          )}
          {detail && !detail.rendered_content && !detail.has_file && !detail.error && (
            <p className="text-sm text-muted-foreground">No document content available.</p>
          )}
          {detail?.admin_signed_at && (
            <div className="rounded-lg border border-border bg-secondary/40 p-3">
              <p className="text-xs font-semibold text-muted-foreground">
                Signed by the Director of SGS — {detail.admin_signed_by || "Company"}
                {` · ${new Date(detail.admin_signed_at).toLocaleString("en-GB", { hour12: false })}`}
              </p>
              {detail.admin_signature_type !== "type" && detail.admin_signature_data ? (
                <img src={detail.admin_signature_data} alt="Company signature" className="mt-2 max-h-16 rounded border border-border bg-white" />
              ) : detail.admin_signature_type === "type" && detail.admin_signature_data ? (
                <p className="mt-1 text-xl italic" style={{ fontFamily: "cursive" }}>{detail.admin_signature_data}</p>
              ) : null}
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-border px-5 py-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Batch signature — one signature covers every ticked document ---------- */
export function BatchSignModal({ requests, onClose, onDone }: { requests: PortalDocRequest[]; onClose: () => void; onDone: () => void }) {
  const [details, setDetails] = useState<Record<string, any>>({});
  const [fileUrls, setFileUrls] = useState<Record<string, { url: string; blob: Blob }>>({});
  // Tick marks the signer places on each PDF, keyed by request id.
  const [ticks, setTicks] = useState<Record<string, TickMark[]>>({});
  const [method, setMethod] = useState<"draw" | "type" | "upload">("draw");
  const [drawData, setDrawData] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  const [uploadData, setUploadData] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ signed: any[]; failed: any[] } | null>(null);
  const blobUrls = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const r of requests) {
        try {
          const d = await apiClient.get<any>(`/api/documents/requests/${r.id}`);
          if (cancelled) return;
          setDetails((prev) => ({ ...prev, [r.id]: d }));
          await apiClient.post(`/api/documents/requests/${r.id}/view`, {});
          if (d.has_file) {
            const blob = await apiClient.getBlob(`/api/documents/requests/${r.id}/file`);
            const url = URL.createObjectURL(blob);
            blobUrls.current.push(url);
            if (!cancelled) setFileUrls((prev) => ({ ...prev, [r.id]: { url, blob } }));
          }
        } catch {
          if (!cancelled) setDetails((prev) => ({ ...prev, [r.id]: { error: true } }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const signatureReady =
    (method === "draw" && !!drawData) ||
    (method === "type" && typedName.trim().length > 0) ||
    (method === "upload" && !!uploadData);
  const signatureData =
    method === "draw" ? drawData : method === "type" ? typedName.trim() : uploadData;

  const totalTicks = Object.values(ticks).reduce((n, t) => n + t.length, 0);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const annotations: Record<string, TickMark[]> = {};
      for (const [id, t] of Object.entries(ticks)) if (t.length) annotations[id] = t;
      const res = await apiClient.post<{ signed: any[]; failed: any[] }>(
        "/api/documents/requests/sign-batch",
        { requestIds: requests.map((r) => r.id), signatureType: method, signatureData, annotations }
      );
      if (!res.failed || res.failed.length === 0) {
        onDone();
        return;
      }
      setResult(res);
    } catch (e: any) {
      setErr(e.message || "Failed to sign documents");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="font-semibold">Sign {requests.length} document{requests.length === 1 ? "" : "s"}</h3>
            <p className="text-xs text-muted-foreground">Your signature below is applied to every document listed — review each one first. Click on a PDF to tick boxes (Yes/No etc.) where needed.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {result ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-success">{result.signed.length} document(s) signed.</p>
              {result.failed.length > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
                  <p className="font-medium">{result.failed.length} could not be signed:</p>
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {result.failed.map((f, i) => <li key={i}>{f.name || f.id} — {f.error}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {requests.map((r, idx) => {
                  const d = details[r.id];
                  const f = fileUrls[r.id];
                  const t = ticks[r.id] ?? [];
                  return (
                    <details key={r.id} open={requests.length === 1 || idx === 0} className="rounded-lg border border-border">
                      <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium hover:bg-secondary/50">
                        {r.document_name}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {t.length > 0 ? `${t.length} tick${t.length === 1 ? "" : "s"} placed` : "tap to review"}
                        </span>
                      </summary>
                      <div className="border-t border-border px-3 py-3">
                        {d === undefined && <p className="text-xs text-muted-foreground">Loading…</p>}
                        {d?.error && <p className="text-xs text-danger">Failed to load this document.</p>}
                        {d?.rendered_content && (
                          <pre className="whitespace-pre-wrap rounded-lg bg-secondary/50 p-3 text-xs">{d.rendered_content}</pre>
                        )}
                        {!d?.rendered_content && f && (
                          <FilePreview
                            file={f}
                            name={r.document_name}
                            ticks={t}
                            onTicksChange={(next) => setTicks((prev) => ({ ...prev, [r.id]: next }))}
                            editable
                            maxHeight="55vh"
                          />
                        )}
                        {d && !d.rendered_content && !d.has_file && !d.error && (
                          <p className="text-xs text-muted-foreground">No document content available.</p>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>

              <label className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  I confirm I have read and agree to all {requests.length} document{requests.length === 1 ? "" : "s"} listed above
                  {totalTicks > 0 ? `, including the ${totalTicks} tick mark${totalTicks === 1 ? "" : "s"} I placed` : ""}.
                </span>
              </label>

              <div>
                <p className="text-sm font-medium mb-2">Sign with:</p>
                <div className="flex gap-2 mb-3">
                  {(["draw", "type", "upload"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={`px-3 py-1.5 rounded-lg text-sm capitalize ${method === m ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
                    >
                      {m === "draw" ? "Draw" : m === "type" ? "Type" : "Upload"}
                    </button>
                  ))}
                </div>
                {method === "draw" && <DrawPad onChange={setDrawData} />}
                {method === "type" && (
                  <div>
                    <input
                      value={typedName}
                      onChange={(e) => setTypedName(e.target.value)}
                      placeholder="Type your full name"
                      className="w-full h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
                    />
                    {typedName.trim() && (
                      <p className="mt-2 rounded-lg border border-border bg-white px-3 py-2 text-2xl italic" style={{ fontFamily: "cursive" }}>
                        {typedName}
                      </p>
                    )}
                  </div>
                )}
                {method === "upload" && (
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) { setUploadData(null); return; }
                      const r = new FileReader();
                      r.onload = () => setUploadData(String(r.result));
                      r.readAsDataURL(f);
                    }}
                    className="w-full h-10 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  />
                )}
                {method === "upload" && uploadData && (
                  <img src={uploadData} alt="Signature preview" className="mt-2 max-h-20 rounded border border-border bg-white" />
                )}
              </div>
              {err && <p className="text-sm text-danger">{err}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-4">
          {result ? (
            <>
              <span />
              <button onClick={onDone} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">Done</button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={busy}
                className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-secondary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || !signatureReady || !confirmed}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                <FileSignature className="size-4" /> {busy ? "Signing..." : `Confirm & Sign ${requests.length}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- All-in-one Documents tab (used by the Contractor Portal) ---------- */
export function PortalDocuments({ docs, onChanged }: { docs: PortalDocRequest[]; onChanged: () => void }) {
  const [viewing, setViewing] = useState<PortalDocRequest | null>(null);
  const [agreed, setAgreed] = useState<string[]>([]);
  const [batchSigning, setBatchSigning] = useState(false);

  const pending = docs.filter((d) => d.status === "pending");
  const past = docs.filter((d) => d.status !== "pending");
  const agreedDocs = pending.filter((d) => agreed.includes(d.id));

  useEffect(() => {
    const ids = new Set(pending.map((d) => d.id));
    setAgreed((prev) => prev.filter((id) => ids.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  return (
    <div className="space-y-6">
      <PendingDocs
        docs={pending}
        agreed={agreed}
        onToggle={(id) => setAgreed((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
        onView={setViewing}
        onSignSelected={() => setBatchSigning(true)}
        onChanged={onChanged}
        emptyText="Nothing waiting for your signature."
      />
      <PastDocs docs={past} />
      {viewing && <ViewDocModal request={viewing} onClose={() => setViewing(null)} />}
      {batchSigning && agreedDocs.length > 0 && (
        <BatchSignModal
          requests={agreedDocs}
          onClose={() => setBatchSigning(false)}
          onDone={() => { setBatchSigning(false); setAgreed([]); onChanged(); }}
        />
      )}
    </div>
  );
}

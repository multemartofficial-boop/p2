import { jsPDF } from "jspdf";
import { apiClient } from "@/lib/api-client";

const fmtTs = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-GB", { hour12: false }) : "—";

export type SignedRequestRef = {
  id: string;
  document_name?: string;
  worker_name?: string;
  worker_id?: string | null;
  recipient_name?: string;
  recipient_type?: "worker" | "contractor";
  recipient_id?: string;
};

type Tick = { page: number; x: number; y: number };

const saveBlob = (bytes: Uint8Array, name: string) => {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const dataUrlToBytes = (dataUrl: string) => {
  const base64 = dataUrl.split(",")[1] || "";
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const signerLabel = (d: any) => (d.recipient_type === "contractor" || d.contractor_id ? "Contractor" : "Worker");
const signerName = (d: any, req: SignedRequestRef) =>
  d.recipient_name || d.worker_name || req.recipient_name || req.worker_name || d.worker_id || d.contractor_id || "";
const signerId = (d: any, req: SignedRequestRef) =>
  d.recipient_id || d.worker_id || d.contractor_id || req.recipient_id || req.worker_id || "";

/* ---------- Uploaded PDF: stamp ticks on the real pages + add a signatures page ---------- */
const buildFromOriginalPdf = async (d: any, req: SignedRequestRef, original: Uint8Array) => {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.load(original, { ignoreEncryption: true });
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const zapf = await pdf.embedFont(StandardFonts.ZapfDingbats); // "4" = ✔
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const blue = rgb(0.09, 0.32, 0.72);

  // Tick marks — x/y are fractions of the page from the top-left.
  const ticks: Tick[] = Array.isArray(d.annotations) ? d.annotations : [];
  const pages = pdf.getPages();
  for (const t of ticks) {
    const page = pages[t.page - 1];
    if (!page) continue;
    const { width, height } = page.getSize();
    const size = Math.max(10, width * 0.028);
    const cx = t.x * width;
    const cy = height - t.y * height;
    page.drawRectangle({
      x: cx - size / 2, y: cy - size / 2, width: size, height: size,
      borderColor: blue, borderWidth: 1.2, color: rgb(1, 1, 1), opacity: 0.6,
    });
    page.drawText("4", { x: cx - size * 0.36, y: cy - size * 0.34, size: size * 0.85, font: zapf, color: blue });
  }

  // Signatures page
  const first = pages[0];
  const pw = first ? first.getSize().width : 595.28;
  const ph = first ? first.getSize().height : 841.89;
  const page = pdf.addPage([pw, ph]);
  const margin = 48;
  let y = ph - margin;
  const text = (s: string, size = 10, font = helv, color = rgb(0.1, 0.1, 0.1)) => {
    page.drawText(s, { x: margin, y: y - size, size, font, color });
    y -= size * 1.5;
  };

  text("Signature record", 16, helvBold);
  text(d.document_name || req.document_name || "Document", 12, helvBold);
  text(`${signerLabel(d)}: ${signerName(d, req)}${signerId(d, req) ? ` (${signerId(d, req)})` : ""}`, 10);
  text(`Sent: ${fmtTs(d.sent_at)}${d.viewed_at ? `   ·   Viewed: ${fmtTs(d.viewed_at)}` : ""}`, 10);
  if (ticks.length) text(`Tick marks placed on the document by the signer: ${ticks.length} (shown on the pages above in blue)`, 10);
  y -= 12;

  const sigBlock = async (label: string, who: string, at: string | null, ip: string | null, type: string | null, data: string | null) => {
    text(label, 11, helvBold);
    if (type && data && type !== "type" && String(data).startsWith("data:image")) {
      try {
        const bytes = dataUrlToBytes(String(data));
        const img = String(data).startsWith("data:image/jpeg") ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
        const w = 150;
        const h = (img.height / img.width) * w;
        page.drawImage(img, { x: margin, y: y - h, width: w, height: h });
        y -= h + 6;
      } catch { /* fall through to text */ }
    } else if (type === "type" && data) {
      page.drawText(String(data), { x: margin, y: y - 20, size: 20, font: italic, color: rgb(0.1, 0.1, 0.1) });
      y -= 28;
    }
    text(`${who}${at ? ` — ${fmtTs(at)}` : ""}${ip ? `   ·   IP ${ip}` : ""}`, 9, helv, rgb(0.35, 0.35, 0.35));
    y -= 14;
  };

  // Company signed first chronologically when it came from a signed template;
  // for uploads the signer signs first and the company countersigns.
  const companyFirst = d.admin_signed_at && d.signed_at && new Date(d.admin_signed_at) < new Date(d.signed_at);
  const company = () => d.admin_signed_at
    ? sigBlock("Signed by the Director of SGS", d.admin_signed_by || "Company", d.admin_signed_at, d.admin_signer_ip, d.admin_signature_type, d.admin_signature_data)
    : Promise.resolve();
  const signer = () => sigBlock(`Signed by ${signerLabel(d)}`, signerName(d, req), d.signed_at, d.signer_ip, d.signature_type, d.signature_data);
  if (companyFirst) { await company(); await signer(); } else { await signer(); await company(); }

  return pdf.save();
};

/* ---------- Text template / fallback: rebuild as a fresh PDF ---------- */
const buildFromText = (d: any, req: SignedRequestRef) => {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;
  let y = 20;

  const write = (text: string, size = 10, style: "normal" | "bold" = "normal") => {
    doc.setFontSize(size);
    doc.setFont("helvetica", style);
    for (const line of doc.splitTextToSize(text, pageW - margin * 2) as string[]) {
      if (y > 278) { doc.addPage(); y = 20; }
      doc.text(line, margin, y);
      y += size * 0.5;
    }
    y += 2;
  };

  write(d.document_name || req.document_name || "Document", 16, "bold");
  write(`${signerLabel(d)}: ${signerName(d, req)}${signerId(d, req) ? ` (${signerId(d, req)})` : ""}`, 10);
  write(`Sent: ${fmtTs(d.sent_at)}`, 10);
  y += 4;

  // Body: rendered content (or signed_content minus the appended sig blocks)
  const body = String(d.rendered_content || d.docx_text || d.signed_content || "[No content]");
  write(body, 10);
  y += 6;

  const sigBlock = (
    label: string,
    signer: string,
    at: string | null,
    ip: string | null,
    sigType: string | null,
    sigData: string | null,
  ) => {
    if (y > 240) { doc.addPage(); y = 20; }
    write(label, 11, "bold");
    if (sigType && sigData && sigType !== "type" && String(sigData).startsWith("data:image")) {
      try { doc.addImage(sigData, "PNG", margin, y, 45, 18); } catch { /* fall through to text */ }
      y += 22;
    } else if (sigType === "type" && sigData) {
      doc.setFont("times", "italic");
      doc.setFontSize(18);
      doc.text(String(sigData), margin, y + 8);
      y += 12;
    }
    write(`${signer}${at ? ` — ${fmtTs(at)}` : ""}${ip ? ` · IP ${ip}` : ""}`, 9);
    y += 4;
  };

  // Company signed at template creation — its block goes first chronologically.
  if (d.admin_signed_at) {
    sigBlock("Signed by the Director of SGS", d.admin_signed_by || "Company", d.admin_signed_at, d.admin_signer_ip, d.admin_signature_type, d.admin_signature_data);
  }
  sigBlock(`Signed by ${signerLabel(d)}`, signerName(d, req), d.signed_at, d.signer_ip, d.signature_type, d.signature_data);

  doc.save(`${(d.document_name || "document").replace(/[^\w-]+/g, "_")}-signed.pdf`);
};

/* ---------- Build + download the fully signed PDF ---------- */
export const downloadSignedPdf = async (req: SignedRequestRef) => {
  const d = await apiClient.get<any>(`/api/documents/requests/${req.id}`);
  if (typeof d.annotations === "string") {
    try { d.annotations = JSON.parse(d.annotations); } catch { d.annotations = null; }
  }

  // Uploaded PDF files keep their original pages, with the signer's tick marks
  // drawn on and a signature record page appended.
  if (d.has_file && !d.rendered_content) {
    try {
      const blob = await apiClient.getBlob(`/api/documents/requests/${req.id}/file`);
      if (blob.type === "application/pdf") {
        const bytes = await buildFromOriginalPdf(d, req, new Uint8Array(await blob.arrayBuffer()));
        saveBlob(bytes, `${(d.document_name || "document").replace(/[^\w-]+/g, "_")}-signed.pdf`);
        return;
      }
      // Word files: extract the text so the signed PDF carries the document body.
      if (blob.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        const { default: mammoth } = await import("mammoth");
        const out = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() });
        d.docx_text = out.value;
      }
    } catch (e) {
      console.error("Original PDF stamping failed, falling back to text summary:", e);
    }
  }
  buildFromText(d, req);
};

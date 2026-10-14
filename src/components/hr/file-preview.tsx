import { useEffect, useState } from "react";
import { Download, Info } from "lucide-react";
import { PdfAnnotator, type TickMark } from "@/components/hr/pdf-annotator";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const isDocxBlob = (blob: Blob, name?: string) =>
  blob.type === DOCX_MIME || /\.docx$/i.test(name || "");

/** Word (.docx) rendered to readable HTML in the browser — no download needed. */
export function DocxPreview({ url, maxHeight = "60vh" }: { url: string; maxHeight?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ default: mammoth }, res] = await Promise.all([import("mammoth"), fetch(url)]);
        const arrayBuffer = await res.arrayBuffer();
        const out = await mammoth.convertToHtml({ arrayBuffer });
        if (!cancelled) setHtml(out.value || "<p><em>(empty document)</em></p>");
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Could not render this Word document");
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (html === null) return <div className="h-40 animate-pulse rounded bg-secondary" />;
  return (
    <div
      className="nice-scrollbar overflow-auto rounded-lg border border-border bg-white p-5 text-sm leading-relaxed text-foreground [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_table]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_ul]:list-disc"
      style={{ maxHeight }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Inline preview for an uploaded signature document. PDFs get the full
 * page renderer (with tick marks when editable); .docx is converted to
 * readable HTML; anything else falls back to a download link.
 */
export function FilePreview({
  file, name, ticks = [], onTicksChange, editable = false, maxHeight = "60vh",
}: {
  file: { url: string; blob: Blob };
  name: string;
  ticks?: TickMark[];
  onTicksChange?: (t: TickMark[]) => void;
  editable?: boolean;
  maxHeight?: string;
}) {
  if (file.blob.type === "application/pdf") {
    return <PdfAnnotator url={file.url} ticks={ticks} {...(onTicksChange ? { onChange: onTicksChange } : {})} editable={editable} maxHeight={maxHeight} />;
  }
  if (file.blob.type.startsWith("image/")) {
    return <img src={file.url} alt={name} className="max-h-[60vh] w-full rounded-lg border border-border object-contain" />;
  }
  if (isDocxBlob(file.blob, name)) {
    return (
      <div className="space-y-2">
        <DocxPreview url={file.url} maxHeight={maxHeight} />
        {editable && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            This is a Word document, so tick boxes can't be placed on it — your signature applies to the whole document. Ask the admin for a PDF version if you need to tick Yes/No answers.
          </p>
        )}
        <a href={file.url} download={name} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline">
          <Download className="size-3.5" /> Download original file
        </a>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-secondary/50 p-4 text-sm">
      <p className="mb-2 text-muted-foreground">This file type can't be previewed in the browser — open it to review the full contents.</p>
      <a href={file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-primary underline">
        <Download className="size-4" /> Download {name}
      </a>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Pencil, Trash2, FileSpreadsheet, FileDown, ClipboardList, Filter } from "lucide-react";
import { jsPDF } from "jspdf";
import { AdminShell } from "@/components/hr/admin-shell";
import {
  Card, Field, GhostButton, Modal, PrimaryButton, inputCls,
  DataTable, Th, Td, EmptyRow, SectionTitle,
} from "@/components/hr/bits";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/lib/api-store";
import { fmtDate, toISO } from "@/lib/hr-utils";

export const Route = createFileRoute("/admin/daily-tasks")({
  head: () => ({
    meta: [
      { title: "Daily Tasks — WorkHR" },
      { name: "description", content: "Day-by-day admin task log with remarks and status." },
    ],
  }),
  component: DailyTasksPage,
});

type TaskStatus = "In progress" | "Completed";
type Task = {
  id: string;
  date: string;
  tasks: string;
  remarks: string | null;
  status: TaskStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUSES: TaskStatus[] = ["In progress", "Completed"];
const COLUMNS = ["Date", "Tasks", "Remarks", "Status"] as const;

const rowsForExport = (tasks: Task[]) =>
  tasks.map((t) => [fmtDate(t.date), t.tasks, t.remarks || "", t.status]);

const rangeLabel = (from: string, to: string) =>
  from && to ? `${fmtDate(from)} – ${fmtDate(to)}` : from ? `from ${fmtDate(from)}` : to ? `up to ${fmtDate(to)}` : "all dates";

const fileStamp = (from: string, to: string) =>
  `daily-tasks${from ? `-${from}` : ""}${to ? `-to-${to}` : ""}`;

/* ---------- Excel export (.xlsx via exceljs, loaded on demand) ---------- */
const exportExcel = async (tasks: Task[], from: string, to: string) => {
  const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Daily Tasks");
  ws.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Tasks", key: "tasks", width: 60 },
    { header: "Remarks", key: "remarks", width: 40 },
    { header: "Status", key: "status", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rowsForExport(tasks)) ws.addRow(r);
  ws.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileStamp(from, to)}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/* ---------- PDF export (jsPDF, hand-drawn table) ---------- */
const exportPdf = (tasks: Task[], from: string, to: string) => {
  const doc = new jsPDF({ orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const widths = [28, 120, 90, pageW - margin * 2 - 28 - 120 - 90];
  let y = margin;

  const header = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Daily Tasks", margin, y + 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Range: ${rangeLabel(from, to)} · ${tasks.length} task${tasks.length === 1 ? "" : "s"} · Exported ${new Date().toLocaleString("en-GB", { hour12: false })}`, margin, y + 10);
    y += 16;
    doc.setFillColor(235, 238, 243);
    doc.rect(margin, y, pageW - margin * 2, 8, "F");
    doc.setFont("helvetica", "bold");
    let x = margin;
    COLUMNS.forEach((c, i) => { doc.text(c, x + 2, y + 5.5); x += widths[i]!; });
    y += 8;
    doc.setFont("helvetica", "normal");
  };

  header();
  for (const r of rowsForExport(tasks)) {
    const cells = r.map((v, i) => doc.splitTextToSize(String(v), widths[i]! - 4) as string[]);
    const lines = Math.max(...cells.map((c) => c.length), 1);
    const h = lines * 4.2 + 3;
    if (y + h > pageH - margin) { doc.addPage(); y = margin; header(); }
    let x = margin;
    cells.forEach((c, i) => { doc.text(c, x + 2, y + 4.5); x += widths[i]!; });
    y += h;
    doc.setDrawColor(220);
    doc.line(margin, y, pageW - margin, y);
  }
  if (tasks.length === 0) doc.text("No tasks in this range.", margin + 2, y + 6);
  doc.save(`${fileStamp(from, to)}.pdf`);
};

/* ---------- Add / edit modal ---------- */
function TaskModal({ existing, onClose, onSaved }: { existing: Task | null; onClose: () => void; onSaved: () => void }) {
  const { session } = useApi();
  const [date, setDate] = useState(existing?.date ?? toISO(new Date()));
  const [tasks, setTasks] = useState(existing?.tasks ?? "");
  const [remarks, setRemarks] = useState(existing?.remarks ?? "");
  const [addedBy, setAddedBy] = useState(existing?.createdBy ?? session?.name ?? "");
  const [status, setStatus] = useState<TaskStatus>(existing?.status ?? "In progress");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload = { date, tasks: tasks.trim(), remarks: remarks.trim() || null, addedBy: addedBy.trim() || null, status };
      if (existing) await apiClient.put(`/api/daily-tasks/${existing.id}`, payload);
      else await apiClient.post("/api/daily-tasks", payload);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to save task");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={existing ? "Edit task" : "Add task"} description="What was done (or needs doing) on this date, with any remarks." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date">
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={inputCls}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Tasks">
          <textarea required value={tasks} onChange={(e) => setTasks(e.target.value)} rows={4} className={`${inputCls} h-auto py-2`} placeholder="Site visit at Camden, chase RAMS sign-off, update rota…" />
        </Field>
        <Field label="Remarks">
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} className={`${inputCls} h-auto py-2`} placeholder="Optional notes, blockers, follow-ups" />
        </Field>
        <Field label="Added by">
          <input value={addedBy} onChange={(e) => setAddedBy(e.target.value)} className={inputCls} placeholder="Your name" />
        </Field>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={busy || !tasks.trim()}>{busy ? "Saving..." : existing ? "Save changes" : "Add task"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function DailyTasksPage() {
  const [all, setAll] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | TaskStatus>("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAll(await apiClient.get<Task[]>("/api/daily-tasks"));
      setErr(null);
    } catch (e: any) {
      setErr(e.message || "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Filter client-side — the list is small and this keeps the date pickers instant.
  const tasks = useMemo(() => all.filter((t) =>
    (!from || t.date >= from) && (!to || t.date <= to) && (!statusFilter || t.status === statusFilter)
  ), [all, from, to, statusFilter]);

  const setStatus = async (t: Task, status: TaskStatus) => {
    try {
      await apiClient.put(`/api/daily-tasks/${t.id}`, { status });
      setAll((prev) => prev.map((x) => (x.id === t.id ? { ...x, status } : x)));
    } catch (e: any) { setErr(e.message); }
  };

  const del = async (t: Task) => {
    if (!window.confirm(`Delete this task from ${fmtDate(t.date)}?`)) return;
    try {
      await apiClient.delete(`/api/daily-tasks/${t.id}`);
      void load();
    } catch (e: any) { setErr(e.message); }
  };

  const runExport = async (kind: "xlsx" | "pdf") => {
    setExporting(kind);
    setErr(null);
    try {
      if (kind === "xlsx") await exportExcel(tasks, from, to);
      else exportPdf(tasks, from, to);
    } catch (e: any) {
      setErr(e.message || "Export failed");
    } finally {
      setExporting(null);
    }
  };

  const quick = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    setFrom(toISO(start));
    setTo(toISO(end));
  };

  const completed = tasks.filter((t) => t.status === "Completed").length;

  return (
    <AdminShell
      title="Daily Tasks"
      action={
        <button
          onClick={() => { setEditing(null); setOpen(true); }}
          className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          <Plus className="size-4" /> Add Task
        </button>
      }
    >
      {err && <p className="mb-3 text-sm text-danger">{err}</p>}

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From" className="w-40">
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </Field>
          <Field label="To" className="w-40">
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Status" className="w-40">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | TaskStatus)} className={inputCls}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <div className="flex flex-wrap gap-1.5 pb-0.5">
            <GhostButton type="button" className="h-10 px-3 text-xs" onClick={() => { setFrom(toISO(new Date())); setTo(toISO(new Date())); }}>Today</GhostButton>
            <GhostButton type="button" className="h-10 px-3 text-xs" onClick={() => quick(7)}>Last 7 days</GhostButton>
            <GhostButton type="button" className="h-10 px-3 text-xs" onClick={() => quick(30)}>Last 30 days</GhostButton>
            {(from || to || statusFilter) && (
              <GhostButton type="button" className="h-10 px-3 text-xs" onClick={() => { setFrom(""); setTo(""); setStatusFilter(""); }}>
                <Filter className="size-3.5" /> Clear
              </GhostButton>
            )}
          </div>
          <div className="ml-auto flex gap-2 pb-0.5">
            <GhostButton type="button" onClick={() => void runExport("xlsx")} disabled={exporting !== null || tasks.length === 0}>
              <FileSpreadsheet className="size-4" /> {exporting === "xlsx" ? "Preparing…" : "Excel"}
            </GhostButton>
            <GhostButton type="button" onClick={() => void runExport("pdf")} disabled={exporting !== null || tasks.length === 0}>
              <FileDown className="size-4" /> {exporting === "pdf" ? "Preparing…" : "PDF"}
            </GhostButton>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle
          title={`Tasks — ${rangeLabel(from, to)}`}
          action={<span className="text-xs text-muted-foreground">{tasks.length} task{tasks.length === 1 ? "" : "s"} · {completed} completed · {tasks.length - completed} in progress</span>}
        />
        <DataTable
          labels={["Date", "Tasks", "Remarks", "Status", "Added by", ""]}
          head={<><Th>Date</Th><Th>Tasks</Th><Th>Remarks</Th><Th>Status</Th><Th>Added by</Th><Th className="text-right">Actions</Th></>}
        >
          {loading ? (
            <EmptyRow colSpan={6} text="Loading tasks…" />
          ) : tasks.length === 0 ? (
            <EmptyRow colSpan={6} text={all.length === 0 ? "No tasks yet — add your first daily task." : "No tasks match this filter."} />
          ) : (
            tasks.map((t) => (
              <tr key={t.id}>
                <Td className="whitespace-nowrap font-medium">{fmtDate(t.date)}</Td>
                <Td className="max-w-md whitespace-pre-wrap">
                  <div className="flex items-start gap-2">
                    <ClipboardList className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span>{t.tasks}</span>
                  </div>
                </Td>
                <Td className="max-w-xs whitespace-pre-wrap text-muted-foreground">{t.remarks || "—"}</Td>
                <Td>
                  <select
                    value={t.status}
                    onChange={(e) => void setStatus(t, e.target.value as TaskStatus)}
                    title="Change status"
                    className={`h-8 rounded-full border-0 px-2.5 text-xs font-medium outline-none ${t.status === "Completed" ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Td>
                <Td className="text-xs text-muted-foreground">{t.createdBy || "—"}</Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button title="Edit" onClick={() => { setEditing(t); setOpen(true); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-primary">
                      <Pencil className="size-4" />
                    </button>
                    <button title="Delete" onClick={() => void del(t)} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-danger">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </DataTable>
      </Card>

      {open && (
        <TaskModal
          existing={editing}
          onClose={() => { setOpen(false); setEditing(null); }}
          onSaved={load}
        />
      )}
    </AdminShell>
  );
}

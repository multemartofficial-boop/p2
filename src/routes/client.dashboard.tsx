import { useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Building2, LogOut, MapPin, Users, Calendar, PoundSterling, RefreshCw, LayoutDashboard, FileText } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useApi } from "@/lib/api-store";
import { cn } from "@/lib/utils";
import { PortalDocuments, loadMyDocRequests, type PortalDocRequest } from "@/components/hr/portal-documents";

export const Route = createFileRoute("/client/dashboard")({
  head: () => ({
    meta: [
      { title: "Contractor Portal — WorkHR" },
      { name: "description", content: "Site coverage, schedules and billing for your locations." },
    ],
  }),
  component: ClientDashboard,
});

type Overview = {
  company: string;
  locations: { id: string; name: string; address: string }[];
  scheduledToday: number;
  scheduledWorkers: { worker_id: string; worker: string; location: string }[];
  checkedInNow: { worker: string; location: string; check_in_time: string }[];
  checkedInCount: number;
};

type ScheduleRow = {
  id: string; date: string; worker: string; location: string;
  checkIn: string | null; checkOut: string | null;
  status: "scheduled" | "on_site" | "completed" | "checked_in_elsewhere";
};

type Billing = {
  buyerName: string | null;
  entries: { id: string; description: string; amount: number; date: string; status: string }[];
  totals: { received: number; pending: number };
};

const money = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtD = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

const schedBadge = (s: ScheduleRow["status"]) => {
  const map = {
    scheduled: "bg-secondary text-muted-foreground",
    on_site: "bg-success-soft text-success",
    completed: "bg-primary-soft text-primary",
    checked_in_elsewhere: "bg-danger-soft text-danger",
  } as const;
  const label = {
    scheduled: "Scheduled",
    on_site: "On site",
    completed: "Completed",
    checked_in_elsewhere: "Checked in elsewhere",
  } as const;
  return <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", map[s])}>{label[s]}</span>;
};

function ClientDashboard() {
  const router = useRouter();
  const { session, logout } = useApi();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastPoll, setLastPoll] = useState<Date>(new Date());
  const [tab, setTab] = useState<"dashboard" | "documents">("dashboard");
  // Documents sent to this contractor for e-signature (same flow as workers)
  const [docs, setDocs] = useState<PortalDocRequest[]>([]);

  const loadDocs = async () => {
    try {
      setDocs((await loadMyDocRequests()) || []);
    } catch (e) {
      console.error("Contractor documents load failed:", e);
    }
  };

  const load = async () => {
    try {
      const [o, s, b] = await Promise.all([
        apiClient.get<Overview>("/api/client/overview"),
        apiClient.get<ScheduleRow[]>("/api/client/schedule"),
        apiClient.get<Billing>("/api/client/billing"),
      ]);
      setOverview(o);
      setSchedule(s);
      setBilling(b);
      setLastPoll(new Date());
    } catch (e) {
      console.error("Contractor portal load failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadDocs();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const pendingDocs = docs.filter((d) => d.status === "pending").length;

  const refresh = () => {
    setRefreshing(true);
    load().finally(() => setTimeout(() => setRefreshing(false), 400));
  };

  const handleLogout = () => {
    logout();
    router.navigate({ to: "/" });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top Bar */}
      <div className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/images/demo-logo.svg" alt="ShieldGuard Security Ltd" className="h-9 w-auto" />
            <span className="text-muted-foreground">|</span>
            <span className="text-sm">Contractor Portal</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{overview?.company || session?.name}</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <LogOut className="size-4" />
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Portal nav */}
      <div className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {([
            { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
            { key: "documents", label: "Documents", icon: FileText },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${
                tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-4" />
              {label}
              {key === "documents" && pendingDocs > 0 && (
                <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">{pendingDocs}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {tab === "documents" && (
        <div className="max-w-7xl mx-auto px-4 py-8">
          <PortalDocuments docs={docs} onChanged={loadDocs} />
        </div>
      )}

      {tab === "dashboard" && (
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {pendingDocs > 0 && (
          <button
            onClick={() => setTab("documents")}
            className="flex w-full items-center gap-3 rounded-xl border border-primary/30 bg-primary-soft px-4 py-3 text-left text-sm"
          >
            <FileText className="size-5 shrink-0 text-primary" />
            <span>
              <span className="font-medium text-primary">{pendingDocs} document{pendingDocs === 1 ? "" : "s"} waiting for your signature.</span>
              <span className="ml-1 text-muted-foreground">Open the Documents tab to read and sign.</span>
            </span>
          </button>
        )}
        {/* Coverage today */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="bg-card rounded-xl p-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="size-4" /> Your locations</div>
            <p className="mt-2 text-2xl font-bold">{overview?.locations.length ?? 0}</p>
          </div>
          <div className="bg-card rounded-xl p-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Users className="size-4" /> Scheduled today</div>
            <p className="mt-2 text-2xl font-bold">{overview?.scheduledToday ?? 0}</p>
          </div>
          <div className="bg-card rounded-xl p-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Users className="size-4 text-success" /> On site right now</div>
            <p className="mt-2 text-2xl font-bold text-success">{overview?.checkedInCount ?? 0}</p>
          </div>
        </div>

        {/* Who's on site */}
        <div className="bg-card rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="size-5" /> Currently on site
            </h2>
            <button onClick={refresh} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              <span className="hidden sm:inline">Updated {lastPoll.toLocaleTimeString("en-GB", { hour12: false })}</span>
            </button>
          </div>
          {!overview?.checkedInNow.length ? (
            <p className="text-sm text-muted-foreground">No workers currently checked in at your locations.</p>
          ) : (
            <div className="divide-y divide-border">
              {overview.checkedInNow.map((r, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{r.worker}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="size-3" /> {r.location}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">since {String(r.check_in_time).slice(0, 5)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Schedule */}
        <div className="bg-card rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Calendar className="size-5" /> Schedule — next 14 days
          </h2>
          {schedule.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming assignments at your locations.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium">Date</th>
                    <th className="text-left py-3 px-4 font-medium">Worker</th>
                    <th className="text-left py-3 px-4 font-medium">Location</th>
                    <th className="text-left py-3 px-4 font-medium">Check-in</th>
                    <th className="text-left py-3 px-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-3 px-4 whitespace-nowrap">{fmtD(r.date)}</td>
                      <td className="py-3 px-4 font-medium">{r.worker}</td>
                      <td className="py-3 px-4 text-muted-foreground">{r.location}</td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {r.checkIn ? `${r.checkIn}${r.checkOut ? ` – ${r.checkOut}` : ""}` : "—"}
                      </td>
                      <td className="py-3 px-4">{schedBadge(r.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Billing */}
        <div className="bg-card rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <PoundSterling className="size-5" /> Billing
            {billing?.buyerName && <span className="text-sm font-normal text-muted-foreground">({billing.buyerName})</span>}
          </h2>
          {!billing?.buyerName ? (
            <p className="text-sm text-muted-foreground">No billing account is linked to your profile yet.</p>
          ) : billing.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <>
              <div className="mb-4 flex gap-6 text-sm">
                <span>Received: <strong className="text-success">{money(billing.totals.received)}</strong></span>
                <span>Pending: <strong className="text-warning">{money(billing.totals.pending)}</strong></span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium">Date</th>
                      <th className="text-left py-3 px-4 font-medium">Description</th>
                      <th className="text-right py-3 px-4 font-medium">Amount</th>
                      <th className="text-left py-3 px-4 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.entries.map((e) => (
                      <tr key={e.id} className="border-b">
                        <td className="py-3 px-4 whitespace-nowrap">{fmtD(e.date)}</td>
                        <td className="py-3 px-4">{e.description}</td>
                        <td className="py-3 px-4 text-right font-medium">{money(e.amount)}</td>
                        <td className="py-3 px-4">
                          <span className={cn(
                            "rounded-full px-2.5 py-0.5 text-xs font-medium",
                            e.status === "Received" ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
                          )}>
                            {e.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

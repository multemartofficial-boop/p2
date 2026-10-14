import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, RefreshCw, Building2, MapPin, Trash2, Pencil } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import {
  Card, Field, GhostButton, Modal, PrimaryButton, inputCls,
  DataTable, Th, Td, EmptyRow, SectionTitle, StatusBadge,
} from "@/components/hr/bits";
import { apiClient } from "@/lib/api-client";
import { fmtDate } from "@/lib/hr-utils";
import { useApi } from "@/lib/api-store";

export const Route = createFileRoute("/admin/clients")({
  head: () => ({
    meta: [
      { title: "Contractors — WorkHR" },
      { name: "description", content: "Contractor records — company details, linked locations and portal access." },
    ],
  }),
  component: ClientsPage,
});

type Client = {
  id: string;
  userId: number | null;
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: "Active" | "Inactive";
  notes: string | null;
  buyerName: string | null;
  workerCount: number;
  locations: { id: string; name: string; address: string }[];
  createdAt: string;
};

function LocationPicker({
  selected, onChange,
}: { selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const { locations } = useApi();
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };
  return (
    <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-border">
      {(locations || []).map((l) => (
        <label key={l.id} className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-secondary/40">
          <input
            type="checkbox"
            checked={selected.has(l.id)}
            onChange={() => toggle(l.id)}
            className="size-4 accent-primary"
          />
          <span className="flex-1">{l.name}</span>
          <span className="text-xs text-muted-foreground">{l.address}</span>
        </label>
      ))}
      {(locations || []).length === 0 && (
        <p className="px-3 py-4 text-sm text-muted-foreground">No locations configured.</p>
      )}
    </div>
  );
}

function ClientForm({
  existing, onClose, onSaved,
}: { existing: Client | null; onClose: () => void; onSaved: () => void }) {
  const [company, setCompany] = useState(existing?.company ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [address, setAddress] = useState(existing?.address ?? "");
  const [status, setStatus] = useState<"Active" | "Inactive">(existing?.status ?? "Active");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [password, setPassword] = useState("");
  const [buyerName, setBuyerName] = useState(existing?.buyerName ?? "");
  const [locIds, setLocIds] = useState<Set<string>>(new Set((existing?.locations ?? []).map(l => l.id)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const payload = {
        company, name: company, email: email || null, phone: phone || null,
        address: address || null, status, notes: notes || null,
        buyerName: buyerName || null,
        locationIds: [...locIds],
        ...(password ? { password } : {}),
      };
      if (existing) await apiClient.put(`/api/clients/${existing.id}`, payload);
      else await apiClient.post("/api/clients", payload);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to save contractor");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? `Edit ${existing.company}` : "Add contractor"}
      description={
        existing
          ? "Update the contractor's details, linked sites, and portal access."
          : "Company record — set a password to also give them a contractor portal login."
      }
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name">
            <input required value={company} onChange={(e) => setCompany(e.target.value)} className={inputCls} placeholder="Acme Facilities Ltd" />
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as "Active" | "Inactive")} className={inputCls}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </Field>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="contact@acme.com" />
          </Field>
          <Field label="Phone number">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="020 7946 0000" />
          </Field>
          <Field
            label={existing ? "Portal password" : "Portal password (optional)"}
            hint={
              existing
                ? existing.userId
                  ? "Login active — enter a new password to reset it, or leave blank to keep it."
                  : "No login yet — set a password to give this contractor portal access."
                : "Set one to let the contractor sign in on the Contractor tab; leave blank for an internal record only."
            }
          >
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              placeholder="Min. 8 characters"
            />
          </Field>
          <Field label="Buyer name (billing)" hint="Links this contractor to buyer_income rows so they see billing in the portal.">
            <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={inputCls} placeholder={company || "Buyer name"} />
          </Field>
        </div>
        <Field label="Address">
          <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} placeholder="1 Example Street, London, E1 1AA" />
        </Field>
        <Field label="Active locations" hint="The sites this contractor is linked to — for admin reference.">
          <LocationPicker selected={locIds} onChange={setLocIds} />
        </Field>
        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={`${inputCls} min-h-20 resize-y`}
            placeholder="Contract details, key contacts, billing terms…"
          />
        </Field>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Saving..." : existing ? "Save changes" : "Add contractor"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClients(await apiClient.get<Client[]>("/api/clients"));
    } catch (e) {
      console.error("Load clients failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const del = async (c: Client) => {
    if (!confirm(`Delete the contractor record for ${c.company}?`)) return;
    try {
      await apiClient.delete(`/api/clients/${c.id}`);
      setErr(null);
      void load();
    } catch (e: any) {
      setErr(e.message || "Failed to delete contractor");
    }
  };

  return (
    <AdminShell
      title="Contractors"
      action={
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium">
            <RefreshCw className="size-4" /> Refresh
          </button>
          <button
            onClick={() => { setEditing(null); setOpen(true); }}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <Plus className="size-4" /> Add Contractor
          </button>
        </div>
      }
    >
      {err && <p className="mb-3 text-sm text-danger">{err}</p>}
      <Card>
        <SectionTitle title="Contractor records" />
        <p className="-mt-3 mb-4 text-xs text-muted-foreground">
          Company details, linked locations and contractor portal access. Documents can be sent to a contractor for e-signature from the Documents page.
        </p>
        <DataTable
          labels={["Company", "Contact", "Address", "Locations", "Workers", "Portal", "Status", "Created", ""]}
          head={
            <>
              <Th>Company</Th>
              <Th>Contact</Th>
              <Th>Address</Th>
              <Th>Locations</Th>
              <Th>Workers</Th>
              <Th>Portal</Th>
              <Th>Status</Th>
              <Th>Created</Th>
              <Th className="text-right">Actions</Th>
            </>
          }
        >
          {loading ? (
            <EmptyRow colSpan={9} text="Loading contractors…" />
          ) : clients.length === 0 ? (
            <EmptyRow colSpan={9} text="No contractor records yet — add your first contractor company." />
          ) : (
            clients.map((c) => (
              <tr key={c.id}>
                <Td>
                  <div className="leading-tight">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <Building2 className="size-4 text-muted-foreground" /> {c.company}
                    </div>
                    {c.notes && <div className="mt-0.5 max-w-52 truncate text-xs text-muted-foreground" title={c.notes}>{c.notes}</div>}
                  </div>
                </Td>
                <Td>
                  <div className="text-xs leading-tight">
                    {c.email && <div>{c.email}</div>}
                    {c.phone && <div className="text-muted-foreground">{c.phone}</div>}
                    {!c.email && !c.phone && <span className="text-muted-foreground">—</span>}
                  </div>
                </Td>
                <Td className="max-w-44 truncate text-xs text-muted-foreground" title={c.address ?? undefined}>
                  {c.address || "—"}
                </Td>
                <Td>
                  {c.locations.length === 0 ? (
                    <span className="text-xs text-muted-foreground">None linked</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {c.locations.map((l) => (
                        <span key={l.id} className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
                          <MapPin className="size-3" /> {l.name}
                        </span>
                      ))}
                    </div>
                  )}
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-1 text-sm font-medium" title="Workers based at or assigned to this contractor's locations">
                    {c.workerCount} worker{c.workerCount === 1 ? "" : "s"}
                  </span>
                </Td>
                <Td>
                  {c.userId ? (
                    <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">Login</span>
                  ) : (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">None</span>
                  )}
                </Td>
                <Td><StatusBadge status={c.status} /></Td>
                <Td className="whitespace-nowrap text-muted-foreground">{fmtDate(c.createdAt)}</Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      title="Edit contractor"
                      onClick={() => { setEditing(c); setOpen(true); }}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      title="Delete contractor"
                      onClick={() => void del(c)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-danger"
                    >
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
        <ClientForm
          existing={editing}
          onClose={() => { setOpen(false); setEditing(null); }}
          onSaved={load}
        />
      )}
    </AdminShell>
  );
}

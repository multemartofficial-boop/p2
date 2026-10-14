/*
 * Demo backend — replaces the Express/MySQL API entirely in this showcase build.
 * Everything below is fictional seed data held in memory and persisted to
 * localStorage, so admin edits survive reloads. Clear site data to reset.
 *
 * Shapes mirror backend/routes/*.js responses (camelCase where the real API
 * normalised rows, snake_case where it returned raw rows).
 */
import {
  seedWorkers,
  seedApplications,
  seedAttendance,
  seedPayrolls,
  seedLocations,
  seedSettings,
  seedActivity,
  blankCompliance,
  type Application,
  type Settings,
} from "./mock-data";
import { addDays, todayISO } from "./hr-utils";

/* ── errors ─────────────────────────────────────────────────────────────── */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/* ── demo JWT (format-compatible: header.payload.sig, payload holds exp) ── */
// Standard padded base64 (not base64url) so `atob(token.split('.')[1])` in
// api-store's session-restore decodes it cleanly on refresh.
const b64 = (s: string) => btoa(s);
const issueToken = (payload: Record<string, unknown>) =>
  `${b64(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64(
    JSON.stringify({
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    }),
  )}.${b64("demo-signature")}`;

type TokenUser = {
  userId?: number | string;
  email?: string;
  name?: string;
  role?: string;
  workerId?: string;
  clientId?: string;
};
const parseToken = (auth: string | null): TokenUser | null => {
  const raw = auth?.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (!raw) return null;
  try {
    const seg = raw.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(seg + "=".repeat((4 - (seg.length % 4)) % 4)));
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    return payload as TokenUser;
  } catch {
    return null;
  }
};

/* ── store ──────────────────────────────────────────────────────────────── */
const LS_KEY = "workhr.demo.v1";
const hasLS = typeof window !== "undefined" && !!window.localStorage;

type DB = ReturnType<typeof seedDb>;
let db: DB | null = null;

const save = () => {
  if (!hasLS || !db) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch {
    /* quota — fine for a demo */
  }
};

const store = (): DB => {
  if (db) return db;
  if (hasLS) {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        db = { ...seedDb(), ...JSON.parse(raw) } as DB;
        return db!;
      }
    } catch {
      /* fall through to reseed */
    }
  }
  db = seedDb();
  return db!;
};

/* ── fictional seeds ────────────────────────────────────────────────────── */
function seedDb() {
  const workers = seedWorkers.map((w) => ({
    ...w,
    // mirrors of the MySQL columns the API also surfaces
    on_leave: w.onLeave ? 1 : 0,
    status: "active",
    pay_type: w.payType ?? "hourly",
    monthly_salary: w.monthlySalary ?? null,
    passport_country: w.passportCountry ?? null,
    passport_number: w.passportNumber ?? null,
    passport_expiry: w.passportExpiry ?? null,
    visa_number: w.visaNumber ?? null,
    visa_expiry: w.visaExpiry ?? null,
    sia_badge_number: w.siaBadgeNumber ?? null,
    sia_badge_expiry: w.siaBadgeExpiry ?? null,
    worker_type: w.workerType ?? "Direct",
    employment_type: w.employmentType ?? "full_time",
    subcontract_company: w.subcontractCompany ?? null,
    complianceDone: 0,
    passwordSet: w.id === "WRK-10241",
  }));

  // Give the demo worker geofenced check-in coordinates + leave flags
  const geoByName: Record<string, [number, number]> = {
    "Camden Site": [51.5392, -0.1426],
    "Hackney Depot": [51.545, -0.0554],
    "Stratford Yard": [51.5413, -0.0018],
    "Croydon Hub": [51.3762, -0.0982],
  };

  const locations = seedLocations.map((l) => ({
    ...l,
    building: null,
    street: null,
    city: l.address.includes("London") ? "London" : "Croydon",
    postcode: l.address.split(" ").slice(-2).join(" "),
    latitude: geoByName[l.name]?.[0] ?? null,
    longitude: geoByName[l.name]?.[1] ?? null,
    radiusMeters: 100,
  }));

  const attendance = seedAttendance.map((a) => ({
    id: a.id,
    worker_id: a.workerId,
    worker: a.worker,
    date: a.date,
    check_in_time: a.in,
    check_out_time: a.out || null,
    location: a.location,
    hours_worked: a.hours,
    source: a.source,
    check_in_lat: geoByName[a.location]?.[0] ?? null,
    check_in_lng: geoByName[a.location]?.[1] ?? null,
    location_mismatch: 0,
    assignment_status: "none",
    nearest_location: null,
    distance_meters: null,
    holiday_accrued_hours: Math.round(a.hours * 0.1207 * 100) / 100,
  }));

  const payrolls = seedPayrolls.map((p) => ({
    id: p.id,
    worker_id: p.workerId,
    worker: p.worker,
    period_start: p.from,
    period_end: p.to,
    pay_type: p.payType ?? "hourly",
    monthly_salary: p.monthlySalary ?? null,
    pay_details: p.payDetails ?? null,
    hours: p.hours,
    overtime: 0,
    holiday_hours: 0,
    holiday_pay: 0,
    holiday_accrued_hours: Math.round(p.hours * 0.1207 * 100) / 100,
    holiday_accrual_pay: Math.round(p.hours * 0.1207 * p.rate * 100) / 100,
    rate: p.rate,
    gross: p.gross,
    advance_deduction: p.advance,
    tax_ni: p.tax,
    net_pay: p.net,
    status: p.status,
    paid_at: p.status === "Paid" ? p.created : null,
    paid_by: p.status === "Paid" ? "Alex Morgan" : null,
    payment_reference: null,
    generated_at: p.created,
  }));

  return {
    users: [
      {
        id: 1,
        name: "Alex Morgan",
        email: "admin@demo.io",
        role: "admin",
        workerId: null,
        password: "admin123",
      },
      {
        id: 2,
        name: "Hazel Nutt",
        email: "hazel.n@mail.com",
        role: "worker",
        workerId: "WRK-10241",
        password: "worker123",
      },
      {
        id: 3,
        name: "Jamie Doyle",
        email: "client@demo.io",
        role: "client",
        clientId: "CLI-01",
        password: "client123",
      },
      {
        id: 4,
        name: "Priya Shah",
        email: "ops@demo.io",
        role: "admin",
        workerId: null,
        password: null,
      }, // invited, no password yet
    ],
    workers: workers as any[],
    applications: seedApplications.map((a) => ({
      ...a,
      applied_for: a.appliedFor,
      compliance: blankCompliance(),
      password_set: null,
      resume_token: null,
    })) as Application[],
    attendance: attendance as any[],
    payrolls: payrolls as any[],
    locations: locations as any[],
    settings: { ...seedSettings, companySignatory: "Alex Morgan" } as Settings,
    notifications: seedActivity as any[],
    actionLogs: [
      {
        id: 3,
        actor_type: "admin",
        actor_id: "1",
        actor_name: "Alex Morgan",
        action: "generated_payroll",
        target_type: "payroll",
        target_id: "PYRL-12024",
        details: { worker: "Hazel Nutt" },
        created_at: addDays(todayISO(), -2) + "T10:24:00",
      },
      {
        id: 2,
        actor_type: "admin",
        actor_id: "1",
        actor_name: "Alex Morgan",
        action: "added_attendance",
        target_type: "attendance",
        target_id: "ATT-9003",
        details: { worker: "Peg Legge" },
        created_at: addDays(todayISO(), -3) + "T09:12:00",
      },
      {
        id: 1,
        actor_type: "system",
        actor_id: null,
        actor_name: "System",
        action: "expiry_check_completed",
        target_type: null,
        target_id: null,
        details: { flagged: 2 },
        created_at: addDays(todayISO(), -4) + "T06:00:00",
      },
    ] as any[],
    assignments: [
      {
        id: "ASG-01",
        worker_id: "WRK-10241",
        location_id: "LOC-01",
        assigned_date: todayISO(),
        created_at: todayISO() + "T06:00:00",
      },
      {
        id: "ASG-02",
        worker_id: "WRK-10246",
        location_id: "LOC-02",
        assigned_date: todayISO(),
        created_at: todayISO() + "T06:00:00",
      },
      {
        id: "ASG-03",
        worker_id: "WRK-10247",
        location_id: "LOC-03",
        assigned_date: addDays(todayISO(), 1),
        created_at: todayISO() + "T06:00:00",
      },
    ] as any[],
    clients: [
      {
        id: "CLI-01",
        user_id: 3,
        name: "Jamie Doyle",
        company: "Meridian Retail Group",
        email: "client@demo.io",
        phone: "+44 7700 910101",
        address: "200 Example Way, London SE1 1AA",
        status: "Active",
        notes: "Flagship contract — retail guarding",
        buyer_name: "Meridian Retail Group",
        location_ids: ["LOC-01", "LOC-02"],
        created_at: addDays(todayISO(), -120) + "T09:00:00",
      },
      {
        id: "CLI-02",
        user_id: null,
        name: "Dana Whitfield",
        company: "Northgate Logistics",
        email: "ops@northgate.example",
        phone: "+44 7700 910202",
        address: "14 Sample Road, London E9 5AA",
        status: "Active",
        notes: null,
        buyer_name: null,
        location_ids: ["LOC-03"],
        created_at: addDays(todayISO(), -60) + "T09:00:00",
      },
    ] as any[],
    dailyTasks: [
      {
        id: "TSK-01",
        date: todayISO(),
        tasks:
          "Process pending applications; confirm weekend rota; chase outstanding right-to-work docs.",
        remarks: "2 approvals waiting review",
        status: "In progress",
        created_by: "Alex Morgan",
        created_at: todayISO() + "T08:30:00",
        updated_at: todayISO() + "T08:30:00",
      },
      {
        id: "TSK-02",
        date: addDays(todayISO(), -1),
        tasks: "Payroll run for w/c staff; reconcile advance deductions; site walk Camden.",
        remarks: null,
        status: "Completed",
        created_by: "Alex Morgan",
        created_at: addDays(todayISO(), -1) + "T08:15:00",
        updated_at: addDays(todayISO(), -1) + "T16:40:00",
      },
    ] as any[],
    documents: [
      {
        id: "DOC-01",
        name: "Security Officer Terms of Engagement",
        type: "template",
        file_path: null,
        content:
          "TERMS OF ENGAGEMENT\n\nWorker: {{name}} ({{worker_id}})\nSite: {{location}}\nDate: {{date}}\n\nThis confirms the engagement of the above-named security officer by the Company at the site shown. Duties, pay and working time are as agreed in the accompanying schedule. Both parties agree to comply with site rules and company policy while on duty.\n\n— End —",
        created_at: addDays(todayISO(), -30) + "T10:00:00",
        admin_signature_type: "type",
        admin_signature_data: "Alex Morgan",
        admin_signed_by: "Alex Morgan",
        admin_signed_at: addDays(todayISO(), -30) + "T10:05:00",
        signed_content_hash: null,
      },
      {
        id: "DOC-02",
        name: "Health & Safety Induction (2025)",
        type: "uploaded_pdf",
        file_path: "uploads/demo-hs-induction.pdf",
        content: null,
        created_at: addDays(todayISO(), -45) + "T14:00:00",
        admin_signature_type: null,
        admin_signature_data: null,
        admin_signed_by: null,
        admin_signed_at: null,
        signed_content_hash: null,
      },
    ] as any[],
    docRequests: [
      {
        id: "REQ-01",
        document_id: "DOC-01",
        worker_id: "WRK-10241",
        contractor_id: null,
        status: "pending",
        sent_at: addDays(todayISO(), -1) + "T09:00:00",
        viewed_at: null,
        signed_at: null,
        declined_at: null,
        worker_signature_type: null,
        worker_signature_data: null,
        annotations: null,
        admin_signed_at: addDays(todayISO(), -30) + "T10:05:00",
        admin_signed_by: "Alex Morgan",
        admin_signature_type: "type",
        admin_signature_data: "Alex Morgan",
      },
      {
        id: "REQ-02",
        document_id: "DOC-02",
        worker_id: "WRK-10244",
        contractor_id: null,
        status: "signed",
        sent_at: addDays(todayISO(), -10) + "T11:00:00",
        viewed_at: addDays(todayISO(), -9) + "T08:00:00",
        signed_at: addDays(todayISO(), -9) + "T08:05:00",
        declined_at: null,
        worker_signature_type: "type",
        worker_signature_data: "Peg Legge",
        annotations: null,
        admin_signed_at: addDays(todayISO(), -8) + "T09:00:00",
        admin_signed_by: "Alex Morgan",
        admin_signature_type: "type",
        admin_signature_data: "Alex Morgan",
      },
      {
        id: "REQ-03",
        document_id: "DOC-01",
        worker_id: null,
        contractor_id: "CLI-01",
        status: "pending",
        sent_at: addDays(todayISO(), -2) + "T15:00:00",
        viewed_at: null,
        signed_at: null,
        declined_at: null,
        worker_signature_type: null,
        worker_signature_data: null,
        annotations: null,
        admin_signed_at: addDays(todayISO(), -30) + "T10:05:00",
        admin_signed_by: "Alex Morgan",
        admin_signature_type: "type",
        admin_signature_data: "Alex Morgan",
      },
    ] as any[],
    incidents: [
      {
        id: "INC-01",
        reported_by: "WRK-10242",
        reporter_name: "Simon Cyrene",
        location_id: "LOC-02",
        location_name: "Hackney Depot",
        attendance_id: "ATT-9002",
        category: "Safety Hazard",
        description: "Blocked fire exit near loading bay 3 — reported to site manager.",
        severity: "Medium",
        status: "Open",
        internal_notes: [],
        attachments: [],
        created_at: addDays(todayISO(), -1) + "T16:45:00",
        updated_at: addDays(todayISO(), -1) + "T16:45:00",
      },
      {
        id: "INC-02",
        reported_by: "WRK-10241",
        reporter_name: "Hazel Nutt",
        location_id: "LOC-01",
        location_name: "Camden Site",
        attendance_id: null,
        category: "Theft",
        description: "Attempted shoplifting by two individuals; items recovered, police informed.",
        severity: "High",
        status: "Resolved",
        internal_notes: [
          {
            note: "CCTV footage requested from store.",
            author: "Alex Morgan",
            at: addDays(todayISO(), -6) + "T11:00:00",
          },
        ],
        attachments: [],
        created_at: addDays(todayISO(), -7) + "T19:20:00",
        updated_at: addDays(todayISO(), -6) + "T10:00:00",
      },
    ] as any[],
    bankHolidays: [
      { id: 1, date: `${new Date().getFullYear()}-12-25`, name: "Christmas Day" },
      { id: 2, date: `${new Date().getFullYear()}-12-26`, name: "Boxing Day" },
      { id: 3, date: `${new Date().getFullYear() + 1}-01-01`, name: "New Year's Day" },
    ] as any[],
    buyerIncome: [
      {
        id: "BI-01",
        buyer_name: "Meridian Retail Group",
        description: "Guarding services — Camden & Hackney — last month",
        amount: 4280.5,
        date: addDays(todayISO(), -20),
        status: "Received",
      },
      {
        id: "BI-02",
        buyer_name: "Meridian Retail Group",
        description: "Guarding services — Camden & Hackney — this month",
        amount: 4360.0,
        date: addDays(todayISO(), -5),
        status: "Pending",
      },
    ] as any[],
    setupTokens: {} as Record<
      string,
      { email: string; name: string; accountType: "worker" | "admin"; workerId?: string }
    >,
    drafts: [] as {
      id: string;
      email: string;
      details: any;
      resume_token: string;
      submitted: string;
    }[],
    counters: {
      worker: 10249,
      app: 3305,
      att: 9100,
      pyr: 12031,
      doc: 3,
      req: 4,
      inc: 3,
      cli: 3,
      tsk: 3,
      asg: 4,
      log: 4,
      bi: 3,
    } as Record<string, number>,
  };
}

/* ── helpers ────────────────────────────────────────────────────────────── */
const nextId = (kind: string, prefix: string) => {
  const d = store();
  const n = (d.counters[kind] ?? 0) + 1;
  d.counters[kind] = n;
  return `${prefix}-${n}`;
};
const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const isoNow = () => new Date().toISOString();

const workerToApi = (w: any) => ({
  ...w,
  onLeave: w.on_leave === 1 || w.onLeave === true,
  passportCountry: w.passport_country,
  passportNumber: w.passport_number,
  passportExpiry: w.passport_expiry,
  visaNumber: w.visa_number,
  visaExpiry: w.visa_expiry,
  siaBadgeNumber: w.sia_badge_number,
  siaBadgeExpiry: w.sia_badge_expiry,
  workerType: w.worker_type || "Direct",
  subcontractCompany: w.subcontract_company,
  employmentType: w.employment_type === "irregular" ? "irregular" : "full_time",
  payType: w.pay_type === "salary" ? "salary" : "hourly",
  monthlySalary: w.monthly_salary != null ? Number(w.monthly_salary) : null,
  complianceDone: w.complianceDone || 0,
});

const appToApi = (a: any) => ({
  ...a,
  workerId: a.worker_id ?? a.workerId,
  passwordSet: a.password_set !== undefined && a.password_set !== null ? !!a.password_set : null,
  worker_joined: a.worker_joined,
  worker_expiry: a.worker_expiry,
  rejectedOn: a.rejected_on,
  appliedFor: a.applied_for ?? a.appliedFor,
  howHeard: a.how_heard ?? a.howHeard,
  subcontractCompany: a.subcontract_company,
  workerType: a.worker_type || a.workerType || "Direct",
  employmentType: a.employment_type === "full_time" ? "full_time" : "irregular",
  payType: a.pay_type === "salary" ? "salary" : (a.payType ?? "hourly"),
  monthlySalary: a.monthly_salary != null ? Number(a.monthly_salary) : null,
  passportCountry: a.passport_country,
  passportNumber: a.passport_number,
  passportIssueDate: a.passport_issue_date,
  passportExpiry: a.passport_expiry,
  visaNumber: a.visa_number,
  visaIssueDate: a.visa_issue_date,
  visaExpiry: a.visa_expiry,
  siaBadgeNumber: a.sia_badge_number,
  siaBadgeExpiry: a.sia_badge_expiry,
  hasVisa: a.has_visa,
  compliance: a.compliance ?? blankCompliance(),
});

const payrollToApi = (p: any) => ({
  id: p.id,
  workerId: p.worker_id,
  worker: p.worker,
  periodStart: p.period_start,
  periodEnd: p.period_end,
  payType: p.pay_type === "salary" ? "salary" : "hourly",
  monthlySalary: p.monthly_salary != null ? Number(p.monthly_salary) : null,
  payDetails:
    typeof p.pay_details === "string" ? JSON.parse(p.pay_details) : (p.pay_details ?? null),
  hours: Number(p.hours),
  overtime: Number(p.overtime),
  holidayHours: Number(p.holiday_hours || 0),
  holidayPay: Number(p.holiday_pay || 0),
  holidayAccruedHours: Number(p.holiday_accrued_hours || 0),
  holidayAccrualPay: Number(p.holiday_accrual_pay || 0),
  rate: Number(p.rate),
  gross: Number(p.gross),
  normalPay:
    Math.round(
      (Number(p.gross) - Number(p.holiday_pay || 0) - Number(p.holiday_accrual_pay || 0)) * 100,
    ) / 100,
  advanceDeduction: Number(p.advance_deduction),
  taxNi: Number(p.tax_ni),
  netPay: Number(p.net_pay),
  status: p.status === "Completed" ? "Paid" : p.status,
  paidAt: p.paid_at || null,
  paidBy: p.paid_by || null,
  paymentReference: p.payment_reference || null,
  generatedAt: p.generated_at,
});

const incidentToApi = (r: any, includeNotes = true) => ({
  id: r.id,
  reportedBy: r.reported_by,
  reporterName: r.reporter_name,
  locationId: r.location_id,
  locationName: r.location_name,
  attendanceId: r.attendance_id,
  category: r.category,
  description: r.description,
  severity: r.severity,
  status: r.status,
  internalNotes: includeNotes ? r.internal_notes || [] : undefined,
  attachments: (r.attachments || []).map((a: any, i: number) => ({
    index: i,
    name: a.name,
    url: a.url,
  })),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const docRequestToApi = (r: any, d: DB) => {
  const doc = d.documents.find((x) => x.id === r.document_id);
  const worker = r.worker_id ? d.workers.find((w) => w.id === r.worker_id) : null;
  const client = r.contractor_id ? d.clients.find((c) => c.id === r.contractor_id) : null;
  return {
    id: r.id,
    document_id: r.document_id,
    document_name: doc?.name ?? "Document",
    document_type: doc?.type ?? "template",
    worker_id: r.worker_id,
    contractor_id: r.contractor_id,
    worker_name: worker?.name ?? client?.name ?? "",
    recipient_name: worker?.name ?? client?.name ?? "",
    recipient_type: r.contractor_id ? "contractor" : "worker",
    recipient_id: r.worker_id ?? r.contractor_id,
    status: r.status,
    sent_at: r.sent_at,
    viewed_at: r.viewed_at,
    signed_at: r.signed_at,
    declined_at: r.declined_at,
    admin_signed_at: r.admin_signed_at,
    admin_signed_by: r.admin_signed_by,
    file_path: doc?.file_path ?? null,
    has_file: doc?.file_path ? 1 : 0,
  };
};

const renderTemplate = (content: string, worker: any, d: DB) => {
  const loc = d.locations.find((l) => l.name === worker?.location);
  return content
    .replace(/\{\{\s*name\s*\}\}/g, worker?.name ?? "—")
    .replace(/\{\{\s*worker_id\s*\}\}/g, worker?.id ?? "—")
    .replace(/\{\{\s*location\s*\}\}/g, worker?.location ?? "—")
    .replace(/\{\{\s*location_address\s*\}\}/g, loc?.address ?? "—")
    .replace(/\{\{\s*date\s*\}\}/g, todayISO())
    .replace(
      /\{\{\s*rate\s*\}\}/g,
      worker?.rate != null ? `£${Number(worker.rate).toFixed(2)}` : "—",
    );
};

/* ── demo file content ──────────────────────────────────────────────────── */
export const demoFileBlob = (name = "Document") => {
  // Minimal valid single-page PDF so in-app viewers/previewers work.
  const text = `${name} — demo document (fictional content)`;
  const content = `BT /F1 14 Tf 60 720 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${content.length}>>stream
${content}
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
};

/* ── auth helpers ───────────────────────────────────────────────────────── */
const requireUser = (auth: string | null) => {
  const u = parseToken(auth);
  if (!u) throw new ApiError(401, "Not authenticated");
  return u;
};
const requireRole = (auth: string | null, role: string) => {
  const u = requireUser(auth);
  if (u.role !== role) throw new ApiError(401, "Not authenticated");
  return u;
};

/* ── payroll calculation (simplified port of backend/routes/payroll.js) ──── */
const calcPayroll = (
  d: DB,
  workerId: string,
  from: string,
  to: string,
  advance: number,
  allowZero = false,
) => {
  const w = d.workers.find((x) => x.id === workerId);
  if (!w) throw new ApiError(404, "Worker not found");
  const s = d.settings;
  const rows = d.attendance.filter(
    (a) => a.worker_id === workerId && a.date >= from && a.date <= to,
  );
  const hours = Math.round(rows.reduce((n, r) => n + Number(r.hours_worked), 0) * 100) / 100;
  const accrued =
    Math.round(rows.reduce((n, r) => n + Number(r.holiday_accrued_hours || 0), 0) * 100) / 100;
  if (hours === 0 && !allowZero) throw new ApiError(400, "No attendance recorded in this period");

  const payType = w.pay_type === "salary" ? "salary" : "hourly";
  const rate = Number(w.rate);
  const weeks = Math.max(
    1,
    Math.round((new Date(to).getTime() - new Date(from).getTime()) / (7 * 86400000)),
  );
  const regularHours = Math.min(hours, Number(s.overtimeThreshold) * weeks);
  const overtime = Math.max(0, Math.round((hours - regularHours) * 100) / 100);
  const holidayAccrualRate = Number(s.holidayAccrualRate ?? 12.07);

  let gross: number,
    salaryBreakdown: any = null;
  if (payType === "salary") {
    const monthly = Number(w.monthly_salary ?? 0);
    const days = Math.max(
      1,
      Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1,
    );
    gross = Math.round(((monthly * 12) / 365) * days * 100) / 100;
    salaryBreakdown = [{ month: from.slice(0, 7), days, daysInMonth: 30, amount: gross }];
  } else {
    gross =
      Math.round((regularHours * rate + overtime * rate * Number(s.overtimeMultiplier)) * 100) /
      100;
  }
  const holidayAccrualPay =
    w.employment_type === "irregular" ? Math.round(accrued * rate * 100) / 100 : 0;
  gross = Math.round((gross + holidayAccrualPay) * 100) / 100;
  const tax =
    Math.round(((gross * (Number(s.taxRate) + Number(s.niRate))) / 10000 / 100) * 100) / 100;
  const net = Math.round((gross - tax - advance) * 100) / 100;

  return {
    workerId,
    worker: w.name,
    payType,
    monthlySalary: w.monthly_salary != null ? Number(w.monthly_salary) : null,
    salaryBreakdown,
    rate,
    hours,
    regularHours: Math.round(regularHours * 100) / 100,
    overtime,
    holidayHours: 0,
    holidayPay: 0,
    holidayMultiplier: Number(s.holidayPayMultiplier ?? 2),
    holidayAccruedHours: accrued,
    holidayAccrualPay,
    holidayAccrualRate,
    gross,
    tax,
    advance,
    net,
    from,
    to,
  };
};

/* ── router ─────────────────────────────────────────────────────────────── */
export async function demoApi(
  method: string,
  rawPath: string,
  body: any,
  auth: string | null,
): Promise<any> {
  const d = store();
  const [pathOnly, qs] = rawPath.split("?");
  const path = pathOnly!.replace(/^\/api/, "") || "/";
  const q = new URLSearchParams(qs ?? "");
  const seg = (re: RegExp) => path.match(re);
  method = method.toUpperCase();

  /* ═══ auth ═══ */
  if (seg(/^\/auth\/login$/) && method === "POST") {
    const email = String(body?.email ?? "")
      .trim()
      .toLowerCase();
    const user = d.users.find((u) => u.email === email && u.role === "admin");
    if (!user || user.password !== body?.password)
      throw new ApiError(401, "Invalid email or password");
    return {
      token: issueToken({ userId: user.id, email: user.email, name: user.name, role: "admin" }),
      user: { id: user.id, email: user.email, name: user.name, role: "admin", workerId: null },
    };
  }
  if (seg(/^\/auth\/worker\/login$/) && method === "POST") {
    const w = d.workers.find((x) => x.id === body?.workerCode);
    const user = d.users.find((u) => u.workerId === body?.workerCode);
    if (!w) throw new ApiError(401, "Invalid worker code or password");
    if (!w.passwordSet || !user?.password)
      throw new ApiError(
        401,
        "No password set for this worker. Please use the setup link sent to your email.",
      );
    if (user.password !== body?.password)
      throw new ApiError(401, "Invalid worker code or password");
    return {
      token: issueToken({
        userId: user.id,
        email: w.email,
        name: w.name,
        role: "worker",
        workerId: w.id,
      }),
      user: { id: user.id, email: w.email, name: w.name, role: "worker", workerId: w.id },
    };
  }
  if (seg(/^\/auth\/client\/login$/) && method === "POST") {
    const email = String(body?.email ?? "")
      .trim()
      .toLowerCase();
    const user = d.users.find((u) => u.email === email && u.role === "client");
    const client = user ? d.clients.find((c) => c.id === (user as any).clientId) : null;
    if (!user || !client || user.password !== body?.password)
      throw new ApiError(401, "Invalid email or password");
    return {
      token: issueToken({
        userId: user.id,
        email: user.email,
        name: user.name,
        role: "client",
        clientId: client.id,
      }),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: "client",
        clientId: client.id,
        company: client.company,
      },
    };
  }
  if (seg(/^\/auth\/me$/) && method === "GET") {
    const u = requireUser(auth);
    const user = d.users.find((x) => x.id === u.userId);
    return {
      id: user?.id,
      name: u.name,
      email: u.email,
      role: u.role,
      worker_id: u.workerId ?? null,
    };
  }
  if (seg(/^\/auth\/forgot-password$/) && method === "POST")
    return { message: "If an account exists with this email, a password reset link will be sent." };
  if (seg(/^\/auth\/validate-reset-token\//) && method === "GET")
    return { valid: true, email: "admin@demo.io", accountType: "admin" };
  if (seg(/^\/auth\/reset-password$/) && method === "POST")
    return { message: "Password reset successfully. You can now log in with your new password." };
  if (seg(/^\/auth\/validate-setup-token\//) && method === "GET") {
    const token = decodeURIComponent(path.split("/").pop()!);
    const t = d.setupTokens[token];
    if (!t) throw new ApiError(400, "Invalid or expired token");
    const exists = t.workerId && d.workers.some((w) => w.id === t.workerId && w.passwordSet);
    if (exists) throw new ApiError(400, "Worker account already exists");
    return {
      valid: true,
      email: t.email,
      name: t.name,
      accountType: t.accountType,
      workerCode: t.workerId,
    };
  }
  if (seg(/^\/auth\/setup-password$/) && method === "POST") {
    const t = d.setupTokens[body?.token];
    if (!t) throw new ApiError(400, "Invalid or expired token");
    const user = d.users.find((u) => u.email === t.email);
    if (user) user.password = body.password;
    if (t.workerId) {
      const w = d.workers.find((x) => x.id === t.workerId);
      if (w) w.passwordSet = true;
    }
    delete d.setupTokens[body.token];
    save();
    return {
      message: "Password set successfully. You can now log in.",
      accountType: t.accountType,
    };
  }

  /* ═══ workers ═══ */
  if (seg(/^\/workers$/) && method === "GET") {
    requireRole(auth, "admin");
    let rows = d.workers;
    const status = q.get("status");
    const today = todayISO();
    if (status === "Expiring Soon")
      rows = rows.filter(
        (w) => w.status === "active" && w.expiry >= today && w.expiry <= addDays(today, 30),
      );
    else if (status === "Expired") rows = rows.filter((w) => w.status === "expired");
    else if (status === "On Leave")
      rows = rows.filter((w) => w.status === "active" && (w.on_leave === 1 || w.onLeave));
    else if (status === "Active")
      rows = rows.filter((w) => w.status === "active" && !(w.on_leave === 1 || w.onLeave));
    const loc = q.get("location");
    if (loc && loc !== "all") rows = rows.filter((w) => w.location === loc);
    return [...rows]
      .sort((a, b) => String(b.joined).localeCompare(String(a.joined)))
      .map(workerToApi);
  }
  if (seg(/^\/workers$/) && method === "POST") {
    requireRole(auth, "admin");
    const id = nextId("worker", "WRK");
    const expiry = addDays(body?.joined || todayISO(), (d.settings.contractMonths ?? 3) * 30);
    d.workers.push({
      name: body?.name ?? "",
      phone: body?.phone ?? "",
      email: body?.email ?? "",
      location: body?.location ?? "",
      role: body?.role ?? "Site Operative",
      rate: Number(body?.rate ?? 0),
      id,
      joined: body?.joined || todayISO(),
      expiry,
      on_leave: 0,
      status: "active",
      pay_type: body?.payType === "salary" ? "salary" : "hourly",
      monthly_salary: body?.monthlySalary ?? null,
      worker_type: body?.workerType ?? "Direct",
      employment_type: body?.employmentType ?? "full_time",
      subcontract_company: body?.subcontractCompany ?? null,
      passport_country: body?.passportCountry ?? null,
      passport_number: body?.passportNumber ?? null,
      passport_expiry: body?.passportExpiry ?? null,
      visa_number: body?.visaNumber ?? null,
      visa_expiry: body?.visaExpiry ?? null,
      sia_badge_number: body?.siaBadgeNumber ?? null,
      sia_badge_expiry: body?.siaBadgeExpiry ?? null,
      address: body?.address ?? null,
      nid: body?.nid ?? null,
      complianceDone: 0,
      passwordSet: false,
    });
    save();
    return { id, message: "Worker added" };
  }
  if (seg(/^\/workers\/me$/) && method === "GET") {
    const u = requireRole(auth, "worker");
    const w = d.workers.find((x) => x.id === u.workerId);
    if (!w) throw new ApiError(404, "Worker not found");
    return {
      ...workerToApi(w),
      visaExpiry: w.visa_expiry,
      status: w.status,
      holiday: {
        type: "statutory_days",
        annualDays: 28,
        entitlementDays: 28,
        accruedDays: 0,
        monthsRemaining: 6,
        leaveYearStart: `${new Date().getFullYear()}-04-06`,
        leaveYearEnd: `${new Date().getFullYear() + 1}-04-05`,
        startedThisYear: true,
      },
    };
  }
  if (seg(/^\/workers\/me$/) && method === "PUT") {
    const u = requireRole(auth, "worker");
    const w = d.workers.find((x) => x.id === u.workerId);
    if (!w) throw new ApiError(404, "Worker not found");
    if (body?.phone != null) w.phone = body.phone;
    if (body?.email != null) w.email = body.email;
    if (body?.address != null) w.address = body.address;
    save();
    return { message: "Profile updated" };
  }
  const wm = seg(/^\/workers\/([^/]+)(?:\/(reactivate|compliance|documents))?$/);
  if (wm && seg(/^\/workers\//)) {
    requireRole(auth, "admin");
    const id = decodeURIComponent(wm[1]!);
    const w = d.workers.find((x) => x.id === id);
    const sub = wm[2];
    if (!sub && method === "PUT") {
      if (!w) throw new ApiError(404, "Worker not found");
      const map: Record<string, string> = {
        payType: "pay_type",
        monthlySalary: "monthly_salary",
        onLeave: "on_leave",
        workerType: "worker_type",
        employmentType: "employment_type",
        subcontractCompany: "subcontract_company",
        passportCountry: "passport_country",
        passportNumber: "passport_number",
        passportExpiry: "passport_expiry",
        visaNumber: "visa_number",
        visaExpiry: "visa_expiry",
        siaBadgeNumber: "sia_badge_number",
        siaBadgeExpiry: "sia_badge_expiry",
      };
      for (const [k, v] of Object.entries(body ?? {})) {
        const key = map[k] ?? k;
        (w as any)[key] = k === "onLeave" ? (v ? 1 : 0) : v;
      }
      save();
      return { message: "Worker updated successfully" };
    }
    if (!sub && method === "DELETE") {
      if (!w) throw new ApiError(404, "Worker not found");
      d.workers = d.workers.filter((x) => x.id !== id);
      save();
      return { message: "Worker deleted successfully" };
    }
    if (sub === "reactivate" && method === "POST") {
      if (!w) throw new ApiError(404, "Worker not found");
      w.status = "active";
      w.expiry = addDays(todayISO(), (d.settings.contractMonths ?? 3) * 30);
      save();
      return { message: "Worker reactivated successfully" };
    }
    if (sub === "compliance" && method === "PUT") {
      if (!w) throw new ApiError(404, "Worker not found");
      const checks = body?.checks ?? [];
      (w as any).complianceChecks = checks;
      w.complianceDone = checks.filter((c: any) => c.status === "complete").length;
      save();
      return { workerId: id, checks, complete: w.complianceDone, total: checks.length };
    }
    if (sub === "documents" && method === "GET") return { applicationId: null, documents: [] };
  }

  /* ═══ applications ═══ */
  if (seg(/^\/applications$/) && method === "GET") {
    requireRole(auth, "admin");
    const st = q.get("status") ?? "pending";
    return d.applications.filter((a: any) => a.status === st).map(appToApi);
  }
  if (seg(/^\/applications\/rejected$/) && method === "GET") {
    requireRole(auth, "admin");
    return d.applications.filter((a: any) => a.status === "rejected").map(appToApi);
  }
  if (seg(/^\/applications$/) && method === "POST") {
    // public worker application (multipart form → fields object)
    const id = nextId("app", "APP");
    const f = body ?? {};
    const name = [f.forename, f.surname].filter(Boolean).join(" ") || f.name || "Applicant";
    const app: any = {
      id,
      name,
      submitted: isoNow(),
      phone: f.mobile || f.phone || "",
      email: f.email || "",
      address: [f.addr1, f.town, f.postcode].filter(Boolean).join(", ") || "",
      nid: f.ni || f.nid || "",
      applied_for: f.appliedFor || "Site Operative",
      location: f.prefLocations?.[0] || "",
      rate: Number(f.rate) || 0,
      status: "pending",
      details: f,
      compliance: blankCompliance(),
      password_set: null,
      resume_token: null,
    };
    d.applications.push(app);
    save();
    return { id, docUrls: {}, resumeToken: `demo-${id}`, message: "Application submitted" };
  }
  if (seg(/^\/applications\/draft$/) && method === "POST") {
    const f = body ?? {};
    const email = String(f.email ?? "")
      .trim()
      .toLowerCase();
    let draft = d.drafts.find((x) => x.email === email);
    if (!draft) {
      draft = {
        id: nextId("app", "APP"),
        email,
        details: f,
        resume_token: `draft-${Math.random().toString(36).slice(2, 12)}`,
        submitted: isoNow(),
      };
      d.drafts.push(draft);
    } else draft.details = f;
    save();
    return { id: draft.id, docUrls: {}, resumeToken: draft.resume_token, message: "Draft saved" };
  }
  if (seg(/^\/applications\/draft$/) && method === "GET") {
    const email = String(q.get("email") ?? "")
      .trim()
      .toLowerCase();
    const token = q.get("token");
    if (!token)
      return { message: "If a draft exists for this email, a resume link has been sent." };
    const draft = d.drafts.find((x) => x.email === email && x.resume_token === token);
    if (!draft) throw new ApiError(404, "Draft not found");
    return { id: draft.id, details: draft.details, submitted: draft.submitted };
  }
  const am = seg(
    /^\/applications\/([^/]+)(?:\/(approve|reject|resend-setup|compliance|document\/[^/]+))?$/,
  );
  if (am && seg(/^\/applications\//)) {
    const id = decodeURIComponent(am[1]!);
    const app = d.applications.find((a: any) => a.id === id);
    const sub = am[2];
    if (!app) throw new ApiError(404, "Application not found");
    if (sub === "approve" && method === "POST") {
      requireRole(auth, "admin");
      const year = new Date().getFullYear();
      d.counters["worker"] = (d.counters["worker"] ?? 0) + 1;
      const workerId = `WKR-${year}-${String(d.counters["worker"] - 10240).padStart(4, "0")}`;
      const joined = todayISO();
      const expiry = addDays(joined, (d.settings.contractMonths ?? 3) * 30);
      const token = `setup-${Math.random().toString(36).slice(2, 14)}`;
      const payType = body?.payType === "salary" ? "salary" : "hourly";
      app.status = "approved";
      (app as any).worker_id = workerId;
      (app as any).password_set = false;
      d.setupTokens[token] = { email: app.email, name: app.name, accountType: "worker", workerId };
      d.workers.push({
        id: workerId,
        name: app.name,
        phone: app.phone,
        email: app.email,
        location: app.location || "",
        role: (app as any).applied_for || "Site Operative",
        rate: Number(body?.rate ?? app.rate) || 0,
        joined,
        expiry,
        on_leave: 0,
        status: "active",
        pay_type: payType,
        monthly_salary: payType === "salary" ? Number(body?.monthlySalary ?? 0) : null,
        worker_type: (app as any).worker_type || "Direct",
        employment_type: body?.employmentType ?? (app as any).employment_type ?? "full_time",
        address: app.address,
        nid: app.nid,
        complianceDone: 0,
        passwordSet: false,
      } as any);
      d.users.push({
        id: d.users.length + 10,
        name: app.name,
        email: app.email,
        role: "worker",
        workerId,
        password: null,
      } as any);
      save();
      return {
        id: workerId,
        expiry,
        workerId,
        rate: Number(body?.rate ?? app.rate) || 0,
        payType,
        monthlySalary: payType === "salary" ? Number(body?.monthlySalary ?? 0) : null,
        message: "Application approved — worker created",
        setupLink: `${location.origin}/setup-password?token=${token}`,
      };
    }
    if (sub === "reject" && method === "POST") {
      requireRole(auth, "admin");
      app.status = "rejected";
      (app as any).rejected_on = isoNow();
      save();
      return { message: "Application rejected successfully" };
    }
    if (sub === "resend-setup" && method === "POST") {
      requireRole(auth, "admin");
      const token = `setup-${Math.random().toString(36).slice(2, 14)}`;
      d.setupTokens[token] = {
        email: app.email,
        name: app.name,
        accountType: "worker",
        workerId: (app as any).worker_id,
      };
      save();
      return {
        message: "Setup link resent",
        setupLink: `${location.origin}/setup-password?token=${token}`,
      };
    }
    if (sub === "compliance" && method === "PUT") {
      requireRole(auth, "admin");
      app.compliance = { ...blankCompliance(), ...(body ?? {}) };
      save();
      return { compliance: app.compliance, message: "Compliance checklist saved" };
    }
  }

  /* ═══ attendance ═══ */
  if (seg(/^\/attendance$/) && method === "GET") {
    requireRole(auth, "admin");
    return [...d.attendance].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  if (seg(/^\/attendance$/) && method === "POST") {
    requireRole(auth, "admin");
    const w = d.workers.find((x) => x.id === body?.workerId);
    if (!w) throw new ApiError(404, "Worker not found");
    const [h1 = 0, m1 = 0] = String(body?.in ?? "09:00")
      .split(":")
      .map(Number);
    const [h2 = 0, m2 = 0] = String(body?.out ?? "17:00")
      .split(":")
      .map(Number);
    const hours = Math.max(0, Math.round((h2 + m2 / 60 - (h1 + m1 / 60)) * 100) / 100);
    const row = {
      id: nextId("att", "ATT"),
      worker_id: w.id,
      worker: w.name,
      date: body?.date || todayISO(),
      check_in_time: body?.in,
      check_out_time: body?.out || null,
      location: body?.location || w.location,
      hours_worked: hours,
      source: "Admin",
      check_in_lat: null,
      check_in_lng: null,
      location_mismatch: 0,
      assignment_status: "none",
      nearest_location: null,
      distance_meters: null,
      holiday_accrued_hours: Math.round(hours * 0.1207 * 100) / 100,
    };
    d.attendance.push(row);
    save();
    return { id: row.id, hours };
  }
  if (seg(/^\/attendance\/checkin$/) && method === "POST") {
    const u = requireRole(auth, "worker");
    const w = d.workers.find((x) => x.id === u.workerId);
    if (!w) throw new ApiError(404, "Worker not found");
    const open = d.attendance.find(
      (a) => a.worker_id === w.id && a.date === todayISO() && !a.check_out_time,
    );
    if (open) throw new ApiError(400, "Already checked in today");
    const t = new Date();
    const timeIn = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    const loc = body?.location || w.location;
    const row = {
      id: nextId("att", "ATT"),
      worker_id: w.id,
      worker: w.name,
      date: todayISO(),
      check_in_time: timeIn,
      check_out_time: null,
      location: loc,
      hours_worked: 0,
      source: "Self",
      check_in_lat: null,
      check_in_lng: null,
      location_mismatch: 0,
      assignment_status: "match",
      nearest_location: loc,
      distance_meters: 0,
      holiday_accrued_hours: 0,
    };
    d.attendance.push(row);
    save();
    return { id: row.id, timeIn, location: loc, message: "Checked in successfully" };
  }
  if (seg(/^\/attendance\/checkout$/) && method === "POST") {
    const u = requireRole(auth, "worker");
    return checkout(String(u.workerId), d);
  }
  if (seg(/^\/worker\/attendance\/today$/) && method === "GET") {
    const u = requireRole(auth, "worker");
    const open = d.attendance.find((a) => a.worker_id === u.workerId && a.date === todayISO());
    const w = d.workers.find((x) => x.id === u.workerId);
    const asg = d.assignments.find(
      (a) => a.worker_id === u.workerId && a.assigned_date === todayISO(),
    );
    const asgLoc = asg ? d.locations.find((l) => l.id === asg.location_id) : null;
    return {
      checkedIn: !!open && !open.check_out_time,
      record: open ?? null,
      visaExpired: w?.visa_expiry ? String(w.visa_expiry) < todayISO() : false,
      assignment: asg && asgLoc ? { location: asgLoc.name, address: asgLoc.address } : null,
    };
  }
  if (seg(/^\/worker\/attendance\/checkout$/) && method === "POST") {
    const u = requireRole(auth, "worker");
    return checkout(String(u.workerId), d);
  }
  if (seg(/^\/worker\/attendance\/my$/) && method === "GET") {
    const u = requireRole(auth, "worker");
    return d.attendance
      .filter((a) => a.worker_id === u.workerId)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  if (seg(/^\/attendance\/my$/) && method === "GET") {
    const u = requireUser(auth);
    return d.attendance
      .filter((a) => a.worker_id === u.workerId)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  if (seg(/^\/attendance\/active\/shifts$/) && method === "GET") {
    requireRole(auth, "admin");
    return d.attendance
      .filter((a) => a.date === todayISO() && !a.check_out_time)
      .map((a) => {
        const w = d.workers.find((x) => x.id === a.worker_id);
        return { ...a, worker_address: w?.address ?? null };
      });
  }
  const atm = seg(/^\/attendance\/([^/]+)$/);
  if (atm && seg(/^\/attendance\//) && !["checkin", "checkout", "my", "active"].includes(atm[1]!)) {
    requireRole(auth, "admin");
    const row = d.attendance.find((a) => a.id === atm[1]);
    if (!row) throw new ApiError(404, "Attendance not found");
    if (method === "PUT") {
      if (body?.in) row.check_in_time = body.in;
      if (body?.out !== undefined) row.check_out_time = body.out;
      if (body?.date) row.date = body.date;
      if (body?.location) row.location = body.location;
      if (body?.workerId) {
        const w = d.workers.find((x) => x.id === body.workerId);
        if (w) {
          row.worker_id = w.id;
          row.worker = w.name;
        }
      }
      const [h1 = 0, m1 = 0] = String(row.check_in_time).split(":").map(Number);
      const [h2 = 0, m2 = 0] = String(row.check_out_time ?? row.check_in_time)
        .split(":")
        .map(Number);
      row.hours_worked = Math.max(0, Math.round((h2 + m2 / 60 - (h1 + m1 / 60)) * 100) / 100);
      save();
      return {
        hours: row.hours_worked,
        holidayAccruedHours: row.holiday_accrued_hours,
        message: "Attendance updated successfully",
      };
    }
    if (method === "DELETE") {
      d.attendance = d.attendance.filter((a) => a.id !== row.id);
      save();
      return { message: "Attendance deleted successfully" };
    }
  }

  /* ═══ payroll ═══ */
  if (seg(/^\/payroll$/) && method === "GET") {
    requireRole(auth, "admin");
    let rows = d.payrolls;
    const st = q.get("status");
    if (st && st !== "all") rows = rows.filter((p) => p.status === st);
    const wid = q.get("workerId");
    if (wid) rows = rows.filter((p) => p.worker_id === wid);
    return [...rows]
      .sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)))
      .map(payrollToApi);
  }
  if (seg(/^\/payroll$/) && method === "POST") {
    requireRole(auth, "admin");
    const calc = calcPayroll(d, body?.workerId, body?.from, body?.to, Number(body?.advance) || 0);
    const p = {
      id: nextId("pyr", "PYRL"),
      worker_id: calc.workerId,
      worker: calc.worker,
      period_start: calc.from,
      period_end: calc.to,
      pay_type: calc.payType,
      monthly_salary: calc.monthlySalary,
      pay_details: calc.salaryBreakdown ? { salaryBreakdown: calc.salaryBreakdown } : null,
      hours: calc.hours,
      overtime: calc.overtime,
      holiday_hours: 0,
      holiday_pay: 0,
      holiday_accrued_hours: calc.holidayAccruedHours,
      holiday_accrual_pay: calc.holidayAccrualPay,
      rate: calc.rate,
      gross: calc.gross,
      advance_deduction: calc.advance,
      tax_ni: calc.tax,
      net_pay: calc.net,
      status: "Pending",
      paid_at: null,
      paid_by: null,
      payment_reference: null,
      generated_at: isoNow(),
    };
    d.payrolls.push(p);
    d.actionLogs.unshift({
      id: (d.counters["log"] = (d.counters["log"] ?? 0) + 1),
      actor_type: "admin",
      actor_id: "1",
      actor_name: "Alex Morgan",
      action: "generated_payroll",
      target_type: "payroll",
      target_id: p.id,
      details: { worker: calc.worker },
      created_at: isoNow(),
    });
    save();
    return payrollToApi(p);
  }
  if (seg(/^\/payroll\/preview$/) && method === "POST") {
    requireRole(auth, "admin");
    return calcPayroll(d, body?.workerId, body?.from, body?.to, Number(body?.advance) || 0, true);
  }
  if (seg(/^\/payroll\/my$/) && method === "GET") {
    const u = requireUser(auth);
    return d.payrolls
      .filter((p) => p.worker_id === u.workerId)
      .sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)))
      .map(payrollToApi);
  }
  if (seg(/^\/payroll\/summary$/) && method === "GET") {
    requireRole(auth, "admin");
    const period = q.get("period") ?? "monthly";
    const groups = new Map<string, any[]>();
    for (const p of d.payrolls) {
      const dt = new Date(String(p.period_end));
      const key =
        period === "weekly"
          ? `${dt.getFullYear()}-W${String(Math.ceil((dt.getTime() - new Date(dt.getFullYear(), 0, 1).getTime()) / 604800000)).padStart(2, "0")}`
          : period === "yearly"
            ? String(dt.getFullYear())
            : String(p.period_end).slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return [...groups.entries()]
      .sort()
      .reverse()
      .map(([key, ps]) => {
        const workers = ps.map((p) => {
          const a = payrollToApi(p);
          return {
            workerId: a.workerId,
            worker: a.worker,
            payType: a.payType,
            monthlySalary: a.monthlySalary,
            rate: a.rate,
            hours: a.hours,
            overtime: a.overtime,
            holidayHours: a.holidayHours,
            holidayPay: a.holidayPay,
            holidayAccruedHours: a.holidayAccruedHours,
            holidayAccrualPay: a.holidayAccrualPay,
            gross: a.gross,
            tax: a.taxNi,
            advance: a.advanceDeduction,
            net: a.netPay,
          };
        });
        return {
          period: key,
          label: key,
          hours: workers.reduce((n, w) => n + w.hours, 0),
          holidayHours: workers.reduce((n, w) => n + w.holidayHours, 0),
          holidayPay: workers.reduce((n, w) => n + w.holidayPay, 0),
          holidayAccruedHours: workers.reduce((n, w) => n + (w.holidayAccruedHours ?? 0), 0),
          holidayAccrualPay: workers.reduce((n, w) => n + (w.holidayAccrualPay ?? 0), 0),
          gross: workers.reduce((n, w) => n + w.gross, 0),
          tax: workers.reduce((n, w) => n + w.tax, 0),
          net: workers.reduce((n, w) => n + w.net, 0),
          workers,
        };
      });
  }
  const pm = seg(/^\/payroll\/([^/]+)(?:\/(status))?$/);
  if (pm && seg(/^\/payroll\//) && !["preview", "my", "summary"].includes(pm[1]!)) {
    requireRole(auth, "admin");
    const p = d.payrolls.find((x) => x.id === pm[1]);
    if (!p) throw new ApiError(404, "Payroll record not found");
    if (pm[2] === "status" && method === "PATCH") {
      p.status = body?.status === "Paid" ? "Paid" : "Pending";
      if (p.status === "Paid") {
        p.paid_at = isoNow();
        p.paid_by = "Alex Morgan";
        p.payment_reference = body?.paymentReference ?? null;
      } else {
        p.paid_at = null;
        p.paid_by = null;
        p.payment_reference = null;
      }
      save();
      return { message: "Payroll status updated successfully" };
    }
    if (method === "DELETE") {
      d.payrolls = d.payrolls.filter((x) => x.id !== p.id);
      save();
      return { message: "Payroll deleted successfully" };
    }
  }

  /* ═══ locations ═══ */
  if (seg(/^\/locations$/) && method === "GET") {
    requireUser(auth);
    return d.locations.map((l) => ({
      ...l,
      latitude: l.latitude != null ? Number(l.latitude) : null,
      longitude: l.longitude != null ? Number(l.longitude) : null,
      radiusMeters: l.radiusMeters ?? 25,
    }));
  }
  if (seg(/^\/locations$/) && method === "POST") {
    requireRole(auth, "admin");
    const loc = {
      id: `LOC-${String(d.locations.length + 1).padStart(2, "0")}`,
      name: body?.name ?? "",
      address: body?.address ?? "",
      building: body?.building ?? null,
      street: body?.street ?? null,
      city: body?.city ?? null,
      postcode: body?.postcode ?? null,
      latitude: body?.latitude ?? null,
      longitude: body?.longitude ?? null,
      radiusMeters: body?.radiusMeters ?? 25,
    };
    d.locations.push(loc);
    save();
    return loc;
  }
  const lm = seg(/^\/locations\/([^/]+)$/);
  if (lm) {
    requireRole(auth, "admin");
    const loc = d.locations.find((l) => l.id === lm[1]);
    if (!loc) throw new ApiError(404, "Location not found");
    if (method === "PUT") {
      Object.assign(loc, body ?? {});
      save();
      return loc;
    }
    if (method === "DELETE") {
      d.locations = d.locations.filter((l) => l.id !== loc.id);
      save();
      return { message: "Location deleted" };
    }
  }

  /* ═══ settings ═══ */
  if (seg(/^\/settings$/) && method === "GET") {
    requireRole(auth, "admin");
    return { ...d.settings };
  }
  if (seg(/^\/settings$/) && method === "PUT") {
    requireRole(auth, "admin");
    Object.assign(d.settings, body ?? {});
    save();
    return { ...d.settings };
  }
  if (seg(/^\/settings\/bank-holidays$/) && method === "GET") {
    requireRole(auth, "admin");
    return d.bankHolidays;
  }
  if (seg(/^\/settings\/bank-holidays$/) && method === "POST") {
    requireRole(auth, "admin");
    d.bankHolidays.push({
      id: Math.max(0, ...d.bankHolidays.map((h) => h.id)) + 1,
      date: body?.date,
      name: body?.name ?? "",
    });
    save();
    return d.bankHolidays;
  }
  const bh = seg(/^\/settings\/bank-holidays\/(\d+)$/);
  if (bh && method === "DELETE") {
    requireRole(auth, "admin");
    d.bankHolidays = d.bankHolidays.filter((h) => h.id !== Number(bh[1]));
    save();
    return d.bankHolidays;
  }

  /* ═══ notifications ═══ */
  if (seg(/^\/notifications$/) && method === "GET") {
    requireRole(auth, "admin");
    return d.notifications;
  }

  /* ═══ action logs ═══ */
  if (seg(/^\/action-logs$/) && method === "GET") {
    requireRole(auth, "admin");
    let rows = d.actionLogs;
    const action = q.get("action");
    if (action) rows = rows.filter((r) => r.action === action);
    const qtext = q.get("q")?.toLowerCase();
    if (qtext) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(qtext));
    return rows
      .slice(0, 500)
      .map((r) => ({
        id: r.id,
        actorType: r.actor_type,
        actorId: r.actor_id,
        actorName: r.actor_name,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        details: r.details,
        createdAt: r.created_at,
      }));
  }
  if (seg(/^\/action-logs\/actions$/) && method === "GET") {
    requireRole(auth, "admin");
    return [...new Set(d.actionLogs.map((r) => r.action))];
  }

  /* ═══ assignments ═══ */
  if (seg(/^\/assignments$/) && method === "GET") {
    requireRole(auth, "admin");
    const date = q.get("date") ?? todayISO();
    return d.assignments
      .filter((a) => a.assigned_date === date)
      .map((a) => {
        const w = d.workers.find((x) => x.id === a.worker_id);
        const l = d.locations.find((x) => x.id === a.location_id);
        return {
          id: a.id,
          workerId: a.worker_id,
          worker: w?.name ?? "—",
          locationId: a.location_id,
          location: l?.name ?? "—",
          address: l?.address ?? "",
          date: a.assigned_date,
          createdAt: a.created_at,
        };
      });
  }
  if (seg(/^\/assignments$/) && method === "POST") {
    requireRole(auth, "admin");
    const w = d.workers.find((x) => x.id === body?.workerId);
    const l = d.locations.find((x) => x.id === body?.locationId);
    if (!w || !l) throw new ApiError(400, "Worker and location are required");
    const existing = d.assignments.find(
      (a) => a.worker_id === w.id && a.assigned_date === body?.date,
    );
    if (existing) {
      existing.location_id = l.id;
      save();
      return { updated: true, email: w.email };
    }
    d.assignments.push({
      id: nextId("asg", "ASG"),
      worker_id: w.id,
      location_id: l.id,
      assigned_date: body?.date || todayISO(),
      created_at: isoNow(),
    });
    save();
    return { updated: false, email: w.email };
  }
  if (seg(/^\/assignments\/today$/) && method === "GET") {
    requireRole(auth, "admin");
    return d.assignments
      .filter((a) => a.assigned_date === todayISO())
      .map((a) => {
        const w = d.workers.find((x) => x.id === a.worker_id);
        const l = d.locations.find((x) => x.id === a.location_id);
        const att = d.attendance.find(
          (x) => x.worker_id === a.worker_id && x.date === a.assigned_date,
        );
        return {
          id: a.id,
          workerId: a.worker_id,
          worker: w?.name ?? "—",
          location: l?.name ?? "—",
          status: !att ? "not_checked_in" : att.location === l?.name ? "match" : "mismatch",
          checkedInAt: att?.check_in_time ?? null,
          actualLocation: att?.location ?? null,
        };
      });
  }
  const asg = seg(/^\/assignments\/([^/]+)$/);
  if (asg && method === "DELETE") {
    requireRole(auth, "admin");
    d.assignments = d.assignments.filter((a) => a.id !== asg[1]);
    save();
    return { message: "Assignment deleted" };
  }

  /* ═══ clients ═══ */
  if (seg(/^\/clients$/) && method === "GET") {
    requireRole(auth, "admin");
    return d.clients.map((c) => ({
      id: c.id,
      userId: c.user_id,
      name: c.name,
      company: c.company,
      email: c.email,
      phone: c.phone,
      address: c.address,
      status: c.status || "Active",
      notes: c.notes,
      buyerName: c.buyer_name ?? null,
      locations: (c.location_ids ?? [])
        .map((lid: string) => {
          const l = d.locations.find((x) => x.id === lid);
          return l ? { id: l.id, name: l.name, address: l.address } : null;
        })
        .filter(Boolean),
      workerCount: d.workers.filter((w) =>
        (c.location_ids ?? []).some(
          (lid: string) => d.locations.find((x) => x.id === lid)?.name === w.location,
        ),
      ).length,
      createdAt: c.created_at,
    }));
  }
  if (seg(/^\/clients$/) && method === "POST") {
    requireRole(auth, "admin");
    const id = nextId("cli", "CLI");
    const userId = body?.portalPassword ? Math.max(...d.users.map((u) => u.id)) + 1 : null;
    d.clients.push({
      id,
      user_id: userId,
      name: body?.name ?? "",
      company: body?.company ?? "",
      email: body?.email ?? null,
      phone: body?.phone ?? null,
      address: body?.address ?? null,
      status: "Active",
      notes: body?.notes ?? null,
      buyer_name: body?.buyerName ?? null,
      location_ids: body?.locationIds ?? [],
      created_at: isoNow(),
    } as any);
    if (userId)
      d.users.push({
        id: userId,
        name: body?.name ?? body?.company ?? "",
        email: String(body?.email ?? "").toLowerCase(),
        role: "client",
        clientId: id,
        password: body?.portalPassword,
      } as any);
    save();
    return { id, message: "Client created" };
  }
  const cm = seg(/^\/clients\/([^/]+)$/);
  if (cm) {
    requireRole(auth, "admin");
    const c = d.clients.find((x) => x.id === cm[1]);
    if (!c) throw new ApiError(404, "Client not found");
    if (method === "PUT") {
      const map: Record<string, string> = { buyerName: "buyer_name", locationIds: "location_ids" };
      for (const [k, v] of Object.entries(body ?? {})) (c as any)[map[k] ?? k] = v;
      if (body?.portalPassword) {
        const userId = c.user_id ?? Math.max(...d.users.map((u) => u.id)) + 1;
        c.user_id = userId;
        const ex = d.users.find((u) => u.id === userId);
        if (ex) ex.password = body.portalPassword;
        else
          d.users.push({
            id: userId,
            name: c.name,
            email: String(c.email ?? "").toLowerCase(),
            role: "client",
            clientId: c.id,
            password: body.portalPassword,
          } as any);
      }
      save();
      return { message: "Client updated", portalLogin: c.user_id != null };
    }
    if (method === "DELETE") {
      d.clients = d.clients.filter((x) => x.id !== c.id);
      save();
      return { message: "Client deleted" };
    }
  }

  /* ═══ daily tasks ═══ */
  if (seg(/^\/daily-tasks$/) && method === "GET") {
    requireRole(auth, "admin");
    return [...d.dailyTasks]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map((t) => ({
        id: t.id,
        date: t.date,
        tasks: t.tasks,
        remarks: t.remarks,
        status: t.status,
        createdBy: t.created_by,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      }));
  }
  if (seg(/^\/daily-tasks$/) && method === "POST") {
    requireRole(auth, "admin");
    const t = {
      id: nextId("tsk", "TSK"),
      date: body?.date || todayISO(),
      tasks: body?.tasks ?? "",
      remarks: body?.remarks ?? null,
      status: body?.status ?? "In progress",
      created_by: "Alex Morgan",
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    d.dailyTasks.push(t);
    save();
    return t;
  }
  const tm = seg(/^\/daily-tasks\/([^/]+)$/);
  if (tm) {
    requireRole(auth, "admin");
    const t = d.dailyTasks.find((x) => x.id === tm[1]);
    if (!t) throw new ApiError(404, "Task not found");
    if (method === "PUT") {
      Object.assign(t, body ?? {}, { updated_at: isoNow() });
      save();
      return { message: "Task updated" };
    }
    if (method === "DELETE") {
      d.dailyTasks = d.dailyTasks.filter((x) => x.id !== t.id);
      save();
      return { message: "Task deleted" };
    }
  }

  /* ═══ documents ═══ */
  if (seg(/^\/documents$/) && method === "GET") {
    requireRole(auth, "admin");
    return d.documents;
  }
  if (seg(/^\/documents\/upload$/) && method === "POST") {
    requireRole(auth, "admin");
    const id = nextId("doc", "DOC");
    const doc = {
      id,
      name: body?.name || "Uploaded document",
      type: "uploaded_pdf",
      file_path: `uploads/demo-${id}.pdf`,
      content: null,
      created_at: isoNow(),
      admin_signature_type: null,
      admin_signature_data: null,
      admin_signed_by: null,
      admin_signed_at: null,
      signed_content_hash: null,
    };
    d.documents.push(doc);
    save();
    return { id, name: doc.name, type: doc.type, file_path: doc.file_path };
  }
  if (seg(/^\/documents\/template$/) && method === "POST") {
    requireRole(auth, "admin");
    const id = nextId("doc", "DOC");
    d.documents.push({
      id,
      name: body?.name ?? "Untitled template",
      type: "template",
      file_path: null,
      content: body?.content ?? "",
      created_at: isoNow(),
      admin_signature_type: null,
      admin_signature_data: null,
      admin_signed_by: null,
      admin_signed_at: null,
      signed_content_hash: null,
    });
    save();
    return { id };
  }
  if (seg(/^\/documents\/send-batch$/) && method === "POST") {
    requireRole(auth, "admin");
    const ids: string[] = body?.documentIds ?? [];
    const workerId = body?.workerId,
      contractorId = body?.contractorId;
    let sent = 0;
    const failed: { name: string; error: string }[] = [];
    for (const docId of ids) {
      const doc = d.documents.find((x) => x.id === docId);
      if (!doc) {
        failed.push({ name: docId, error: "Document not found" });
        continue;
      }
      if (doc.type === "template" && !doc.admin_signed_at) {
        failed.push({ name: doc.name, error: "Template must be signed by the company first" });
        continue;
      }
      d.docRequests.push({
        id: nextId("req", "REQ"),
        document_id: docId,
        worker_id: workerId ?? null,
        contractor_id: contractorId ?? null,
        status: "pending",
        sent_at: isoNow(),
        viewed_at: null,
        signed_at: null,
        declined_at: null,
        worker_signature_type: null,
        worker_signature_data: null,
        annotations: null,
        admin_signed_at: doc.admin_signed_at,
        admin_signed_by: doc.admin_signed_by,
        admin_signature_type: doc.admin_signature_type,
        admin_signature_data: doc.admin_signature_data,
      });
      sent++;
    }
    save();
    return { sent, failed };
  }
  if (seg(/^\/documents\/requests$/) && method === "GET") {
    requireRole(auth, "admin");
    return d.docRequests.map((r) => docRequestToApi(r, d));
  }
  if (seg(/^\/documents\/requests\/mine$/) && method === "GET") {
    const u = requireUser(auth);
    return d.docRequests
      .filter((r) =>
        u.role === "client" ? r.contractor_id === u.clientId : r.worker_id === u.workerId,
      )
      .map((r) => docRequestToApi(r, d));
  }
  if (seg(/^\/documents\/requests\/sign-batch$/) && method === "POST") {
    const u = requireUser(auth);
    const signed: any[] = [],
      failed: any[] = [];
    for (const rid of body?.requestIds ?? []) {
      const r = d.docRequests.find((x) => x.id === rid);
      const mine =
        u.role === "client" ? r?.contractor_id === u.clientId : r?.worker_id === u.workerId;
      if (!r || !mine) {
        failed.push({ id: rid, error: "Request not found" });
        continue;
      }
      if (r.status !== "pending") {
        failed.push({ id: rid, name: r.document_id, error: "Already handled" });
        continue;
      }
      r.status = r.admin_signed_at ? "signed" : "worker_signed";
      r.worker_signature_type = body?.signatureType;
      r.worker_signature_data = body?.signatureData;
      r.annotations = body?.annotations?.[rid] ?? null;
      r.signed_at = isoNow();
      signed.push({ id: rid });
    }
    save();
    return { signed, failed };
  }
  const drm = seg(
    /^\/documents\/requests\/([^/]+)(?:\/(view|file|sign|decline|cancel|countersign))?$/,
  );
  if (drm && seg(/^\/documents\/requests\//)) {
    const r = d.docRequests.find((x) => x.id === drm[1]);
    if (!r) throw new ApiError(404, "Request not found");
    const sub = drm[2];
    const doc = d.documents.find((x) => x.id === r.document_id);
    if (!sub && method === "GET") {
      const u = requireUser(auth);
      const worker = r.worker_id ? d.workers.find((w) => w.id === r.worker_id) : null;
      return {
        ...docRequestToApi(r, d),
        rendered_content: doc?.content ? renderTemplate(doc.content, worker, d) : null,
        has_file: doc?.file_path ? 1 : 0,
        annotations: r.annotations,
        worker_signature_type: r.worker_signature_type,
        worker_signature_data: r.worker_signature_data,
        admin_signature_type: r.admin_signature_type,
        admin_signature_data: r.admin_signature_data,
        admin_signer_ip: "203.0.113.10",
        signer_ip: "203.0.113.20",
      };
    }
    if (sub === "view" && method === "POST") {
      r.viewed_at = r.viewed_at ?? isoNow();
      save();
      return { viewed: true };
    }
    if (sub === "sign" && method === "POST") {
      r.status = r.admin_signed_at ? "signed" : "worker_signed";
      r.worker_signature_type = body?.signatureType;
      r.worker_signature_data = body?.signatureData;
      r.annotations = body?.annotations ?? null;
      r.signed_at = isoNow();
      save();
      return { status: r.status, signedAt: r.signed_at };
    }
    if (sub === "decline" && method === "POST") {
      r.status = "declined";
      r.declined_at = isoNow();
      save();
      return { status: "declined" };
    }
    if (sub === "cancel" && method === "POST") {
      requireRole(auth, "admin");
      r.status = "cancelled";
      save();
      return { message: "Request cancelled" };
    }
    if (sub === "countersign" && method === "POST") {
      requireRole(auth, "admin");
      r.status = "signed";
      r.admin_signed_at = isoNow();
      r.admin_signed_by = "Alex Morgan";
      r.admin_signature_type = body?.signatureType;
      r.admin_signature_data = body?.signatureData;
      save();
      return { status: "signed", adminSignedAt: r.admin_signed_at, adminSignedBy: "Alex Morgan" };
    }
  }
  const dm = seg(/^\/documents\/([^/]+)(?:\/(preview\/[^/]+|sign-template|file))?$/);
  if (
    dm &&
    seg(/^\/documents\//) &&
    !["upload", "template", "send-batch", "requests"].includes(dm[1]!)
  ) {
    requireRole(auth, "admin");
    const doc = d.documents.find((x) => x.id === dm[1]);
    if (!doc) throw new ApiError(404, "Document not found");
    const sub = dm[2];
    if (!sub && method === "PUT") {
      if (body?.name != null) doc.name = body.name;
      if (body?.content != null) {
        doc.content = body.content;
        doc.admin_signed_at = null;
        doc.admin_signed_by = null;
        doc.admin_signature_type = null;
        doc.admin_signature_data = null;
      }
      save();
      return { message: "Document updated" };
    }
    if (!sub && method === "DELETE") {
      d.documents = d.documents.filter((x) => x.id !== doc.id);
      d.docRequests = d.docRequests.filter((r) => r.document_id !== doc.id);
      save();
      return { message: "Document deleted" };
    }
    if (sub === "sign-template" && method === "POST") {
      doc.admin_signature_type = body?.signatureType;
      doc.admin_signature_data = body?.signatureData;
      doc.admin_signed_by = "Alex Morgan";
      doc.admin_signed_at = isoNow();
      save();
      return {
        message: "Template signed — it can now be sent for signature",
        adminSignedBy: "Alex Morgan",
      };
    }
    const pv = sub?.match(/^preview\/(.+)$/);
    if (pv) {
      const w = d.workers.find((x) => x.id === decodeURIComponent(pv[1]!));
      return { rendered: doc.type === "template" ? renderTemplate(doc.content ?? "", w, d) : null };
    }
  }

  /* ═══ incidents ═══ */
  if (seg(/^\/incidents$/) && method === "GET") {
    requireRole(auth, "admin");
    let rows = d.incidents;
    const st = q.get("status");
    if (st && st !== "all") rows = rows.filter((r) => r.status === st);
    const cat = q.get("category");
    if (cat) rows = rows.filter((r) => r.category === cat);
    return rows.map((r) => incidentToApi(r, false));
  }
  if (seg(/^\/incidents\/mine$/) && method === "GET") {
    const u = requireRole(auth, "worker");
    return d.incidents
      .filter((r) => r.reported_by === u.workerId)
      .map((r) => incidentToApi(r, false));
  }
  if (seg(/^\/incidents$/) && method === "POST") {
    const u = requireRole(auth, "worker");
    const w = d.workers.find((x) => x.id === u.workerId);
    const loc = body?.locationId ? d.locations.find((l) => l.id === body.locationId) : null;
    const row = {
      id: nextId("inc", "INC"),
      reported_by: u.workerId,
      reporter_name: w?.name ?? "Worker",
      location_id: loc?.id ?? null,
      location_name: loc?.name ?? null,
      attendance_id: null,
      category: body?.category ?? "Other",
      description: body?.description ?? "",
      severity: "Low",
      status: "Open",
      internal_notes: [],
      attachments: body?.attachmentNames?.map((n: string) => ({ name: n, url: null })) ?? [],
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    d.incidents.unshift(row);
    save();
    return incidentToApi(row);
  }
  const im = seg(/^\/incidents\/([^/]+)(?:\/(notes|attachment\/\d+))?$/);
  if (im && seg(/^\/incidents\//)) {
    const r = d.incidents.find((x) => x.id === im[1]);
    if (!r) throw new ApiError(404, "Incident not found");
    const sub = im[2];
    if (!sub && method === "GET") {
      requireUser(auth);
      return incidentToApi(r);
    }
    if (!sub && method === "PATCH") {
      requireRole(auth, "admin");
      if (body?.status) r.status = body.status;
      if (body?.severity) r.severity = body.severity;
      r.updated_at = isoNow();
      save();
      return incidentToApi(r);
    }
    if (sub === "notes" && method === "POST") {
      requireRole(auth, "admin");
      r.internal_notes = [
        ...(r.internal_notes ?? []),
        { note: body?.note ?? "", author: "Alex Morgan", at: isoNow() },
      ];
      r.updated_at = isoNow();
      save();
      return incidentToApi(r);
    }
  }

  /* ═══ admins ═══ */
  if (seg(/^\/admins$/) && method === "GET") {
    const u = requireRole(auth, "admin");
    return d.users
      .filter((x) => x.role === "admin")
      .map((x) => ({
        id: x.id,
        name: x.name,
        email: x.email,
        note: (x as any).note ?? null,
        createdAt: addDays(todayISO(), -90) + "T09:00:00",
        status: x.password ? "active" : "invited",
        isSelf: x.id === u.userId,
      }));
  }
  if (seg(/^\/admins$/) && method === "POST") {
    requireRole(auth, "admin");
    const email = String(body?.email ?? "")
      .trim()
      .toLowerCase();
    if (d.users.some((x) => x.email === email))
      throw new ApiError(400, "An account with this email already exists");
    const id = Math.max(...d.users.map((x) => x.id)) + 1;
    d.users.push({
      id,
      name: body?.name ?? "",
      email,
      role: "admin",
      note: body?.note ?? null,
      password: null,
    } as any);
    const token = `setup-${Math.random().toString(36).slice(2, 14)}`;
    d.setupTokens[token] = { email, name: body?.name ?? "", accountType: "admin" };
    save();
    return {
      id,
      message: "Invitation sent",
      setupLink: `${location.origin}/setup-password?token=${token}`,
    };
  }
  const adm = seg(/^\/admins\/(\d+)(?:\/(resend-invite))?$/);
  if (adm) {
    requireRole(auth, "admin");
    const user = d.users.find((x) => x.id === Number(adm[1]));
    if (!user) throw new ApiError(404, "Admin not found");
    if (adm[2] === "resend-invite" && method === "POST") return { message: "Invitation resent" };
    if (method === "DELETE") {
      d.users = d.users.filter((x) => x.id !== user.id);
      save();
      return { message: "Admin removed" };
    }
  }

  /* ═══ client portal ═══ */
  if (seg(/^\/client\/me$/) && method === "GET") {
    const u = requireRole(auth, "client");
    const c = d.clients.find((x) => x.id === u.clientId);
    return {
      id: c?.id,
      name: c?.name,
      company: c?.company,
      email: c?.email,
      locations: (c?.location_ids ?? [])
        .map((lid: string) => d.locations.find((l) => l.id === lid))
        .filter(Boolean),
    };
  }
  if (seg(/^\/client\/overview$/) && method === "GET") {
    const u = requireRole(auth, "client");
    const c = d.clients.find((x) => x.id === u.clientId);
    const locs = (c?.location_ids ?? [])
      .map((lid: string) => d.locations.find((l) => l.id === lid))
      .filter(Boolean);
    const locIds = locs.map((l: any) => l.id);
    const todayRows = d.assignments
      .filter((a) => a.assigned_date === todayISO() && locIds.includes(a.location_id))
      .map((a) => ({
        worker_id: a.worker_id,
        worker: d.workers.find((w) => w.id === a.worker_id)?.name ?? "—",
        location: locs.find((l: any) => l.id === a.location_id)!.name,
      }));
    const open = d.attendance
      .filter(
        (a) =>
          a.date === todayISO() &&
          !a.check_out_time &&
          locs.some((l: any) => l.name === a.location),
      )
      .map((a) => ({ worker: a.worker, location: a.location, check_in_time: a.check_in_time }));
    return {
      company: c?.company ?? "Client",
      locations: locs.map((l: any) => ({ id: l.id, name: l.name, address: l.address })),
      scheduledToday: todayRows.length,
      scheduledWorkers: todayRows,
      checkedInNow: open,
      checkedInCount: open.length,
    };
  }
  if (seg(/^\/client\/schedule$/) && method === "GET") {
    const u = requireRole(auth, "client");
    const c = d.clients.find((x) => x.id === u.clientId);
    const locIds = c?.location_ids ?? [];
    const from = q.get("from") ?? todayISO();
    const to = q.get("to") ?? addDays(todayISO(), 14);
    return d.assignments
      .filter(
        (a) => locIds.includes(a.location_id) && a.assigned_date >= from && a.assigned_date <= to,
      )
      .map((a) => {
        const l = d.locations.find((x) => x.id === a.location_id);
        const att = d.attendance.find(
          (x) => x.worker_id === a.worker_id && x.date === a.assigned_date,
        );
        return {
          id: a.id,
          date: a.assigned_date,
          worker: d.workers.find((w) => w.id === a.worker_id)?.name ?? "—",
          location: l?.name ?? "—",
          checkIn: att?.check_in_time ?? null,
          checkOut: att?.check_out_time ?? null,
          status: !att
            ? "scheduled"
            : att.location !== l?.name
              ? "checked_in_elsewhere"
              : att.check_out_time
                ? "completed"
                : "on_site",
        };
      });
  }
  if (seg(/^\/client\/billing$/) && method === "GET") {
    const u = requireRole(auth, "client");
    const c = d.clients.find((x) => x.id === u.clientId);
    const entries = d.buyerIncome
      .filter((e) => e.buyer_name === c?.buyer_name)
      .map((e) => ({
        id: e.id,
        description: e.description,
        amount: Number(e.amount),
        date: e.date,
        status: e.status,
      }));
    return {
      buyerName: c?.buyer_name ?? null,
      entries,
      totals: {
        received: entries.filter((e) => e.status === "Received").reduce((s, e) => s + e.amount, 0),
        pending: entries.filter((e) => e.status === "Pending").reduce((s, e) => s + e.amount, 0),
      },
    };
  }

  throw new ApiError(404, `Unknown demo endpoint: ${method} ${rawPath}`);
}

/* shared checkout used by both admin+worker checkout paths */
function checkout(workerId: string, d: DB) {
  const row = d.attendance.find(
    (a) => a.worker_id === workerId && a.date === todayISO() && !a.check_out_time,
  );
  if (!row) throw new ApiError(400, "Not checked in today");
  const t = new Date();
  const timeOut = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  row.check_out_time = timeOut;
  const [h1 = 0, m1 = 0] = String(row.check_in_time).split(":").map(Number);
  row.hours_worked = Math.max(
    0,
    Math.round((t.getHours() + t.getMinutes() / 60 - (h1 + m1 / 60)) * 100) / 100,
  );
  row.holiday_accrued_hours = Math.round(row.hours_worked * 0.1207 * 100) / 100;
  save();
  return {
    hours: row.hours_worked,
    holidayAccruedHours: row.holiday_accrued_hours,
    timeOut,
    message: "Checked out successfully",
  };
}

/* ── blob endpoints (document files, incident/application attachments) ── */
export async function demoBlob(path: string, _auth: string | null): Promise<Blob> {
  const d = store();
  const reqFile = path.match(/\/api\/documents\/requests\/([^/]+)\/file/);
  if (reqFile) {
    const r = d.docRequests.find((x) => x.id === reqFile[1]);
    const doc = r && d.documents.find((x) => x.id === r.document_id);
    return demoFileBlob(doc?.name ?? "Document");
  }
  const docFile = path.match(/\/api\/documents\/([^/]+)\/file/);
  if (docFile)
    return demoFileBlob(d.documents.find((x) => x.id === docFile[1])?.name ?? "Document");
  const appDoc = path.match(/\/api\/applications\/([^/]+)\/document\/([^/]+)/);
  if (appDoc) return demoFileBlob(`${appDoc[1]} — ${appDoc[2]}`);
  const incAtt = path.match(/\/api\/incidents\/([^/]+)\/attachment\/(\d+)/);
  if (incAtt) {
    const r = d.incidents.find((x) => x.id === incAtt[1]);
    return demoFileBlob(r?.attachments?.[Number(incAtt[2])]?.name ?? "Attachment");
  }
  return demoFileBlob("Attachment");
}

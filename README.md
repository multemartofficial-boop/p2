# WorkHR — HR & Payroll Demo (portfolio build)

A full workforce-management demo: worker directory, applications pipeline,
attendance with geofenced check-in, payroll, assignments, contractors,
e-signature document flows, incidents, and an admin dashboard.

**This build has no backend and no real data.** The original Express/MySQL API
has been replaced by an in-browser demo backend — every record is fictional and
mutations persist to `localStorage`. Clear site data to reset the demo.

## Run it

```bash
npm install
npm run dev      # vite dev server
npm run build    # production build (emits .vercel/output on Vercel)
npm run lint
```

## Demo accounts

Shown on the login page too (click to fill):

| Role | Credential | Password |
| --- | --- | --- |
| Admin | `admin@demo.io` | `admin123` |
| Worker | `WRK-10241` (worker code) | `worker123` |
| Contractor portal | `client@demo.io` | `client123` |

Things to try: approve a pending application (Admin → Applications), assign a
worker to a site (Daily Assignments), generate payroll (Payroll → Generate),
send/sign documents (Documents → Signature requests — worker signs in their
dashboard, admin countersigns), live map, action log.

## How the demo backend works

`src/lib/api-client.ts` no longer calls a server. It dispatches every
`/api/*` request to `src/lib/demo-api.ts`, which implements the same response
shapes as the original Express API (auth/JWT sessions, workers, applications,
attendance, payroll calc, locations, settings, clients, documents, incidents,
admins, action logs, client portal) against fictional seeds in
`src/lib/mock-data.ts`.

No database credentials, secrets, or real contact information exist in this
copy.

# FarePulse India Frontend

React 19, TypeScript, Tailwind CSS, Recharts, and Vite power the FarePulse
policy-analytics dashboard.

```bash
npm install
npm run dev
```

The development server runs at `http://localhost:5173` and proxies `/api` to
the FastAPI backend at `http://localhost:8000`.

Verification commands:

```bash
npm run lint
npm run build
# With backend and frontend dev servers running:
npm run test:interaction
```

The interaction command restores the deterministic sample and verifies the
one-click empty-state recovery, real filters, Case File evidence and threshold,
drawers, What-If sliders, Judge Mode across all 10 routes, mobile overflow, and
runtime/API errors.

Pages are route-level lazy chunks. The shared shell reports operating mode and
stored-data provenance independently. Analytical endpoints use one explicit
active source cohort even when several provenance types coexist in storage.

See the repository [README](../README.md) for backend setup, live-provider
activation, methodology, and the complete demo path.

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
npm run smoke
```

The smoke command visits all 10 routes with Judge Mode enabled and fails on
browser console warnings/errors, page exceptions, or unsuccessful API calls.

Pages are route-level lazy chunks. The shared shell reports operating mode and
stored-data provenance independently so Demo, Imported, Live, and Hybrid states
cannot be confused.

See the repository [README](../README.md) for backend setup, live-provider
activation, methodology, and the complete demo path.

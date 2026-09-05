import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { JudgeModeProvider } from './context/judgeMode'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import { Spinner } from './components/ui'

const Overview = lazy(() => import('./pages/Overview'))
const RoutesPage = lazy(() => import('./pages/Routes'))
const Trends = lazy(() => import('./pages/Trends'))
const Compare = lazy(() => import('./pages/Compare'))
const Spikes = lazy(() => import('./pages/Spikes'))
const RegulatoryReview = lazy(() => import('./pages/RegulatoryReview'))
const Competition = lazy(() => import('./pages/Competition'))
const Vulnerability = lazy(() => import('./pages/Vulnerability'))
const Fairness = lazy(() => import('./pages/Fairness'))
const Whatif = lazy(() => import('./pages/Whatif'))
const Admin = lazy(() => import('./pages/Admin'))
const Methodology = lazy(() => import('./pages/Methodology'))

export default function App() {
  return (
    <ErrorBoundary>
      <JudgeModeProvider>
      <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Suspense fallback={<Spinner />}><Overview /></Suspense>} />
          <Route path="routes" element={<Suspense fallback={<Spinner />}><RoutesPage /></Suspense>} />
          <Route path="trends" element={<Suspense fallback={<Spinner />}><Trends /></Suspense>} />
          <Route path="compare" element={<Suspense fallback={<Spinner />}><Compare /></Suspense>} />
          <Route path="spikes" element={<Suspense fallback={<Spinner />}><Spikes /></Suspense>} />
          <Route path="review" element={<Suspense fallback={<Spinner />}><RegulatoryReview /></Suspense>} />
          <Route path="competition" element={<Suspense fallback={<Spinner />}><Competition /></Suspense>} />
          <Route path="vulnerability" element={<Suspense fallback={<Spinner />}><Vulnerability /></Suspense>} />
          <Route path="fairness" element={<Suspense fallback={<Spinner />}><Fairness /></Suspense>} />
          <Route path="whatif" element={<Suspense fallback={<Spinner />}><Whatif /></Suspense>} />
          <Route path="admin" element={<Suspense fallback={<Spinner />}><Admin /></Suspense>} />
          <Route path="method" element={<Suspense fallback={<Spinner />}><Methodology /></Suspense>} />
          <Route
            path="*"
            element={
              <div className="rounded-lg border border-line bg-surface p-8 text-center shadow-sm">
                <h1 className="font-serif text-[24px] text-ink">Page not found</h1>
                <p className="mt-2 text-[13px] text-muted">
                  This dashboard route does not exist. Return to the analytical overview.
                </p>
                <a
                  href="/"
                  className="mt-5 inline-flex rounded-md bg-accent px-4 py-2 text-[12px] font-semibold text-white"
                >
                  Return to Overview
                </a>
              </div>
            }
          />
        </Route>
      </Routes>
      </BrowserRouter>
      </JudgeModeProvider>
    </ErrorBoundary>
  )
}

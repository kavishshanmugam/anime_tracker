import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import FinishedModal from '@/components/FinishedModal'
import { useState } from 'react'
import { ToastProvider } from '@/hooks/useToast'
import { LibraryProvider, useLibrary } from '@/hooks/useLibrary'

// ponytail: lazy-load page components, add eager imports if startup matters
import { lazy, Suspense } from 'react'

const Home = lazy(() => import('@/pages/Home'))
const Library = lazy(() => import('@/pages/Library'))
const ComingForYou = lazy(() => import('@/pages/ComingForYou'))
const Calendar = lazy(() => import('@/pages/Calendar'))
const ForYou = lazy(() => import('@/pages/ForYou'))
const Stats = lazy(() => import('@/pages/Stats'))
const AnimeDetail = lazy(() => import('@/pages/AnimeDetail'))
const Onboarding = lazy(() => import('@/pages/Onboarding'))
const Seasonal = lazy(() => import('@/pages/Seasonal'))
const BrowseAll = lazy(() => import('@/pages/BrowseAll'))
const Settings = lazy(() => import('@/pages/Settings'))
const Watch = lazy(() => import('@/pages/Watch'))
const Layout = lazy(() => import('@/components/Layout'))

function LoadingFallback() {
  return <div className="flex items-center justify-center h-screen bg-bg-0">
    <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
  </div>
}

function AppRoutes() {
  const { entries, loading: libLoading } = useLibrary()
  const [skipped, setSkipped] = useState(false)

  if (libLoading) return <LoadingFallback />
  const needsOnboarding = entries.length === 0 && !skipped

  const skipOnboarding = () => setSkipped(true)

  return (
    <Routes>
      <Route path="/onboarding" element={
        <Suspense fallback={<LoadingFallback />}><Onboarding onSkip={skipOnboarding} /></Suspense>
      } />
      <Route path="/watch/:id/:ep" element={
        <Suspense fallback={<LoadingFallback />}><Watch /></Suspense>
      } />
      <Route element={
        <Suspense fallback={<LoadingFallback />}><Layout /></Suspense>
      }>
        <Route path="/" element={
          needsOnboarding ? <Navigate to="/onboarding" replace /> :
          <Suspense fallback={<LoadingFallback />}><Home /></Suspense>
        } />
        <Route path="/library" element={<Suspense fallback={<LoadingFallback />}><Library /></Suspense>} />
        <Route path="/coming-for-you" element={<Suspense fallback={<LoadingFallback />}><ComingForYou /></Suspense>} />
        <Route path="/calendar" element={<Suspense fallback={<LoadingFallback />}><Calendar /></Suspense>} />
        <Route path="/for-you" element={<Suspense fallback={<LoadingFallback />}><ForYou /></Suspense>} />
        <Route path="/stats" element={<Suspense fallback={<LoadingFallback />}><Stats /></Suspense>} />
        <Route path="/seasonal" element={<Suspense fallback={<LoadingFallback />}><Seasonal /></Suspense>} />
        <Route path="/browse" element={<Suspense fallback={<LoadingFallback />}><BrowseAll /></Suspense>} />
        <Route path="/anime/:id" element={<Suspense fallback={<LoadingFallback />}><AnimeDetail /></Suspense>} />
        <Route path="/settings" element={<Suspense fallback={<LoadingFallback />}><Settings /></Suspense>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

// Built app is loaded from file:// where the path is the on-disk location of index.html,
// so BrowserRouter matches no route (blank window). Use hash routing there.
const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter

export default function App() {
  return (
    <Router>
      <ToastProvider>
        <LibraryProvider>
          <AppRoutes />
          <FinishedModal />
        </LibraryProvider>
      </ToastProvider>
    </Router>
  )
}

import { Navigate, Route, Routes } from 'react-router-dom'
import { useApp } from './lib/app-context.jsx'
import Layout from './components/Layout.jsx'
import Toasts from './components/Toasts.jsx'
import PinGate from './components/PinGate.jsx'
import Dashboard from './pages/Dashboard.jsx'
import MyHotel from './pages/MyHotel.jsx'
import Competitors from './pages/Competitors.jsx'
import CalendarPage from './pages/CalendarPage.jsx'
import History from './pages/History.jsx'
import Settings from './pages/Settings.jsx'
import { Spinner } from './components/ui.jsx'

export default function App() {
  const { loading, status } = useApp()

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950">
        <div className="flex flex-col items-center gap-3 text-ink-300">
          <Spinner className="h-6 w-6" />
          <p className="text-sm">Loading HotelTrackr…</p>
        </div>
      </div>
    )
  }

  if (status?.locked) {
    return (
      <>
        <PinGate />
        <Toasts />
      </>
    )
  }

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="hotel" element={<MyHotel />} />
          <Route path="competitors" element={<Competitors />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="history" element={<History />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toasts />
    </>
  )
}
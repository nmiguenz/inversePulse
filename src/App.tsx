import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { AuthProvider, useAuth } from '@/lib/auth'
import { Dashboard } from '@/pages/Dashboard'
import { Alerts } from '@/pages/Alerts'
import { Opportunities } from '@/pages/Opportunities'
import { News } from '@/pages/News'
import { Settings } from '@/pages/Settings'
import { Login } from '@/pages/Login'

function Gate() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="bg-base flex min-h-dvh items-center justify-center">
        <span className="border-strong border-t-accent h-7 w-7 animate-spin rounded-full border-2" />
      </div>
    )
  }

  if (!session) return <Login />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="alertas" element={<Alerts />} />
        <Route path="oportunidades" element={<Opportunities />} />
        <Route path="noticias" element={<News />} />
        <Route path="config" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

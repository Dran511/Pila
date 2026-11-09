import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ToastProvider } from './components/ui'
import { AuthProvider, RequireAuth } from './lib/auth'
import { AdminDashboard } from './pages/admin/Dashboard'
import { Poster } from './pages/admin/Poster'
import { Setup } from './pages/admin/Setup'
import { Shell } from './pages/Shell'
import { Display } from './pages/Display'
import { Join } from './pages/Join'
import { Landing } from './pages/Landing'
import { Login, Signup } from './pages/Auth'
import { NotFound } from './pages/NotFound'
import { Console } from './pages/staff/Console'
import { TicketPage } from './pages/Ticket'

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/q/:slug" element={<Join />} />
            <Route path="/t/:id" element={<TicketPage />} />
            <Route path="/display/:slug" element={<Display />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route
              path="/poster"
              element={
                <RequireAuth role="admin">
                  <Poster />
                </RequireAuth>
              }
            />
            <Route
              element={
                <RequireAuth>
                  <Shell />
                </RequireAuth>
              }
            >
              <Route path="/staff" element={<Console />} />
              <Route
                path="/admin"
                element={
                  <RequireAuth role="admin">
                    <AdminDashboard />
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/setup"
                element={
                  <RequireAuth role="admin">
                    <Setup />
                  </RequireAuth>
                }
              />
            </Route>
            <Route path="/app" element={<Navigate to="/staff" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

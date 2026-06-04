import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import Layout from './components/layout/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import SpkDashboard from './pages/SpkDashboard'
import SpkForm from './pages/SpkForm'
import SpkDetail from './pages/SpkDetail'
import ProductionTracking from './pages/ProductionTracking'
import PurchaseOrders from './pages/PurchaseOrders'
import Inventory from './pages/Inventory'
import Inbound from './pages/Inbound'
import InboundNew from './pages/InboundNew'
import InboundQC from './pages/InboundQC'
import InboundDetail from './pages/InboundDetail'
import COGM from './pages/COGM'
import Invoice from './pages/Invoice'
import InvoiceNew from './pages/InvoiceNew'
import InvoiceDetail from './pages/InvoiceDetail'
import './index.css'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f2' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: '#1a1a1a', letterSpacing: '0.04em', marginBottom: 8 }}>ALEZA</div>
        <div style={{ fontSize: 12, color: '#999' }}>Memuat...</div>
      </div>
    </div>
  )

  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </AuthProvider>
  )
}

function AppShell() {
  const location = useLocation()
  const isLogin  = location.pathname === '/login'

  if (isLogin) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    )
  }

  return (
    <Layout>
      <Routes>
        <Route path="/"                   element={<ProtectedRoute><Navigate to="/dashboard" replace /></ProtectedRoute>} />
        <Route path="/dashboard"          element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/spk"                element={<ProtectedRoute><SpkDashboard /></ProtectedRoute>} />
        <Route path="/spk/new"            element={<ProtectedRoute><SpkForm /></ProtectedRoute>} />
        <Route path="/spk/:id"            element={<ProtectedRoute><SpkDetail /></ProtectedRoute>} />
        <Route path="/production"         element={<ProtectedRoute><ProductionTracking /></ProtectedRoute>} />
        <Route path="/po"                 element={<ProtectedRoute><PurchaseOrders /></ProtectedRoute>} />
        <Route path="/inventory"          element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
        <Route path="/inbound"            element={<ProtectedRoute><Inbound /></ProtectedRoute>} />
        <Route path="/inbound/new"        element={<ProtectedRoute><InboundNew /></ProtectedRoute>} />
        <Route path="/inbound/qc/:id"     element={<ProtectedRoute><InboundQC /></ProtectedRoute>} />
        <Route path="/inbound/:type/:id"  element={<ProtectedRoute><InboundDetail /></ProtectedRoute>} />
        <Route path="/cogm"               element={<ProtectedRoute><COGM /></ProtectedRoute>} />
        <Route path="/invoice"            element={<ProtectedRoute><Invoice /></ProtectedRoute>} />
        <Route path="/invoice/new"        element={<ProtectedRoute><InvoiceNew /></ProtectedRoute>} />
        <Route path="/invoice/:id"        element={<ProtectedRoute><InvoiceDetail /></ProtectedRoute>} />
        <Route path="*"                   element={<ProtectedRoute><Navigate to="/dashboard" replace /></ProtectedRoute>} />
      </Routes>
    </Layout>
  )
}

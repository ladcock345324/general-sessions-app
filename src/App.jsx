import { Routes, Route, Navigate } from 'react-router-dom'
import './App.css'
import { AuthProvider } from './AuthContext'
import { SyncProvider } from './SyncContext'
import RequireAuth from './RequireAuth'
import Login from './pages/Login'
import ClientList from './pages/ClientList'
import ClientFile from './pages/ClientFile'
import NewClient from './pages/NewClient'
import EditClient from './pages/EditClient'
import CaseView from './pages/CaseView'

function App() {
  return (
    <AuthProvider>
      <SyncProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><ClientList /></RequireAuth>} />
        <Route path="/client/new" element={<RequireAuth><NewClient /></RequireAuth>} />
        <Route path="/client/:id/edit" element={<RequireAuth><EditClient /></RequireAuth>} />
        <Route path="/client/:id" element={<RequireAuth><ClientFile /></RequireAuth>} />
        <Route path="/case/:caseNumber" element={<RequireAuth><CaseView /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </SyncProvider>
    </AuthProvider>
  )
}

export default App

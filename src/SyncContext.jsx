import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { fullSync, startBackgroundSync } from './syncManager'
import { useAuth } from './AuthContext'

const SyncContext = createContext(null)

export function SyncProvider({ children }) {
  const { session, loading: authLoading } = useAuth()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState(
    () => localStorage.getItem('lastSyncedAt') ?? null
  )
  const cleanupRef = useRef(null)

  // Track online/offline state
  useEffect(() => {
    const handleOnline  = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Initial sync + background sync — only after confirmed session
  useEffect(() => {
    if (authLoading || !session) return

    async function init() {
      setIsSyncing(true)
      try {
        await fullSync(supabase)
        setLastSyncedAt(localStorage.getItem('lastSyncedAt'))
      } finally {
        setIsSyncing(false)
      }
      cleanupRef.current = startBackgroundSync(supabase)
    }

    init()

    return () => {
      if (cleanupRef.current) cleanupRef.current()
    }
  }, [authLoading, session])

  async function triggerSync() {
    setIsSyncing(true)
    try {
      await fullSync(supabase)
      setLastSyncedAt(localStorage.getItem('lastSyncedAt'))
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <SyncContext.Provider value={{ isOnline, isSyncing, lastSyncedAt, triggerSync }}>
      {children}
    </SyncContext.Provider>
  )
}

export function useSyncStatus() {
  return useContext(SyncContext)
}

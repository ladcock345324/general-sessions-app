import { useEffect, useState } from 'react'
import { usePWAStatus } from '../PWAContext'
import styles from './OfflineStatus.module.css'

// Permanent, low-contrast offline-readiness indicator.
// Shared by Login and ClientList so both render sites stay identical.
//
// States (computed live):
//  • controlled        → green  "Offline-ready" (shell is cached; app will open offline)
//  • registered/installing → amber "Preparing offline…"
//  • needRefresh       → muted  "Update ready — opens on next launch" (no reload button)
//  • showConnectivity  → plain Online/Offline segment (Login only; ClientList's
//                        sync bar already shows connectivity, so it passes false)
export default function OfflineStatus({ showConnectivity = false }) {
  const { needRefresh, controlled } = usePWAStatus()

  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  useEffect(() => {
    if (!showConnectivity) return
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [showConnectivity])

  const ready = controlled
  const dotClass = ready ? styles.dotGreen : styles.dotAmber
  const readyText = ready ? 'Offline-ready' : 'Preparing offline…'

  return (
    <div className={styles.bar}>
      <span className={`${styles.dot} ${dotClass}`} />
      <span>{readyText}</span>
      {needRefresh && (
        <span className={styles.update}>· Update ready — opens on next launch</span>
      )}
      {showConnectivity && (
        <span className={styles.conn}>· {online ? 'Online' : 'Offline'}</span>
      )}
    </div>
  )
}

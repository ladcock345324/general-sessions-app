import { createContext, useContext, useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

const PWAContext = createContext(null)

// Registers the service worker in-app (injectRegister is null in vite.config)
// and exposes the live offline-readiness signals to the UI.
//
// Option 1 update model: registerType is 'prompt' with skipWaiting:false, so a
// new SW only reaches "waiting" AFTER it has fully precached, and activates on
// the next full launch. We deliberately do NOT call updateServiceWorker() — no
// forced reload. needRefresh is surfaced for DISPLAY ONLY.
export function PWAProvider({ children }) {
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('[pwa] SW registration error:', error)
    },
  })

  // Live "controlled" signal: true when a SW is actively controlling this page,
  // which is the real proof the shell will be served from cache offline.
  const [controlled, setControlled] = useState(
    typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller
  )

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const update = () => setControlled(!!navigator.serviceWorker.controller)
    update()
    navigator.serviceWorker.addEventListener('controllerchange', update)
    // controller becomes set shortly after activation (clientsClaim on first install)
    navigator.serviceWorker.ready.then(update).catch(() => {})
    return () => navigator.serviceWorker.removeEventListener('controllerchange', update)
  }, [])

  return (
    <PWAContext.Provider value={{ offlineReady, needRefresh, controlled }}>
      {children}
    </PWAContext.Provider>
  )
}

export function usePWAStatus() {
  return useContext(PWAContext) ?? { offlineReady: false, needRefresh: false, controlled: false }
}

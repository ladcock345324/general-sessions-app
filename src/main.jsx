import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

// Take scroll positioning off the browser for the whole app, at boot.
//
// Moved here from inside ClientList's effect on 2026-09-03: set there, it never
// applied on a cold load straight into a client file, and only took effect once
// the list had mounted at least once.
//
// ⚠️ This is necessary but NOT sufficient — mobile Safari still moves the scroll
// across these SPA route changes regardless, which is why the app also has to
// reset detail pages on mount and hold a restored position for a settle window.
// See scrollHold.js.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

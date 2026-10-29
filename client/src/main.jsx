import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from './components/theme-provider'
import './index.css'
import App from './App'
import Display from './components/Display'

// Fork addition: compact view for a docked phone. Lazy so it doesn't add to the main bundle.
const DockDisplay = lazy(() => import('./components/DockDisplay'))

const root = ReactDOM.createRoot(document.getElementById('root'))

function currentPath() {
  if (typeof window === 'undefined') return ''
  return window.location.pathname.replace(/\/$/, '')
}

function Root() {
  const path = currentPath()
  if (path.endsWith('/dock')) {
    return (
      <Suspense fallback={<div className="fixed inset-0 bg-gray-950" />}>
        <DockDisplay />
      </Suspense>
    )
  }
  return path.endsWith('/display') ? <Display /> : (
    <ThemeProvider defaultTheme="system" storageKey="spotiqueue-theme">
      <App />
    </ThemeProvider>
  )
}

root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)

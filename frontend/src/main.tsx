import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { Toaster } from './components/ui/toaster.tsx'
import { escape } from 'querystring'

const registerServiceWorker = () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/firebase-messaging-sw.js', { type: 'classic' }) // Corrected path
      .then((registration) => {
        console.log('Service Worker registered with scope:', registration.scope);
      })
      .catch((err) => {
        console.log('Service Worker registration failed:', err);
      });
  } else {
    console.log("Service Worker not supported by browser")
  }
}

if (import.meta.env.DEV) {
  fetch('http://localhost:8000/api/method/nirmaan_stack.www.nirmaan_stack.get_context_for_dev', {
    method: 'POST',
  })
    .then(response => response.json())
    .then((values) => {
      const v = JSON.parse(values.message)
      //@ts-expect-error
      if (!window.frappe) window.frappe = {};
      //@ts-ignore
      window.frappe.boot = v
      registerServiceWorker()
      ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
          <App />
          <Toaster />
        </React.StrictMode>,
      )
    }
    )
} else {
  registerServiceWorker()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
      <Toaster />
    </React.StrictMode>,
  )
}

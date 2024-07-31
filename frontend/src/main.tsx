import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
// import { BrowserRouter } from 'react-router-dom'
// import { UserProvider } from './utils/auth/UserProvider'
// import { FrappeProvider } from 'frappe-react-sdk'
 
// const getSiteName = () => {
//   // @ts-ignore
//   if (window.frappe?.boot?.versions?.frappe && (window.frappe.boot.versions.frappe.startsWith('15') || window.frappe.boot.versions.frappe.startsWith('16'))) {
//     // @ts-ignore
//     return window.frappe?.boot?.sitename ?? import.meta.env.VITE_SITE_NAME
//   }
//   return import.meta.env.VITE_SITE_NAME

// }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* <FrappeProvider
			url={import.meta.env.VITE_FRAPPE_PATH ?? ""}
			socketPort={import.meta.env.VITE_SOCKET_PORT ? import.meta.env.VITE_SOCKET_PORT : undefined}
			//@ts-ignore
			siteName={getSiteName()}
      >
    <BrowserRouter>
    <UserProvider> */}
        <App />
    {/* </UserProvider>
    </BrowserRouter>
    </FrappeProvider> */}
  </React.StrictMode>,
)

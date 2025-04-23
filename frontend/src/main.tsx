// import React from 'react'
// import ReactDOM from 'react-dom/client'
// import App from './App.tsx'
// import './index.css'
// import { Toaster } from './components/ui/toaster.tsx'
// import ReloadPrompt from './ReloadPrompt.tsx';

// const registerServiceWorker = () => {
//   if ('serviceWorker' in navigator) {
//     navigator.serviceWorker
//       .register('/firebase-messaging-sw.js', { type: 'classic' }) // Corrected path
//       .then((registration) => {
//         console.log('Service Worker registered with scope:', registration.scope);
//       })
//       .catch((err) => {
//         console.log('Service Worker registration failed:', err);
//       });
//   } else {
//     console.log("Service Worker not supported by browser")
//   }
// }

// if (import.meta.env.DEV) {
//   fetch('http://localhost:8000/api/method/nirmaan_stack.www.nirmaan_stack.get_context_for_dev', {
//     method: 'POST',
//   })
//     .then(response => response.json())
//     .then((values) => {
//       const v = JSON.parse(values.message)
//       //@ts-expect-error
//       if (!window.frappe) window.frappe = {};
//       //@ts-ignore
//       window.frappe.boot = v
//       registerServiceWorker()
//       ReactDOM.createRoot(document.getElementById('root')!).render(
//         <React.StrictMode>
//           <App />
//           <Toaster />
//           {/* <ReloadPrompt /> */}
//         </React.StrictMode>,
//       )
//     }
//     )
// } else {
//   registerServiceWorker()
//   ReactDOM.createRoot(document.getElementById('root')!).render(
//     <React.StrictMode>
//       <App />
//       <Toaster />
//       {/* <ReloadPrompt /> */}
//     </React.StrictMode>,
//   )
// }


import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { Toaster } from './components/ui/toaster.tsx';
// import ReloadPrompt from './ReloadPrompt.tsx'; // Assuming commented out intentionally

const registerServiceWorker = () => {
  // Make sure this path is correct relative to your domain root in production
  const swPath = '/firebase-messaging-sw.js';
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register(swPath, { type: 'classic' }) // Ensure type is correct
      .then((registration) => {
        console.log('Service Worker registered with scope:', registration.scope);
      })
      .catch((err) => {
        console.error('Service Worker registration failed:', err); // Use console.error
      });
  } else {
    console.warn("Service Worker not supported by browser"); // Use console.warn
  }
};

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error("Fatal Error: Root element #root not found in the DOM.");
}
const root = ReactDOM.createRoot(rootElement);

// Create an async function to handle initialization
async function initializeAndRenderApp() {
    try {
        // --- Boot Data Loading ---
        if (import.meta.env.DEV) {
            console.log("DEV MODE: Fetching boot context...");
            // Use relative path if Vite proxy is configured, or full path otherwise
            const response = await fetch('http://localhost:8000/api/method/nirmaan_stack.www.nirmaan_stack.get_context_for_dev', {
                method: 'POST',
                // Add headers if needed (e.g., Content-Type)
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch dev boot context: ${response.status} ${response.statusText}`);
            }

            const values = await response.json();
            // Check if the response structure is as expected
            if (values.message) {
                const v = JSON.parse(values.message); // Assuming message is a JSON string
                if (!window.frappe) window.frappe = {};
                window.frappe.boot = v;
                console.log("DEV MODE: Boot context loaded.", window.frappe.boot);
            } else {
                 throw new Error("DEV MODE: Invalid response structure from boot context API.");
            }

        } else {
            // --- Production Mode ---
            // Assume Frappe has injected window.frappe.boot globally *before* this script runs.
            // Add a check for safety.
            if (!window.frappe?.boot) {
                console.warn("PROD MODE: window.frappe.boot was not found. Check Frappe Page/Template injection.");
                // You *could* add a fallback fetch here if absolutely necessary,
                // but the ideal solution is Frappe server-side injection.
                // Example Fallback (use with caution):
                // try {
                //   const response = await fetch('/api/method/frappe.boot.get_bootinfo'); // Adjust endpoint if needed
                //   if (!response.ok) throw new Error('Fallback boot fetch failed');
                //   const data = await response.json();
                //   window.frappe.boot = data.message; // Adjust based on actual response structure
                //   console.log("PROD MODE: Fallback boot context loaded.");
                // } catch (fallbackError) {
                //   console.error("PROD MODE: Fallback boot context fetch failed:", fallbackError);
                //   throw new Error("Application boot context failed to load.");
                // }
            } else {
               console.log("PROD MODE: Boot context found.", window.frappe.boot);
            }
        }

        // --- Critical Check ---
        // Ensure frappe.boot exists before proceeding
        if (!window.frappe?.boot) {
           throw new Error("Critical Error: Frappe boot context is missing. Cannot render application.");
        }

        // --- Service Worker Registration ---
        // Register SW *after* potential async operations
        registerServiceWorker();

        // --- Render Application ---
        root.render(
            <React.StrictMode>
                <App />
                <Toaster />
                {/* <ReloadPrompt /> */}
            </React.StrictMode>,
        );

    } catch (error) {
        console.error("Application Initialization Failed:", error);
        // Render a user-friendly error message in the DOM
        root.render(
            <React.StrictMode>
                <div style={{ padding: '20px', color: 'red', fontFamily: 'sans-serif' }}>
                    <h2>Application Error</h2>
                    <p>Failed to initialize the application. Please check the console for details or contact support.</p>
                    <pre>{error instanceof Error ? error.message : String(error)}</pre>
                </div>
            </React.StrictMode>
        );
    }
}

// Start the initialization process
initializeAndRenderApp();
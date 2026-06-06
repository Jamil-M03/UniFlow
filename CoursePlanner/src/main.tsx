import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import './mobile.css'
import App from './App'
import { SupabaseProvider } from './hooks/useSupabase'
import { AppUserProvider } from './hooks/useAppUser'

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPublishableKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY.");
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <SupabaseProvider>
        <AppUserProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AppUserProvider>
      </SupabaseProvider>
    </ClerkProvider>
  </React.StrictMode>
)

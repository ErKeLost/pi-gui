import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/rpc'
import App from './App'
import './index.css'
import {Providers} from './components/Providers'
document.title = import.meta.env.DEV ? 'Pi GUI · DEV (HMR)' : 'Pi GUI'
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={queryClient}><Providers><App/></Providers></QueryClientProvider></StrictMode>)

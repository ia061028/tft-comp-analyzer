import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import StatsPage from './StatsPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StatsPage />
  </StrictMode>,
)

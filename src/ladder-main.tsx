import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import LadderPage from './LadderPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LadderPage />
  </StrictMode>,
)

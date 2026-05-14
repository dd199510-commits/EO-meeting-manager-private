import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AccessGate } from './components/AccessGate.jsx'
import installBrowserAiScheduler from './lib/browserAiScheduler'
import { resetPublicBuildDataOnce } from './lib/publicBuild'

resetPublicBuildDataOnce()
installBrowserAiScheduler()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AccessGate>
      <App />
    </AccessGate>
  </StrictMode>,
)

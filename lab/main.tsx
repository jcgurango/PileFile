import { createRoot } from 'react-dom/client'
import '../src/index.css'
import './lab.css'
import Lab from './Lab'

// No StrictMode: the editors are imperative and a double mount would only add noise to the experiment.
createRoot(document.getElementById('root')!).render(<Lab />)

import './i18n';
import './index.css';
import '@/stores/theme';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { useAuth } from './stores/auth';

useAuth.getState().loadFromStorage();

const root = document.getElementById('root');
if (!root) throw new Error('#root missing in index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

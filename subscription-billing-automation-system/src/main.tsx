import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

declare global {
  interface Window {
    __deferredPWAInstallPrompt?: any;
  }
}

// Register our clean, HMR-independent service worker (/sw.js) immediately
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  // Unregister any broken dev-sw.js registrations first, then register /sw.js
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      for (const reg of registrations) {
        if (reg.active?.scriptURL.includes('dev-sw.js')) {
          reg.unregister();
        }
      }
      return navigator.serviceWorker.register('/sw.js', { scope: '/' });
    })
    .catch((err) => {
      console.error('Service worker registration error:', err);
    });
}

createRoot(document.getElementById('root')!).render(<App />);

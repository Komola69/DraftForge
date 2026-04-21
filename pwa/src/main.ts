/**
 * Entry point. Imports CSS, initializes the app.
 */
import './styles/index.css';
import { initApp } from './ui/app';

// Boot
initApp();

// Register Service Worker for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(
      (reg) => console.log('[SW] Registered:', reg.scope),
      (err) => console.warn('[SW] Registration failed:', err)
    );
  });
}


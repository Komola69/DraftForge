/**
 * Entry point. Imports CSS, initializes the app.
 */
import './styles/index.css';
import { initApp, engine } from './ui/app';
import { store } from './ui/state';

// Global disposal hook — called by FloatingService.onDestroy() via evaluateJavascript
(window as any).__draftforge_dispose = () => {
  console.log('[DraftForge] Teardown: disposing state manager and engine worker...');
  store.dispose();
  if (engine?.dispose) engine.dispose();
};

// Boot
initApp().catch(err => {
  console.error('[DraftForge] Fatal initialization error:', err);
  document.body.innerHTML = `
    <div style="height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#0a0e1a; color:#ef4444; font-family:sans-serif; text-align:center; padding:20px;">
      <h1 style="margin-bottom:10px;">⚠️ System Boot Failure</h1>
      <p style="color:#94a3b8; max-width:400px; line-height:1.6;">${err.message}</p>
      <button onclick="location.reload()" style="margin-top:20px; background:#6366f1; color:white; border:none; padding:10px 20px; border-radius:8px; cursor:pointer;">Retry</button>
    </div>
  `;
});

// Register Service Worker for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(
      (reg) => console.log('[SW] Registered:', reg.scope),
      (err) => console.warn('[SW] Registration failed:', err)
    );
  });
}


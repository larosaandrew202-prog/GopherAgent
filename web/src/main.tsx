import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import './styles/console.css';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

/**
 * Publish the on-screen keyboard height as `--kb`.
 *
 * The shell keeps a fixed height (100dvh) so the page never scrolls; the
 * composer lifts by `--kb` instead, which keeps the input above the keyboard on
 * iOS (where the layout viewport does not shrink) without resizing the app.
 * Android Chrome resizes the layout viewport itself (interactive-widget=
 * resizes-content), so `--kb` stays 0 there and nothing double-lifts.
 */
function trackKeyboard() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    if (Number.isFinite(kb)) root.style.setProperty('--kb', `${kb}px`);
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  window.addEventListener('orientationchange', () => window.setTimeout(apply, 120));
  apply();
}

trackKeyboard();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

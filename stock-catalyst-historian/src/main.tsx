import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './ErrorBoundary.tsx';

if (typeof window !== "undefined") {
  // Gracefully handle unhandled rejections caused by WebSocket or network interruptions during dev server restarts
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (
      reason === "WebSocket closed without opened." ||
      (reason && typeof reason === "string" && (reason.includes("websocket") || reason.includes("WebSocket") || reason.includes("Failed to fetch"))) ||
      (reason && reason.message && (reason.message.includes("websocket") || reason.message.includes("WebSocket") || reason.message.includes("Failed to fetch")))
    ) {
      event.preventDefault();
      console.warn("[Safe Suppression] Unhandled promise rejection ignored:", reason);
    }
  });

  // Gracefully handle errors or network failures
  window.addEventListener("error", (event) => {
    const msg = event.message || "";
    if (
      msg.includes("websocket") ||
      msg.includes("WebSocket") ||
      msg.includes("Failed to fetch") ||
      msg.includes("WebSocket closed without opened")
    ) {
      event.preventDefault();
      console.warn("[Safe Suppression] Dev environment network/websocket error ignored:", msg);
    }
  });

  // Intercept console.error to avoid raising modal alerts in dev browser overlays for trivial network/HMR noise
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const argStr = args.map(a => String(a)).join(" ");
    if (
      argStr.includes("websocket") ||
      argStr.includes("WebSocket") ||
      argStr.includes("Failed fetching cache stats") ||
      argStr.includes("Failed to fetch") ||
      argStr.includes("WebSocket closed without opened")
    ) {
      console.warn("[Safe Suppression] Dev console error suppressed:", ...args);
      return;
    }
    originalConsoleError.apply(console, args);
  };

  // Intercept console.warn to suppress noisy Recharts dimension warnings
  const originalConsoleWarn = console.warn;
  console.warn = (...args: any[]) => {
    const argStr = args.map(a => String(a)).join(" ");
    if (
      argStr.includes("width(-1) and height(-1) of chart") ||
      argStr.includes("should be greater than 0, please check the style of container")
    ) {
      // Quietly suppress Recharts layout noise on load or container resize
      return;
    }
    originalConsoleWarn.apply(console, args);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

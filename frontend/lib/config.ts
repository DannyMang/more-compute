/**
 * Runtime configuration for MoreCompute frontend.
 * Handles dynamic URLs for WebSocket and API connections.
 */

/**
 * Get the WebSocket URL for connecting to the backend.
 * In development (Next.js dev server), connects directly to backend.
 * In production (served from FastAPI), uses relative URL.
 */
export function getWebSocketUrl(): string {
  if (typeof window === 'undefined') {
    // SSR - return placeholder (won't be used)
    return 'ws://localhost:3141/ws';
  }

  // Check if we're running from the Next.js dev server (port 2718)
  // or from the FastAPI server (any other port, typically 3141)
  const isDev = window.location.port === '2718';

  if (isDev) {
    // Development: connect directly to FastAPI backend
    return 'ws://127.0.0.1:3141/ws';
  }

  // Production: use relative WebSocket URL (same origin as the page)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/**
 * Get the base API URL.
 * In development, API calls go through Next.js rewrites.
 * In production, API calls go directly to the same origin.
 */
export function getApiBaseUrl(): string {
  // API calls always use relative URLs - this works in both dev and prod
  // because Next.js rewrites handle it in dev, and FastAPI serves it in prod
  return '';
}

/**
 * Check if running in development mode (Next.js dev server)
 */
export function isDevelopment(): boolean {
  if (typeof window === 'undefined') return true;
  return window.location.port === '2718';
}

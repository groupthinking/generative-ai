const SESSION_KEY = "wealth-advisor-session";
let currentSession: string | undefined;

export function getSessionId(): string {
  if (currentSession) return currentSession;
  try { currentSession = window.sessionStorage.getItem(SESSION_KEY) || undefined; } catch { /* Storage can be disabled. */ }
  currentSession ||= crypto.randomUUID();
  try { window.sessionStorage.setItem(SESSION_KEY, currentSession); } catch { /* Keep the in-memory session for this page. */ }
  return currentSession;
}

export function getWebSocketUrl(): string {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const base = process.env.NEXT_PUBLIC_BACKEND_URL || (local ? "http://localhost:8000" : window.location.origin);
  const url = new URL(base);
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    throw new Error("NEXT_PUBLIC_BACKEND_URL must use HTTP(S) or WebSocket(S)");
  }
  url.protocol = ["https:", "wss:"].includes(url.protocol) ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/websocket/ws`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

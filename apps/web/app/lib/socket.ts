import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/** When page is HTTPS, use HTTPS/WSS for the API URL to avoid mixed-content blocking. */
function getSocketBaseUrl(): string {
  const raw = (window as Window & { ENV?: { API_URL?: string } }).ENV?.API_URL ?? 'http://localhost:4444';
  if (typeof window !== 'undefined' && window.location?.protocol === 'https:' && raw.startsWith('http://')) {
    return raw.replace(/^http:\/\//, 'https://');
  }
  return raw;
}

/**
 * Get or create the Socket.io connection.
 * The connection is authenticated via the session cookie.
 * Automatically reconnects on disconnect.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(getSocketBaseUrl(), {
      withCredentials: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });
  }
  return socket;
}

/**
 * Disconnect and clean up the socket connection.
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

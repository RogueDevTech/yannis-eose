import { io, type Socket } from 'socket.io-client';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';

let socket: Socket | null = null;

function getSocketBaseUrl(): string {
  return getBrowserApiBaseUrl() || 'http://localhost:4444';
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

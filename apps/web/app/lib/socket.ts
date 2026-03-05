import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/**
 * Get or create the Socket.io connection.
 * The connection is authenticated via the session cookie.
 * Automatically reconnects on disconnect.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io((window as Window & { ENV?: { API_URL?: string } }).ENV?.API_URL ?? 'http://localhost:4444', {
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

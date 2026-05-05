import { io } from 'socket.io-client';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const socket = io(BACKEND, { autoConnect: false });

export function connectSocket() {
  if (!socket.connected) socket.connect();
  return socket;
}

export default socket;

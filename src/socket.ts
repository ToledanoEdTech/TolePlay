import { io } from "socket.io-client";

// In development: same origin (port 3000). In production: use VITE_SOCKET_URL from env
const socketUrl = import.meta.env.VITE_SOCKET_URL || "";
export const socket = io(socketUrl || undefined, {
  path: "/socket.io",
  transports: ["websocket", "polling"],
});

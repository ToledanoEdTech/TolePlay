import { io } from "socket.io-client";

// In development, we connect to the same origin since we run on port 3000
export const socket = io();

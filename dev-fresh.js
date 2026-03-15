/**
 * מריץ את האתר לוקאלית כל פעם על פורט אחר (3000, 3001, 3002, ...)
 * כך שהדפדפן טוען גרסה מעודכנת בלי קאש מההרצה הקודמת.
 *
 * שימוש: node dev-fresh.js
 * או: npm run dev:fresh
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_FILE = path.join(__dirname, '.last-dev-port');
const BASE_PORT = 3000;
const MAX_OFFSET = 100; // פורטים 3000–3099

function getNextPort() {
  let last = BASE_PORT;
  try {
    if (fs.existsSync(PORT_FILE)) {
      const data = fs.readFileSync(PORT_FILE, 'utf8').trim();
      last = Math.max(BASE_PORT, parseInt(data, 10) || BASE_PORT);
    }
  } catch (_) {}
  const next = BASE_PORT + ((last - BASE_PORT + 1) % MAX_OFFSET);
  try {
    fs.writeFileSync(PORT_FILE, String(next), 'utf8');
  } catch (_) {}
  return next;
}

function waitForServer(port, cb) {
  const url = `http://127.0.0.1:${port}/api/health`;
  let attempts = 0;
  const maxAttempts = 60; // עד 30 שניות
  const interval = setInterval(() => {
    attempts++;
    const req = http.get(url, (res) => {
      if (res.statusCode === 200) {
        clearInterval(interval);
        cb();
      }
    });
    req.on('error', () => {});
    req.setTimeout(800, () => { req.destroy(); });
    if (attempts >= maxAttempts) {
      clearInterval(interval);
      cb(); // פותח דפדפן גם אם לא הגיב בזמן
    }
  }, 500);
}

function openBrowser(port) {
  const url = `http://localhost:${port}`;
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', windowsHide: true });
  } else {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(cmd, [url], { stdio: 'ignore' });
  }
}

const port = getNextPort();
process.env.PORT = String(port);

console.log(`\n[dev-fresh] פורט הפעם: ${port} (מעודכן כל הרצה)\n`);

const child = spawn('npx', ['tsx', 'server.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PORT: String(port) },
  cwd: __dirname,
});

child.on('error', (err) => {
  console.error('[dev-fresh] שגיאה בהפעלת השרת:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

// מחכה שהשרת יעלה עם כל הקבצים והקוד המעודכן, ואז פותח דפדפן
setTimeout(() => {
  waitForServer(port, () => {
    openBrowser(port);
    console.log(`[dev-fresh] הדפדפן נפתח ב־http://localhost:${port}\n`);
  });
}, 2500); // נותן זמן ל-Vite ולשרת לטעון את כל הקבצים

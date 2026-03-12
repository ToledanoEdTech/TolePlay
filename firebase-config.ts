import admin from 'firebase-admin';
import { existsSync, readFileSync } from 'fs';

let database: admin.database.Database | null = null;

export function initFirebase(): admin.database.Database | null {
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!databaseURL) {
    console.warn('[Firebase] FIREBASE_DATABASE_URL is not set in .env');
    console.warn('[Firebase] Running without database persistence.');
    return null;
  }

  let serviceAccount: object | null = null;

  // Option 1: JSON string from env (for Railway, Render, Vercel serverless)
  const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (envJson) {
    try {
      serviceAccount = JSON.parse(envJson);
    } catch (e) {
      console.error('[Firebase] Invalid FIREBASE_SERVICE_ACCOUNT JSON:', e);
      return null;
    }
  }

  // Option 2: File path
  if (!serviceAccount) {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
    if (existsSync(serviceAccountPath)) {
      try {
        serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
      } catch (e) {
        console.error('[Firebase] Failed to read service account file:', e);
        return null;
      }
    }
  }

  if (!serviceAccount) {
    console.warn('[Firebase] No service account (file or FIREBASE_SERVICE_ACCOUNT env). Running without DB persistence.');
    return null;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      databaseURL,
    });

    database = admin.database();
    console.log('[Firebase] Realtime Database connected');
    return database;
  } catch (error) {
    console.error('[Firebase] Initialization failed:', error);
    return null;
  }
}

export function getDb(): admin.database.Database | null {
  return database;
}

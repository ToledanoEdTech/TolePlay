import admin from 'firebase-admin';
import { existsSync, readFileSync } from 'fs';

let database: admin.database.Database | null = null;

export function initFirebase(): admin.database.Database | null {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!existsSync(serviceAccountPath)) {
    console.warn('[Firebase] Service account not found at:', serviceAccountPath);
    console.warn('[Firebase] Running without database persistence.');
    return null;
  }

  if (!databaseURL) {
    console.warn('[Firebase] FIREBASE_DATABASE_URL is not set in .env');
    console.warn('[Firebase] Running without database persistence.');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
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

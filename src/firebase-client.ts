/**
 * Firebase client SDK - for Auth and Realtime Database (quizzes)
 * Uses env vars from Vite: VITE_FIREBASE_* 
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Database | null = null;

export function initFirebaseClient(): { app: FirebaseApp; auth: Auth; db: Database } | null {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'undefined') {
    console.warn('[Firebase Client] Missing VITE_FIREBASE_* env vars. Auth and quiz save disabled.');
    return null;
  }
  if (app && auth && db) return { app, auth, db };
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
  return { app, auth, db };
}

export function getFirebaseAuth(): Auth | null {
  return auth;
}

export function getFirebaseDb(): Database | null {
  return db;
}

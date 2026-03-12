import { ref, set, get, push, remove, type DatabaseReference } from 'firebase/database';
import { getFirebaseDb } from '../firebase-client';

export interface QuizQuestion {
  q: string;
  opts: string[];
  a: number;
}

export interface SavedQuiz {
  id?: string;
  title: string;
  questions: QuizQuestion[];
  createdAt: number;
  updatedAt: number;
}

export async function saveQuiz(userId: string, quiz: Omit<SavedQuiz, 'createdAt' | 'updatedAt' | 'id'>): Promise<string | null> {
  const db = getFirebaseDb();
  if (!db) return null;
  const now = Date.now();
  const quizRef = push(ref(db, `users/${userId}/quizzes`));
  await set(quizRef, {
    title: quiz.title,
    questions: quiz.questions,
    createdAt: now,
    updatedAt: now,
  });
  return quizRef.key;
}

export async function updateQuiz(userId: string, quizId: string, quiz: Partial<SavedQuiz>): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  const quizRef = ref(db, `users/${userId}/quizzes/${quizId}`);
  const snap = await get(quizRef);
  if (!snap.exists()) return;
  const existing = snap.val();
  await set(quizRef, {
    ...existing,
    ...quiz,
    updatedAt: Date.now(),
  });
}

export async function loadQuizzes(userId: string): Promise<SavedQuiz[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const quizzesRef = ref(db, `users/${userId}/quizzes`);
  const snap = await get(quizzesRef);
  if (!snap.exists()) return [];
  const data = snap.val();
  return Object.entries(data).map(([id, v]: [string, any]) => ({
    id,
    title: v.title || 'חידון ללא שם',
    questions: v.questions || [],
    createdAt: v.createdAt || 0,
    updatedAt: v.updatedAt || 0,
  }));
}

export async function deleteQuiz(userId: string, quizId: string): Promise<void> {
  const db = getFirebaseDb();
  if (!db) return;
  await remove(ref(db, `users/${userId}/quizzes/${quizId}`));
}

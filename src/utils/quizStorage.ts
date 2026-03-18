import { ref, set, get, push, remove } from 'firebase/database';
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

export interface QuizRunPlayerStat {
  id: string;
  name: string;
  score: number;
  resources: number;
  correctAnswers: number;
  kills: number;
  team?: string | null;
}

export interface QuizRun {
  id?: string;
  quizId: string;
  quizTitle: string;
  mode: string;
  winner: string;
  createdAt: number;
  questionCount: number;
  players: QuizRunPlayerStat[];
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

export async function addQuizRun(userId: string, run: Omit<QuizRun, 'id'>): Promise<string | null> {
  const db = getFirebaseDb();
  if (!db) return null;
  const runRef = push(ref(db, `users/${userId}/quizRuns/${run.quizId}`));
  await set(runRef, run);
  return runRef.key;
}

export async function loadQuizRuns(userId: string, quizId: string): Promise<QuizRun[]> {
  const db = getFirebaseDb();
  if (!db) return [];
  const runsRef = ref(db, `users/${userId}/quizRuns/${quizId}`);
  const snap = await get(runsRef);
  if (!snap.exists()) return [];
  const data = snap.val();
  return Object.entries(data).map(([id, v]: [string, any]) => ({
    id,
    quizId: v.quizId || quizId,
    quizTitle: v.quizTitle || 'חידון ללא שם',
    mode: v.mode || 'unknown',
    winner: v.winner || 'unknown',
    createdAt: v.createdAt || 0,
    questionCount: v.questionCount || 0,
    players: Array.isArray(v.players) ? v.players : [],
  })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

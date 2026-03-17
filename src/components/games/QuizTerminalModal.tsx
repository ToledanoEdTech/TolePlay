import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

type QuizQuestion = {
  q?: string;
  question?: string;
  opts?: string[];
  options?: string[];
  a?: number;
  answerIndex?: number;
};

function getText(q: QuizQuestion): string {
  return String(q.q ?? q.question ?? '');
}

function getOptions(q: QuizQuestion): string[] {
  const opts = Array.isArray(q.opts) ? q.opts : Array.isArray(q.options) ? q.options : [];
  return opts.map(o => String(o));
}

function getAnswerIndex(q: QuizQuestion): number {
  const a = typeof q.a === 'number' ? q.a : (typeof q.answerIndex === 'number' ? q.answerIndex : -1);
  return Number.isFinite(a) ? a : -1;
}

function pickIndex(len: number): number {
  if (len <= 0) return -1;
  return Math.floor(Math.random() * len);
}

export function QuizTerminalModal({
  open,
  questions,
  onClose,
  onCorrect,
  onWrong,
  sessionId,
}: {
  open: boolean;
  questions: any[];
  onClose: () => void;
  onCorrect: () => void;
  onWrong: () => void;
  sessionId: number;
}) {
  // Freeze questions for this modal session so server ticks can't mutate what we show.
  const frozenQuestions = useMemo(() => {
    const src = Array.isArray(questions) ? questions : [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sc = (globalThis as any).structuredClone;
      if (typeof sc === 'function') return sc(src) as QuizQuestion[];
    } catch {
      // ignore
    }
    return src.map((q: any) => ({
      ...q,
      opts: Array.isArray(q?.opts) ? [...q.opts] : q?.opts,
      options: Array.isArray(q?.options) ? [...q.options] : q?.options,
    })) as QuizQuestion[];
  }, [sessionId]); // intentionally ONLY on session open

  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [locked, setLocked] = useState(false);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const prevOpenRef = useRef(false);
  const autoNextTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open) return;
    if (wasOpen) return;
    // Init exactly once per open.
    setLocked(false);
    setFeedback(null);
    setCurrentIndex(pickIndex(frozenQuestions.length));
  }, [open, frozenQuestions.length]);

  useEffect(() => {
    // Cleanup any pending auto-next when closing or session changes.
    if (!open && autoNextTimeoutRef.current !== null) {
      window.clearTimeout(autoNextTimeoutRef.current);
      autoNextTimeoutRef.current = null;
    }
    return () => {
      if (autoNextTimeoutRef.current !== null) {
        window.clearTimeout(autoNextTimeoutRef.current);
        autoNextTimeoutRef.current = null;
      }
    };
  }, [open, sessionId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      // prevent Enter/Space from auto-activating buttons
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const q = frozenQuestions[currentIndex] ?? null;
  const text = q ? getText(q) : '';
  const opts = q ? getOptions(q) : [];
  const answerIdx = q ? getAnswerIndex(q) : -1;

  const choose = (i: number) => {
    if (locked || !q) return;
    setLocked(true);
    const ok = i === answerIdx;
    setFeedback(ok ? 'correct' : 'wrong');
    if (ok) onCorrect();
    else onWrong();

    // Auto-advance (no need to click "next").
    if (autoNextTimeoutRef.current !== null) {
      window.clearTimeout(autoNextTimeoutRef.current);
      autoNextTimeoutRef.current = null;
    }
    autoNextTimeoutRef.current = window.setTimeout(() => {
      autoNextTimeoutRef.current = null;
      setLocked(false);
      setFeedback(null);
      setCurrentIndex(pickIndex(frozenQuestions.length));
    }, 1200);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
    >
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 shadow-2xl bg-slate-950 text-white">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 left-3 z-10 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
        >
          <X size={18} className="text-slate-400" />
        </button>

        <div className="p-6 pt-12">
          <h2 className="text-xl font-bold text-center mb-2">טרמינל שאלות</h2>
          <p className="text-slate-300 text-sm text-center mb-4">תשובה נכונה = +20 ⚡ + 10 💰</p>

          <div className="text-center font-bold text-lg mb-4 min-h-[3em]">
            {text || 'טוען שאלה...'}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {opts.map((opt, i) => (
              <button
                key={`${sessionId}-${currentIndex}-${i}`}
                type="button"
                disabled={locked}
                onClick={() => choose(i)}
                className={`p-4 rounded-xl font-bold border transition ${
                  locked && i === answerIdx
                    ? 'bg-emerald-600 border-emerald-400'
                    : locked
                      ? 'bg-slate-800 border-slate-700 text-slate-400'
                      : 'bg-slate-700 hover:bg-slate-600 border-slate-600'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>

          <div className="mt-4 flex justify-center items-center">
            <div className="text-sm">
              {feedback === 'correct' ? <span className="text-emerald-400 font-bold">✓ נכון!</span> : feedback === 'wrong' ? <span className="text-red-400 font-bold">✗ לא נכון</span> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


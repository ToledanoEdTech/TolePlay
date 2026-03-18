import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { socket } from '../socket';
import { Trophy } from 'lucide-react';
import { ZombieDefenseGame } from './games/ZombieDefenseGame';
import { EconomyMarathonGame } from './games/EconomyMarathonGame';
import { BossBattleGame } from './games/BossBattleGame';
import { AsteroidHuntGame } from './games/AsteroidHuntGame';
import { CTFGame } from './games/CTFGame';
import { Leaderboard } from './Leaderboard';
import { SoundManager } from '../utils/SoundManager';

export function PlayerView({ onBack, initialCode, initialName, autoJoin }: {
  onBack: () => void; initialCode?: string; initialName?: string; autoJoin?: boolean;
}) {
  const [code, setCode] = useState(initialCode || '');
  const [name, setName] = useState(initialName || '');
  const [gameState, setGameState] = useState<'join' | 'lobby' | 'playing' | 'ended'>('join');
  const [player, setPlayer] = useState<any>(null);
  const [room, setRoom] = useState<any>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [roomQuestions, setRoomQuestions] = useState<any[]>([]);
  const [globalState, setGlobalState] = useState<any>({});
  const [allPlayers, setAllPlayers] = useState<Record<string, any>>({});
  const [winner, setWinner] = useState<string | null>(null);
  const [gameOverPayload, setGameOverPayload] = useState<{ winner: string; mode?: string; players?: { id: string; name: string; kills: number; score: number; correctAnswers: number }[] } | null>(null);
  const [error, setError] = useState('');
  const [lobbyCount, setLobbyCount] = useState(0);
  const [ctfHudSnapshot, setCtfHudSnapshot] = useState<{ redScore: number; blueScore: number; gameOver: any; myPlayer: any } | null>(null);
  const [showRotateOverlay, setShowRotateOverlay] = useState(false);
  const [dismissRotateOverlay, setDismissRotateOverlay] = useState(false);

  const playerIdRef = useRef<string>('');
  const roomRef = useRef<any>(null);
  const modeRef = useRef<string | null>(null);
  const questionsRef = useRef<any[]>([]);
  const gameStateRef = useRef<{ players: Record<string, any>; globalState: any }>({ players: {}, globalState: {} });
  const lastCtfHudUpdate = useRef(0);

  const attemptLandscapeLock = async () => {
    try {
      // Must be called from a user gesture in most browsers.
      const scr: any = (window as any).screen;
      const ori = scr?.orientation;
      if (ori?.lock) await ori.lock('landscape');
    } catch {
      // ignore; we'll show an overlay prompt instead
    }
  };

  useEffect(() => {
    if (autoJoin && initialCode && initialName && gameState === 'join') {
      doJoin(initialCode, initialName);
    }
  }, [autoJoin, initialCode, initialName]);

  const doJoin = (c: string, n: string) => {
    setError('');
    socket.emit('joinRoom', { code: c, name: n }, (res: any) => {
      if (res.success) {
        playerIdRef.current = res.playerId;
        const p = res.room.players[res.playerId];
        setPlayer({ ...p, id: res.playerId });
        roomRef.current = res.room;
        setRoom(res.room);
        const joinedMode = res.room?.mode ?? null;
        modeRef.current = joinedMode;
        setMode(joinedMode);
        const qs = Array.isArray(res.room?.questions) ? res.room.questions : [];
        questionsRef.current = qs;
        setRoomQuestions(qs);
        setGlobalState(res.room.globalState || {});
        setAllPlayers(res.room.players || {});
        setLobbyCount(Object.keys(res.room.players).length);
        setGameState('lobby');
      } else {
        setError(res.error || 'שגיאה בהתחברות');
      }
    });
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (gameState !== 'playing') {
      setShowRotateOverlay(false);
      setDismissRotateOverlay(false);
      return;
    }

    const update = () => {
      const mobile = (window.matchMedia?.('(max-width: 768px)')?.matches ?? false) || ('ontouchstart' in window);
      const portrait = window.innerHeight > window.innerWidth;
      setShowRotateOverlay(mobile && portrait && !dismissRotateOverlay);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update as any);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update as any);
    };
  }, [gameState, dismissRotateOverlay]);

  useEffect(() => {
    const onRoomUpdated = (r: any) => {
      roomRef.current = r;
      setRoom(r);
      setAllPlayers(r.players || {});
      setLobbyCount(Object.keys(r.players || {}).length);
      // Keep mode/questions stable during play; only update if server explicitly sends them.
      if (typeof r?.mode === 'string') {
        modeRef.current = r.mode;
        setMode(r.mode);
      }
      if (Array.isArray(r?.questions)) {
        questionsRef.current = r.questions;
        setRoomQuestions(r.questions);
      }
    };
    const onGameStarted = (r: any) => {
      roomRef.current = r;
      setRoom(r);
      const startedMode = r?.mode ?? null;
      modeRef.current = startedMode;
      setMode(startedMode);
      const qs = Array.isArray(r?.questions) ? r.questions : [];
      questionsRef.current = qs;
      setRoomQuestions(qs);
      const players = r.players || {};
      const gs = r.globalState || {};
      gameStateRef.current = { players, globalState: gs };
      if (r.mode === 'ctf') {
        const myId = playerIdRef.current;
        setCtfHudSnapshot({
          redScore: gs.redScore ?? 0,
          blueScore: gs.blueScore ?? 0,
          gameOver: gs.gameOver ?? null,
          myPlayer: myId && players[myId] ? { ...players[myId], id: myId } : null,
        });
      } else {
        setAllPlayers(players);
        setGlobalState(gs);
      }
      const myId = playerIdRef.current;
      if (myId && players[myId]) {
        setPlayer({ ...players[myId], id: myId });
      }
      setGameState('playing');
    };
    const onPlayerUpdated = ({ playerId: pid, player: p }: any) => {
      setAllPlayers(prev => ({ ...prev, [pid]: p }));
      if (pid === playerIdRef.current) {
        setPlayer({ ...p, id: pid });
      }
    };
    const onGlobalState = (state: any) => setGlobalState(state);
    const onTick = (data: any) => {
      const players = data.players || {};
      const globalState = data.globalState || {};
      gameStateRef.current = { players, globalState };
      const mode = roomRef.current?.mode;
      if (mode === 'ctf') {
        const now = Date.now();
        if (now - lastCtfHudUpdate.current >= 250) {
          lastCtfHudUpdate.current = now;
          const myId = playerIdRef.current;
          setCtfHudSnapshot({
            redScore: globalState.redScore ?? 0,
            blueScore: globalState.blueScore ?? 0,
            gameOver: globalState.gameOver ?? null,
            myPlayer: myId && players[myId] ? { ...players[myId], id: myId } : null,
          });
        }
        return;
      }
      setAllPlayers(players);
      setGlobalState(globalState);
      const myId = playerIdRef.current;
      if (myId && players[myId]) {
        setPlayer((prev: any) => {
          if (!prev) return prev;
          return { ...players[myId], id: myId };
        });
      }
    };
    const onGameOver = (data: any) => { setWinner(data?.winner ?? null); setGameOverPayload(data ?? null); setGameState('ended'); };
    const onKicked = () => {
      setGameState('join');
      setPlayer(null);
      setRoom(null);
      playerIdRef.current = '';
      setError('הוצאת מהחדר על ידי המורה');
    };

    socket.on('roomUpdated', onRoomUpdated);
    socket.on('gameStarted', onGameStarted);
    socket.on('playerUpdated', onPlayerUpdated);
    socket.on('globalStateUpdated', onGlobalState);
    socket.on('tick', onTick);
    socket.on('gameOver', onGameOver);
    socket.on('kicked', onKicked);

    return () => {
      socket.off('roomUpdated', onRoomUpdated);
      socket.off('gameStarted', onGameStarted);
      socket.off('playerUpdated', onPlayerUpdated);
      socket.off('globalStateUpdated', onGlobalState);
      socket.off('tick', onTick);
      socket.off('gameOver', onGameOver);
      socket.off('kicked', onKicked);
    };
  }, []);

  // JOIN SCREEN
  if (gameState === 'join') {
    return (
      <div className="h-full min-h-screen flex flex-col bg-[#070b18] text-white" dir="rtl">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="TolePlay" className="w-8 h-8 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            <span className="text-lg font-black brand-text-sm">TolePlay</span>
          </div>
          <button onClick={onBack} className="text-slate-400 hover:text-white transition text-sm font-bold hover:bg-slate-800/50 px-3 py-1.5 rounded-lg">
            ← חזור
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
        <motion.form
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6 && name.trim()) {
              // Mobile polish: user gesture moment — enable audio + try lock landscape.
              SoundManager.resumeFromUserGesture();
              attemptLandscapeLock();
              doJoin(code, name.trim());
            }
          }}
          className="bg-slate-900/60 backdrop-blur-xl p-7 rounded-3xl w-full max-w-sm shadow-2xl border border-slate-700/50"
        >
          <h2 className="text-3xl font-black mb-2 text-center brand-text-sm">
            הצטרף למשחק
          </h2>
          <p className="text-sm text-slate-400 text-center mb-6">הכנס את הקוד שהמורה שלך שיתף</p>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-900/50 border border-red-500/40 rounded-xl p-3 mb-4 text-center text-red-400 text-sm font-bold"
            >
              {error}
            </motion.div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1.5">קוד חדר</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                className="w-full bg-slate-900/80 border-2 border-slate-700 rounded-xl px-4 py-3 text-3xl text-center font-mono tracking-[0.5em] focus:border-indigo-500 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)] transition-all placeholder:text-slate-700"
                placeholder="000000"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 mb-1.5">כינוי</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={20}
                className="w-full bg-slate-900/80 border-2 border-slate-700 rounded-xl px-4 py-3 text-lg focus:border-indigo-500 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)] transition-all text-center placeholder:text-slate-600"
                placeholder="הכנס שם..."
                required
              />
            </div>
            <motion.button
              whileTap={{ scale: 0.95 }}
              type="submit"
              disabled={code.length < 6 || !name.trim()}
              className="w-full py-3.5 bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-400 hover:to-violet-400 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 rounded-xl text-xl font-black shadow-[0_4px_20px_rgba(99,102,241,0.3)] hover:shadow-[0_4px_30px_rgba(99,102,241,0.5)] transition-all"
            >
              היכנס!
            </motion.button>
          </div>
        </motion.form>
        </div>
      </div>
    );
  }

  // LOBBY
  if (gameState === 'lobby') {
    const instructionsByMode: Record<string, { objective: string; rules: string; controls: string }> = {
      zombie: {
        objective: 'מטרה: לשרוד את גלי הזומבים ולהגן על הבסיס.',
        rules: 'כל הריגת זומבי מקנה נקודות ותחמושת. ענה על שאלות כדי לקבל תחמושת ולקנות נשקים וצריחים.',
        controls: 'בקרים: W,A,S,D (או ג׳ויסטיק) לתזוזה, עכבר/מגע לכוון ולירות, לחצן "שאלות" לתחמושת.',
      },
      economy: {
        objective: 'מטרה: לאסוף הכי הרבה זהב במפה.',
        rules: 'אספו מטבעות וענו נכון על שאלות כדי להגדיל את הכפילים.',
        controls: 'בקרים: תזוזה עם מקשים או ג׳ויסטיק, לחץ על שאלות כשמופיעות.',
      },
      boss: {
        objective: 'מטרה: להביס את הבוס (או כגיבור – לשרוד ולהנחית נזק).',
        rules: 'שחקן אחד יכול להיות הבוס. שאר השחקנים צריכים לעבוד יחד נגדו.',
        controls: 'בקרים: תזוזה, ירי עם עכבר/מגע, שאלות לתחמושת.',
      },
      ctf: {
        objective: 'מטרה: לתפוס את דגל היריב ולהביאו לבסיס שלכם.',
        rules: 'קבוצה אדומה נגד כחולה. גנבו את הדגל והגנו על הבסיס.',
        controls: 'בקרים: תזוזה, ירי, שאלות לתחמושת ומטבעות.',
      },
      farm: {
        objective: 'מטרה: לאסוף משאבים ולהשמיד אסטרואידים בחלל.',
        rules: 'פוצצו אסטרואידים וענו על שאלות כדי לשדרג כלי נשק.',
        controls: 'בקרים: תזוזה, ירי עם עכבר/מגע.',
      },
    };
    const inst = room?.mode ? instructionsByMode[room.mode] : null;

    return (
      <div className="h-full min-h-screen flex flex-col items-center justify-center p-6 bg-[#070b18] text-center text-white" dir="rtl">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="max-w-lg w-full">
          <motion.div
            animate={{ y: [0, -6, 0], scale: [1, 1.05, 1] }}
            transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
            className="w-24 h-24 bg-violet-500/10 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_40px_rgba(139,92,246,0.2)]"
          >
            <img src="/logo.png" alt="TolePlay" className="w-14 h-14 object-contain drop-shadow-[0_0_15px_rgba(139,92,246,0.5)]" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          </motion.div>
          <h2 className="text-3xl font-bold mb-2">אתה בפנים!</h2>
          <p className="text-xl text-indigo-300 font-bold mb-4">{player?.name}</p>
          <div className="bg-slate-800 px-6 py-4 rounded-2xl border border-slate-700 space-y-2 mb-6">
            <p className="text-slate-400 text-sm">ממתין למורה שיתחיל את המשחק...</p>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-emerald-400 font-bold">{lobbyCount} שחקנים מחוברים</span>
            </div>
          </div>
          {inst && (
            <div className="bg-slate-800/80 rounded-2xl border border-slate-600 p-5 text-right">
              <h3 className="text-lg font-bold text-amber-400 mb-3">הוראות משחק</h3>
              <p className="text-slate-200 text-sm font-bold mb-1">{inst.objective}</p>
              <p className="text-slate-400 text-sm mb-2">{inst.rules}</p>
              <p className="text-cyan-300/90 text-xs">{inst.controls}</p>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  // ENDED
  if (gameState === 'ended') {
    const isZombieEnd = room?.mode === 'zombie' && gameOverPayload?.mode === 'zombie';
    const isBossEnd = room?.mode === 'boss' && (gameOverPayload?.mode === 'boss' || !!gameOverPayload?.players);
    const mySummaryZombie = isZombieEnd && gameOverPayload?.players ? gameOverPayload.players.find((p: any) => p.id === playerIdRef.current) : null;
    const mySummaryBoss = isBossEnd && gameOverPayload?.players ? gameOverPayload.players.find((p: any) => p.id === playerIdRef.current) : null;

    return (
      <div className="h-full min-h-screen flex items-center justify-center p-6 bg-[#070b18] text-center text-white" dir="rtl">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="max-w-lg w-full">
          <motion.div
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ repeat: Infinity, duration: 2 }}
          >
            <Trophy className="w-24 h-24 text-yellow-400 mx-auto mb-6 drop-shadow-[0_0_30px_rgba(250,204,21,0.5)]" />
          </motion.div>
          <h2 className="text-4xl font-black mb-4 text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500">
            המשחק נגמר!
          </h2>
          {isZombieEnd && mySummaryZombie ? (
            <div className="bg-slate-800/80 rounded-2xl border border-slate-600 p-8 mb-8 text-right">
              <p className="text-2xl font-black text-cyan-300 mb-2">הריגות שלך: {mySummaryZombie.kills}</p>
              <p className="text-2xl font-black text-amber-400">הנקודות שלך: {mySummaryZombie.score}</p>
            </div>
          ) : isBossEnd && mySummaryBoss ? (
            <div className="bg-slate-800/80 rounded-2xl border border-slate-600 p-8 mb-8 text-right">
              <p className="text-2xl font-black text-amber-400">הנקודות שלך: {mySummaryBoss.score}</p>
              <p className="text-xl font-bold text-violet-300">תשובות נכונות: {mySummaryBoss.correctAnswers}</p>
            </div>
          ) : (
            <>
              <p className="text-lg text-slate-400 mb-2">המנצח:</p>
              <p className="text-3xl font-black text-indigo-400 mb-8">{winner}</p>
            </>
          )}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={onBack}
            className="py-3 px-10 bg-indigo-500 hover:bg-indigo-400 rounded-xl text-lg font-bold transition-all shadow-lg shadow-indigo-500/20"
          >
            חזור לראשי
          </motion.button>
        </motion.div>
      </div>
    );
  }

  // PLAYING - delegate to mode-specific component
  const activeMode = modeRef.current ?? mode ?? room?.mode ?? null;
  const gameProps = {
    roomCode: room?.code || code,
    playerId: playerIdRef.current,
    player,
    questions: questionsRef.current.length ? questionsRef.current : roomQuestions,
    globalState,
    allPlayers,
    startTime: room?.startTime,
  };
  const ctfGameProps = {
    ...gameProps,
    gameStateRef,
    hudSnapshot: ctfHudSnapshot,
  };

  return (
    <div className="h-screen w-full overflow-hidden bg-[#070b18]" dir="rtl">
      <Leaderboard
        mode={activeMode}
        players={allPlayers}
        localPlayerId={playerIdRef.current}
      />
      {showRotateOverlay && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-5 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-950/90 p-6 text-center shadow-2xl">
            <div className="text-2xl font-black text-white mb-2">סובבו את הטלפון לרוחב</div>
            <div className="text-slate-300 text-sm leading-relaxed mb-5">
              החוויה במובייל טובה משמעותית במצב לרוחב. אם אפשר, נא לסובב את המכשיר.
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { SoundManager.resumeFromUserGesture(); attemptLandscapeLock(); }}
                className="flex-1 py-3 rounded-2xl bg-indigo-500 hover:bg-indigo-400 text-white font-black"
              >
                נסה לנעול לרוחב
              </button>
              <button
                type="button"
                onClick={() => { setDismissRotateOverlay(true); setShowRotateOverlay(false); }}
                className="flex-1 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-black"
              >
                המשך בכל זאת
              </button>
            </div>
          </div>
        </div>
      )}
      {activeMode === 'zombie' && <ZombieDefenseGame {...gameProps} />}
      {activeMode === 'economy' && <EconomyMarathonGame {...gameProps} />}
      {activeMode === 'boss' && <BossBattleGame {...gameProps} />}
      {activeMode === 'farm' && <AsteroidHuntGame {...gameProps} />}
      {activeMode === 'ctf' && <CTFGame {...ctfGameProps} />}
      {!activeMode && (
        <div className="flex items-center justify-center h-full bg-[#070b18] text-white">
          <p className="text-slate-400">טוען משחק...</p>
        </div>
      )}
    </div>
  );
}

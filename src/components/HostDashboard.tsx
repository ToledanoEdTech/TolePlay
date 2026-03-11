import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { socket } from '../socket';
import { Users, Play, Trophy, Shield, Rocket, Target, DollarSign, Upload, FileText, XCircle } from 'lucide-react';
import { PlayerView } from './PlayerView';

const MODES = [
  { id: 'zombie', name: 'הגנת זומבים', icon: Shield, desc: 'הגנו על הבסיס מגלי זומבים. ענו על שאלות כדי לקנות נשקים וצריחים.', color: 'from-slate-800 to-slate-900', accent: 'text-blue-400' },
  { id: 'economy', name: 'מרתון כלכלי', icon: DollarSign, desc: 'אספו מטבעות במפה וענו על שאלות. הראשון שמגיע ל-10,000$ מנצח!', color: 'from-emerald-900 to-slate-900', accent: 'text-yellow-400' },
  { id: 'boss', name: 'קרב בוס', icon: Trophy, desc: 'שחקן אחד הופך לבוס ענק! שאר השחקנים צריכים להביס אותו.', color: 'from-red-900 to-slate-900', accent: 'text-red-400' },
  { id: 'ctf', name: 'תפוס ת\'דגל', icon: Target, desc: 'קבוצה אדומה נגד כחולה. גנבו את הדגל של היריב והביאו לבסיס שלכם.', color: 'from-indigo-900 to-slate-900', accent: 'text-indigo-400' },
  { id: 'farm', name: 'ציד אסטרואידים', icon: Rocket, desc: 'פוצצו אסטרואידים בחלל כדי לאסוף משאבים יקרים.', color: 'from-purple-900 to-slate-900', accent: 'text-purple-400' },
];

const MOCK_QUESTIONS = [
  { q: "מהי בירת ישראל?", opts: ["תל אביב", "ירושלים", "חיפה", "אילת"], a: 1 },
  { q: "כמה זה 7 כפול 8?", opts: ["54", "56", "64", "48"], a: 1 },
  { q: "איזה כוכב לכת הוא הקרוב ביותר לשמש?", opts: ["נוגה", "מאדים", "כדור הארץ", "חמה"], a: 3 },
  { q: "מי כתב את 'הארי פוטר'?", opts: ["ג'יי קיי רולינג", "סטיבן קינג", "ג'ורג' ר.ר. מרטין", "טולקין"], a: 0 },
  { q: "מהו היסוד הכימי בעל הסימול O?", opts: ["זהב", "חמצן", "פחמן", "ברזל"], a: 1 },
  { q: "כמה זה 12 כפול 12?", opts: ["124", "132", "144", "156"], a: 2 },
  { q: "מה השפה הנפוצה ביותר בעולם?", opts: ["אנגלית", "ספרדית", "סינית מנדרינית", "הינדית"], a: 2 },
  { q: "כמה צלעות יש למשולש?", opts: ["2", "3", "4", "5"], a: 1 },
  { q: "מהו בעל החיים הגדול ביותר בעולם?", opts: ["פיל אפריקאי", "לוויתן כחול", "כריש לוויתן", "ג'ירפה"], a: 1 },
  { q: "באיזו שנה הוקמה מדינת ישראל?", opts: ["1945", "1948", "1950", "1952"], a: 1 },
  { q: "מה שורש של 81?", opts: ["7", "8", "9", "10"], a: 2 },
  { q: "כמה יבשות יש בעולם?", opts: ["5", "6", "7", "8"], a: 2 },
  { q: "מי צייר את המונה ליזה?", opts: ["מיכלאנג'לו", "לאונרדו דה וינצ'י", "רפאל", "דאלי"], a: 1 },
  { q: "מהי הנוסחה של מים?", opts: ["CO2", "H2O", "NaCl", "O2"], a: 1 },
  { q: "כמה דקות יש בשעה?", opts: ["30", "45", "60", "90"], a: 2 },
  { q: "מהו כוח הכבידה על פני כדור הארץ?", opts: ["8.9 m/s²", "9.8 m/s²", "10.2 m/s²", "7.5 m/s²"], a: 1 },
  { q: "כמה זה 15% מ-200?", opts: ["25", "30", "35", "40"], a: 1 },
  { q: "מהו האוקיינוס הגדול ביותר?", opts: ["האטלנטי", "ההודי", "השקט", "הארקטי"], a: 2 },
  { q: "באיזו מדינה נמצא מגדל אייפל?", opts: ["אנגליה", "צרפת", "גרמניה", "איטליה"], a: 1 },
  { q: "כמה שיניים יש לאדם בוגר?", opts: ["28", "30", "32", "34"], a: 2 },
];

export function HostDashboard({ onBack }: { onBack: () => void }) {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mode, setMode] = useState<string>('zombie');
  const [players, setPlayers] = useState<any[]>([]);
  const [gameState, setGameState] = useState<'setup' | 'lobby' | 'playing' | 'ended'>('setup');
  const [globalState, setGlobalState] = useState<any>({});
  const [winner, setWinner] = useState<string | null>(null);
  const [showTestPlayer, setShowTestPlayer] = useState(false);
  const [customQuestions, setCustomQuestions] = useState<any[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestTick = useRef<any>(null);
  const particles = useRef<any[]>([]);

  useEffect(() => {
    const onRoomUpdated = (room: any) => {
      setPlayers(Object.values(room.players));
    };
    const onPlayerUpdated = ({ player }: any) => {
      setPlayers(prev => {
        const idx = prev.findIndex((p: any) => p.id === player.id);
        if (idx >= 0) {
          const newPlayers = [...prev];
          newPlayers[idx] = player;
          return newPlayers;
        }
        return [...prev, player];
      });
    };
    const onGlobalState = (state: any) => setGlobalState(state);
    const onTick = (data: any) => { latestTick.current = data; };
    const onGameOver = ({ winner }: any) => { setGameState('ended'); setWinner(winner); };

    socket.on('roomUpdated', onRoomUpdated);
    socket.on('playerUpdated', onPlayerUpdated);
    socket.on('globalStateUpdated', onGlobalState);
    socket.on('tick', onTick);
    socket.on('gameOver', onGameOver);

    return () => {
      socket.off('roomUpdated', onRoomUpdated);
      socket.off('playerUpdated', onPlayerUpdated);
      socket.off('globalStateUpdated', onGlobalState);
      socket.off('tick', onTick);
      socket.off('gameOver', onGameOver);
    };
  }, []);

  // Host Canvas Renderer
  useEffect(() => {
    if (gameState !== 'playing') return;
    let animationFrameId: number;

    const render = () => {
      const canvas = canvasRef.current;
      if (canvas && latestTick.current) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Clear
          ctx.fillStyle = '#0f172a'; // slate-900
          ctx.fillRect(0, 0, 1000, 1000);

          // Grid lines
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 2;
          for(let i=0; i<=1000; i+=100) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 1000); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(1000, i); ctx.stroke();
          }

          const gs = latestTick.current.globalState;

          // Stations (Always present)
          const qX = mode === 'ctf' ? 500 : 300;
          const qY = mode === 'ctf' ? 200 : 500;
          const sX = mode === 'ctf' ? 500 : 700;
          const sY = mode === 'ctf' ? 800 : 500;

          ctx.shadowBlur = 20;
          ctx.shadowColor = '#3b82f6';
          ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
          ctx.beginPath(); ctx.arc(qX, qY, 100, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = '#3b82f6'; ctx.font = 'bold 24px Arial'; ctx.textAlign = 'center'; ctx.fillText('שאלות', qX, qY + 8);

          ctx.shadowColor = '#10b981';
          ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
          ctx.beginPath(); ctx.arc(sX, sY, 100, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = '#10b981'; ctx.fillText('חנות', sX, sY + 8);
          ctx.shadowBlur = 0;

          if (mode === 'zombie') {
            // Base
            ctx.shadowBlur = 30; ctx.shadowColor = '#3b82f6';
            ctx.fillStyle = '#3b82f6';
            ctx.beginPath(); ctx.arc(500, 500, 60, 0, Math.PI*2); ctx.fill();
            ctx.shadowBlur = 0;
            const hp = gs?.baseHealth || 0;
            const maxHp = gs?.maxBaseHealth || 2000;
            ctx.fillStyle = 'red'; ctx.fillRect(450, 420, 100, 10);
            ctx.fillStyle = '#10b981'; ctx.fillRect(450, 420, 100 * (hp/maxHp), 10);

            // Turrets
            gs?.turrets?.forEach((t: any) => {
              ctx.fillStyle = '#94a3b8';
              ctx.fillRect(t.x - 10, t.y - 10, 20, 20);
              ctx.fillStyle = '#3b82f6';
              ctx.beginPath(); ctx.arc(t.x, t.y, 5, 0, Math.PI*2); ctx.fill();
            });

            // Zombies
            gs?.zombies?.forEach((z: any) => {
              ctx.shadowBlur = 15; ctx.shadowColor = '#ef4444';
              ctx.fillStyle = '#ef4444';
              ctx.beginPath(); ctx.arc(z.x, z.y, 18, 0, Math.PI*2); ctx.fill();
              ctx.shadowBlur = 0;
              ctx.fillStyle = 'red'; ctx.fillRect(z.x-15, z.y-25, 30, 5);
              ctx.fillStyle = '#10b981'; ctx.fillRect(z.x-15, z.y-25, 30 * (z.hp/z.maxHp), 5);
            });
          } else if (mode === 'economy') {
            // Coins
            gs?.coins?.forEach((c: any) => {
              ctx.shadowBlur = 20; ctx.shadowColor = '#facc15';
              ctx.fillStyle = '#facc15';
              ctx.beginPath(); ctx.arc(c.x, c.y, 12, 0, Math.PI*2); ctx.fill();
              ctx.shadowBlur = 0;
              ctx.fillStyle = '#ca8a04'; ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, Math.PI*2); ctx.fill();
            });
          } else if (mode === 'farm') {
            // Asteroids
            gs?.asteroids?.forEach((a: any) => {
              ctx.shadowBlur = 15; ctx.shadowColor = '#94a3b8';
              ctx.fillStyle = '#64748b';
              ctx.beginPath(); ctx.arc(a.x, a.y, 25, 0, Math.PI*2); ctx.fill();
              ctx.shadowBlur = 0;
              ctx.fillStyle = 'red'; ctx.fillRect(a.x-20, a.y-35, 40, 5);
              ctx.fillStyle = '#10b981'; ctx.fillRect(a.x-20, a.y-35, 40 * (a.hp/a.maxHp), 5);
            });
          } else if (mode === 'ctf') {
            // Bases
            ctx.fillStyle = 'rgba(239, 68, 68, 0.2)'; ctx.beginPath(); ctx.arc(100, 500, 80, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = 'rgba(59, 130, 246, 0.2)'; ctx.beginPath(); ctx.arc(900, 500, 80, 0, Math.PI*2); ctx.fill();
            
            // Flags
            if (gs?.redFlag) {
              ctx.fillStyle = '#ef4444'; ctx.fillRect(gs.redFlag.x - 10, gs.redFlag.y - 10, 20, 20);
            }
            if (gs?.blueFlag) {
              ctx.fillStyle = '#3b82f6'; ctx.fillRect(gs.blueFlag.x - 10, gs.blueFlag.y - 10, 20, 20);
            }
          }

          // Draw Lasers
          gs?.lasers?.forEach((l: any) => {
            ctx.shadowBlur = 10; ctx.shadowColor = l.color || '#eab308';
            ctx.strokeStyle = l.color || '#eab308';
            ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
            ctx.shadowBlur = 0;
            
            if (Math.random() > 0.5) {
              particles.current.push({ x: l.x2, y: l.y2, vx: (Math.random()-0.5)*10, vy: (Math.random()-0.5)*10, life: 1, color: l.color });
            }
          });

          // Draw Particles
          particles.current.forEach((pt, i) => {
            ctx.fillStyle = pt.color;
            ctx.globalAlpha = pt.life;
            ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI*2); ctx.fill();
            pt.x += pt.vx; pt.y += pt.vy; pt.life -= 0.05;
            if (pt.life <= 0) particles.current.splice(i, 1);
          });
          ctx.globalAlpha = 1;

          // Draw Players
          Object.values(latestTick.current.players || {}).forEach((p: any) => {
            const isBoss = p.modeState?.isBoss;
            const radius = isBoss ? 45 : 18;
            
            ctx.shadowBlur = 20; 
            ctx.shadowColor = p.modeState?.team === 'red' ? '#ef4444' : (p.modeState?.team === 'blue' ? '#3b82f6' : '#a855f7');
            if (isBoss) ctx.shadowColor = '#ef4444';
            ctx.fillStyle = ctx.shadowColor;
            
            if (p.modeState?.hp === undefined || p.modeState?.hp > 0) {
              ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI*2); ctx.fill();
              ctx.shadowBlur = 0;
              
              ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'; 
              ctx.fillText(p.name, p.x, p.y - radius - 15);

              if (p.modeState?.maxHp) {
                ctx.fillStyle = 'red'; ctx.fillRect(p.x - 20, p.y - radius - 10, 40, 5);
                ctx.fillStyle = '#10b981'; ctx.fillRect(p.x - 20, p.y - radius - 10, 40 * (p.modeState.hp/p.modeState.maxHp), 5);
              }
            } else {
              ctx.shadowBlur = 0;
              ctx.fillStyle = '#475569';
              ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI*2); ctx.fill();
              ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'; 
              ctx.fillText('DEAD', p.x, p.y);
            }
          });
        }
      }
      animationFrameId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState, mode]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const lines = text.split('\n');
      const parsed = lines.slice(1).map(line => {
        const cols = line.split(',');
        if (cols.length >= 6) {
          return {
            q: cols[0].trim(),
            opts: [cols[1].trim(), cols[2].trim(), cols[3].trim(), cols[4].trim()],
            a: parseInt(cols[5].trim()) - 1
          };
        }
        return null;
      }).filter(Boolean);
      if (parsed.length > 0) setCustomQuestions(parsed);
    };
    reader.readAsText(file);
  };

  const createRoom = () => {
    const questionsToUse = customQuestions.length > 0 ? customQuestions : MOCK_QUESTIONS;
    socket.emit('createRoom', { mode, questions: questionsToUse }, (res: any) => {
      if (res.success) {
        setRoomCode(res.code);
        setGameState('lobby');
      }
    });
  };

  const startGame = () => {
    socket.emit('startGame', { code: roomCode });
    setGameState('playing');
  };

  const kickPlayer = (playerId: string) => {
    socket.emit('kickPlayer', { code: roomCode, playerId });
  };

  return (
    <div className="flex h-screen w-full bg-[#070b18] text-slate-100 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="TolePlay" className="w-9 h-9 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              <span className="text-xl font-black brand-text-sm">TolePlay</span>
            </div>
            <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 text-sm font-bold hover:bg-slate-800/50 px-4 py-2 rounded-xl">
              ← חזור
            </button>
          </div>

          {gameState === 'setup' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-12">
              <div className="text-center">
                <h2 className="text-5xl font-black brand-text mb-4">בחר מצב משחק</h2>
                <p className="text-xl text-slate-400">בחר את החוויה המושלמת עבור התלמידים שלך</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {MODES.map(m => {
                  const Icon = m.icon;
                  const isActive = mode === m.id;
                  return (
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      key={m.id}
                      onClick={() => setMode(m.id)}
                      className={`relative overflow-hidden p-8 rounded-3xl border-2 text-right transition-all ${
                        isActive 
                          ? 'border-indigo-500 shadow-[0_0_40px_rgba(99,102,241,0.3)]' 
                          : 'border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      <div className={`absolute inset-0 bg-gradient-to-br ${m.color} opacity-50`}></div>
                      <div className="relative z-10">
                        <Icon className={`w-14 h-14 mb-6 ${isActive ? m.accent : 'text-slate-500'}`} />
                        <h3 className="text-3xl font-bold mb-3">{m.name}</h3>
                        <p className="text-slate-300 text-lg leading-relaxed">{m.desc}</p>
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              <div className="bg-slate-900/50 p-10 rounded-3xl border border-slate-800 backdrop-blur-sm">
                <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                  <div>
                    <h3 className="text-3xl font-bold mb-4 flex items-center gap-3">
                      <FileText className="text-indigo-400 w-8 h-8" />
                      העלאת שאלות (CSV)
                    </h3>
                    <p className="text-slate-400 text-lg mb-4 max-w-2xl">
                      הכן קובץ CSV עם העמודות הבאות (ללא שורת כותרת):<br/>
                      <code className="bg-slate-950 p-3 rounded-xl text-indigo-300 block mt-4 font-mono border border-slate-800">
                        שאלה, תשובה 1, תשובה 2, תשובה 3, תשובה 4, מספר תשובה נכונה (1-4)
                      </code>
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-4">
                    <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-white py-4 px-8 rounded-2xl font-bold flex items-center gap-3 transition-all border border-slate-600 hover:border-indigo-500">
                      <Upload size={24} />
                      בחר קובץ CSV
                      <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
                    </label>
                    <AnimatePresence>
                      {customQuestions.length > 0 && (
                        <motion.span initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-emerald-400 font-bold bg-emerald-500/10 px-6 py-2 rounded-xl border border-emerald-500/20">
                          נטענו {customQuestions.length} שאלות בהצלחה!
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
              
              <div className="flex justify-center pt-8">
                <motion.button 
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={createRoom}
                  className="py-5 px-16 bg-indigo-600 hover:bg-indigo-500 rounded-full text-2xl font-black shadow-[0_0_40px_rgba(79,70,229,0.5)] transition-all"
                >
                  צור חדר משחק
                </motion.button>
              </div>
            </motion.div>
          )}

          {gameState === 'lobby' && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center max-w-4xl mx-auto">
              <div className="bg-slate-900/60 backdrop-blur-xl rounded-[3rem] p-12 border border-slate-700/30 shadow-[0_0_80px_rgba(99,102,241,0.08)] mb-8">
                <h2 className="text-2xl text-slate-400 mb-6 font-bold uppercase tracking-widest">קוד החדר שלך</h2>
                <div className="text-9xl font-black tracking-widest text-indigo-400 mb-12 select-all drop-shadow-[0_0_40px_rgba(99,102,241,0.4)]">
                  {roomCode}
                </div>
                
                <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
                  {!showTestPlayer && (
                    <button 
                      onClick={() => setShowTestPlayer(true)}
                      className="py-4 px-8 bg-slate-800 hover:bg-slate-700 rounded-2xl font-bold flex items-center gap-3 transition-all text-xl border border-slate-700"
                    >
                      בחן משחק (טסט)
                    </button>
                  )}
                  <button 
                    onClick={startGame}
                    disabled={players.length === 0}
                    className={`py-4 px-12 rounded-2xl font-black flex items-center gap-3 transition-all text-2xl shadow-xl ${
                      players.length > 0 
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/30' 
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <Play size={28} fill="currentColor" />
                    התחל משחק
                  </button>
                </div>
              </div>
              
              <div className="bg-slate-900/50 rounded-3xl p-8 border border-slate-800">
                <h3 className="text-2xl font-bold flex items-center justify-center gap-3 mb-8">
                  <Users className="text-indigo-400 w-8 h-8" />
                  שחקנים מחוברים ({players.length})
                </h3>
                
                <div className="flex flex-wrap gap-4 justify-center">
                  {players.length === 0 ? (
                    <p className="text-slate-500 text-lg italic">ממתין לשחקנים שיצטרפו...</p>
                  ) : (
                    <AnimatePresence>
                      {players.map(p => (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          key={p.id} 
                          className="bg-slate-800 px-6 py-3 rounded-2xl font-bold text-lg shadow-md border border-slate-700 flex items-center gap-3 group"
                        >
                          {p.name}
                          <button 
                            onClick={() => kickPlayer(p.id)}
                            className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="הוצא שחקן"
                          >
                            <XCircle size={20} />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {gameState === 'playing' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-[calc(100vh-8rem)] flex flex-col">
              <div className="flex justify-between items-center mb-6 bg-slate-900/80 p-6 rounded-3xl border border-slate-800 backdrop-blur-md">
                <div className="flex items-center gap-4">
                  <img src="/logo.png" alt="TolePlay" className="w-8 h-8 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  <h2 className="text-3xl font-black text-indigo-400">המשחק פעיל</h2>
                  <span className="bg-slate-800 px-4 py-1 rounded-full text-sm font-bold border border-slate-700">
                    {MODES.find(m => m.id === mode)?.name}
                  </span>
                </div>
                <div className="flex items-center gap-6">
                  {!showTestPlayer && (
                    <button 
                      onClick={() => setShowTestPlayer(true)}
                      className="py-2 px-6 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold text-sm transition-all border border-slate-700"
                    >
                      פתח מסך בדיקה
                    </button>
                  )}
                  <div className="text-2xl font-black font-mono bg-slate-950 px-8 py-3 rounded-2xl border-2 border-indigo-500/30 shadow-[0_0_20px_rgba(99,102,241,0.2)]">
                    קוד: <span className="text-indigo-400">{roomCode}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                <div className="lg:col-span-2 bg-slate-900/80 rounded-3xl p-6 border border-slate-800 shadow-2xl flex flex-col">
                  <h3 className="text-xl font-bold mb-4 text-slate-400 uppercase tracking-wider">מפת המשחק</h3>
                  <div className="flex-1 bg-slate-950 rounded-2xl overflow-hidden border-2 border-slate-800 relative">
                    <canvas 
                      ref={canvasRef} 
                      width={1000} 
                      height={1000} 
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>

                <div className="bg-slate-900/80 rounded-3xl p-6 border border-slate-800 shadow-2xl flex flex-col">
                  <h3 className="text-xl font-bold mb-6 text-slate-400 uppercase tracking-wider flex items-center justify-between">
                    <span>טבלת מובילים</span>
                    <Trophy size={20} className="text-yellow-400" />
                  </h3>
                  
                  {mode === 'ctf' && (
                    <div className="flex justify-between mb-8 bg-slate-950 p-6 rounded-2xl border border-slate-800">
                      <div className="text-center">
                        <div className="text-5xl font-black text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]">{latestTick.current?.globalState?.redScore || 0}</div>
                        <div className="text-slate-400 font-bold mt-2">קבוצה אדומה</div>
                      </div>
                      <div className="w-px bg-slate-800"></div>
                      <div className="text-center">
                        <div className="text-5xl font-black text-blue-500 drop-shadow-[0_0_15px_rgba(59,130,246,0.5)]">{latestTick.current?.globalState?.blueScore || 0}</div>
                        <div className="text-slate-400 font-bold mt-2">קבוצה כחולה</div>
                      </div>
                    </div>
                  )}

                  {mode === 'boss' && latestTick.current?.globalState?.timeLeft !== undefined && (
                    <div className="mb-8 bg-slate-950 p-6 rounded-2xl border border-slate-800 text-center">
                      <div className="text-slate-400 font-bold mb-2">זמן נותר</div>
                      <div className="text-5xl font-black text-indigo-400 font-mono">
                        {Math.floor(latestTick.current.globalState.timeLeft / 60)}:{(latestTick.current.globalState.timeLeft % 60).toString().padStart(2, '0')}
                      </div>
                    </div>
                  )}

                  <div className="space-y-3 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                    {[...players].sort((a, b) => (mode === 'farm' ? b.score - a.score : b.resources - a.resources)).map((p, i) => (
                      <motion.div 
                        layout
                        key={p.id} 
                        className={`flex items-center justify-between p-4 rounded-2xl border ${
                          i === 0 ? 'bg-indigo-900/30 border-indigo-500/30' : 'bg-slate-800/50 border-slate-700/50'
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <span className={`text-2xl font-black w-8 ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-slate-600'}`}>
                            {i + 1}
                          </span>
                          <span className="text-lg font-bold flex items-center gap-2">
                            {p.modeState?.isBoss && <Trophy className="text-red-500 w-5 h-5"/>}
                            {p.name}
                          </span>
                        </div>
                        <div className="text-xl font-mono text-emerald-400 font-black">
                          {(mode === 'farm' ? p.score : p.resources).toLocaleString()}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {gameState === 'ended' && (
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center py-20">
              <div className="relative inline-block mb-12">
                <div className="absolute inset-0 bg-yellow-400 blur-[100px] opacity-20 rounded-full"></div>
                <Trophy className="w-48 h-48 text-yellow-400 relative z-10 drop-shadow-[0_0_50px_rgba(250,204,21,0.5)]" />
              </div>
              <h2 className="text-8xl font-black mb-6 text-transparent bg-clip-text bg-gradient-to-br from-yellow-300 via-amber-400 to-orange-500">המשחק נגמר!</h2>
              <p className="text-5xl text-indigo-200 mb-16 font-bold drop-shadow-lg">המנצח: {winner}</p>
              <button 
                onClick={() => {
                  setGameState('setup');
                  setRoomCode(null);
                }}
                className="py-5 px-16 bg-indigo-600 hover:bg-indigo-500 rounded-full text-2xl font-black shadow-[0_0_40px_rgba(79,70,229,0.5)] transition-all active:scale-95"
              >
                חזור ללובי הראשי
              </button>
            </motion.div>
          )}
        </div>
      </div>
      {showTestPlayer && roomCode && (
        <div className="w-[400px] border-r border-slate-800/50 bg-[#0a0f1e] shadow-2xl flex-shrink-0 relative z-50">
          <div className="absolute top-0 left-0 right-0 bg-indigo-600 text-white text-center py-2 text-sm font-bold z-50 shadow-md flex justify-between px-4">
            <span>מצב בדיקה (תצוגת שחקן)</span>
            <button onClick={() => setShowTestPlayer(false)} className="hover:text-indigo-200"><XCircle size={16}/></button>
          </div>
          <div className="h-full pt-10">
            <PlayerView onBack={() => setShowTestPlayer(false)} initialCode={roomCode} initialName="מורה (טסט)" autoJoin={true} />
          </div>
        </div>
      )}
    </div>
  );
}

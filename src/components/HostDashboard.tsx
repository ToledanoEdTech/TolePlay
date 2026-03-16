import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { socket } from '../socket';
import { Users, Play, Trophy, Shield, Rocket, Target, DollarSign, Upload, FileText, XCircle, Plus, Trash2, Edit3, Save, LogIn, LogOut, BookOpen } from 'lucide-react';
import { CTF_MAP } from '../engine/maps/ctfMap';
import { useAuth } from '../contexts/AuthContext';
import { AuthModal } from './AuthModal';
import { saveQuiz, loadQuizzes, type SavedQuiz, type QuizQuestion } from '../utils/quizStorage';

const MODES = [
  { id: 'zombie', name: 'הגנת זומבים', icon: Shield, desc: 'הגנו על הבסיס מגלי זומבים. ענו על שאלות כדי לקנות נשקים וצריחים.', color: 'from-slate-800 to-slate-900', accent: 'text-blue-400' },
  { id: 'economy', name: 'מרתון כלכלי', icon: DollarSign, desc: 'מי שאוסף הכי הרבה זהב מנצח! אספו מטבעות במפה וענו על שאלות.', color: 'from-emerald-900 to-slate-900', accent: 'text-yellow-400' },
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

type QuizSourceTab = 'upload' | 'edit' | 'saved';

export function HostDashboard({ onBack }: { onBack: () => void }) {
  const { user, isAuthAvailable, signOut } = useAuth();
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mode, setMode] = useState<string>('zombie');
  const [players, setPlayers] = useState<any[]>([]);
  const [gameState, setGameState] = useState<'setup' | 'lobby' | 'playing' | 'ended'>('setup');
  const [globalState, setGlobalState] = useState<any>({});
  const [winner, setWinner] = useState<string | null>(null);
  const [gameOverPayload, setGameOverPayload] = useState<{ winner: string; mode?: string; players?: { id: string; name: string; kills: number; score: number; correctAnswers: number }[] } | null>(null);
  const [customQuestions, setCustomQuestions] = useState<any[]>([]);
  const [quizSourceTab, setQuizSourceTab] = useState<QuizSourceTab>('upload');
  const [savedQuizzes, setSavedQuizzes] = useState<SavedQuiz[]>([]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [saveQuizTitle, setSaveQuizTitle] = useState('');
  const [savingQuiz, setSavingQuiz] = useState(false);
  const showTestPlayer = false; // Legacy - kept to prevent ReferenceError from cached builds

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestTick = useRef<any>(null);
  const particles = useRef<any[]>([]);

  useEffect(() => {
    const onRoomUpdated = (room: any) => {
      setPlayers(Object.values(room.players));
      if (room.mode === 'boss' && room.globalState) setGlobalState(room.globalState);
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
    const onGameOver = (data: any) => { setGameState('ended'); setWinner(data?.winner ?? null); setGameOverPayload(data ?? null); };

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
    let t = 0;

    const render = () => {
      const canvas = canvasRef.current;
      if (canvas && latestTick.current) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          t += 1 / 60;

          // Themed background
          if (mode === 'farm') {
            const bg = ctx.createLinearGradient(0, 0, 0, 1000);
            bg.addColorStop(0, '#020210'); bg.addColorStop(0.5, '#0a0a2e'); bg.addColorStop(1, '#020210');
            ctx.fillStyle = bg; ctx.fillRect(0, 0, 1000, 1000);
          } else if (mode === 'ctf') {
            ctx.fillStyle = '#0a0f1e'; ctx.fillRect(0, 0, 1000, 1000);
          } else if (mode === 'zombie') {
            const bg = ctx.createRadialGradient(500, 500, 0, 500, 500, 700);
            bg.addColorStop(0, '#111318'); bg.addColorStop(1, '#08090d');
            ctx.fillStyle = bg; ctx.fillRect(0, 0, 1000, 1000);
          } else {
            ctx.fillStyle = '#0a1628'; ctx.fillRect(0, 0, 1000, 1000);
          }

          // Subtle grid
          ctx.strokeStyle = mode === 'farm' ? '#0f0f30' : '#131a2e';
          ctx.lineWidth = 1;
          for (let i = 0; i <= 1000; i += 80) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 1000); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(1000, i); ctx.stroke();
          }

          const gs = latestTick.current.globalState;

          if (mode === 'zombie') {
            // Bunker base (octagon)
            const bx = 500, by = 500;
            const hpPct = (gs?.baseHealth || 0) / (gs?.maxBaseHealth || 2000);

            // Range rings
            for (let r = 100; r <= 400; r += 100) {
              ctx.strokeStyle = `rgba(59,130,246,${0.03 + 0.02 * Math.sin(t + r * 0.01)})`;
              ctx.lineWidth = 0.5;
              ctx.setLineDash([4, 8]);
              ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.stroke();
            }
            ctx.setLineDash([]);

            // Bunker shape
            ctx.fillStyle = '#1e293b'; ctx.strokeStyle = '#334155'; ctx.lineWidth = 3;
            ctx.beginPath();
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2 - Math.PI / 8;
              const px = bx + Math.cos(a) * 55, py = by + Math.sin(a) * 55;
              i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.closePath(); ctx.fill(); ctx.stroke();

            ctx.fillStyle = '#1e40af'; ctx.shadowBlur = 20; ctx.shadowColor = '#3b82f6';
            ctx.beginPath(); ctx.arc(bx, by, 28, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;

            // HP bar
            ctx.fillStyle = '#1f2937'; ctx.fillRect(450, 420, 100, 8);
            ctx.fillStyle = hpPct > 0.5 ? '#22c55e' : hpPct > 0.25 ? '#eab308' : '#ef4444';
            ctx.fillRect(450, 420, 100 * hpPct, 8);

            // Turrets (detailed)
            gs?.turrets?.forEach((tur: any) => {
              ctx.fillStyle = '#374151'; ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 1.5;
              ctx.fillRect(tur.x - 12, tur.y - 12, 24, 24);
              ctx.strokeRect(tur.x - 12, tur.y - 12, 24, 24);
              ctx.fillStyle = '#22d3ee'; ctx.shadowBlur = 6; ctx.shadowColor = '#22d3ee';
              ctx.beginPath(); ctx.arc(tur.x, tur.y, 5, 0, Math.PI * 2); ctx.fill();
              ctx.shadowBlur = 0;
              ctx.strokeStyle = 'rgba(34,211,238,0.06)';
              ctx.setLineDash([3, 6]);
              ctx.beginPath(); ctx.arc(tur.x, tur.y, 150, 0, Math.PI * 2); ctx.stroke();
              ctx.setLineDash([]);
            });

            // Zombies (humanoid shape)
            gs?.zombies?.forEach((z: any) => {
              const green = z.hp / z.maxHp > 0.5 ? '#16a34a' : '#15803d';
              ctx.fillStyle = green;
              ctx.beginPath(); ctx.ellipse(z.x, z.y, 10, 14, 0, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = green;
              ctx.beginPath(); ctx.arc(z.x, z.y - 14, 8, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = '#ef4444'; ctx.shadowBlur = 4; ctx.shadowColor = '#ef4444';
              ctx.beginPath(); ctx.arc(z.x - 3, z.y - 15, 2, 0, Math.PI * 2); ctx.fill();
              ctx.beginPath(); ctx.arc(z.x + 3, z.y - 15, 2, 0, Math.PI * 2); ctx.fill();
              ctx.shadowBlur = 0;
              ctx.fillStyle = '#1f2937'; ctx.fillRect(z.x - 12, z.y - 28, 24, 4);
              const zpct = z.hp / z.maxHp;
              ctx.fillStyle = zpct > 0.5 ? '#22c55e' : zpct > 0.25 ? '#eab308' : '#ef4444';
              ctx.fillRect(z.x - 12, z.y - 28, 24 * zpct, 4);
            });

          } else if (mode === 'economy') {
            const econScale = 1000 / 4000;
            (gs?.collectibles || []).forEach((c: any) => {
              const px = c.x * econScale, py = c.y * econScale;
              const isChest = c.type === 'treasure_chest';
              const isCoins = c.type === 'coin_pile';
              const r = isChest ? 14 : isCoins ? 10 : 8;
              ctx.shadowBlur = 12; ctx.shadowColor = '#facc15';
              ctx.fillStyle = isChest ? '#f59e0b' : isCoins ? '#facc15' : '#4ade80';
              ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
              ctx.shadowBlur = 0;
              ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              ctx.fillText('$', px, py);
            });

          } else if (mode === 'farm') {
            // Stars background
            for (let i = 0; i < 60; i++) {
              const sx = ((i * 137.5) % 1000), sy = ((i * 211.3 + t * (i % 3 + 1) * 0.5) % 1000);
              ctx.globalAlpha = 0.3 + 0.2 * Math.sin(t + i);
              ctx.fillStyle = '#a5b4fc';
              ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalAlpha = 1;

            gs?.asteroids?.forEach((a: any) => {
              const val = a.value || 50;
              const size = 18 + (val / 150) * 14;
              const color = val > 100 ? '#c084fc' : val > 70 ? '#7dd3fc' : '#6b7280';
              ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
              ctx.beginPath();
              for (let i = 0; i < 8; i++) {
                const ang = (i / 8) * Math.PI * 2;
                const r = size * (0.7 + Math.sin(i * 3.7) * 0.15 + 0.15);
                const px = a.x + Math.cos(ang) * r, py = a.y + Math.sin(ang) * r;
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
              }
              ctx.closePath(); ctx.fill(); ctx.stroke();
              ctx.fillStyle = '#1f2937'; ctx.fillRect(a.x - size, a.y - size - 8, size * 2, 4);
              ctx.fillStyle = a.hp / a.maxHp > 0.5 ? color : '#ef4444';
              ctx.fillRect(a.x - size, a.y - size - 8, size * 2 * (a.hp / a.maxHp), 4);
            });

          } else if (mode === 'ctf') {
            // Scale 2000x1500 world → 1000x1000 canvas
            ctx.save();
            ctx.scale(1000 / CTF_MAP.width, 1000 / CTF_MAP.height);

            // Zone gradients
            const rg = ctx.createLinearGradient(0, 0, CTF_MAP.width * 0.48, 0);
            rg.addColorStop(0, 'rgba(220,38,38,0.06)'); rg.addColorStop(1, 'transparent');
            ctx.fillStyle = rg; ctx.fillRect(0, 0, CTF_MAP.width / 2, CTF_MAP.height);
            const bg = ctx.createLinearGradient(CTF_MAP.width, 0, CTF_MAP.width * 0.52, 0);
            bg.addColorStop(0, 'rgba(37,99,235,0.06)'); bg.addColorStop(1, 'transparent');
            ctx.fillStyle = bg; ctx.fillRect(CTF_MAP.width / 2, 0, CTF_MAP.width / 2, CTF_MAP.height);

            // Walls
            ctx.fillStyle = '#1e293b';
            CTF_MAP.obstacles.forEach(o => ctx.fillRect(o.x, o.y, o.w, o.h));

            // Center divider
            ctx.strokeStyle = 'rgba(148,163,184,0.15)'; ctx.lineWidth = 4;
            ctx.setLineDash([12, 12]);
            ctx.beginPath(); ctx.moveTo(CTF_MAP.width / 2, 0); ctx.lineTo(CTF_MAP.width / 2, CTF_MAP.height); ctx.stroke();
            ctx.setLineDash([]);

            // Hex bases
            ['red', 'blue'].forEach(team => {
              const bx = team === 'red' ? CTF_MAP.redFlag.x : CTF_MAP.blueFlag.x;
              const by = team === 'red' ? CTF_MAP.redFlag.y : CTF_MAP.blueFlag.y;
              const color = team === 'red' ? '#ef4444' : '#3b82f6';
              ctx.fillStyle = `${color}20`; ctx.strokeStyle = `${color}50`; ctx.lineWidth = 4;
              ctx.beginPath();
              for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
                const px = bx + Math.cos(a) * 80, py = by + Math.sin(a) * 80;
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
              }
              ctx.closePath(); ctx.fill(); ctx.stroke();
              ctx.fillStyle = `${color}40`; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
              ctx.fillText('BASE', bx, by + 40);
            });

            // Flags
            const drawHostFlag = (x: number, y: number, color: string) => {
              ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 4;
              ctx.beginPath(); ctx.moveTo(x, y + 20); ctx.lineTo(x, y - 20); ctx.stroke();
              ctx.fillStyle = color; ctx.shadowBlur = 12; ctx.shadowColor = color;
              const wave = Math.sin(t * 4) * 3;
              ctx.beginPath();
              ctx.moveTo(x, y - 20);
              ctx.lineTo(x + 28 + wave, y - 10);
              ctx.lineTo(x, y);
              ctx.closePath(); ctx.fill();
              ctx.shadowBlur = 0;
            };
            if (gs?.redFlag) drawHostFlag(gs.redFlag.x, gs.redFlag.y, '#ef4444');
            if (gs?.blueFlag) drawHostFlag(gs.blueFlag.x, gs.blueFlag.y, '#3b82f6');
            ctx.restore();
          }

          // Coordinate scaling (world coords → canvas coords)
          const isCtf = mode === 'ctf';
          const isEconomy = mode === 'economy';
          const csx = isCtf ? 1000 / CTF_MAP.width : isEconomy ? 1000 / 4000 : 1;
          const csy = isCtf ? 1000 / CTF_MAP.height : isEconomy ? 1000 / 4000 : 1;

          // Lasers (enhanced beam)
          gs?.lasers?.forEach((l: any) => {
            const color = l.color || '#eab308';
            ctx.save(); ctx.lineCap = 'round';
            ctx.shadowBlur = 12; ctx.shadowColor = color;
            ctx.strokeStyle = color + '60'; ctx.lineWidth = 8;
            ctx.beginPath(); ctx.moveTo(l.x1 * csx, l.y1 * csy); ctx.lineTo(l.x2 * csx, l.y2 * csy); ctx.stroke();
            ctx.strokeStyle = color; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(l.x1 * csx, l.y1 * csy); ctx.lineTo(l.x2 * csx, l.y2 * csy); ctx.stroke();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(l.x1 * csx, l.y1 * csy); ctx.lineTo(l.x2 * csx, l.y2 * csy); ctx.stroke();
            ctx.shadowBlur = 0; ctx.restore();

            for (let i = 0; i < 3; i++) {
              particles.current.push({
                x: l.x2 * csx, y: l.y2 * csy,
                vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8,
                life: 1, color
              });
            }
          });

          // Particles
          particles.current = particles.current.filter((pt) => {
            ctx.fillStyle = pt.color || '#fff';
            ctx.globalAlpha = pt.life;
            ctx.beginPath(); ctx.arc(pt.x, pt.y, 3 * pt.life, 0, Math.PI * 2); ctx.fill();
            pt.x += pt.vx; pt.y += pt.vy; pt.life -= 0.04;
            return pt.life > 0;
          });
          ctx.globalAlpha = 1;

          // Players (styled per mode)
          Object.values(latestTick.current.players || {}).forEach((p: any) => {
            const isBoss = p.modeState?.isBoss;
            const alive = p.modeState?.hp === undefined || p.modeState?.hp > 0;
            const pTeam = p.modeState?.team;
            const color = pTeam === 'red' ? '#ef4444' : pTeam === 'blue' ? '#3b82f6' : (isBoss ? '#ef4444' : '#a855f7');
            const px = p.x * csx, py = p.y * csy;

            if (!alive) {
              ctx.globalAlpha = 0.2; ctx.fillStyle = '#475569';
              ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill();
              ctx.globalAlpha = 1;
              return;
            }

            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.beginPath(); ctx.ellipse(px, py + 16, 12, 4, 0, 0, Math.PI * 2); ctx.fill();

            if (isBoss) {
              ctx.fillStyle = '#4c1d95'; ctx.shadowBlur = 20; ctx.shadowColor = '#ef4444';
              ctx.beginPath();
              ctx.moveTo(px - 30, py - 10);
              ctx.quadraticCurveTo(px, py - 40, px + 30, py - 10);
              ctx.quadraticCurveTo(px + 35, py + 15, px + 25, py + 35);
              ctx.quadraticCurveTo(px, py + 45, px - 25, py + 35);
              ctx.quadraticCurveTo(px - 35, py + 15, px - 30, py - 10);
              ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
              ctx.fillStyle = '#f59e0b'; ctx.shadowBlur = 6; ctx.shadowColor = '#f59e0b';
              ctx.beginPath(); ctx.ellipse(px - 10, py - 5, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
              ctx.beginPath(); ctx.ellipse(px + 10, py - 5, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
              ctx.shadowBlur = 0;
            } else {
              ctx.fillStyle = color; ctx.shadowBlur = 12; ctx.shadowColor = color;
              ctx.beginPath(); ctx.ellipse(px, py, 10, 14, 0, 0, Math.PI * 2); ctx.fill();
              ctx.shadowBlur = 0;
              ctx.fillStyle = '#fcd34d';
              ctx.beginPath(); ctx.arc(px, py - 16, 7, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = '#1e293b';
              ctx.beginPath(); ctx.arc(px - 2.5, py - 17, 1.5, 0, Math.PI * 2); ctx.fill();
              ctx.beginPath(); ctx.arc(px + 2.5, py - 17, 1.5, 0, Math.PI * 2); ctx.fill();
            }

            ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(p.name, px, py - (isBoss ? 50 : 28));

            if (p.modeState?.maxHp) {
              const barY = py - (isBoss ? 45 : 24);
              const barW = isBoss ? 60 : 30;
              ctx.fillStyle = '#1f2937'; ctx.fillRect(px - barW / 2, barY, barW, 4);
              const hpPct = p.modeState.hp / p.modeState.maxHp;
              ctx.fillStyle = hpPct > 0.5 ? '#22c55e' : hpPct > 0.25 ? '#eab308' : '#ef4444';
              ctx.fillRect(px - barW / 2, barY, barW * hpPct, 4);
            }

            if (p.modeState?.hasFlag) {
              const flagColor = pTeam === 'red' ? '#3b82f6' : '#ef4444';
              ctx.fillStyle = flagColor; ctx.shadowBlur = 6; ctx.shadowColor = flagColor;
              ctx.beginPath();
              ctx.moveTo(px + 10, py - 20);
              ctx.lineTo(px + 22, py - 14);
              ctx.lineTo(px + 10, py - 8);
              ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
            }
          });
        }
      }
      animationFrameId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState, mode]);

  useEffect(() => {
    if (user && isAuthAvailable) {
      loadQuizzes(user.uid).then(setSavedQuizzes);
    } else {
      setSavedQuizzes([]);
    }
  }, [user, isAuthAvailable]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      let lines = text.split('\n').filter(line => line.trim());
      const isHeaderRow = (cols: string[]) =>
        cols.length >= 2 &&
        (cols[0].trim() === 'שאלה' || cols[0].toLowerCase() === 'question') &&
        (cols[1].includes('תשובה') || cols[1].toLowerCase().includes('answer'));
      if (lines.length > 0) {
        const firstCols = lines[0].split(',').map(c => c.trim());
        if (firstCols.length >= 6 && isHeaderRow(firstCols)) {
          lines = lines.slice(1);
        }
      }
      const parsed = lines.map(line => {
        const cols = line.split(',').map(c => c.trim());
        if (cols.length >= 6) {
          return {
            q: cols[0],
            opts: [cols[1], cols[2], cols[3], cols[4]],
            a: Math.max(0, Math.min(3, parseInt(cols[5]) - 1))
          };
        }
        return null;
      }).filter(Boolean) as QuizQuestion[];
      if (parsed.length > 0) {
        setCustomQuestions(parsed);
        setQuizSourceTab('upload');
      }
    };
    reader.readAsText(file);
  };

  const addQuestion = () => {
    setCustomQuestions(prev => [...prev, { q: '', opts: ['', '', '', ''], a: 0 }]);
    setQuizSourceTab('edit');
  };

  const updateQuestion = (idx: number, field: 'q' | 'opts' | 'a', value: any) => {
    setCustomQuestions(prev => {
      const next = [...prev];
      if (field === 'q') next[idx] = { ...next[idx], q: value };
      else if (field === 'opts') next[idx] = { ...next[idx], opts: value };
      else next[idx] = { ...next[idx], a: value };
      return next;
    });
  };

  const removeQuestion = (idx: number) => {
    setCustomQuestions(prev => prev.filter((_, i) => i !== idx));
  };

  const loadSavedQuiz = (quiz: SavedQuiz) => {
    setCustomQuestions(quiz.questions);
    setSaveQuizTitle(quiz.title);
  };

  const handleSaveQuiz = async () => {
    if (!user || customQuestions.length === 0) return;
    const title = saveQuizTitle.trim() || `חידון ${new Date().toLocaleDateString('he-IL')}`;
    setSavingQuiz(true);
    try {
      await saveQuiz(user.uid, { title, questions: customQuestions });
      setSavedQuizzes(prev => [...prev, { title, questions: customQuestions, createdAt: Date.now(), updatedAt: Date.now() }]);
    } finally {
      setSavingQuiz(false);
    }
  };

  const createRoom = () => {
    const questionsToUse = customQuestions.length > 0 ? customQuestions : MOCK_QUESTIONS;
    socket.emit('createRoom', { mode, questions: questionsToUse }, (res: any) => {
      if (res.success) {
        setRoomCode(res.code);
        setGameState('lobby');
        if (res.room?.globalState) setGlobalState(res.room.globalState);
        if (res.room?.players) setPlayers(Object.values(res.room.players));
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
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-3xl font-bold flex items-center gap-3">
                    <FileText className="text-indigo-400 w-8 h-8" />
                    שאלות לחידון
                  </h3>
                  {isAuthAvailable && (
                    <div className="flex items-center gap-3">
                      {user ? (
                        <>
                          <span className="text-slate-400 text-sm">{user.email || user.displayName}</span>
                          <button onClick={() => signOut()} className="text-slate-400 hover:text-white flex items-center gap-2 text-sm">
                            <LogOut size={18} /> התנתק
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setShowAuthModal(true)} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-xl font-bold text-sm">
                          <LogIn size={18} /> התחבר לשמירת חידונים
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 mb-6">
                  <button
                    onClick={() => setQuizSourceTab('upload')}
                    className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all ${quizSourceTab === 'upload' ? 'bg-indigo-600' : 'bg-slate-800 hover:bg-slate-700'}`}
                  >
                    <Upload size={20} /> העלאת קובץ CSV
                  </button>
                  <button
                    onClick={() => setQuizSourceTab('edit')}
                    className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all ${quizSourceTab === 'edit' ? 'bg-indigo-600' : 'bg-slate-800 hover:bg-slate-700'}`}
                  >
                    <Edit3 size={20} /> כתיבת חידון
                  </button>
                  {user && (
                    <button
                      onClick={() => setQuizSourceTab('saved')}
                      className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all ${quizSourceTab === 'saved' ? 'bg-indigo-600' : 'bg-slate-800 hover:bg-slate-700'}`}
                    >
                      <BookOpen size={20} /> החידונים שלי ({savedQuizzes.length})
                    </button>
                  )}
                </div>

                {quizSourceTab === 'upload' && (
                  <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                    <div>
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
                )}

                {quizSourceTab === 'edit' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <button onClick={addQuestion} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded-xl font-bold">
                        <Plus size={20} /> הוסף שאלה
                      </button>
                      {user && customQuestions.length > 0 && (
                        <div className="flex items-center gap-3">
                          <input
                            type="text"
                            value={saveQuizTitle}
                            onChange={(e) => setSaveQuizTitle(e.target.value)}
                            placeholder="שם החידון (לשמירה)"
                            className="bg-slate-800 border border-slate-600 rounded-xl px-4 py-2 w-48"
                          />
                          <button onClick={handleSaveQuiz} disabled={savingQuiz} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-xl font-bold disabled:opacity-50">
                            <Save size={18} /> שמור חידון
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto space-y-4 custom-scrollbar">
                      {customQuestions.length === 0 ? (
                        <p className="text-slate-500 text-center py-8">לחץ "הוסף שאלה" כדי להתחיל לכתוב חידון</p>
                      ) : (
                        customQuestions.map((q, idx) => (
                          <div key={idx} className="bg-slate-800/80 p-5 rounded-2xl border border-slate-700">
                            <div className="flex justify-between items-start gap-4 mb-3">
                              <input
                                value={q.q}
                                onChange={(e) => updateQuestion(idx, 'q', e.target.value)}
                                placeholder="טקסט השאלה"
                                className="flex-1 bg-slate-950 border border-slate-600 rounded-xl px-4 py-2"
                              />
                              <button onClick={() => removeQuestion(idx)} className="text-red-400 hover:text-red-300 p-1">
                                <Trash2 size={20} />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              {q.opts.map((opt, oi) => (
                                <label key={oi} className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`correct-${idx}`}
                                    checked={q.a === oi}
                                    onChange={() => updateQuestion(idx, 'a', oi)}
                                    className="accent-emerald-500"
                                  />
                                  <input
                                    value={opt}
                                    onChange={(e) => updateQuestion(idx, 'opts', q.opts.map((o, i) => i === oi ? e.target.value : o))}
                                    placeholder={`תשובה ${oi + 1}`}
                                    className="flex-1 bg-slate-950 border border-slate-600 rounded-lg px-3 py-1.5 text-sm"
                                  />
                                </label>
                              ))}
                            </div>
                            <span className="text-slate-500 text-xs">✓ סימן את התשובה הנכונה</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {quizSourceTab === 'saved' && user && (
                  <div className="space-y-3 max-h-60 overflow-y-auto custom-scrollbar">
                    {savedQuizzes.length === 0 ? (
                      <p className="text-slate-500 text-center py-8">אין לך חידונים שמורים. צור חידון ולחץ "שמור חידון"</p>
                    ) : (
                      savedQuizzes.map((quiz) => (
                        <button
                          key={quiz.id || quiz.title}
                          onClick={() => loadSavedQuiz(quiz)}
                          className="w-full text-right bg-slate-800 hover:bg-slate-700 p-4 rounded-xl border border-slate-700 flex justify-between items-center"
                        >
                          <span className="font-bold">{quiz.title}</span>
                          <span className="text-slate-400 text-sm">{quiz.questions.length} שאלות</span>
                        </button>
                      ))
                    )}
                  </div>
                )}

                <AnimatePresence>
                  {customQuestions.length > 0 && quizSourceTab !== 'edit' && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 text-emerald-400 font-bold">
                      {customQuestions.length} שאלות מוכנות למשחק
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} onSuccess={() => { /* useEffect loads quizzes when user updates */ }} />}
              
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
                
                {mode === 'boss' && (
                  <div className="mb-8 p-6 bg-slate-950/80 rounded-2xl border border-slate-700">
                    <h4 className="text-lg font-bold text-slate-300 mb-4 flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-red-400" />
                      מצב משחק
                    </h4>
                    <div className="flex flex-col gap-4 mb-6">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="radio"
                          name="bossMode"
                          checked={globalState?.useAiBoss !== false}
                          onChange={() => socket.emit('setBossUseAi', { code: roomCode, useAiBoss: true })}
                          className="w-4 h-4 accent-indigo-500"
                        />
                        <span className="font-bold">בוס בוט – כולם גיבורים נגד מפלצת AI</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="radio"
                          name="bossMode"
                          checked={globalState?.useAiBoss === false}
                          onChange={() => socket.emit('setBossUseAi', { code: roomCode, useAiBoss: false })}
                          className="w-4 h-4 accent-indigo-500"
                        />
                        <span className="font-bold">בוס שחקן – שחקן אחד בוס נגד גיבורים</span>
                      </label>
                    </div>
                    {globalState?.useAiBoss === false && (
                    <>
                    <h4 className="text-lg font-bold text-slate-300 mb-4 flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-red-400" />
                      בחר מי יהיה הבוס ומי גיבור
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-red-950/40 rounded-xl p-5 border-2 border-red-500/30">
                        <div className="text-red-400 font-bold mb-3 flex items-center gap-2">
                          <div className="w-4 h-4 rounded-full bg-red-500" /> בוס
                        </div>
                        <div className="space-y-2 min-h-[60px]">
                          {players.filter((p: any) => p.modeState?.isBoss).map((p: any) => (
                            <div key={p.id} className="flex items-center justify-between bg-slate-800/80 px-4 py-2 rounded-lg group">
                              <span className="font-bold">{p.name}</span>
                              <div className="flex gap-2">
                                <button onClick={() => socket.emit('assignBossRole', { code: roomCode, playerId: p.id, isBoss: false })}
                                  className="text-xs px-3 py-1 rounded-lg bg-blue-600/60 hover:bg-blue-500 text-blue-200 font-bold transition-colors">
                                  → גיבור
                                </button>
                                <button onClick={() => kickPlayer(p.id)} className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="הוצא שחקן">
                                  <XCircle size={18} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="bg-blue-950/40 rounded-xl p-5 border-2 border-blue-500/30">
                        <div className="text-blue-400 font-bold mb-3 flex items-center gap-2">
                          <div className="w-4 h-4 rounded-full bg-blue-500" /> גיבורים
                        </div>
                        <div className="space-y-2 min-h-[60px]">
                          {players.filter((p: any) => !p.modeState?.isBoss).map((p: any) => (
                            <div key={p.id} className="flex items-center justify-between bg-slate-800/80 px-4 py-2 rounded-lg group">
                              <span className="font-bold">{p.name}</span>
                              <div className="flex gap-2">
                                <button onClick={() => socket.emit('assignBossRole', { code: roomCode, playerId: p.id, isBoss: true })}
                                  className="text-xs px-3 py-1 rounded-lg bg-red-600/60 hover:bg-red-500 text-red-200 font-bold transition-colors">
                                  → בוס
                                </button>
                                <button onClick={() => kickPlayer(p.id)} className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="הוצא שחקן">
                                  <XCircle size={18} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    </>
                    )}
                  </div>
                )}

                {mode === 'ctf' && (
                  <div className="mb-8 p-6 bg-slate-950/80 rounded-2xl border border-slate-700">
                    <h4 className="text-lg font-bold text-slate-300 mb-4 flex items-center gap-2">
                      <Target className="w-5 h-5 text-indigo-400" />
                      סידור קבוצות – גרור שחקנים בין הקבוצות
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-red-950/40 rounded-xl p-5 border-2 border-red-500/30">
                        <div className="text-red-400 font-bold mb-3 flex items-center gap-2">
                          <div className="w-4 h-4 rounded-full bg-red-500" /> קבוצה אדומה
                        </div>
                        <div className="space-y-2 min-h-[60px]">
                          {players.filter((p: any) => p.modeState?.team === 'red').map((p: any) => (
                            <div key={p.id} className="flex items-center justify-between bg-slate-800/80 px-4 py-2 rounded-lg group">
                              <span className="font-bold">{p.name}</span>
                              <div className="flex gap-2">
                                <button onClick={() => socket.emit('assignTeam', { code: roomCode, playerId: p.id, team: 'blue' })}
                                  className="text-xs px-3 py-1 rounded-lg bg-blue-600/60 hover:bg-blue-500 text-blue-200 font-bold transition-colors">
                                  → כחול
                                </button>
                                <button onClick={() => kickPlayer(p.id)} className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="הוצא שחקן">
                                  <XCircle size={18} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="bg-blue-950/40 rounded-xl p-5 border-2 border-blue-500/30">
                        <div className="text-blue-400 font-bold mb-3 flex items-center gap-2">
                          <div className="w-4 h-4 rounded-full bg-blue-500" /> קבוצה כחולה
                        </div>
                        <div className="space-y-2 min-h-[60px]">
                          {players.filter((p: any) => p.modeState?.team === 'blue').map((p: any) => (
                            <div key={p.id} className="flex items-center justify-between bg-slate-800/80 px-4 py-2 rounded-lg group">
                              <span className="font-bold">{p.name}</span>
                              <div className="flex gap-2">
                                <button onClick={() => socket.emit('assignTeam', { code: roomCode, playerId: p.id, team: 'red' })}
                                  className="text-xs px-3 py-1 rounded-lg bg-red-600/60 hover:bg-red-500 text-red-200 font-bold transition-colors">
                                  → אדום
                                </button>
                                <button onClick={() => kickPlayer(p.id)} className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="הוצא שחקן">
                                  <XCircle size={18} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {mode !== 'ctf' && mode !== 'boss' && (
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
                )}
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
              <p className="text-5xl text-indigo-200 mb-8 font-bold drop-shadow-lg">המנצח: {winner}</p>
              {mode === 'zombie' && gameOverPayload?.players && gameOverPayload.players.length > 0 && (
                <div className="max-w-4xl mx-auto mb-16 overflow-x-auto rounded-2xl border-2 border-slate-600 bg-slate-900/90">
                  <table className="w-full text-right" dir="rtl">
                    <thead>
                      <tr className="border-b border-slate-600 bg-slate-800/80">
                        <th className="py-4 px-4 text-amber-400 font-black text-lg">דירוג</th>
                        <th className="py-4 px-4 text-cyan-300 font-black text-lg">שם שחקן</th>
                        <th className="py-4 px-4 text-red-400 font-black text-lg">הריגות</th>
                        <th className="py-4 px-4 text-emerald-400 font-black text-lg">נקודות</th>
                        <th className="py-4 px-4 text-violet-400 font-black text-lg">תשובות נכונות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...gameOverPayload.players]
                        .sort((a, b) => (b.score !== a.score ? b.score - a.score : (b as any).kills - (a as any).kills))
                        .map((p, i) => (
                          <tr key={p.id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                            <td className="py-3 px-4 font-bold text-slate-200">{i + 1}</td>
                            <td className="py-3 px-4 font-bold text-white">{p.name}</td>
                            <td className="py-3 px-4 font-mono text-red-300">{(p as any).kills ?? '-'}</td>
                            <td className="py-3 px-4 font-mono text-emerald-300">{p.score}</td>
                            <td className="py-3 px-4 font-mono text-violet-300">{p.correctAnswers}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              {mode === 'boss' && gameOverPayload?.players && gameOverPayload.players.length > 0 && (
                <div className="max-w-4xl mx-auto mb-16 overflow-x-auto rounded-2xl border-2 border-slate-600 bg-slate-900/90">
                  <table className="w-full text-right" dir="rtl">
                    <thead>
                      <tr className="border-b border-slate-600 bg-slate-800/80">
                        <th className="py-4 px-4 text-amber-400 font-black text-lg">דירוג</th>
                        <th className="py-4 px-4 text-cyan-300 font-black text-lg">שם שחקן</th>
                        <th className="py-4 px-4 text-emerald-400 font-black text-lg">נקודות</th>
                        <th className="py-4 px-4 text-violet-400 font-black text-lg">תשובות נכונות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...gameOverPayload.players]
                        .sort((a, b) => b.score !== a.score ? b.score - a.score : b.correctAnswers - a.correctAnswers)
                        .map((p, i) => (
                          <tr key={p.id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                            <td className="py-3 px-4 font-bold text-slate-200">{i + 1}</td>
                            <td className="py-3 px-4 font-bold text-white">{p.name}</td>
                            <td className="py-3 px-4 font-mono text-emerald-300">{p.score}</td>
                            <td className="py-3 px-4 font-mono text-violet-300">{p.correctAnswers}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button 
                onClick={() => {
                  setGameState('setup');
                  setRoomCode(null);
                  setGameOverPayload(null);
                }}
                className="py-5 px-16 bg-indigo-600 hover:bg-indigo-500 rounded-full text-2xl font-black shadow-[0_0_40px_rgba(79,70,229,0.5)] transition-all active:scale-95"
              >
                חזור ללובי הראשי
              </button>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

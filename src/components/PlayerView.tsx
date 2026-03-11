import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { socket } from '../socket';
import { Zap, ShoppingCart, ShieldAlert, Coins, Target, Heart, Crosshair, Shield, Snowflake, ZapOff } from 'lucide-react';

export function PlayerView({ onBack, initialCode, initialName, autoJoin }: { onBack: () => void, initialCode?: string, initialName?: string, autoJoin?: boolean }) {
  const [code, setCode] = useState(initialCode || '');
  const [name, setName] = useState(initialName || '');
  const [gameState, setGameState] = useState<'join' | 'lobby' | 'playing' | 'ended'>('join');
  const [player, setPlayer] = useState<any>(null);
  const [room, setRoom] = useState<any>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [nearStation, setNearStation] = useState<'question' | 'shop' | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestTick = useRef<any>(null);
  const keys = useRef({ w: false, a: false, s: false, d: false });
  const pos = useRef({ x: 500, y: 500 });
  const particles = useRef<any[]>([]);

  useEffect(() => {
    if (autoJoin && initialCode && initialName && gameState === 'join') {
      doJoin(initialCode, initialName);
    }
  }, [autoJoin, initialCode, initialName]);

  const doJoin = (c: string, n: string) => {
    socket.emit('joinRoom', { code: c, name: n }, (res: any) => {
      if (res.success) {
        setPlayer({ id: res.playerId, name: n, resources: 0, score: 0, modeState: {} });
        setRoom(res.room);
        setGameState('lobby');
      } else {
        alert(res.error);
      }
    });
  };

  useEffect(() => {
    socket.on('gameStarted', (r) => {
      setRoom(r);
      setGameState('playing');
      nextQuestion(r.questions);
    });

    socket.on('playerUpdated', ({ playerId, player: p }) => {
      if (player && playerId === player.id) {
        setPlayer(p);
      }
    });

    socket.on('tick', (data) => {
      latestTick.current = data;
    });

    socket.on('gameOver', ({ winner }) => {
      setGameState('ended');
    });

    return () => {
      socket.off('gameStarted');
      socket.off('playerUpdated');
      socket.off('tick');
      socket.off('gameOver');
    };
  }, [player]);

  // Keyboard Controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if(e.key === 'w' || e.key === 'ArrowUp') keys.current.w = true;
      if(e.key === 'a' || e.key === 'ArrowLeft') keys.current.a = true;
      if(e.key === 's' || e.key === 'ArrowDown') keys.current.s = true;
      if(e.key === 'd' || e.key === 'ArrowRight') keys.current.d = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if(e.key === 'w' || e.key === 'ArrowUp') keys.current.w = false;
      if(e.key === 'a' || e.key === 'ArrowLeft') keys.current.a = false;
      if(e.key === 's' || e.key === 'ArrowDown') keys.current.s = false;
      if(e.key === 'd' || e.key === 'ArrowRight') keys.current.d = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, []);

  // 2D Game Loop & Rendering
  useEffect(() => {
    if (gameState !== 'playing' || !room?.mode) return;
    let animationFrameId: number;
    let lastSync = 0;

    const render = () => {
      // Movement
      const speed = player?.modeState?.speed || 6;
      let dx = 0; let dy = 0;
      if (keys.current.w) dy -= speed;
      if (keys.current.s) dy += speed;
      if (keys.current.a) dx -= speed;
      if (keys.current.d) dx += speed;

      const isFrozenLocal = player?.modeState?.frozenUntil > Date.now();
      const isDisabledLocal = player?.modeState?.disabledUntil > Date.now();

      if ((dx !== 0 || dy !== 0) && !isFrozenLocal && !isDisabledLocal) {
        const oldX = pos.current.x;
        const oldY = pos.current.y;
        pos.current.x = Math.max(15, Math.min(985, pos.current.x + dx));
        pos.current.y = Math.max(15, Math.min(985, pos.current.y + dy));
        
        // Client-side prediction for CTF energy
        if (room.mode === 'ctf' && player) {
            const dist = Math.hypot(oldX - pos.current.x, oldY - pos.current.y);
            if (player.resources < dist * 0.1) {
                pos.current.x = oldX;
                pos.current.y = oldY;
            }
        }

        const now = Date.now();
        if (now - lastSync > 33) { // 30fps sync
          socket.emit('updatePosition', { code: room.code, playerId: player.id, x: pos.current.x, y: pos.current.y });
          lastSync = now;
        }
      }

      // Check Stations
      let nearQ = false;
      let nearS = false;
      
      if (room.mode === 'ctf') {
        nearQ = Math.hypot(pos.current.x - 500, pos.current.y - 200) < 100;
        nearS = Math.hypot(pos.current.x - 500, pos.current.y - 800) < 100;
      } else {
        nearQ = Math.hypot(pos.current.x - 300, pos.current.y - 500) < 100;
        nearS = Math.hypot(pos.current.x - 700, pos.current.y - 500) < 100;
      }
      setNearStation(nearQ ? 'question' : nearS ? 'shop' : null);

      // Draw
      const canvas = canvasRef.current;
      if (canvas && latestTick.current) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Camera follow player
          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          // Center camera on player
          const cx = canvas.width / 2 - pos.current.x;
          const cy = canvas.height / 2 - pos.current.y;
          ctx.translate(cx, cy);

          // Draw Ground / Grid
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, 1000, 1000);
          
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 2;
          for(let i=0; i<=1000; i+=100) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 1000); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(1000, i); ctx.stroke();
          }

          const gs = latestTick.current.globalState;

          // Stations (Always present)
          const qX = room.mode === 'ctf' ? 500 : 300;
          const qY = room.mode === 'ctf' ? 200 : 500;
          const sX = room.mode === 'ctf' ? 500 : 700;
          const sY = room.mode === 'ctf' ? 800 : 500;

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

          if (room.mode === 'zombie') {
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
          } else if (room.mode === 'economy') {
            // Coins
            gs?.coins?.forEach((c: any) => {
              ctx.shadowBlur = 20; ctx.shadowColor = '#facc15';
              ctx.fillStyle = '#facc15';
              ctx.beginPath(); ctx.arc(c.x, c.y, 12, 0, Math.PI*2); ctx.fill();
              ctx.shadowBlur = 0;
              ctx.fillStyle = '#ca8a04'; ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, Math.PI*2); ctx.fill();
            });
          } else if (room.mode === 'farm') {
            // Asteroids
            gs?.asteroids?.forEach((a: any) => {
              ctx.shadowBlur = 15; ctx.shadowColor = '#94a3b8';
              ctx.fillStyle = '#64748b';
              ctx.beginPath(); ctx.arc(a.x, a.y, 25, 0, Math.PI*2); ctx.fill();
              ctx.shadowBlur = 0;
              ctx.fillStyle = 'red'; ctx.fillRect(a.x-20, a.y-35, 40, 5);
              ctx.fillStyle = '#10b981'; ctx.fillRect(a.x-20, a.y-35, 40 * (a.hp/a.maxHp), 5);
            });
          } else if (room.mode === 'ctf') {
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
            
            // Add particles on hit
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
            const isMe = p.id === player.id;
            const isBoss = p.modeState?.isBoss;
            const radius = isBoss ? 45 : 18;
            
            ctx.shadowBlur = 20; 
            ctx.shadowColor = isMe ? '#a855f7' : (p.modeState?.team === 'red' ? '#ef4444' : (p.modeState?.team === 'blue' ? '#3b82f6' : '#6366f1'));
            if (isBoss) ctx.shadowColor = '#ef4444';
            ctx.fillStyle = ctx.shadowColor;
            
            // Draw my own player exactly where I think I am (client-side prediction)
            const drawX = isMe ? pos.current.x : p.x;
            const drawY = isMe ? pos.current.y : p.y;

            if (p.modeState?.hp === undefined || p.modeState?.hp > 0) {
              ctx.beginPath(); ctx.arc(drawX, drawY, radius, 0, Math.PI*2); ctx.fill();
              
              if (p.modeState?.hasFlag) {
                  ctx.fillStyle = p.modeState.team === 'red' ? '#3b82f6' : '#ef4444';
                  ctx.fillRect(drawX - 10, drawY - 30, 20, 20);
              }

              if (p.modeState?.shields > 0) {
                  ctx.strokeStyle = '#3b82f6';
                  ctx.lineWidth = 4;
                  ctx.beginPath(); ctx.arc(drawX, drawY, radius + 10, 0, Math.PI*2); ctx.stroke();
              }

              ctx.shadowBlur = 0;
              
              // Name tag
              ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'; 
              ctx.fillText(p.name, drawX, drawY - radius - 15);

              // HP Bar
              if (p.modeState?.maxHp) {
                ctx.fillStyle = 'red'; ctx.fillRect(drawX - 20, drawY - radius - 10, 40, 5);
                ctx.fillStyle = '#10b981'; ctx.fillRect(drawX - 20, drawY - radius - 10, 40 * (p.modeState.hp/p.modeState.maxHp), 5);
              }
            } else {
              // Dead
              ctx.shadowBlur = 0;
              ctx.fillStyle = '#475569';
              ctx.beginPath(); ctx.arc(drawX, drawY, radius, 0, Math.PI*2); ctx.fill();
              ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'; 
              ctx.fillText('DEAD', drawX, drawY);
            }
          });

          ctx.restore();
        }
      }
      animationFrameId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState, room, player]);

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !name) return;
    doJoin(code, name);
  };

  const nextQuestion = (questionsList: any[]) => {
    if (questionsList && questionsList.length > 0) {
      setCurrentQ(Math.floor(Math.random() * questionsList.length));
    }
    setFeedback(null);
  };

  const handleAnswer = (idx: number) => {
    const q = room.questions[currentQ];
    const isCorrect = idx === q.a;
    setFeedback(isCorrect ? 'correct' : 'wrong');
    
    socket.emit('submitAnswer', { code: room.code, playerId: player.id, isCorrect });
    
    setTimeout(() => {
      nextQuestion(room.questions);
    }, 1000);
  };

  const buyUpgrade = (upgradeId: string, cost: number, targetId?: string) => {
    if (player.resources >= cost) {
      socket.emit('buyUpgrade', { code: room.code, playerId: player.id, upgradeId, cost, targetId });
    }
  };

  const performAction = (actionType: string, targetId?: string) => {
      socket.emit('action', { code: room.code, playerId: player.id, actionType, targetId });
  };

  // Touch Controls (Simple follow)
  const handleTouch = (e: React.TouchEvent | React.MouseEvent) => {
    if (gameState !== 'playing' || !canvasRef.current) return;
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const touchX = clientX - rect.left;
    const touchY = clientY - rect.top;
    
    // Calculate direction from center of screen (where player is)
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const dx = touchX - centerX;
    const dy = touchY - centerY;
    
    // Set keys based on direction
    keys.current.w = dy < -30;
    keys.current.s = dy > 30;
    keys.current.a = dx < -30;
    keys.current.d = dx > 30;

    // Tap to shoot (Farm & Zombie modes)
    if ((room.mode === 'farm' || room.mode === 'zombie') && (e.type === 'mousedown' || e.type === 'touchstart')) {
        const worldX = pos.current.x + dx;
        const worldY = pos.current.y + dy;
        
        const gs = latestTick.current?.globalState;
        if (room.mode === 'farm' && gs?.asteroids) {
            let clickedAsteroid = null;
            gs.asteroids.forEach((a: any) => {
                if (Math.hypot(a.x - worldX, a.y - worldY) < 40) {
                    clickedAsteroid = a;
                }
            });
            if (clickedAsteroid) {
                performAction('shoot', clickedAsteroid.id);
            }
        } else if (room.mode === 'zombie' && gs?.zombies) {
            let clickedZombie = null;
            gs.zombies.forEach((z: any) => {
                if (Math.hypot(z.x - worldX, z.y - worldY) < 40) {
                    clickedZombie = z;
                }
            });
            if (clickedZombie) {
                performAction('shoot_zombie', clickedZombie.id);
            }
        }
    }
  };

  const stopTouch = () => {
    keys.current = { w: false, a: false, s: false, d: false };
  };

  if (gameState === 'join') {
    return (
      <div className="h-full min-h-screen md:min-h-0 flex items-center justify-center p-4">
        <button onClick={onBack} className="absolute top-8 right-8 text-slate-400 hover:text-white">
          &rarr; חזור
        </button>
        <motion.form 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          onSubmit={joinRoom} 
          className="bg-slate-800 p-8 rounded-3xl w-full max-w-md shadow-2xl border border-slate-700"
        >
          <h2 className="text-3xl font-bold mb-8 text-center bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">הצטרף למשחק</h2>
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">קוד חדר (6 ספרות)</label>
              <input 
                type="text" 
                maxLength={6}
                value={code} 
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                className="w-full bg-slate-900 border-2 border-slate-700 rounded-xl px-4 py-3 text-2xl text-center font-mono tracking-widest focus:border-indigo-500 focus:outline-none transition-colors"
                placeholder="000000"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">כינוי</label>
              <input 
                type="text" 
                value={name} 
                onChange={e => setName(e.target.value)}
                className="w-full bg-slate-900 border-2 border-slate-700 rounded-xl px-4 py-3 text-xl focus:border-indigo-500 focus:outline-none transition-colors"
                placeholder="הכנס שם..."
                required
              />
            </div>
            <button 
              type="submit"
              className="w-full py-4 bg-indigo-500 hover:bg-indigo-600 rounded-xl text-xl font-bold shadow-lg shadow-indigo-500/20 transition-all active:scale-95 mt-4"
            >
              היכנס!
            </button>
          </div>
        </motion.form>
      </div>
    );
  }

  if (gameState === 'lobby') {
    return (
      <div className="h-full min-h-screen md:min-h-0 flex flex-col items-center justify-center p-4 text-center">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <div className="w-24 h-24 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-8 shadow-[0_0_50px_rgba(99,102,241,0.3)]">
            <Zap className="w-12 h-12 text-indigo-400 animate-pulse" />
          </div>
          <h2 className="text-4xl font-bold mb-4">אתה בפנים, {player?.name}!</h2>
          <p className="text-xl text-slate-400">ממתין למורה שיתחיל את המשחק...</p>
        </motion.div>
      </div>
    );
  }

  if (gameState === 'ended') {
    return (
      <div className="h-full min-h-screen md:min-h-0 flex items-center justify-center p-4 text-center">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <h2 className="text-6xl font-black mb-4 text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500">המשחק נגמר!</h2>
          <p className="text-2xl text-slate-400 mb-8">הבט במסך הראשי לראות מי ניצח</p>
          <button 
            onClick={onBack}
            className="py-4 px-12 bg-indigo-500 hover:bg-indigo-600 rounded-2xl text-xl font-bold transition-all active:scale-95 shadow-lg shadow-indigo-500/30"
          >
            חזור לראשי
          </button>
        </motion.div>
      </div>
    );
  }

  const q = room?.questions?.[currentQ];
  const isFrozen = player?.modeState?.frozenUntil > Date.now();
  const isDisabled = player?.modeState?.disabledUntil > Date.now();

  return (
    <div className="h-full min-h-screen md:min-h-0 flex flex-col bg-slate-900 relative">
      {/* Top Bar */}
      <div className="bg-slate-800/80 backdrop-blur-md p-4 flex justify-between items-center shadow-md z-20 absolute top-0 left-0 right-0 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold shadow-lg ${
              player?.modeState?.isBoss ? 'bg-red-500 shadow-red-500/30' : 'bg-indigo-500 shadow-indigo-500/30'
          }`}>
            {player?.name.charAt(0)}
          </div>
          <span className="font-bold">{player?.name}</span>
        </div>
        
        {player?.modeState?.hp !== undefined && (
          <div className="flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full border border-slate-700">
            <Heart className="text-red-500 w-5 h-5" />
            <span className="font-bold text-red-400">{player.modeState.hp}</span>
          </div>
        )}

        <div className="flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full border border-slate-700">
          <Coins className="text-yellow-400 w-5 h-5" />
          <motion.span 
            key={player?.resources}
            initial={{ scale: 1.5, color: '#4ade80' }}
            animate={{ scale: 1, color: '#facc15' }}
            className="font-mono font-bold text-xl"
          >
            {player?.resources}
            {room.mode === 'economy' ? '$' : room.mode === 'ctf' ? '⚡' : room.mode === 'boss' ? (player.modeState.isBoss ? '🛡️' : '⚔️') : room.mode === 'farm' ? ' 🔋' : ''}
          </motion.span>
        </div>
        
        {room.mode === 'farm' && (
          <div className="flex items-center gap-2 bg-slate-900 px-4 py-2 rounded-full border border-slate-700">
            <motion.span 
              key={player?.score}
              initial={{ scale: 1.5, color: '#a855f7' }}
              animate={{ scale: 1, color: '#c084fc' }}
              className="font-mono font-bold text-xl text-purple-400"
            >
              {player?.score} 💎
            </motion.span>
          </div>
        )}
      </div>

      {/* 2D Game Canvas */}
      <div 
        className="flex-1 relative overflow-hidden touch-none"
        onTouchStart={handleTouch}
        onTouchMove={handleTouch}
        onTouchEnd={stopTouch}
        onMouseDown={handleTouch}
        onMouseMove={(e) => { if(e.buttons === 1) handleTouch(e); }}
        onMouseUp={stopTouch}
        onMouseLeave={stopTouch}
      >
        <canvas 
          ref={canvasRef}
          width={window.innerWidth}
          height={window.innerHeight}
          className="absolute inset-0 w-full h-full"
        />
        
        {/* Mobile Controls Hint */}
        <div className="absolute bottom-4 left-0 right-0 text-center text-slate-400/50 pointer-events-none font-bold">
          גע וגרור כדי לזוז (או השתמש ב-WASD)
          {(room.mode === 'farm' || room.mode === 'zombie') && <br/>}
          {room.mode === 'farm' && "לחץ על אסטרואידים כדי לירות"}
          {room.mode === 'zombie' && "לחץ על זומבים כדי לירות (עולה 5 זהב)"}
        </div>
      </div>

      {/* Overlays for Stations & Actions */}
      <AnimatePresence>
        {/* Wrong Answer Flash */}
        {feedback === 'wrong' && (
          <motion.div
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 bg-red-500 pointer-events-none z-50"
          />
        )}

        {/* Boss Mode Action Button */}
        {room.mode === 'boss' && !player.modeState.isBoss && player.resources > 0 && (
            <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute top-24 right-4 z-30"
            >
                <button 
                    onClick={() => performAction('attack')}
                    className="w-20 h-20 bg-red-500 rounded-full flex flex-col items-center justify-center font-black text-white shadow-[0_0_30px_rgba(239,68,68,0.6)] active:scale-90 transition-transform"
                >
                    <Crosshair size={32} />
                    תקוף!
                </button>
            </motion.div>
        )}

        {/* Boss Mode Boss Actions */}
        {room.mode === 'boss' && player.modeState.isBoss && (
            <motion.div
                initial={{ x: 100 }}
                animate={{ x: 0 }}
                className="absolute top-24 right-4 z-30 flex flex-col gap-4"
            >
                <button 
                    onClick={() => buyUpgrade('shield', 50)}
                    disabled={player.resources < 50}
                    className={`p-4 rounded-2xl font-bold flex flex-col items-center gap-2 shadow-lg ${player.resources >= 50 ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-500'}`}
                >
                    <Shield size={24} />
                    מגן (50)
                </button>
                {/* Simplified disable: just disables a random hero for 5s */}
                <button 
                    onClick={() => {
                        const heroes = Object.values(latestTick.current?.players || {}).filter((p:any) => !p.modeState.isBoss);
                        if (heroes.length > 0) {
                            const target = heroes[Math.floor(Math.random() * heroes.length)] as any;
                            buyUpgrade('disable', 100, target.id);
                        }
                    }}
                    disabled={player.resources < 100}
                    className={`p-4 rounded-2xl font-bold flex flex-col items-center gap-2 shadow-lg ${player.resources >= 100 ? 'bg-purple-500 text-white' : 'bg-slate-800 text-slate-500'}`}
                >
                    <ZapOff size={24} />
                    שתק גיבור (100)
                </button>
            </motion.div>
        )}

        {isFrozen && (
            <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-blue-500/20 backdrop-blur-sm z-40 flex items-center justify-center"
            >
                <div className="bg-slate-900 p-8 rounded-3xl text-center border-2 border-blue-400 shadow-[0_0_50px_rgba(59,130,246,0.5)]">
                    <Snowflake className="w-24 h-24 text-blue-400 mx-auto mb-4 animate-spin-slow" />
                    <h2 className="text-3xl font-black text-blue-400">קפוא!</h2>
                    <p className="text-slate-300">מישהו הקפיא אותך...</p>
                </div>
            </motion.div>
        )}

        {isDisabled && (
            <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 bg-purple-500/20 backdrop-blur-sm z-40 flex items-center justify-center"
            >
                <div className="bg-slate-900 p-8 rounded-3xl text-center border-2 border-purple-400 shadow-[0_0_50px_rgba(168,85,247,0.5)]">
                    <ZapOff className="w-24 h-24 text-purple-400 mx-auto mb-4 animate-pulse" />
                    <h2 className="text-3xl font-black text-purple-400">משותק!</h2>
                    <p className="text-slate-300">הבוס שיתק אותך...</p>
                </div>
            </motion.div>
        )}

        {nearStation === 'question' && q && !isFrozen && !isDisabled && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ 
              y: 0, 
              opacity: 1,
              x: feedback === 'wrong' ? [-10, 10, -10, 10, 0] : 0
            }}
            transition={{ duration: feedback === 'wrong' ? 0.4 : 0.3 }}
            exit={{ y: 100, opacity: 0 }}
            className={`absolute bottom-0 left-0 right-0 backdrop-blur-xl border-t-4 p-6 rounded-t-3xl z-30 shadow-[0_-10px_40px_rgba(59,130,246,0.2)] ${
              feedback === 'wrong' ? 'bg-red-900/95 border-red-500' : 
              feedback === 'correct' ? 'bg-emerald-900/95 border-emerald-500' : 
              'bg-slate-800/95 border-blue-500'
            }`}
          >
            <div className="max-w-2xl mx-auto">
              <h3 className={`${feedback === 'wrong' ? 'text-red-400' : feedback === 'correct' ? 'text-emerald-400' : 'text-blue-400'} font-bold mb-2 flex items-center gap-2`}><Target size={20}/> תחנת שאלות</h3>
              <h2 className="text-2xl font-bold mb-6">{q.q}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {q.opts.map((opt: string, i: number) => (
                  <button
                    key={i}
                    disabled={feedback !== null}
                    onClick={() => handleAnswer(i)}
                    className={`p-4 rounded-xl text-lg font-bold transition-all active:scale-95 ${
                      feedback !== null 
                        ? i === q.a 
                          ? 'bg-emerald-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.5)]' 
                          : 'bg-slate-700 text-slate-500'
                        : 'bg-slate-700 hover:bg-slate-600 text-white shadow-lg'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {nearStation === 'shop' && !isFrozen && !isDisabled && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="absolute bottom-0 left-0 right-0 bg-slate-800/95 backdrop-blur-xl border-t-4 border-emerald-500 p-6 rounded-t-3xl z-30 shadow-[0_-10px_40px_rgba(16,185,129,0.2)]"
          >
            <div className="max-w-2xl mx-auto">
              <h3 className="text-emerald-400 font-bold mb-4 flex items-center gap-2"><ShoppingCart size={20}/> חנות שדרוגים</h3>
              <div className="grid gap-3 max-h-[40vh] overflow-y-auto pr-2">
                
                {/* Common Upgrades */}
                <ShopItem title="מהירות תנועה" desc="זוז מהר יותר במפה" cost={150} onBuy={() => buyUpgrade('speed', 150)} canAfford={player?.resources >= 150} />
                
                {/* Mode Specific Upgrades */}
                {room.mode === 'zombie' && (
                  <>
                    <ShopItem title="תיקון הבסיס" desc="מרפא את הבסיס ב-500 נקודות" cost={100} onBuy={() => buyUpgrade('repair', 100)} canAfford={player?.resources >= 100} />
                    <ShopItem title="בניית צריח אוטומטי" desc="יורה בזומבים באופן אוטומטי" cost={500} onBuy={() => buyUpgrade('turret', 500)} canAfford={player?.resources >= 500} />
                    <ShopItem title="ריפוי קבוצתי" desc="מרפא את כל השחקנים" cost={300} onBuy={() => buyUpgrade('heal', 300)} canAfford={player?.resources >= 300} />
                  </>
                )}
                {room.mode === 'economy' && (
                  <>
                    <ShopItem title="מכפיל רווחים" desc="קבל יותר כסף מכל שאלה נכונה" cost={300} onBuy={() => buyUpgrade('multiplier', 300)} canAfford={player?.resources >= 300} />
                    <ShopItem title="הקפאת מתחרים" desc="מקפיא את כל השחקנים האחרים ל-10 שניות!" cost={500} onBuy={() => buyUpgrade('freeze', 500)} canAfford={player?.resources >= 500} />
                  </>
                )}
                {room.mode === 'farm' && (
                  <>
                    <ShopItem title="שדרוג לייזר" desc="יותר נזק לאסטרואידים" cost={200} onBuy={() => buyUpgrade('laser', 200)} canAfford={player?.resources >= 200} />
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ShopItem({ title, desc, cost, onBuy, canAfford }: any) {
  return (
    <div className="bg-slate-700/50 p-3 rounded-xl flex items-center justify-between gap-4 border border-slate-600/50">
      <div className="flex-1">
        <h4 className="font-bold text-md text-white">{title}</h4>
        <p className="text-xs text-slate-400">{desc}</p>
      </div>
      <button 
        onClick={onBuy}
        disabled={!canAfford}
        className={`px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-all active:scale-95 whitespace-nowrap ${
          canAfford 
            ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]' 
            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
        }`}
      >
        <span>{cost}</span>
        <Coins size={14} />
      </button>
    </div>
  );
}

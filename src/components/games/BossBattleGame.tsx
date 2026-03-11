import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { Swords, Shield, ZapOff, Clock, Heart } from 'lucide-react';
import { socket } from '../../socket';

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
}

export function BossBattleGame({ roomCode, playerId, player, questions, globalState, allPlayers }: Props) {
  const [attackFlash, setAttackFlash] = useState(false);
  const isBoss = player?.modeState?.isBoss;
  const isDisabled = (player?.modeState?.disabledUntil || 0) > Date.now();
  const timeLeft = globalState?.timeLeft ?? 600;
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  const bossPlayer = Object.values(allPlayers || {}).find((p: any) => p.modeState?.isBoss) as any;
  const heroes = Object.values(allPlayers || {}).filter((p: any) => !p.modeState?.isBoss);

  const bossHp = bossPlayer?.modeState?.hp ?? 0;
  const bossMaxHp = bossPlayer?.modeState?.maxHp ?? 1;
  const bossHpPct = Math.max(0, (bossHp / bossMaxHp) * 100);
  const bossShields = bossPlayer?.modeState?.shields ?? 0;

  const onCorrect = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: true });
  };
  const onWrong = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: false });
  };

  const attack = () => {
    if ((player?.resources || 0) <= 0) return;
    socket.emit('action', { code: roomCode, playerId, actionType: 'attack' });
    setAttackFlash(true);
    setTimeout(() => setAttackFlash(false), 400);
  };

  const buyShield = () => {
    socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: 'shield', cost: 50 });
  };

  const disableHero = (targetId: string) => {
    socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: 'disable', cost: 100, targetId });
  };

  return (
    <div className={`flex flex-col h-full text-white ${
      isBoss
        ? 'bg-gradient-to-b from-red-950 via-slate-900 to-[#070b18]'
        : 'bg-gradient-to-b from-indigo-950 via-slate-900 to-[#070b18]'
    }`}>
      {/* Disabled overlay */}
      <AnimatePresence>
        {isDisabled && !isBoss && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-purple-900/70 backdrop-blur-md z-50 flex items-center justify-center"
          >
            <div className="text-center">
              <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 0.5 }}>
                <ZapOff className="w-20 h-20 text-purple-300 mx-auto mb-4" />
              </motion.div>
              <h2 className="text-3xl font-black text-purple-200">משותק!</h2>
              <p className="text-purple-300 mt-2 text-sm">הבוס שיתק אותך...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attack flash */}
      <AnimatePresence>
        {attackFlash && (
          <motion.div
            initial={{ opacity: 0.5 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 bg-orange-500/20 pointer-events-none z-40"
          />
        )}
      </AnimatePresence>

      {/* Timer & Status bar */}
      <div className="flex justify-between items-center p-3 bg-black/40 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-slate-400" />
          <span className={`font-mono font-bold text-sm ${timeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
            {minutes}:{seconds.toString().padStart(2, '0')}
          </span>
        </div>
        <span className={`text-xs font-bold px-3 py-1 rounded-full ${
          isBoss ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
        }`}>
          {isBoss ? '👹 אתה הבוס!' : '⚔️ גיבור'}
        </span>
        <span className="text-sm font-bold text-yellow-400 bg-yellow-900/30 px-3 py-1 rounded-full">
          {isBoss ? `🛡️ ${bossShields}` : `⚔️ ${Math.floor(player?.resources || 0)}`}
        </span>
      </div>

      {/* Boss Visual Area */}
      <div className="flex-shrink-0 p-4 text-center">
        {/* Boss HP Bar */}
        <div className="max-w-sm mx-auto mb-4">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-red-400 font-bold">{bossPlayer?.name || 'Boss'}</span>
            <span className="text-slate-500">{Math.max(0, Math.floor(bossHp)).toLocaleString()} / {Math.floor(bossMaxHp).toLocaleString()}</span>
          </div>
          <div className="h-5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
            <motion.div
              className="h-full rounded-full relative overflow-hidden"
              style={{ background: 'linear-gradient(90deg, #dc2626, #f97316, #ef4444)' }}
              animate={{ width: `${bossHpPct}%` }}
              transition={{ duration: 0.3 }}
            >
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                animate={{ x: ['-100%', '100%'] }}
                transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
              />
            </motion.div>
          </div>
        </div>

        {/* Boss Character */}
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
          className="relative inline-block"
        >
          <div className={`w-28 h-28 rounded-full mx-auto flex items-center justify-center text-5xl relative ${
            isBoss
              ? 'bg-gradient-to-br from-red-600 to-red-900 ring-4 ring-red-400/60 shadow-[0_0_60px_rgba(239,68,68,0.4)]'
              : 'bg-gradient-to-br from-red-700 to-red-950 shadow-[0_0_40px_rgba(239,68,68,0.2)]'
          }`}>
            👹
            {bossShields > 0 && (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 6, ease: 'linear' }}
                className="absolute inset-[-6px] rounded-full border-2 border-dashed border-blue-400/60"
              />
            )}
          </div>
          {bossShields > 0 && (
            <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs font-black w-6 h-6 rounded-full flex items-center justify-center shadow-lg">
              {bossShields}
            </div>
          )}
        </motion.div>

        {/* Heroes row (for hero view) */}
        {!isBoss && heroes.length > 0 && (
          <div className="flex justify-center gap-2 mt-4 flex-wrap">
            {heroes.map((h: any) => (
              <div
                key={h.id}
                className={`text-center px-2 py-1 rounded-lg ${
                  h.id === playerId ? 'bg-blue-500/20 ring-1 ring-blue-400/50' : ''
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold mx-auto ${
                  h.id === playerId ? 'bg-blue-500' : 'bg-slate-700'
                }`}>
                  {h.name.charAt(0)}
                </div>
                <div className="text-[9px] mt-0.5 text-slate-400 truncate max-w-[50px]">{h.name}</div>
              </div>
            ))}
          </div>
        )}

        {/* Boss view: hero targets */}
        {isBoss && heroes.length > 0 && (
          <div className="mt-4">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">שתק גיבור (100 נק')</div>
            <div className="flex justify-center gap-2 flex-wrap">
              {heroes.map((h: any) => (
                <motion.button
                  key={h.id}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => disableHero(h.id)}
                  disabled={(player?.resources || 0) < 100 || (h.modeState?.disabledUntil || 0) > Date.now()}
                  className="flex items-center gap-1.5 bg-slate-800 px-3 py-1.5 rounded-lg text-xs border border-purple-900/30 disabled:opacity-30 hover:border-purple-500/50 transition-colors"
                >
                  <ZapOff size={12} className="text-purple-400" />
                  <span>{h.name}</span>
                  {(h.modeState?.disabledUntil || 0) > Date.now() && (
                    <span className="text-purple-400">⏳</span>
                  )}
                </motion.button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-4 pb-2 flex-shrink-0">
        {!isBoss && (player?.resources || 0) > 0 && (
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={attack}
            className="w-full py-4 bg-gradient-to-r from-red-600 via-orange-600 to-red-600 rounded-2xl text-xl font-black text-white shadow-[0_0_30px_rgba(239,68,68,0.3)] active:shadow-none transition-shadow flex items-center justify-center gap-3"
          >
            <Swords size={24} />
            תקוף! ({Math.floor(player.resources)} נזק)
          </motion.button>
        )}
        {!isBoss && (player?.resources || 0) === 0 && (
          <div className="w-full py-3 bg-slate-800 rounded-2xl text-center text-slate-500 text-sm font-bold border border-slate-700">
            ענה על שאלות כדי לצבור כוח התקפה ⚔️
          </div>
        )}
        {isBoss && (player?.resources || 0) >= 50 && (
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={buyShield}
            className="w-full py-3 bg-gradient-to-r from-blue-600 to-blue-800 rounded-2xl text-lg font-bold text-white shadow-[0_0_20px_rgba(59,130,246,0.3)] flex items-center justify-center gap-3"
          >
            <Shield size={20} />
            הפעל מגן (50 נק')
          </motion.button>
        )}
      </div>

      {/* Questions */}
      <div className="flex-1 overflow-y-auto min-h-0 bg-slate-900/80 border-t border-slate-800">
        <div className="p-2 text-center">
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            {isBoss ? 'ענה כדי לצבור נקודות הגנה' : 'ענה כדי לצבור כוח התקפה'}
          </span>
        </div>
        <QuestionPanel
          questions={questions}
          onCorrect={onCorrect}
          onWrong={onWrong}
          earnLabel={isBoss ? '+20 🛡️' : '+50 ⚔️'}
          disabled={isDisabled}
          compact
        />
      </div>
    </div>
  );
}

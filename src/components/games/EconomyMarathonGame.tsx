import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { TrendingUp, Snowflake, ShoppingCart, HelpCircle, Crown, Zap } from 'lucide-react';
import { socket } from '../../socket';

interface Props {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
}

export function EconomyMarathonGame({ roomCode, playerId, player, questions, globalState, allPlayers }: Props) {
  const [tab, setTab] = useState<'questions' | 'shop'>('questions');
  const cash = Math.floor(player?.resources || 0);
  const multiplier = player?.modeState?.multiplier || 1;
  const isFrozen = (player?.modeState?.frozenUntil || 0) > Date.now();
  const progress = Math.min(100, (cash / 10000) * 100);

  const sorted = Object.values(allPlayers || {})
    .sort((a: any, b: any) => (b.resources || 0) - (a.resources || 0));
  const myRank = sorted.findIndex((p: any) => p.id === playerId) + 1;

  const buyUpgrade = (id: string, cost: number) => {
    socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: id, cost });
  };

  const onCorrect = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: true });
  };
  const onWrong = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: false });
  };

  const recentEvents = (globalState?.events || []).slice(-3).reverse();

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-[#0a1628] via-slate-900 to-emerald-950 text-white">
      {/* Frozen overlay */}
      <AnimatePresence>
        {isFrozen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-blue-900/70 backdrop-blur-md z-50 flex items-center justify-center"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 4, ease: 'linear' }}
            >
              <Snowflake className="w-24 h-24 text-blue-300" />
            </motion.div>
            <div className="absolute text-center">
              <h2 className="text-4xl font-black text-blue-200 mt-32">קפוא!</h2>
              <p className="text-blue-300 mt-2 text-sm">מישהו הקפיא אותך...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cash Display */}
      <div className="p-4 text-center bg-gradient-to-b from-yellow-900/20 to-transparent flex-shrink-0">
        <div className="text-xs text-yellow-500/50 font-bold uppercase tracking-widest mb-1">מרתון כלכלי</div>
        <motion.div
          key={cash}
          initial={{ scale: 1.08 }}
          animate={{ scale: 1 }}
          className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-yellow-400 to-amber-500 mb-2"
        >
          ${cash.toLocaleString()}
        </motion.div>

        {/* Progress to $10,000 */}
        <div className="max-w-xs mx-auto">
          <div className="flex justify-between text-[10px] text-slate-500 mb-1">
            <span>$0</span>
            <span className="text-yellow-400 font-bold">{progress.toFixed(1)}%</span>
            <span>$10,000</span>
          </div>
          <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-yellow-500 via-amber-400 to-emerald-400"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Stats chips */}
        <div className="flex justify-center gap-2 mt-3">
          <span className="text-xs bg-yellow-900/40 px-3 py-1 rounded-full text-yellow-400 font-bold border border-yellow-800/30">
            x{multiplier} מכפיל
          </span>
          <span className="text-xs bg-indigo-900/40 px-3 py-1 rounded-full text-indigo-400 font-bold border border-indigo-800/30">
            מקום #{myRank || '?'}
          </span>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="px-3 pb-2 flex-shrink-0">
        <div className="bg-slate-800/60 rounded-xl p-2.5 space-y-0.5 border border-slate-700/50">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider px-2 mb-1">טבלת מובילים</div>
          {sorted.slice(0, 5).map((p: any, i: number) => {
            const isMe = p.id === playerId;
            return (
              <motion.div
                layout
                key={p.id}
                className={`flex items-center justify-between py-1.5 px-2.5 rounded-lg text-sm transition-colors ${
                  isMe ? 'bg-yellow-500/10 border border-yellow-500/20' : ''
                }`}
              >
                <span className="flex items-center gap-2">
                  {i === 0 && <Crown size={12} className="text-yellow-400" />}
                  <span className={`font-bold text-xs ${isMe ? 'text-yellow-300' : 'text-slate-500'}`}>{i + 1}.</span>
                  <span className={`text-sm ${isMe ? 'text-yellow-200 font-bold' : 'text-slate-400'}`}>
                    {p.name}{isMe ? ' (אתה)' : ''}
                  </span>
                </span>
                <span className={`font-mono font-bold text-sm ${isMe ? 'text-yellow-400' : 'text-slate-500'}`}>
                  ${Math.floor(p.resources || 0).toLocaleString()}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Events log */}
      {recentEvents.length > 0 && (
        <div className="px-3 pb-2 flex-shrink-0">
          <AnimatePresence>
            {recentEvents.map((ev: any, i: number) => (
              <motion.div
                key={ev.time}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1 - i * 0.3, x: 0 }}
                className="text-xs text-blue-400 bg-blue-900/20 rounded-lg px-3 py-1 mb-1 border border-blue-800/20"
              >
                {ev.type === 'freeze' ? `❄️ ${ev.by} הקפיא את כולם!` : ev.type}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Tabs */}
      <div className="flex bg-slate-900 border-t border-b border-slate-800 flex-shrink-0">
        <button
          onClick={() => setTab('questions')}
          className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
            tab === 'questions' ? 'bg-yellow-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <HelpCircle size={16} /> שאלות
        </button>
        <button
          onClick={() => setTab('shop')}
          className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
            tab === 'shop' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <ShoppingCart size={16} /> חנות
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 bg-slate-900">
        {tab === 'questions' && (
          <QuestionPanel
            questions={questions}
            onCorrect={onCorrect}
            onWrong={onWrong}
            earnLabel={`+${10 * multiplier}$`}
            disabled={isFrozen}
            compact
          />
        )}
        {tab === 'shop' && (
          <div className="p-3 space-y-2">
            <ShopItem
              title="מכפיל רווחים"
              desc={`הכפל את הרווח ל-x${multiplier + 1}`}
              cost={300 * multiplier}
              icon={<TrendingUp className="text-yellow-400" size={18} />}
              currency="$"
              canAfford={cash >= 300 * multiplier}
              onBuy={() => buyUpgrade('multiplier', 300 * multiplier)}
            />
            <ShopItem
              title="זירוז שאלות"
              desc="הפחת את זמן הנעילה בשגיאה"
              cost={200}
              icon={<Zap className="text-amber-400" size={18} />}
              currency="$"
              canAfford={cash >= 200}
              onBuy={() => buyUpgrade('speedup', 200)}
            />
            <ShopItem
              title="הקפאת מתחרים"
              desc="הקפא את כל השחקנים האחרים ל-10 שניות!"
              cost={500}
              icon={<Snowflake className="text-blue-400" size={18} />}
              currency="$"
              canAfford={cash >= 500}
              onBuy={() => buyUpgrade('freeze', 500)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ShopItem({ title, desc, cost, icon, currency, canAfford, onBuy }: {
  title: string; desc: string; cost: number; icon: ReactNode; currency: string; canAfford: boolean; onBuy: () => void;
}) {
  return (
    <motion.button
      whileTap={canAfford ? { scale: 0.96 } : {}}
      disabled={!canAfford}
      onClick={onBuy}
      className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all ${
        canAfford
          ? 'bg-slate-800 hover:bg-slate-750 border border-slate-700 shadow-lg'
          : 'bg-slate-800/40 border border-slate-800 opacity-40'
      }`}
    >
      <div className="w-9 h-9 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 text-right min-w-0">
        <h4 className="font-bold text-sm">{title}</h4>
        <p className="text-[11px] text-slate-400 truncate">{desc}</p>
      </div>
      <div className={`font-bold text-xs px-2.5 py-1 rounded-lg whitespace-nowrap ${
        canAfford ? 'bg-yellow-500/20 text-yellow-400' : 'bg-slate-700 text-slate-500'
      }`}>
        {currency}{cost}
      </div>
    </motion.button>
  );
}

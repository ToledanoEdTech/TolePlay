/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gamepad2, GraduationCap, Sparkles } from 'lucide-react';
import { HostDashboard } from './components/HostDashboard';
import { PlayerView } from './components/PlayerView';

function FloatingOrbs() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />
      <div className="orb orb-4" />
      {Array.from({ length: 40 }).map((_, i) => (
        <div
          key={i}
          className="star"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            '--delay': `${Math.random() * 5}s`,
            '--duration': `${2 + Math.random() * 4}s`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<'home' | 'host' | 'player'>('home');

  return (
    <div className="min-h-screen bg-[#070b18] text-white overflow-hidden" dir="rtl">
      <AnimatePresence mode="wait">
        {view === 'home' && (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="relative flex flex-col items-center justify-center min-h-screen p-6"
          >
            <FloatingOrbs />

            <div className="relative z-10 flex flex-col items-center max-w-2xl mx-auto">
              <motion.div
                initial={{ opacity: 0, scale: 0.5, y: -20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className="mb-4"
              >
                <motion.div
                  animate={{ y: [0, -8, 0] }}
                  transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
                >
                  <div className="relative">
                    <div className="absolute inset-0 blur-[60px] opacity-30 bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 rounded-full scale-150" />
                    <img
                      src="/logo.png"
                      alt="TolePlay"
                      className="relative z-10 w-36 h-36 sm:w-44 sm:h-44 object-contain drop-shadow-[0_0_30px_rgba(139,92,246,0.4)]"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  </div>
                </motion.div>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="text-7xl sm:text-8xl lg:text-9xl font-black mb-3 brand-text tracking-tight"
              >
                TolePlay
              </motion.h1>

              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.4, duration: 0.6 }}
                className="w-24 h-1 bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-400 rounded-full mb-6"
              />

              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.5 }}
                className="text-lg sm:text-xl text-slate-400 mb-14 text-center leading-relaxed"
              >
                פלטפורמת משחקי למידה בזמן אמת
                <span className="text-slate-600 mx-2">•</span>
                הצטרף למשחק או צור אחד חדש
              </motion.p>

              <div className="flex flex-col sm:flex-row gap-4 w-full max-w-lg">
                <motion.button
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.65, duration: 0.5 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setView('player')}
                  className="flex-1 py-5 px-8 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 rounded-2xl text-xl font-black shadow-[0_8px_32px_rgba(16,185,129,0.3)] hover:shadow-[0_8px_48px_rgba(16,185,129,0.45)] transition-all flex items-center justify-center gap-3 group"
                >
                  <Gamepad2 className="w-6 h-6 group-hover:rotate-12 transition-transform duration-300" />
                  הצטרף למשחק
                </motion.button>

                <motion.button
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.75, duration: 0.5 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setView('host')}
                  className="flex-1 py-5 px-8 bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-400 hover:to-violet-400 rounded-2xl text-xl font-black shadow-[0_8px_32px_rgba(99,102,241,0.3)] hover:shadow-[0_8px_48px_rgba(99,102,241,0.45)] transition-all flex items-center justify-center gap-3 group"
                >
                  <GraduationCap className="w-6 h-6 group-hover:rotate-12 transition-transform duration-300" />
                  צור משחק (מורה)
                </motion.button>
              </div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1, duration: 0.5 }}
                className="mt-16 flex items-center gap-2 text-slate-600 text-sm"
              >
                <Sparkles className="w-4 h-4" />
                <span>למידה דרך משחק</span>
                <Sparkles className="w-4 h-4" />
              </motion.div>
            </div>
          </motion.div>
        )}

        {view === 'host' && (
          <motion.div
            key="host"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="h-screen"
          >
            <HostDashboard onBack={() => setView('home')} />
          </motion.div>
        )}

        {view === 'player' && (
          <motion.div
            key="player"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="h-screen"
          >
            <PlayerView onBack={() => setView('home')} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

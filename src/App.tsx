/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { HostDashboard } from './components/HostDashboard';
import { PlayerView } from './components/PlayerView';

export default function App() {
  const [view, setView] = useState<'home' | 'host' | 'player'>('home');

  return (
    <div className="min-h-screen bg-slate-900 text-white font-sans overflow-hidden" dir="rtl">
      {view === 'home' && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center min-h-screen p-4"
        >
          <h1 className="text-6xl font-black mb-8 text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">
            LearnQuest
          </h1>
          <p className="text-xl text-slate-300 mb-12 text-center max-w-md">
            פלטפורמת משחקי למידה בזמן אמת. הצטרף למשחק או צור אחד חדש!
          </p>
          
          <div className="flex flex-col sm:flex-row gap-6 w-full max-w-md">
            <button 
              onClick={() => setView('player')}
              className="flex-1 py-4 px-6 bg-emerald-500 hover:bg-emerald-600 rounded-2xl text-xl font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
            >
              הצטרף למשחק
            </button>
            <button 
              onClick={() => setView('host')}
              className="flex-1 py-4 px-6 bg-indigo-500 hover:bg-indigo-600 rounded-2xl text-xl font-bold shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
            >
              צור משחק (מורה)
            </button>
          </div>
        </motion.div>
      )}

      {view === 'host' && <HostDashboard onBack={() => setView('home')} />}
      {view === 'player' && <PlayerView onBack={() => setView('home')} />}
    </div>
  );
}


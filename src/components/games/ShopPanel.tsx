import React, { useMemo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Coins } from 'lucide-react';

type ShopItem = {
  id: string;
  title: string;
  description: string;
  cost: number;
  icon: ReactNode; // inline SVG component
  accent: string;
  owned: boolean;
  affordable: boolean;
  kind: 'weapon' | 'upgrade' | 'utility';
};

function IconTile({ icon, accent }: { icon: ReactNode; accent: string }) {
  return (
    <div
      className="relative w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden border"
      style={{
        background: `${accent}14`,
        borderColor: `${accent}2a`,
      }}
    >
      <div
        className="absolute -inset-4 opacity-35 blur-2xl"
        style={{ background: `radial-gradient(circle at 30% 30%, ${accent} 0%, transparent 60%)` }}
      />
      <div className="relative z-10 w-8 h-8 drop-shadow-[0_0_16px_rgba(255,255,255,0.10)]">
        {icon}
      </div>
    </div>
  );
}

function ShopCard({
  item,
  onBuy,
  onEquip,
  equippedWeapon,
}: {
  item: ShopItem;
  onBuy: (id: string, cost: number) => void;
  onEquip: (weaponId: string) => void;
  equippedWeapon: string;
}) {
  const isEquipped = item.kind === 'weapon' && item.owned && item.id === equippedWeapon;
  const canBuy = !item.owned && item.affordable;
  const canEquip = item.kind === 'weapon' && item.owned && !isEquipped;
  const state: 'owned' | 'affordable' | 'expensive' = item.owned ? 'owned' : item.affordable ? 'affordable' : 'expensive';

  return (
    <motion.div
      layout
      className="group relative rounded-2xl border border-white/10 bg-slate-950/60 backdrop-blur-md overflow-hidden"
      style={{
        boxShadow:
          state === 'affordable'
            ? '0 0 0 1px rgba(99,102,241,0.18), 0 12px 34px rgba(0,0,0,0.45)'
            : '0 12px 34px rgba(0,0,0,0.30)',
      }}
    >
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background: `radial-gradient(800px circle at 20% 0%, ${item.accent}18, transparent 45%),
                       radial-gradient(700px circle at 100% 100%, ${item.accent}10, transparent 55%)`,
        }}
      />

      <div className="relative p-4 flex gap-3">
        <IconTile icon={item.icon} accent={item.accent} />

        <div className="min-w-0 flex-1 text-right">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-extrabold tracking-tight text-slate-100 truncate">{item.title}</h4>
            <span
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-bold ${
                state === 'owned'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25'
                  : state === 'affordable'
                    ? 'bg-amber-500/15 text-amber-200 border-amber-400/25'
                    : 'bg-slate-800/50 text-slate-400 border-slate-700/50'
              }`}
            >
              <Coins size={14} />
              {item.cost}
            </span>
          </div>

          <p className="mt-1 text-[12.5px] leading-5 text-slate-400">{item.description}</p>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span className="font-semibold">{item.kind === 'weapon' ? 'נשק' : item.kind === 'utility' ? 'מערכת' : 'שדרוג'}</span>
            </div>

            {isEquipped ? (
              <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-200 text-xs font-extrabold">
                מצויד
              </div>
            ) : canEquip ? (
              <button
                type="button"
                onClick={() => onEquip(item.id)}
                className="px-3.5 py-2 rounded-xl border text-xs font-extrabold transition-transform duration-150 bg-cyan-600/75 hover:bg-cyan-500/85 active:bg-cyan-600 border-cyan-400/30 text-white hover:-translate-y-[1px] active:translate-y-0"
              >
                Equip
              </button>
            ) : (
              <button
                type="button"
                disabled={!canBuy}
                onClick={() => onBuy(item.id, item.cost)}
                className={`px-3.5 py-2 rounded-xl border text-xs font-extrabold transition-transform duration-150 ${
                  canBuy
                    ? 'bg-indigo-600/80 hover:bg-indigo-500/90 active:bg-indigo-600 border-indigo-400/30 text-white hover:-translate-y-[1px] active:translate-y-0'
                    : 'bg-slate-800/40 border-slate-700/50 text-slate-500 cursor-not-allowed'
                }`}
                aria-disabled={!canBuy}
              >
                {item.owned ? 'נרכש' : item.affordable ? 'רכישה' : 'יקר מדי'}
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function SvgLaser() {
  return (
    <svg viewBox="0 0 64 64" className="w-full h-full">
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <path d="M8 40 L44 4 L60 20 L24 56 Z" fill="url(#g1)" opacity="0.95" />
      <path d="M14 46 L50 10" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
function SvgSpread() {
  return (
    <svg viewBox="0 0 64 64" className="w-full h-full">
      <path d="M8 46 L58 18" stroke="#a855f7" strokeWidth="5" strokeLinecap="round" />
      <path d="M8 32 L58 32" stroke="#60a5fa" strokeWidth="5" strokeLinecap="round" />
      <path d="M8 18 L58 46" stroke="#22c55e" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
function SvgPlasma() {
  return (
    <svg viewBox="0 0 64 64" className="w-full h-full">
      <defs>
        <radialGradient id="p1" cx="35%" cy="35%" r="70%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.35" stopColor="#d8b4fe" stopOpacity="0.9" />
          <stop offset="1" stopColor="#a855f7" stopOpacity="0.35" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="18" fill="url(#p1)" />
      <circle cx="32" cy="32" r="24" fill="none" stroke="#a855f7" strokeOpacity="0.35" strokeWidth="4" />
    </svg>
  );
}
function SvgDamage() {
  return (
    <svg viewBox="0 0 64 64" className="w-full h-full">
      <path d="M12 40 L32 8 L52 40 L32 56 Z" fill="#f472b6" opacity="0.9" />
      <path d="M32 18 L32 44" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="4" strokeLinecap="round" />
      <path d="M22 32 L42 32" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
function SvgMagnet() {
  return (
    <svg viewBox="0 0 64 64" className="w-full h-full">
      <path d="M22 14 v18 a10 10 0 0 0 20 0 V14" fill="none" stroke="#3b82f6" strokeWidth="6" strokeLinecap="round" />
      <path d="M18 14 h10" stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" />
      <path d="M36 14 h10" stroke="#e2e8f0" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}
function SvgShield() {
  return (
    <svg viewBox="0 0 64 64" className="w-full h-full">
      <path
        d="M32 6 C24 12 18 14 12 16 v20 c0 10 8 18 20 22 c12-4 20-12 20-22 V16 c-6-2-12-4-20-10z"
        fill="#14b8a6"
        opacity="0.85"
      />
      <path d="M32 14 v36" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="3" />
    </svg>
  );
}

export function ShopPanel({
  credits,
  ownedWeapons,
  equippedWeapon,
  laserDmg,
  magnetRange,
  hasShield,
  onBuy,
  onEquip,
}: {
  credits: number;
  ownedWeapons: string[];
  equippedWeapon: string;
  laserDmg: number;
  magnetRange: number;
  hasShield: boolean;
  onBuy: (upgradeId: string, cost: number) => void;
  onEquip: (weaponId: string) => void;
}) {
  const items = useMemo<ShopItem[]>(() => {
    const affordable = (c: number) => credits >= c;
    const ownedSet = new Set(ownedWeapons || []);

    return [
      {
        id: 'weapon_tier_1',
        title: 'Tier 1 · לייזר בסיסי',
        description: 'הנשק ההתחלתי. ירייה מדויקת ומהירה.',
        cost: 0,
        icon: <SvgLaser />,
        accent: '#60a5fa',
        owned: true,
        affordable: true,
        kind: 'weapon',
      },
      {
        id: 'weapon_tier_2',
        title: 'Tier 2 · תאומים',
        description: 'שני לייזרים מקבילים — יותר כיסוי ופגיעה.',
        cost: 100,
        icon: <SvgLaser />,
        accent: '#a855f7',
        owned: ownedSet.has('weapon_tier_2'),
        affordable: affordable(100),
        kind: 'weapon',
      },
      {
        id: 'weapon_tier_3',
        title: 'Tier 3 · פזורה',
        description: '3 יריות בקונוס — מעולה לקבוצות אסטרואידים.',
        cost: 150,
        icon: <SvgSpread />,
        accent: '#8b5cf6',
        owned: ownedSet.has('weapon_tier_3'),
        affordable: affordable(150),
        kind: 'weapon',
      },
      {
        id: 'weapon_tier_4',
        title: 'Tier 4 · פלזמה',
        description: 'פגז גדול עם נזק אזורי. צורך יותר אנרגיה.',
        cost: 250,
        icon: <SvgPlasma />,
        accent: '#a855f7',
        owned: ownedSet.has('weapon_tier_4'),
        affordable: affordable(250),
        kind: 'weapon',
      },
      {
        id: 'laser',
        title: 'שדרוג נזק',
        description: `נזק +25 (כרגע: ${laserDmg}).`,
        cost: 100,
        icon: <SvgDamage />,
        accent: '#f472b6',
        owned: false,
        affordable: affordable(100),
        kind: 'upgrade',
      },
      {
        id: 'magnet',
        title: 'מגנט',
        description: `טווח משיכה +50 (כרגע: ${magnetRange}).`,
        cost: 150,
        icon: <SvgMagnet />,
        accent: '#3b82f6',
        owned: false,
        affordable: affordable(150),
        kind: 'utility',
      },
      {
        id: 'shield',
        title: 'מגן',
        description: 'מגן מפני התנגשויות — מוסיף שרידות.',
        cost: 200,
        icon: <SvgShield />,
        accent: '#14b8a6',
        owned: hasShield,
        affordable: affordable(200),
        kind: 'utility',
      },
    ];
  }, [credits, ownedWeapons, laserDmg, magnetRange, hasShield]);

  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="text-right">
          <h2 className="text-2xl font-black tracking-tight text-orange-300">חנות שדרוגים</h2>
          <p className="text-sm text-slate-400 mt-1">
            בחר שדרוגים איכותיים. אפשר להחליף נכסים ע״י החלפת קבצי ה־SVG/PNG בנתיבים.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] font-bold text-slate-500">מטבעות</div>
          <div className="mt-1 inline-flex items-center gap-2 px-3 py-2 rounded-2xl border border-white/10 bg-black/40">
            <Coins size={16} className="text-amber-300" />
            <span className="font-extrabold text-slate-100">{credits}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {items.map((item) => (
          <ShopCard key={item.id} item={item} onBuy={onBuy} onEquip={onEquip} equippedWeapon={equippedWeapon} />
        ))}
      </div>
    </div>
  );
}


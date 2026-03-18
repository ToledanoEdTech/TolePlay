import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestionPanel } from '../QuestionPanel';
import { Shield, ZapOff, Clock, HelpCircle, Crosshair } from 'lucide-react';
import { socket } from '../../socket';
import { lerpAngleRad, wrapAngleRad } from '../../engine/netLerp';

type Props = {
  roomCode: string;
  playerId: string;
  player: any;
  questions: any[];
  globalState: any;
  allPlayers: Record<string, any>;
};

const MAP_SIZE = 400;
const WORLD_FALLBACK_SIZE = 3000;

type KeysState = Record<string, boolean>;

type PlayerEntity = {
  mesh: THREE.Group;
  gun: THREE.Mesh;
  baseGunPos: THREE.Vector3;
  radius: number;
  isBoss: boolean;
};

type ProjectileRuntime = {
  mesh: THREE.Group;
  isBoss: boolean;
  vx: number;
  vz: number;
  life: number;
  maxLife: number;
  trailMeshes: THREE.Mesh[];
  trailPositions: THREE.Vector3[];
};

type Obstacle = { minX: number; maxX: number; minZ: number; maxZ: number };

// Weapon config: fireRate (ms), projectileSpeed (scene units/s), projectileColor (hex), projectileSize, meshColor (hex), spreadCount (1 = single, 3 = spread)
const WEAPON_CONFIG: Record<string, { fireRate: number; projectileSpeed: number; projectileColor: number; projectileSize: number; meshColor: number; spreadCount: number; spreadAngle: number }> = {
  blaster: { fireRate: 120, projectileSpeed: 90, projectileColor: 0x3498db, projectileSize: 0.8, meshColor: 0x3498db, spreadCount: 1, spreadAngle: 0 },
  sniper: { fireRate: 1200, projectileSpeed: 180, projectileColor: 0x00ff00, projectileSize: 0.5, meshColor: 0x2ecc71, spreadCount: 1, spreadAngle: 0 },
  spreadgun: { fireRate: 800, projectileSpeed: 70, projectileColor: 0xff8800, projectileSize: 0.6, meshColor: 0xe67e22, spreadCount: 3, spreadAngle: 0.15 },
  rifle: { fireRate: 120, projectileSpeed: 90, projectileColor: 0x3498db, projectileSize: 0.8, meshColor: 0x222222, spreadCount: 1, spreadAngle: 0 },
  shotgun: { fireRate: 800, projectileSpeed: 70, projectileColor: 0xff8800, projectileSize: 0.6, meshColor: 0xe67e22, spreadCount: 3, spreadAngle: 0.15 },
};
const WEAPONS = [
  { id: 'pistol', name: 'אקדח', color: 0xaaaaaa, speed: 60, cooldown: 250, spread: 0, bullets: 1 },
  { id: 'shotgun', name: 'שוטגאן', color: 0xff8800, speed: 50, cooldown: 800, spread: 0.35, bullets: 6 },
  { id: 'sniper', name: 'רובה צלפים', color: 0x00ff00, speed: 120, cooldown: 1200, spread: 0, bullets: 1 },
  { id: 'rifle', name: 'רובה סער', color: 0x3498db, speed: 80, cooldown: 120, spread: 0.08, bullets: 1 },
  { id: 'plasma', name: 'רובה פלזמה', color: 0x00ffff, speed: 40, cooldown: 600, spread: 0, bullets: 1 },
];
const GUN_PLANE_Y = 2.5; // scene-space height for aim plane (gun height)

const PLAYER_COLLISION_RADIUS = 3;
const PROJECTILE_MAX_LIFE = 2.5;
const LOCAL_LERP = 0.15;
const REMOTE_LERP = 0.25;
const SNAP_DIST = 40;

function createGroundTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const baseGreen = '#2d5016';
  const darkGreen = '#1e3d0f';
  const dirt = '#4a3728';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = Math.sin(x * 0.2) * Math.cos(y * 0.15) + Math.random() * 0.3;
      ctx.fillStyle = n > 0.3 ? baseGreen : n > 0 ? darkGreen : dirt;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  return tex;
}

function createWorld(scene: THREE.Scene, obstacles2D: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>) {
  const addObstacle = (x: number, z: number, width: number, depth: number) => {
    obstacles2D.push({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 });
  };

  const floorGeo = new THREE.PlaneGeometry(MAP_SIZE * 3, MAP_SIZE * 3);
  const floorMat = new THREE.MeshStandardMaterial({
    map: createGroundTexture(),
    roughness: 0.92,
    metalness: 0.05,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wallThickness = 10;
  const wallHeight = 15;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.7 });
  const createWall = (w: number, d: number, x: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, wallHeight, d), wallMat);
    mesh.position.set(x, wallHeight / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    addObstacle(x, z, w, d);
  };
  const halfMap = MAP_SIZE / 2;
  createWall(MAP_SIZE, wallThickness, 0, -halfMap);
  createWall(MAP_SIZE, wallThickness, 0, halfMap);
  createWall(wallThickness, MAP_SIZE, -halfMap, 0);
  createWall(wallThickness, MAP_SIZE, halfMap, 0);

  const pathMat = new THREE.MeshStandardMaterial({ color: 0xd7ccc8, roughness: 1 });
  const path1 = new THREE.Mesh(new THREE.PlaneGeometry(30, MAP_SIZE), pathMat);
  path1.rotation.x = -Math.PI / 2;
  path1.position.y = 0.1;
  path1.receiveShadow = true;
  scene.add(path1);
  const path2 = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, 30), pathMat);
  path2.rotation.x = -Math.PI / 2;
  path2.position.y = 0.1;
  path2.receiveShadow = true;
  scene.add(path2);

  const plazaGeo = new THREE.CylinderGeometry(35, 35, 0.2, 32);
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, roughness: 0.8 });
  const plaza = new THREE.Mesh(plazaGeo, plazaMat);
  plaza.position.set(0, 0.15, 0);
  plaza.receiveShadow = true;
  scene.add(plaza);

  const crateGeo = new THREE.BoxGeometry(6, 6, 6);
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.9 });
  const houseBaseGeo = new THREE.BoxGeometry(14, 10, 14);
  const roofGeo = new THREE.ConeGeometry(11, 8, 4);
  roofGeo.rotateY(Math.PI / 4);
  const treeTrunkGeo = new THREE.CylinderGeometry(1.5, 2, 6, 8);
  const treeLeavesGeo = new THREE.ConeGeometry(7, 14, 8);
  const colors = {
    houseBase: [0xfff59d, 0xffcc80, 0xbcaaa4, 0xe0e0e0],
    roof: [0xe53935, 0x5e35b1, 0x0288d1, 0x455a64],
    trunk: 0x5d4037,
    leaves: [0x2e7d32, 0x388e3c, 0x43a047],
  };

  for (let i = 0; i < 150; i++) {
    let x = (Math.random() - 0.5) * (MAP_SIZE - 40);
    let z = (Math.random() - 0.5) * (MAP_SIZE - 40);
    if (Math.abs(x) < 30 || Math.abs(z) < 30) continue;
    const randType = Math.random();
    if (randType > 0.7) {
      const baseColor = colors.houseBase[Math.floor(Math.random() * colors.houseBase.length)];
      const roofColor = colors.roof[Math.floor(Math.random() * colors.roof.length)];
      const base = new THREE.Mesh(houseBaseGeo, new THREE.MeshStandardMaterial({ color: baseColor }));
      base.position.set(x, 5, z);
      base.castShadow = true;
      base.receiveShadow = true;
      scene.add(base);
      const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: roofColor }));
      roof.position.set(x, 14, z);
      roof.castShadow = true;
      scene.add(roof);
      addObstacle(x, z, 14, 14);
    } else if (randType > 0.2) {
      const leafColor = colors.leaves[Math.floor(Math.random() * colors.leaves.length)];
      const trunk = new THREE.Mesh(treeTrunkGeo, new THREE.MeshStandardMaterial({ color: colors.trunk }));
      trunk.position.set(x, 3, z);
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      scene.add(trunk);
      const leaves = new THREE.Mesh(treeLeavesGeo, new THREE.MeshStandardMaterial({ color: leafColor }));
      leaves.position.set(x, 11 + Math.random() * 2, z);
      leaves.castShadow = true;
      scene.add(leaves);
      addObstacle(x, z, 3, 3);
    } else {
      const crate = new THREE.Mesh(crateGeo, crateMat);
      crate.position.set(x, 3, z);
      crate.castShadow = true;
      crate.receiveShadow = true;
      scene.add(crate);
      addObstacle(x, z, 6, 6);
    }
  }
}

function canMoveTo(x: number, z: number, obstacles: Obstacle[], radius: number) {
  for (const o of obstacles) {
    const inX = x + radius > o.minX && x - radius < o.maxX;
    const inZ = z + radius > o.minZ && z - radius < o.maxZ;
    if (inX && inZ) return false;
  }
  return true;
}

const PROJECTILE_COLLISION_RADIUS = 1.5;
function projectileHitsObstacle(px: number, pz: number, obstacles: Obstacle[], radius: number = PROJECTILE_COLLISION_RADIUS) {
  for (const o of obstacles) {
    if (px >= o.minX - radius && px <= o.maxX + radius && pz >= o.minZ - radius && pz <= o.maxZ + radius) return true;
  }
  return false;
}

type ShopProps = {
  open: boolean;
  onClose: () => void;
  coins: number;
  onBuy: (weaponId: string, cost: number) => void;
};

const SHOP_WEAPONS = [
  { id: 'rifle', label: 'רובה סער', cost: 10, color: '#3498db' },
  { id: 'shotgun', label: 'שוטגאן', cost: 15, color: '#ff8800' },
  { id: 'sniper', label: 'רובה צלפים', cost: 20, color: '#2ecc71' },
];

function WeaponShop({ open, onClose, coins, onBuy }: ShopProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl w-full max-w-md p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <span className="font-bold text-indigo-300">חנות נשק</span>
          <span className="font-mono text-yellow-300">💰 {coins}</span>
        </div>
        <div className="space-y-2">
          {SHOP_WEAPONS.map(w => (
            <button
              key={w.id}
              disabled={coins < w.cost}
              onClick={() => onBuy(w.id, w.cost)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
            >
              <span style={{ color: w.color }} className="font-bold">
                {w.label}
              </span>
              <span className="text-sm text-slate-300">עלות: {w.cost}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 text-right">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100"
          >
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}

function createPlayerEntity(
  scene: THREE.Scene,
  color: number,
  size: number,
  isBoss: boolean
): PlayerEntity {
  const mesh = new THREE.Group();
  const radius = size;

  if (isBoss) {
    const bodyGeo = new THREE.CylinderGeometry(size * 1.6, size * 2, size * 3, 12);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2a0a2a,
      roughness: 0.35,
      metalness: 0.5,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = size * 1.5;
    body.castShadow = body.receiveShadow = true;
    mesh.add(body);
    for (let i = 0; i < 6; i++) {
      const plateGeo = new THREE.BoxGeometry(size * 1.2, size * 0.5, size * 0.4);
      const plateMat = new THREE.MeshStandardMaterial({ color: 0x4a1a4a, roughness: 0.3, metalness: 0.6 });
      const plate = new THREE.Mesh(plateGeo, plateMat);
      const angle = (i / 6) * Math.PI * 2;
      plate.position.set(Math.cos(angle) * size * 1.5, size * (0.4 + (i % 3) * 0.9), Math.sin(angle) * size * 1.5);
      plate.rotation.y = -angle;
      plate.castShadow = plate.receiveShadow = true;
      mesh.add(plate);
    }
    const eyeGeo = new THREE.SphereGeometry(size * 0.55, 10, 10);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff1166 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(size * 0.85, size * 2.5, size * 1.35);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(-size * 0.85, size * 2.5, size * 1.35);
    mesh.add(eyeL, eyeR);
    const armGeo = new THREE.BoxGeometry(size * 0.9, size * 2.4, size * 0.9);
    const armMat = new THREE.MeshStandardMaterial({ color: 0x3b1b3b, metalness: 0.6, roughness: 0.3 });
    const armL = new THREE.Mesh(armGeo, armMat);
    armL.position.set(size * 2.2, size * 1.9, 0);
    const armR = new THREE.Mesh(armGeo, armMat);
    armR.position.set(-size * 2.2, size * 1.9, 0);
    armL.castShadow = armR.castShadow = true;
    mesh.add(armL, armR);
    const clawGeo = new THREE.BoxGeometry(size * 1.2, size * 0.8, size * 2.5);
    const clawMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.9, roughness: 0.2 });
    const gun = new THREE.Mesh(clawGeo, clawMat);
    gun.position.set(0, size * 2.1, size * 1.8);
    const baseGunPos = gun.position.clone();
    gun.castShadow = true;
    mesh.userData.gunMat = clawMat;
    mesh.add(gun);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return { mesh, gun, baseGunPos, radius, isBoss };
  }

  const bodyGeo = new THREE.CapsuleGeometry(size * 0.75, size * 1.3, 8, 12);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.45 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = size * 1.15;
  body.castShadow = body.receiveShadow = true;
  mesh.add(body);
  const shoulderL = new THREE.Mesh(
    new THREE.BoxGeometry(size * 0.9, size * 0.35, size * 0.6),
    new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.5 })
  );
  shoulderL.position.set(size * 0.7, size * 1.9, 0);
  shoulderL.castShadow = true;
  const shoulderR = new THREE.Mesh(
    new THREE.BoxGeometry(size * 0.9, size * 0.35, size * 0.6),
    new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.5 })
  );
  shoulderR.position.set(-size * 0.7, size * 1.9, 0);
  shoulderR.castShadow = true;
  mesh.add(shoulderL, shoulderR);
  const helmetGeo = new THREE.SphereGeometry(size * 0.75, 14, 14, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.2, metalness: 0.6 });
  const helmet = new THREE.Mesh(helmetGeo, helmetMat);
  helmet.position.y = size * 2.35;
  helmet.castShadow = true;
  mesh.add(helmet);
  const visorGeo = new THREE.SphereGeometry(size * 0.5, 8, 8, 0, Math.PI * 2, Math.PI * 0.2, Math.PI * 0.4);
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x00ffff,
    emissive: 0x00ffff,
    emissiveIntensity: 1.2,
    transparent: true,
    opacity: 0.9,
  });
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, size * 2.4, size * 0.45);
  mesh.add(visor);
  const gunGroup = new THREE.Group();
  gunGroup.position.set(size * 0.9, size * 1.55, size * 1.35);
  const baseGunPosHero = gunGroup.position.clone();
  const barrelGeo = new THREE.CylinderGeometry(size * 0.15, size * 0.15, size * 1.8, 10);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.95, roughness: 0.15 });
  const barrel = new THREE.Mesh(barrelGeo, barrelMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = size * 1.1;
  barrel.castShadow = true;
  const stockGeo = new THREE.BoxGeometry(size * 0.4, size * 0.5, size * 0.9);
  const stockMat = new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.8, metalness: 0.1 });
  const stock = new THREE.Mesh(stockGeo, stockMat);
  stock.position.z = -size * 0.6;
  stock.castShadow = true;
  const scopeGeo = new THREE.CylinderGeometry(size * 0.12, size * 0.12, size * 0.5, 8);
  const scopeMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9, roughness: 0.2 });
  const scope = new THREE.Mesh(scopeGeo, scopeMat);
  scope.rotation.x = Math.PI / 2;
  scope.position.set(0, size * 0.35, size * 0.6);
  scope.castShadow = true;
  const muzzleGeo = new THREE.CylinderGeometry(size * 0.18, size * 0.15, size * 0.25, 8);
  const muzzle = new THREE.Mesh(muzzleGeo, barrelMat);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = size * 2.05;
  muzzle.castShadow = true;
  gunGroup.add(barrel, stock, scope, muzzle);
  mesh.userData.gunMat = barrelMat;
  mesh.add(gunGroup);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  return { mesh, gun: gunGroup as unknown as THREE.Mesh, baseGunPos: baseGunPosHero, radius, isBoss };
}

function worldToScene(
  x: number,
  y: number,
  worldSize: number
): { sx: number; sz: number } {
  const center = worldSize / 2;
  const scale = MAP_SIZE / worldSize;
  const sx = (x - center) * scale;
  const sz = (y - center) * scale;
  return { sx, sz };
}

function sceneToWorld(
  sx: number,
  sz: number,
  worldSize: number
): { x: number; y: number } {
  const center = worldSize / 2;
  const scale = worldSize / MAP_SIZE;
  const x = sx * scale + center;
  const y = sz * scale + center;
  return { x, y };
}

export function BossBattleGame({ roomCode, playerId, player, questions, globalState, allPlayers }: Props) {
  const [showQuestions, setShowQuestions] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [coins, setCoins] = useState(0);
  const [equippedWeapon, setEquippedWeapon] = useState<string>(player?.modeState?.weaponType || 'rifle');
  const equippedWeaponRef = useRef(equippedWeapon);
  const [ownedWeapons, setOwnedWeapons] = useState<string[]>(() => [...(player?.modeState?.ownedWeapons || ['rifle', 'sniper', 'shotgun'])]);
  const ownedWeaponsRef = useRef<string[]>(ownedWeapons);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const keysRef = useRef<KeysState>({});
  const roomCodeRef = useRef(roomCode);
  const playerIdRef = useRef(playerId);

  const obstaclesRef = useRef<Obstacle[]>([]);
  const playerEntitiesRef = useRef<Record<string, PlayerEntity & { targetX: number; targetZ: number; isLocal: boolean }>>({});
  const aiBossRef = useRef<(PlayerEntity & { targetX: number; targetZ: number }) | null>(null);
  const projectilesRef = useRef<Record<string, ProjectileRuntime>>({});
  const remoteAnglesRef = useRef<Record<string, { renderAngle: number; targetAngle: number }>>({});
  const pendingSpawnProjectilesRef = useRef<any[]>([]);

  const aimDirRef = useRef(new THREE.Vector3(0, 0, 1));
  const lastShootTimeRef = useRef(0);
  const canShootRef = useRef(true);
  const lastAttackSentAtRef = useRef(0);
  const ATTACK_THROTTLE_MS = 200;
  const isDisabledRef = useRef(false);
  const isDeadRef = useRef(false);
  const ammoRef = useRef(0);
  const localPredictedPosRef = useRef<{ x: number; y: number } | null>(null);

  const gameStateRef = useRef<{
    worldSize: number;
    players: Record<string, any>;
    aiBoss: any;
    projectiles: any[];
  }>({
    worldSize: globalState?.worldSize || WORLD_FALLBACK_SIZE,
    players: allPlayers,
    aiBoss: globalState?.aiBoss,
    projectiles: globalState?.projectiles || [],
  });

  const bossIds = globalState?.bossIds || [];
  const aiBoss = globalState?.aiBoss;
  const bosses = bossIds.map((id: string) => allPlayers?.[id]).filter(Boolean);
  const heroes = Object.values(allPlayers || {}).filter((p: any) => !p.modeState?.isBoss && (p.modeState?.hp ?? 2) > 0);
  const aliveBosses = bosses.filter((b: any) => (b.modeState?.hp ?? 0) > 0);
  const hasAiBoss = aiBoss && aiBoss.hp > 0;

  const isBoss = player?.modeState?.isBoss;
  const isDisabled = (player?.modeState?.disabledUntil || 0) > Date.now();
  const isDead = !isBoss && (player?.modeState?.hp ?? 2) <= 0;
  const timeLeft = globalState?.timeLeft ?? 600;
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const ammo = Math.floor(player?.resources || 0);

  // Sync ownedWeapons from server
  useEffect(() => {
    const ow = player?.modeState?.ownedWeapons;
    if (Array.isArray(ow) && ow.length > 0) {
      setOwnedWeapons(prev => (JSON.stringify(prev) !== JSON.stringify(ow) ? [...ow] : prev));
      ownedWeaponsRef.current = ow;
    }
  }, [player?.modeState?.ownedWeapons]);

  // keep latest simple scalars in refs so the Three.js effect
  // can have an empty dependency array
  useEffect(() => {
    roomCodeRef.current = roomCode;
    playerIdRef.current = playerId;
    isDisabledRef.current = isDisabled;
    isDeadRef.current = isDead;
    ammoRef.current = ammo;
    equippedWeaponRef.current = equippedWeapon;
    ownedWeaponsRef.current = ownedWeapons;
  }, [roomCode, playerId, isDisabled, isDead, ammo, equippedWeapon, ownedWeapons]);

  // keep latest server state in ref (no React re-render on every tick)
  useEffect(() => {
    gameStateRef.current = {
      worldSize: globalState?.worldSize || WORLD_FALLBACK_SIZE,
      players: allPlayers,
      aiBoss: globalState?.aiBoss,
      projectiles: globalState?.projectiles || [],
    };
  }, [globalState, allPlayers]);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 250, 600);

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 100, 80);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xb0d0ff, 0x304050, 0.5);
    scene.add(hemiLight);
    const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.0);
    sunLight.position.set(120, 280, 80);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.left = -200;
    sunLight.shadow.camera.right = 200;
    sunLight.shadow.camera.top = 200;
    sunLight.shadow.camera.bottom = -200;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 500;
    sunLight.shadow.bias = -0.0002;
    scene.add(sunLight);

    obstaclesRef.current = [];
    createWorld(scene, obstaclesRef.current);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    let lastTime = performance.now();

    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GUN_PLANE_Y);
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const intersection = new THREE.Vector3();
    const gunBarrelWorld = new THREE.Vector3();
    const direction = new THREE.Vector3();

    const handleResize = () => {
      if (!rendererRef.current || !cameraRef.current || !containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      keysRef.current[e.code] = true;
      const ow = ownedWeaponsRef.current;
      const idx = e.code === 'Digit1' || e.code === 'Numpad1' ? 0 : e.code === 'Digit2' || e.code === 'Numpad2' ? 1 : e.code === 'Digit3' || e.code === 'Numpad3' ? 2 : e.code === 'Digit4' || e.code === 'Numpad4' ? 3 : e.code === 'Digit5' || e.code === 'Numpad5' ? 4 : -1;
      if (idx >= 0 && idx < ow.length) {
        const w = ow[idx];
        equippedWeaponRef.current = w;
        setEquippedWeapon(w);
        socket.emit('action', { code: roomCodeRef.current, playerId: playerIdRef.current, actionType: 'equipWeapon', weaponId: w });
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!rendererRef.current || !cameraRef.current) return;
      const rect = rendererRef.current.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, cameraRef.current);
      if (!raycaster.ray.intersectPlane(aimPlane, intersection)) return;
      const myEntity = playerEntitiesRef.current[playerIdRef.current];
      if (myEntity) {
        const barrelZ = myEntity.isBoss ? 1.1 : 2.05;
        gunBarrelWorld.set(
          myEntity.gun.position.x,
          myEntity.gun.position.y,
          myEntity.gun.position.z + barrelZ * myEntity.radius
        );
        myEntity.mesh.localToWorld(gunBarrelWorld);
        direction.copy(intersection).sub(gunBarrelWorld);
        direction.y = 0;
        if (direction.lengthSq() > 0.0001) {
          direction.normalize();
          aimDirRef.current.copy(direction);
          myEntity.mesh.rotation.y = Math.atan2(direction.x, direction.z);
        }
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || !rendererRef.current || !cameraRef.current) return;
      e.preventDefault();
      const rect = rendererRef.current.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, cameraRef.current);
      if (!raycaster.ray.intersectPlane(aimPlane, intersection)) return;
      const myEntity = playerEntitiesRef.current[playerIdRef.current];
      if (!myEntity) return;

      const barrelZ = myEntity.isBoss ? 1.1 : 2.05;
      gunBarrelWorld.set(
        myEntity.gun.position.x,
        myEntity.gun.position.y,
        myEntity.gun.position.z + barrelZ * myEntity.radius
      );
      myEntity.mesh.localToWorld(gunBarrelWorld);
      direction.copy(intersection).sub(gunBarrelWorld);
      direction.y = 0;
      if (direction.lengthSq() < 0.0001) return;
      direction.normalize();

      aimDirRef.current.copy(direction);
      myEntity.mesh.rotation.y = Math.atan2(direction.x, direction.z);

      const now = Date.now();
      if (now - lastAttackSentAtRef.current < ATTACK_THROTTLE_MS) return;
      const weaponId = equippedWeaponRef.current || 'rifle';
      const weapon = WEAPON_CONFIG[weaponId] || WEAPON_CONFIG.rifle;
      const cooldownMs = weapon.fireRate;
      if (!canShootRef.current || now - lastShootTimeRef.current < cooldownMs) return;
      canShootRef.current = false;
      lastShootTimeRef.current = now;
      lastAttackSentAtRef.current = now;
      const release = () => { canShootRef.current = true; };
      setTimeout(release, cooldownMs);

      const angle = Math.atan2(direction.z, direction.x);
      const isAssaultRifle = weaponId === 'rifle';
      if (isAssaultRifle) {
        socket.emit('action', { code: roomCodeRef.current, playerId: playerIdRef.current, actionType: 'attack', aimAngle: angle, burst: true });
      } else {
        socket.emit('action', { code: roomCodeRef.current, playerId: playerIdRef.current, actionType: 'attack', aimAngle: angle });
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    renderer.domElement.addEventListener('mousedown', handleMouseDown);

    const animate = () => {
      if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const snapshot = gameStateRef.current;
      const worldSize = snapshot.worldSize || WORLD_FALLBACK_SIZE;

      // Local player movement + collision (solid environment)
      const myId = playerIdRef.current;
      const myFromServer = snapshot.players[myId];
      if (!localPredictedPosRef.current) {
        localPredictedPosRef.current = {
          x: Number.isFinite(myFromServer?.x) ? myFromServer.x : worldSize / 2,
          y: Number.isFinite(myFromServer?.y) ? myFromServer.y : worldSize / 2,
        };
      }
      if (myFromServer && !isDisabledRef.current && !isDeadRef.current) {
        const move = new THREE.Vector3(0, 0, 0);
        if (keysRef.current['KeyW']) move.z -= 1;
        if (keysRef.current['KeyS']) move.z += 1;
        if (keysRef.current['KeyA']) move.x -= 1;
        if (keysRef.current['KeyD']) move.x += 1;
        if (move.lengthSq() > 0) {
          move.normalize();
          const speedWorld = 480;
          const dxWorld = move.x * speedWorld * dt;
          const dzWorld = move.z * speedWorld * dt;
          const baseXWorld = localPredictedPosRef.current?.x ?? (myFromServer?.x ?? worldSize / 2);
          const baseYWorld = localPredictedPosRef.current?.y ?? (myFromServer?.y ?? worldSize / 2);
          const targetXWorld = baseXWorld + dxWorld;
          const targetYWorld = baseYWorld + dzWorld;
          const targetScene = worldToScene(targetXWorld, targetYWorld, worldSize);
          let allowX = true, allowZ = true;
          if (!canMoveTo(targetScene.sx, targetScene.sz, obstaclesRef.current, PLAYER_COLLISION_RADIUS)) {
            const curScene = worldToScene(baseXWorld, baseYWorld, worldSize);
            allowX = canMoveTo(targetScene.sx, curScene.sz, obstaclesRef.current, PLAYER_COLLISION_RADIUS);
            allowZ = canMoveTo(curScene.sx, targetScene.sz, obstaclesRef.current, PLAYER_COLLISION_RADIUS);
          }
          const finalX = allowX ? targetXWorld : baseXWorld;
          const finalY = allowZ ? targetYWorld : baseYWorld;
          if (allowX || allowZ) {
            // Client-side prediction: update local position immediately.
            localPredictedPosRef.current = {
              x: Math.max(30, Math.min(worldSize - 30, finalX)),
              y: Math.max(30, Math.min(worldSize - 30, finalY)),
            };
            socket.emit('updatePosition', {
              code: roomCodeRef.current,
              playerId: playerIdRef.current,
              x: localPredictedPosRef.current.x,
              y: localPredictedPosRef.current.y,
            });
          }
        }
      }

      // Players – interpolation with lerp
      const presentPlayerIds = new Set<string>(Object.keys(snapshot.players || {}));
      // Ghost prevention: remove missing players immediately
      Object.keys(playerEntitiesRef.current).forEach((id) => {
        if (!presentPlayerIds.has(id)) {
          sceneRef.current!.remove(playerEntitiesRef.current[id].mesh);
          delete playerEntitiesRef.current[id];
          delete remoteAnglesRef.current[id];
        }
      });

      Object.entries(snapshot.players).forEach(([id, p]) => {
        const isBossPlayer = !!p.modeState?.isBoss;
        const hp = p.modeState?.hp ?? 2;
        if (hp <= 0) return;

        let ent = playerEntitiesRef.current[id];
        if (!ent) {
          const color = isBossPlayer ? 0x9b59b6 : 0x3498db;
          const base = createPlayerEntity(sceneRef.current!, color, isBossPlayer ? 4 : 1.5, isBossPlayer);
          base.mesh.userData.bobPhase = Math.random() * Math.PI * 2;
          ent = Object.assign(base, {
            targetX: p.x ?? worldSize / 2,
            targetZ: p.y ?? worldSize / 2,
            isLocal: id === playerIdRef.current,
          });
          playerEntitiesRef.current[id] = ent;
        }

        if (ent.isLocal && localPredictedPosRef.current) {
          ent.targetX = localPredictedPosRef.current.x;
          ent.targetZ = localPredictedPosRef.current.y;
        } else {
          ent.targetX = p.x ?? worldSize / 2;
          ent.targetZ = p.y ?? worldSize / 2;
        }

        const current = ent.mesh.position;
        const targetScene = worldToScene(ent.targetX, ent.targetZ, worldSize);
        const dx = targetScene.sx - current.x;
        const dz = targetScene.sz - current.z;
        const moveSpeed = Math.hypot(dx, dz) / (dt || 0.001);
        const bobScale = 0.4 + Math.min(1, moveSpeed / 80) * 0.35;
        // Universal remote interpolation: never snap, always approach target.
        const factor = ent.isLocal ? 0.15 : 0.2;
        current.x += (targetScene.sx - current.x) * factor;
        current.z += (targetScene.sz - current.z) * factor;
        current.y = ent.radius;
        const bob = Math.sin(now * 0.005 + (ent.mesh.userData.bobPhase ?? 0)) * bobScale;
        ent.mesh.position.y = current.y + bob;

        // Remote facing interpolation (shortest path). Server may not yet send angle; keep stable.
        const ang = remoteAnglesRef.current[id] || { renderAngle: 0, targetAngle: 0 };
        const serverAngle = Number.isFinite(p.modeState?.angle) ? p.modeState.angle : (Number.isFinite(p.angle) ? p.angle : ang.targetAngle);
        ang.targetAngle = wrapAngleRad(serverAngle);
        ang.renderAngle = lerpAngleRad(ang.renderAngle, ang.targetAngle, ent.isLocal ? 0.15 : 0.2);
        remoteAnglesRef.current[id] = ang;
        if (!ent.isLocal) {
          ent.mesh.rotation.y = ang.renderAngle;
        }
      });

      // Boss – interpolation with lerp
      const aiState = snapshot.aiBoss;
      if (aiState && aiState.hp > 0) {
        if (!aiBossRef.current) {
          const base = createPlayerEntity(sceneRef.current!, 0x9b59b6, 4, true);
          base.mesh.userData.bobPhase = Math.random() * Math.PI * 2;
          aiBossRef.current = Object.assign(base, {
            targetX: aiState.x,
            targetZ: aiState.y,
          });
        }
        const ent = aiBossRef.current;
        ent.targetX = aiState.x;
        ent.targetZ = aiState.y;

        const current = ent.mesh.position;
        const targetScene = worldToScene(ent.targetX, ent.targetZ, worldSize);
        const dx = targetScene.sx - current.x;
        const dz = targetScene.sz - current.z;
        const distSq = dx * dx + dz * dz;
        const moveSpeed = Math.hypot(dx, dz) / (dt || 0.001);
        const bobScale = 0.5 + Math.min(1, moveSpeed / 60) * 0.4;
        if (distSq > SNAP_DIST * SNAP_DIST) {
          current.set(targetScene.sx, ent.radius, targetScene.sz);
        } else {
          current.x = THREE.MathUtils.lerp(current.x, targetScene.sx, REMOTE_LERP);
          current.z = THREE.MathUtils.lerp(current.z, targetScene.sz, REMOTE_LERP);
          current.y = ent.radius;
        }
        const bob = Math.sin(now * 0.004 + (ent.mesh.userData.bobPhase ?? 0)) * bobScale;
        ent.mesh.position.y = current.y + bob;

        const pulse = 1 + Math.sin(now * 0.003) * 0.04;
        ent.mesh.scale.set(pulse, pulse, pulse);
      } else if (aiBossRef.current) {
        sceneRef.current!.remove(aiBossRef.current.mesh);
        aiBossRef.current = null;
      }

      // Projectiles Manager – visible, moving, cleaned up
      const runtime = projectilesRef.current;
      const projs = snapshot.projectiles || [];
      const presentProjIds = new Set<string>(
        projs
          .map((p: any) => p?.id ?? (p?.shooterId != null && p?.spawnTime != null ? `${p.shooterId}_${p.spawnTime}` : null))
          .filter(Boolean) as string[]
      );
      Object.keys(runtime).forEach((id) => {
        if (!presentProjIds.has(id)) {
          const rt = runtime[id];
          const cap = rt.mesh.children[0] as THREE.Mesh;
          rt.trailMeshes.forEach(m => {
            (m.geometry as THREE.BufferGeometry).dispose();
            ((m.material as THREE.Material) as THREE.MeshBasicMaterial).dispose?.();
          });
          if (cap?.geometry) (cap.geometry as THREE.BufferGeometry).dispose();
          if (cap?.material) (cap.material as THREE.Material).dispose();
          sceneRef.current!.remove(rt.mesh);
          delete runtime[id];
        }
      });

      const scaleToScene = MAP_SIZE / (worldSize || WORLD_FALLBACK_SIZE);
      const TRAIL_LEN = 5;

      // Apply immediate spawns (socket event) without waiting for tick.
      // Tick remains authoritative and will cleanup/confirm IDs.
      if (pendingSpawnProjectilesRef.current.length) {
        const pending = pendingSpawnProjectilesRef.current.splice(0, pendingSpawnProjectilesRef.current.length);
        for (const sp of pending) {
          if (!sp || sp.mode !== 'boss') continue;
          const proj = sp.projectile;
          if (!proj || proj.kind !== 'bossProjectile') continue;
          const id = proj.id ?? `${proj.shooterId}_${proj.spawnTime}`;
          if (!id || runtime[id]) continue;
          // Create a runtime projectile immediately by reusing the same fields the tick path expects.
          projs.push(proj);
        }
      }

      for (const proj of projs) {
        if (!Number.isFinite(proj.x) || !Number.isFinite(proj.y)) continue;
        const id = proj.id ?? `${proj.shooterId}_${proj.spawnTime}`;
        if (runtime[id]) continue;

        const isBossProj = !!proj.isBoss;
        const isOwn = proj.shooterId === playerIdRef.current;
        const weaponId = (proj.weaponType as string) || (isOwn ? (equippedWeaponRef.current || 'rifle') : 'rifle');
        const wcfg = WEAPON_CONFIG[weaponId] || WEAPON_CONFIG.rifle;
        const metaColor = typeof proj?.projectileData?.color === 'string' ? proj.projectileData.color : null;
        const color = metaColor ? parseInt(metaColor.replace('#', ''), 16) : (isBossProj ? 0xff00ff : wcfg.projectileColor);
        const size = typeof proj?.projectileData?.size === 'number' && isFinite(proj.projectileData.size) ? proj.projectileData.size : (isBossProj ? 1.8 : wcfg.projectileSize);
        const rad = isBossProj ? 0.9 : size * 0.5;
        const len = isBossProj ? 3 : 1.8;
        const capsuleGeo = new THREE.CapsuleGeometry(rad, len - rad * 2, 6, 12);
        const mat = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 3,
          roughness: 0.2,
          metalness: 0.8,
        });
        const capMesh = new THREE.Mesh(capsuleGeo, mat);
        capMesh.rotation.x = -Math.PI / 2;
        const group = new THREE.Group();
        group.add(capMesh);
        const trailMeshes: THREE.Mesh[] = [];
        const trailPositions: THREE.Vector3[] = [];
        for (let i = 0; i < TRAIL_LEN; i++) {
          const trailGeo = new THREE.SphereGeometry(rad * 0.6, 4, 4);
          const trailMat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.6 * (1 - i / TRAIL_LEN),
          });
          const trail = new THREE.Mesh(trailGeo, trailMat);
          trail.visible = false;
          group.add(trail);
          trailMeshes.push(trail);
          trailPositions.push(new THREE.Vector3());
        }
        const { sx, sz } = worldToScene(proj.x, proj.y, worldSize);
        group.position.set(sx, GUN_PLANE_Y, sz);
        sceneRef.current!.add(group);

        const vxWorld = Number.isFinite((proj as any).vx) ? (proj as any).vx : Math.cos(proj.aimAngle ?? 0) * 520;
        const vzWorld = Number.isFinite((proj as any).vy) ? (proj as any).vy : Math.sin(proj.aimAngle ?? 0) * 520;
        const vxScene = vxWorld * scaleToScene;
        const vzScene = vzWorld * scaleToScene;
        capMesh.rotation.y = Math.atan2(vxScene, vzScene);
        runtime[id] = {
          mesh: group,
          isBoss: isBossProj,
          vx: vxScene,
          vz: vzScene,
          life: 0,
          maxLife: PROJECTILE_MAX_LIFE,
          trailMeshes,
          trailPositions,
        };
      }

      Object.entries(runtime).forEach(([id, rt]) => {
        rt.life += dt;
        if (rt.life > rt.maxLife) {
          rt.trailMeshes.forEach(m => {
            (m.geometry as THREE.BufferGeometry).dispose();
            ((m.material as THREE.Material) as THREE.MeshBasicMaterial).dispose?.();
          });
          const cap = rt.mesh.children[0] as THREE.Mesh;
          if (cap?.geometry) (cap.geometry as THREE.BufferGeometry).dispose();
          if (cap?.material) (cap.material as THREE.Material).dispose();
          sceneRef.current!.remove(rt.mesh);
          delete runtime[id];
          return;
        }
        rt.trailPositions.unshift(rt.mesh.position.clone());
        if (rt.trailPositions.length > rt.trailMeshes.length) rt.trailPositions.pop();
        rt.mesh.position.x += rt.vx * dt;
        rt.mesh.position.z += rt.vz * dt;
        if (projectileHitsObstacle(rt.mesh.position.x, rt.mesh.position.z, obstaclesRef.current)) {
          rt.trailMeshes.forEach(m => {
            (m.geometry as THREE.BufferGeometry).dispose();
            ((m.material as THREE.Material) as THREE.MeshBasicMaterial).dispose?.();
          });
          const cap = rt.mesh.children[0] as THREE.Mesh;
          if (cap?.geometry) (cap.geometry as THREE.BufferGeometry).dispose();
          if (cap?.material) (cap.material as THREE.Material).dispose();
          sceneRef.current!.remove(rt.mesh);
          delete runtime[id];
          return;
        }
        const cap = rt.mesh.children[0] as THREE.Mesh;
        if (cap) cap.rotation.y = Math.atan2(rt.vx, rt.vz);
        rt.trailMeshes.forEach((m, i) => {
          if (rt.trailPositions[i]) {
            m.position.copy(rt.trailPositions[i]).sub(rt.mesh.position);
            m.visible = true;
            (m.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - i / rt.trailMeshes.length) * (1 - rt.life / rt.maxLife);
          }
        });
      });

      // מצלמה דינמית – ממקדת סביב כל השחקנים החיים
      const camTargets: THREE.Vector3[] = [];
      Object.entries(snapshot.players).forEach(([id, p]) => {
        const hp = p.modeState?.hp ?? 2;
        if (hp <= 0) return;
        const ent = playerEntitiesRef.current[id];
        if (!ent) return;
        camTargets.push(ent.mesh.position.clone());
      });
      if (camTargets.length > 0) {
        const center = new THREE.Vector3();
        camTargets.forEach(t => center.add(t));
        center.divideScalar(camTargets.length);
        const [tA, tB] = camTargets;
        let dist = 0;
        if (tA && tB) dist = tA.distanceTo(tB);
        const targetY = Math.max(70, dist * 1.2 + 50);
        const targetZ = center.z + targetY * 0.7;

        cameraRef.current.position.x += (center.x - cameraRef.current.position.x) * 0.1;
        cameraRef.current.position.y += (targetY - cameraRef.current.position.y) * 0.1;
        cameraRef.current.position.z += (targetZ - cameraRef.current.position.z) * 0.1;
        cameraRef.current.lookAt(center.x, 0, center.z);
      }

      // רתיעה של האקדח חזרה למקומו + עדכון צבע נשק לפי currentWeapon (מקומי)
      const myEnt = playerEntitiesRef.current[playerIdRef.current];
      if (myEnt && myEnt.mesh.userData.gunMat) {
        const w = WEAPON_CONFIG[equippedWeaponRef.current] || WEAPON_CONFIG.rifle;
        (myEnt.mesh.userData.gunMat as THREE.MeshStandardMaterial).color.setHex(w.meshColor);
      }
      Object.values(playerEntitiesRef.current).forEach(ent => {
        ent.gun.position.lerp(ent.baseGunPos, dt * 10);
      });

      rendererRef.current.render(sceneRef.current, cameraRef.current);
      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);

    return () => {
      socket.off('shoot');
      socket.off('projectile');
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);

      // Proper Three.js cleanup to avoid WebGL context leaks
      if (sceneRef.current) {
        sceneRef.current.clear();
      }
      if (rendererRef.current) {
        try {
          rendererRef.current.forceContextLoss();
        } catch {
          // older Three versions may not support this, ignore
        }
        rendererRef.current.dispose();
      } else {
        try {
          renderer.forceContextLoss();
        } catch {
          // ignore
        }
        renderer.dispose();
      }

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }

      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onSpawn = (msg: any) => {
      if (!msg || msg.mode !== 'boss') return;
      const p = msg.projectile;
      if (!p || p.kind !== 'bossProjectile') return;
      pendingSpawnProjectilesRef.current.push(msg);
    };
    socket.on('spawnProjectile', onSpawn);
    return () => { socket.off('spawnProjectile', onSpawn); };
  }, []);

  const onCorrect = () => {
    setCoins(c => c + 5);
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: true });
  };
  const onWrong = () => {
    socket.emit('submitAnswer', { code: roomCode, playerId, isCorrect: false });
  };

  const buyShield = () => {
    if (ammo >= 5) socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: 'shield', cost: 5 });
  };

  const disableHero = (targetId: string) => {
    if (ammo >= 10) socket.emit('buyUpgrade', { code: roomCode, playerId, upgradeId: 'disable', cost: 10, targetId });
  };

  const handleBuyWeapon = (weaponId: string, cost: number) => {
    if (coins < cost) return;
    setCoins(c => c - cost);
    setOwnedWeapons(prev => prev.includes(weaponId) ? prev : [...prev, weaponId]);
    ownedWeaponsRef.current = ownedWeaponsRef.current.includes(weaponId) ? ownedWeaponsRef.current : [...ownedWeaponsRef.current, weaponId];
    setEquippedWeapon(weaponId);
    equippedWeaponRef.current = weaponId;
    socket.emit('action', { code: roomCode, playerId, actionType: 'equipWeapon', weaponId });
  };

  return (
    <div className={`fixed inset-0 text-white ${isBoss ? 'bg-[#0a0515]' : 'bg-[#050a15]'}`}>
      <div ref={containerRef} className="absolute inset-0" />

      <AnimatePresence>
        {isDisabled && !isBoss && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{ background: 'radial-gradient(circle, rgba(88,28,135,0.9), rgba(15,23,42,0.95))' }}
          >
            <div className="text-center">
              <motion.div animate={{ rotate: [0, 15, -15, 0] }} transition={{ repeat: Infinity, duration: 0.4 }}>
                <ZapOff className="w-20 h-20 text-purple-300 mx-auto mb-4" />
              </motion.div>
              <h2 className="text-3xl font-black text-purple-200">⚡ משותק!</h2>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isDead && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justifycenter bg-red-950/80"
          >
            <div className="text-center">
              <h2 className="text-4xl font-black text-red-200 mb-2">💀 נפלת!</h2>
              {player?.modeState?.respawnAt ? (
                <p className="text-red-300/90 text-xl font-bold">
                  חוזר לחיים בעוד {Math.max(0, Math.ceil((player.modeState.respawnAt - Date.now()) / 1000))} שניות...
                </p>
              ) : (
                <p className="text-red-300/80">צפה בחברים ממשיכים...</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="boss-top-hud absolute top-0 left-0 right-0 z-20 p-3 bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
        <div className="flex justify-between items-center flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Clock size={18} className="text-yellow-400" />
            <span className={`font-mono font-black text-xl ${timeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
              {minutes}:{seconds.toString().padStart(2, '0')}
            </span>
            <span
              className={`text-sm font-bold px-4 py-1.5 rounded-xl shadow-lg ${
                isBoss
                  ? 'bg-red-500/30 text-red-300 border border-red-400/50'
                  : 'bg-blue-500/30 text-blue-300 border border-blue-400/50'
              }`}
            >
              {isBoss ? '🐉 בוס' : '⚔️ גיבור'}
            </span>
            <span className="text-lg font-black text-amber-300 bg-amber-500/30 px-4 py-1.5 rounded-xl border-2 border-amber-400/50 shadow-lg">
              🔫 {ammo} תחמושת
            </span>
            {isBoss && (
              <span className="text-sm font-bold text-blue-400 bg-blue-500/20 px-2 py-1 rounded">
                🛡️ {player?.modeState?.shields ?? 0}
              </span>
            )}
          </div>
        </div>
        {(aliveBosses.length > 0 || hasAiBoss) && (
          <div className="boss-health-panel absolute top-4 left-1/2 -translate-x-1/2 z-30 w-full max-w-[520px] px-4">
            {hasAiBoss ? (
              <div className="bg-black/60 backdrop-blur-sm px-6 py-3 rounded-2xl border-2 border-[#9b59b6] shadow-xl text-center">
                <h2 className="text-lg font-black text-[#e056fd] mb-2 drop-shadow-[0_0_10px_rgba(224,86,253,0.8)]">
                  המפלצת הענקית
                </h2>
                <div className="w-full h-6 bg-[#222] border-2 border-black rounded-[15px] overflow-hidden shadow-[inset_0_0_10px_rgba(0,0,0,1)]">
                  <motion.div
                    className="h-full rounded-[12px]"
                    style={{
                      width: `${Math.max(0, aiBoss.hp / (aiBoss.maxHp || 1)) * 100}%`,
                      background: 'linear-gradient(90deg, #8e44ad, #9b59b6, #e056fd)',
                    }}
                    animate={{ width: `${Math.max(0, aiBoss.hp / (aiBoss.maxHp || 1)) * 100}%` }}
                    transition={{ duration: 0.05 }}
                  />
                </div>
              </div>
            ) : (
              aliveBosses.map((b: any) => {
                const hpVal = b.modeState?.hp ?? 0;
                const maxHpVal = b.modeState?.maxHp ?? 10;
                const pct = Math.max(0, hpVal / maxHpVal);
                return (
                  <div
                    key={b.id}
                    className="bg-black/60 backdrop-blur-sm px-6 py-3 rounded-2xl border-2 border-[#9b59b6] shadow-xl text-center"
                  >
                    <h2 className="text-lg font-black text-[#e056fd] mb-2 drop-shadow-[0_0_10px_rgba(224,86,253,0.8)]">
                      המפלצת הענקית
                    </h2>
                    <div className="w-full h-6 bg-[#222] border-2 border-black rounded-[15px] overflow-hidden shadow-[inset_0_0_10px_rgba(0,0,0,1)]">
                      <motion.div
                        className="h-full rounded-[12px]"
                        style={{
                          width: `${pct * 100}%`,
                          background: 'linear-gradient(90deg, #8e44ad, #9b59b6, #e056fd)',
                        }}
                        animate={{ width: `${pct * 100}%` }}
                        transition={{ duration: 0.05 }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className="absolute bottom-4 left-0 right-0 z-30 flex justify-center gap-3 px-4 pointer-events-auto flex-wrap">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowQuestions(true)}
          className="px-5 py-3 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg flex items-center gap-2"
        >
          <HelpCircle size={18} /> שאלות (+תחמושת)
        </motion.button>

        {!isDead && ammo > 0 && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            onClick={() =>
              shoot(
                roomCode,
                playerId,
                ammo,
                isDead,
                lastShootTimeRef,
                canShootRef,
                lastAttackSentAtRef,
                aimDirRef,
                equippedWeapon || 'rifle'
              )
            }
            className="px-8 py-4 rounded-2xl font-black bg-red-600 hover:bg-red-500 text-white shadow-xl flex items-center gap-3 border-2 border-red-400/50"
          >
            <Crosshair size={24} /> ירי!
          </motion.button>
        )}
        {isBoss && ammo >= 5 && (
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={buyShield}
            className="px-4 py-2 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2"
          >
            <Shield size={16} /> מגן (5)
          </motion.button>
        )}
      </div>
      <div className="absolute bottom-4 right-4 z-30 pointer-events-auto">
        <button
          onClick={() => setShowShop(true)}
          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
        >
          🛒 חנות נשק ({coins})
        </button>
      </div>

      <WeaponShop
        open={showShop}
        onClose={() => setShowShop(false)}
        coins={coins}
        onBuy={handleBuyWeapon}
      />


      {isBoss && heroes.length > 0 && ammo >= 10 && (
        <div className="absolute bottom-20 left-0 right-0 z-25 px-4 pointer-events-auto">
          <div className="flex justify-center gap-2 flex-wrap">
            {heroes.map((h: any) => (
              <motion.button
                key={h.id}
                whileTap={{ scale: 0.9 }}
                onClick={() => disableHero(h.id)}
                disabled={(h.modeState?.disabledUntil || 0) > Date.now()}
                className="flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded-lg text-xs border border-purple-900/40 disabled:opacity-40"
              >
                <ZapOff size={12} /> {h.name}
                {(h.modeState?.disabledUntil || 0) > Date.now() && <span className="text-purple-400">⏳</span>}
              </motion.button>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {showQuestions && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowQuestions(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 rounded-2xl border-2 border-indigo-600/50 shadow-2xl max-w-lg w-full max-h-[85vh] overflow-hidden"
            >
              <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                <span className="font-bold text-indigo-300">ענה נכון = +2 תחמושת 🔫</span>
                <button onClick={() => setShowQuestions(false)} className="text-slate-400 hover:text-white">
                  ✕
                </button>
              </div>
              <div className="overflow-y-auto max-h-[70vh] p-4">
                <QuestionPanel
                  questions={questions}
                  onCorrect={onCorrect}
                  onWrong={onWrong}
                  earnLabel="+2 🔫"
                  disabled={isDisabled}
                  compact
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const BUTTON_ATTACK_THROTTLE_MS = 200;

function shoot(
  roomCode: string,
  playerId: string,
  ammo: number,
  isDead: boolean,
  lastShootTimeRef: React.MutableRefObject<number>,
  canShootRef: React.MutableRefObject<boolean>,
  lastAttackSentAtRef: React.MutableRefObject<number>,
  aimDirRef: React.MutableRefObject<THREE.Vector3>,
  weaponId: string = 'rifle'
) {
  if (ammo < 1 || isDead || !canShootRef.current) return;
  const now = Date.now();
  if (now - lastAttackSentAtRef.current < BUTTON_ATTACK_THROTTLE_MS) return;
  const wcfg = WEAPON_CONFIG[weaponId] || WEAPON_CONFIG.rifle;
  const cooldownMs = wcfg.fireRate;
  if (now - lastShootTimeRef.current < cooldownMs) return;
  canShootRef.current = false;
  lastShootTimeRef.current = now;
  lastAttackSentAtRef.current = now;
  setTimeout(() => { canShootRef.current = true; }, cooldownMs);
  const angle = Math.atan2(aimDirRef.current.z, aimDirRef.current.x);
  const isAssaultRifle = weaponId === 'rifle';
  if (isAssaultRifle) {
    socket.emit('action', { code: roomCode, playerId, actionType: 'attack', aimAngle: angle, burst: true });
  } else {
    socket.emit('action', { code: roomCode, playerId, actionType: 'attack', aimAngle: angle });
  }
}

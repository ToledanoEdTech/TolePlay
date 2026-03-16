import * as THREE from 'three';

const WORLD_SIZE = 4000;
const GRID_SIZE = 200;

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export function createGrassTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const base = '#0d2818';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 800; i++) {
    const x = Math.floor(seededRandom(i * 7) * size);
    const y = Math.floor(seededRandom(i * 13 + 1) * size);
    const w = 1 + Math.floor(seededRandom(i * 19) * 3);
    const h = 2 + Math.floor(seededRandom(i * 23) * 4);
    const shades = ['#134e2a', '#166534', '#15803d', '#22c55e', '#14532d'];
    ctx.fillStyle = shades[Math.floor(seededRandom(i * 11) * shades.length)];
    ctx.fillRect(x, y, w, h);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(WORLD_SIZE / 32, WORLD_SIZE / 32);
  tex.needsUpdate = true;
  return tex;
}

export function createGround(scene: THREE.Scene): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE * 1.2, WORLD_SIZE * 1.2, 1, 1);
  const mat = new THREE.MeshStandardMaterial({
    map: createGrassTexture(),
    roughness: 0.95,
    metalness: 0.02,
  });
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
  ground.receiveShadow = true;
  scene.add(ground);
  return ground;
}

export interface TreeGroup {
  group: THREE.Group;
  canopy: THREE.Group;
  seed: number;
}

export function createTree(scene: THREE.Scene, x: number, z: number, seed: number): TreeGroup {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const trunkGeo = new THREE.CylinderGeometry(8, 12, 55, 8);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x2d1a0a,
    roughness: 0.9,
    metalness: 0.05,
  });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 27.5;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  const canopy = new THREE.Group();
  const leafColors = [0x166534, 0x15803d, 0x14532d, 0x1a472a];
  const leafColor = leafColors[Math.floor(seededRandom(seed + 2) * 4)];
  const mat = new THREE.MeshStandardMaterial({
    color: leafColor,
    roughness: 0.85,
    metalness: 0.05,
  });
  const sizes = [42, 32, 24];
  const heights = [55 + 20, 55 + 35, 55 + 48];
  for (let i = 0; i < 3; i++) {
    const sphereGeo = new THREE.SphereGeometry(sizes[i] * 0.5, 10, 10);
    const mesh = new THREE.Mesh(sphereGeo, mat.clone());
    mesh.position.y = heights[i];
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    canopy.add(mesh);
  }
  group.add(canopy);
  scene.add(group);
  return { group, canopy, seed };
}

export interface BushGroup {
  group: THREE.Group;
  seed: number;
}

export function createBush(scene: THREE.Scene, x: number, z: number, seed: number): BushGroup {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x166534,
    roughness: 0.9,
    metalness: 0.02,
  });
  const counts = [4, 5, 6];
  const n = counts[Math.floor(seededRandom(seed) * 3)];
  for (let i = 0; i < n; i++) {
    const r = 10 + seededRandom(seed + i * 3) * 14;
    const sphereGeo = new THREE.SphereGeometry(r, 8, 8);
    const mesh = new THREE.Mesh(sphereGeo, mat.clone());
    mesh.position.set(
      (seededRandom(seed + i * 5) - 0.5) * 35,
      r * 0.4,
      (seededRandom(seed + i * 7 + 1) - 0.5) * 35
    );
    const s = 0.7 + seededRandom(seed + i * 11) * 0.6;
    mesh.scale.setScalar(s);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  scene.add(group);
  return { group, seed };
}

export interface PlayerMesh {
  group: THREE.Group;
  head: THREE.Mesh;
  torso: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  torsoPivot: THREE.Group;
  headPivot: THREE.Group;
}

const PLAYER_SCALE = 0.8;

export function createPlayerMesh(colorHex: number): PlayerMesh {
  const group = new THREE.Group();
  const mainColor = new THREE.Color(colorHex);
  const dark = mainColor.clone().multiplyScalar(0.7);
  const light = mainColor.clone().multiplyScalar(1.2);
  const mat = (c: THREE.Color, r = 0.4, m = 0.1) =>
    new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });

  const torsoPivot = new THREE.Group();
  const torsoGeo = new THREE.CylinderGeometry(22 * PLAYER_SCALE, 26 * PLAYER_SCALE, 48 * PLAYER_SCALE, 10);
  const torso = new THREE.Mesh(torsoGeo, mat(mainColor));
  torso.position.y = 24 * PLAYER_SCALE;
  torso.castShadow = true;
  torso.receiveShadow = true;
  torsoPivot.add(torso);
  torsoPivot.position.y = 24 * PLAYER_SCALE;
  group.add(torsoPivot);

  const headPivot = new THREE.Group();
  const headGeo = new THREE.SphereGeometry(22 * PLAYER_SCALE, 12, 12);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfde68a,
    roughness: 0.6,
    metalness: 0.05,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 52 * PLAYER_SCALE;
  head.castShadow = true;
  headPivot.add(head);
  headPivot.position.y = 52 * PLAYER_SCALE;
  group.add(headPivot);

  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-26 * PLAYER_SCALE, 44 * PLAYER_SCALE, 0);
  const armGeo = new THREE.CapsuleGeometry(6 * PLAYER_SCALE, 28 * PLAYER_SCALE, 4, 8);
  const leftArm = new THREE.Mesh(armGeo, mat(mainColor));
  leftArm.position.set(-18 * PLAYER_SCALE, 0, 0);
  leftArm.rotation.z = Math.PI / 6;
  leftArm.castShadow = true;
  leftArmPivot.add(leftArm);
  group.add(leftArmPivot);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(26 * PLAYER_SCALE, 44 * PLAYER_SCALE, 0);
  const rightArm = new THREE.Mesh(armGeo.clone(), mat(mainColor));
  rightArm.position.set(18 * PLAYER_SCALE, 0, 0);
  rightArm.rotation.z = -Math.PI / 6;
  rightArm.castShadow = true;
  rightArmPivot.add(rightArm);
  group.add(rightArmPivot);

  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-10 * PLAYER_SCALE, 0, 0);
  const legGeo = new THREE.CapsuleGeometry(8 * PLAYER_SCALE, 42 * PLAYER_SCALE, 4, 8);
  const leftLeg = new THREE.Mesh(legGeo, mat(dark));
  leftLeg.position.set(0, 21 * PLAYER_SCALE, 0);
  leftLeg.castShadow = true;
  leftLegPivot.add(leftLeg);
  group.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(10 * PLAYER_SCALE, 0, 0);
  const rightLeg = new THREE.Mesh(legGeo.clone(), mat(dark));
  rightLeg.position.set(0, 21 * PLAYER_SCALE, 0);
  rightLeg.castShadow = true;
  rightLegPivot.add(rightLeg);
  group.add(rightLegPivot);

  return {
    group,
    head,
    torso,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    leftArmPivot,
    rightArmPivot,
    leftLegPivot,
    rightLegPivot,
    torsoPivot,
    headPivot,
  };
}

const WALK_LEG_AMP = 0.45;
const WALK_ARM_AMP = 0.38;
const BOB_AMP = 3;
const BREATH_AMP = 0.02;
const WIND_AMP = 0.04;
const WIND_SPEED = 0.8;

export function updatePlayerMesh(
  pm: PlayerMesh,
  isMoving: boolean,
  speed: number,
  facingAngle: number,
  time: number
): void {
  pm.group.rotation.y = facingAngle;

  if (isMoving && speed > 10) {
    const mult = Math.min(2, speed / 120);
    const phase = time * 8 * mult;
    const legAngle = Math.sin(phase) * WALK_LEG_AMP;
    pm.leftLegPivot.rotation.x = legAngle;
    pm.rightLegPivot.rotation.x = -legAngle;
    pm.leftArmPivot.rotation.x = -legAngle * (WALK_ARM_AMP / WALK_LEG_AMP);
    pm.rightArmPivot.rotation.x = legAngle * (WALK_ARM_AMP / WALK_LEG_AMP);
    const bob = Math.abs(Math.sin(phase)) * BOB_AMP;
    pm.group.position.y = bob;
    pm.torsoPivot.scale.set(1, 1, 1);
    pm.headPivot.scale.set(1, 1, 1);
  } else {
    pm.leftLegPivot.rotation.x = 0;
    pm.rightLegPivot.rotation.x = 0;
    pm.leftArmPivot.rotation.x = 0;
    pm.rightArmPivot.rotation.x = 0;
    pm.group.position.y = 0;
    const breath = 1 + Math.sin(time * 2) * BREATH_AMP;
    pm.torsoPivot.scale.set(1, breath, 1);
    pm.headPivot.scale.set(1, 0.98 + Math.sin(time * 2 + 0.5) * 0.02, 1);
  }
}

export function updateTreeWind(tree: TreeGroup, time: number): void {
  const sway = Math.sin(time * WIND_SPEED + tree.seed) * WIND_AMP;
  tree.canopy.rotation.z = sway;
  tree.canopy.rotation.x = Math.sin(time * WIND_SPEED * 0.7 + tree.seed * 1.3) * WIND_AMP * 0.5;
}

export function updateBushWind(bush: BushGroup, time: number): void {
  const sway = Math.sin(time * WIND_SPEED + bush.seed) * WIND_AMP;
  bush.group.rotation.z = sway;
  bush.group.rotation.x = Math.sin(time * WIND_SPEED * 0.6 + bush.seed) * WIND_AMP * 0.4;
}

export function updateGrassRustle(ground: THREE.Mesh, time: number): void {
  const mat = ground.material as THREE.MeshStandardMaterial;
  if (mat.map) {
    mat.map.offset.set(
      Math.sin(time * 0.25) * 0.015,
      Math.sin(time * 0.2 + 1) * 0.015
    );
  }
}

export function createCollectibleMesh(type: string, value: number): THREE.Mesh {
  const isGreen = type === 'money_bills';
  const color = isGreen ? 0x22c55e : 0xfbbf24;
  const geo = new THREE.CylinderGeometry(18, 22, 8, 12);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.3,
    metalness: 0.4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function getWorldEnvironmentSeeds(): { x: number; z: number; seed: number; type: 'tree' | 'bush' }[] {
  const out: { x: number; z: number; seed: number; type: 'tree' | 'bush' }[] = [];
  const startX = 0;
  const startZ = 0;
  const endX = WORLD_SIZE;
  const endZ = WORLD_SIZE;
  for (let gx = startX; gx < endX; gx += GRID_SIZE) {
    for (let gz = startZ; gz < endZ; gz += GRID_SIZE) {
      const seed = gx * 7 + gz * 13;
      const r = seededRandom(seed);
      const rx = gx + r * GRID_SIZE * 0.8;
      const rz = gz + seededRandom(seed + 1) * GRID_SIZE * 0.8;
      if (r < 0.12) {
        out.push({ x: rx, z: rz, seed, type: 'tree' });
      } else if (r < 0.22) {
        out.push({ x: rx, z: rz, seed, type: 'bush' });
      }
    }
  }
  return out;
}

export function initScene(container: HTMLDivElement): {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  ground: THREE.Mesh;
  trees: TreeGroup[];
  bushes: BushGroup[];
} {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050a0f);

  const aspect = container.clientWidth / container.clientHeight;
  const h = 1200;
  const w = h * aspect;
  const camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 1, 2000);
  camera.position.set(WORLD_SIZE / 2, 600, WORLD_SIZE / 2);
  camera.lookAt(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
  camera.up.set(0, 0, -1);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const dirLight = new THREE.DirectionalLight(0xfff5e6, 1.0);
  dirLight.position.set(500, 800, 500);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 2000;
  dirLight.shadow.camera.left = -800;
  dirLight.shadow.camera.right = 800;
  dirLight.shadow.camera.top = -800;
  dirLight.shadow.camera.bottom = 800;
  dirLight.shadow.bias = -0.0001;
  scene.add(dirLight);

  const hemi = new THREE.HemisphereLight(0x446622, 0x111820, 0.4);
  scene.add(hemi);

  const ground = createGround(scene);

  const trees: TreeGroup[] = [];
  const bushes: BushGroup[] = [];
  const env = getWorldEnvironmentSeeds();
  for (const e of env) {
    if (e.type === 'tree') {
      trees.push(createTree(scene, e.x, e.z, e.seed));
    } else {
      bushes.push(createBush(scene, e.x, e.z, e.seed));
    }
  }

  return { scene, camera, renderer, ground, trees, bushes };
}

export function updateCamera(
  camera: THREE.OrthographicCamera,
  camX: number,
  camY: number,
  zoom: number,
  vpW: number,
  vpH: number
): void {
  const h = vpH / zoom;
  const w = vpW / zoom;
  camera.left = -w / 2;
  camera.right = w / 2;
  camera.top = h / 2;
  camera.bottom = -h / 2;
  camera.near = 1;
  camera.far = 2000;
  camera.updateProjectionMatrix();
  const cx = camX + w / 2;
  const cz = camY + h / 2;
  camera.position.set(cx, 600, cz);
  camera.lookAt(cx, 0, cz);
}

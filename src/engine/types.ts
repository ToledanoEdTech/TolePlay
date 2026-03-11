export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface TileZone {
  x: number;
  y: number;
  w: number;
  h: number;
  color1: string;
  color2: string;
}

export interface GameMap {
  width: number;
  height: number;
  tileSize: number;
  walls: Rect[];
  bushes: Rect[];
  zones: TileZone[];
  spawns: Record<string, Vec2>;
  objectives: Record<string, Vec2>;
}

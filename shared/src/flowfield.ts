// Flow fields: one Dijkstra pass from a goal area over the whole 512x512 grid,
// shared by every unit sent there. Costs follow terrain speed (fords cost 2x),
// so crowds naturally funnel through bridges, ramps and shallows.
import { MH, MW, N } from "./constants";
import { canStep, passable, tileSpeed, type GameMap } from "./map";

export const DX = [1, 1, 0, -1, -1, -1, 0, 1];
export const DY = [0, 1, 1, 1, 0, -1, -1, -1];
export const DIR_GOAL = 8;
export const DIR_NONE = 255;
const DIAG = Math.SQRT2;

export interface FlowField {
  id: number;
  cost: Float32Array;
  dir: Uint8Array;
  tx: number;
  ty: number;
  radius: number;
  refs: number;
}

class Heap {
  nodes = new Int32Array(1 << 16);
  keys = new Float32Array(1 << 16);
  size = 0;
  push(n: number, k: number) {
    if (this.size >= this.nodes.length) {
      const nn = new Int32Array(this.nodes.length * 2);
      nn.set(this.nodes);
      const nk = new Float32Array(this.keys.length * 2);
      nk.set(this.keys);
      this.nodes = nn;
      this.keys = nk;
    }
    let i = this.size++;
    const { nodes, keys } = this;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      nodes[i] = nodes[p];
      keys[i] = keys[p];
      i = p;
    }
    nodes[i] = n;
    keys[i] = k;
  }
  pop(): number {
    const { nodes, keys } = this;
    const top = nodes[0];
    const n = nodes[--this.size];
    const k = keys[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= k) break;
      nodes[i] = nodes[c];
      keys[i] = keys[c];
      i = c;
    }
    nodes[i] = n;
    keys[i] = k;
    return top;
  }
  topKey() {
    return this.keys[0];
  }
}

// Diagonal moves require both orthogonal detours to be legal (no corner cutting past cliffs).
function stepOk(m: GameMap, from: number, d: number): boolean {
  const x = from % MW;
  const y = (from / MW) | 0;
  const nx = x + DX[d];
  const ny = y + DY[d];
  if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) return false;
  const to = ny * MW + nx;
  if (!canStep(m, from, to)) return false;
  if (d & 1) {
    const a = y * MW + nx;
    const b = ny * MW + x;
    if (!canStep(m, from, a) || !canStep(m, a, to)) return false;
    if (!canStep(m, from, b) || !canStep(m, b, to)) return false;
  }
  return true;
}

// Bảng hướng đi được: bit d của mask[i] = stepOk(m, i, d). Tính một lần cho mỗi bản đồ
// (stepOk gọi canStep tới 5 lần cho mỗi hướng chéo — là phần nặng nhất của Dijkstra).
const navCache = new WeakMap<GameMap, Uint8Array>();

export function navMask(m: GameMap): Uint8Array {
  let mask = navCache.get(m);
  if (!mask) {
    mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      let b = 0;
      for (let d = 0; d < 8; d++) if (stepOk(m, i, d)) b |= 1 << d;
      mask[i] = b;
    }
    navCache.set(m, mask);
  }
  return mask;
}

// Gọi khi địa hình đổi (công trình bị phá): tính lại mask trong hình chữ nhật (+1 ô viền).
export function invalidateNav(m: GameMap, x0: number, y0: number, x1: number, y1: number) {
  const mask = navCache.get(m);
  if (!mask) return;
  for (let y = Math.max(0, y0 - 1); y <= Math.min(MH - 1, y1 + 1); y++) {
    for (let x = Math.max(0, x0 - 1); x <= Math.min(MW - 1, x1 + 1); x++) {
      const i = y * MW + x;
      let b = 0;
      for (let d = 0; d < 8; d++) if (stepOk(m, i, d)) b |= 1 << d;
      mask[i] = b;
    }
  }
}

export function nearestPassable(m: GameMap, tx: number, ty: number): number {
  for (let r = 0; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
        const i = y * MW + x;
        if (passable(m, i)) return i;
      }
    }
  }
  return -1;
}

let nextId = 1;

// `sources` (tùy chọn): các ô đang có lính nhận lệnh. Khi đã có, Dijkstra dừng sớm
// sau khi phủ hết các ô này (+25% và 24 ô dự phòng) thay vì quét toàn bản đồ 512×512.
export function buildFlowField(m: GameMap, tx: number, ty: number, radius: number, sources?: ArrayLike<number>): FlowField | null {
  const start = nearestPassable(m, tx, ty);
  if (start < 0) return null;
  const sx = start % MW;
  const sy = (start / MW) | 0;
  const nav = navMask(m);
  const cost = new Float32Array(N).fill(Infinity);
  const heap = new Heap();
  // goal area: tiles within radius reachable from the start tile without leaving the area
  cost[start] = 0;
  const r2 = radius * radius;
  const queue = [start];
  while (queue.length) {
    const c = queue.pop()!;
    heap.push(c, 0);
    for (let d = 0; d < 8; d += 2) {
      if (!((nav[c] >> d) & 1)) continue;
      const n = c + DY[d] * MW + DX[d];
      if (cost[n] === 0) continue;
      const x = n % MW;
      const y = (n / MW) | 0;
      if (Math.max(Math.abs(x - sx), Math.abs(y - sy)) > radius) continue;
      cost[n] = 0;
      queue.push(n);
    }
  }
  let need = new Uint8Array(0);
  let left = 0;
  let stopAt = Infinity;
  if (sources && sources.length) {
    need = new Uint8Array(N);
    for (let k = 0; k < sources.length; k++) if (!need[sources[k]]) { need[sources[k]] = 1; left++; }
  }
  while (heap.size) {
    const k = heap.topKey();
    if (k > stopAt) break;
    const c = heap.pop();
    if (k > cost[c]) continue;
    if (left > 0 && need[c]) {
      need[c] = 0;
      if (--left === 0) stopAt = k * 1.25 + 24;
    }
    // relax neighbours n → c (units move from n toward c)
    const cx = c % MW, cy = (c / MW) | 0;
    const inv = 1 / tileSpeed(m, c);
    for (let d = 0; d < 8; d++) {
      const x = cx + DX[d];
      const y = cy + DY[d];
      if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
      const n = y * MW + x;
      if (!((nav[n] >> ((d + 4) & 7)) & 1)) continue;
      const nc = k + (d & 1 ? DIAG : 1) * inv;
      if (nc < cost[n]) {
        cost[n] = nc;
        heap.push(n, nc);
      }
    }
  }
  const dir = new Uint8Array(N).fill(DIR_NONE);
  for (let i = 0; i < N; i++) {
    const ci = cost[i];
    if (ci === Infinity) continue;
    if (ci === 0) {
      dir[i] = DIR_GOAL;
      continue;
    }
    let best = ci;
    let bd = DIR_NONE;
    const b = nav[i];
    // Duyệt bắt đầu từ một hướng xoay theo ô: khi nhiều hướng bằng chi phí (rất hay gặp trên bãi trống),
    // không luôn chọn hướng có chỉ số nhỏ (Đông / Đông Nam) — việc đó làm quân đi về phía Tây bị lệch chéo
    // và chậm hơn quân đi về phía Đông. Hoà thì ưu tiên hướng thẳng (chẵn) hơn hướng chéo.
    const rot = (i * 7 + (i >> 9) * 3) & 7;
    for (let k = 0; k < 8; k++) {
      const d = (k + rot) & 7;
      if (!((b >> d) & 1)) continue;
      const c = cost[i + DY[d] * MW + DX[d]];
      if (c < best - 1e-4 || (c <= best + 1e-4 && bd !== DIR_NONE && (bd & 1) === 1 && (d & 1) === 0)) {
        best = Math.min(best, c);
        bd = d;
      }
    }
    dir[i] = bd;
  }
  return { id: nextId++, cost, dir, tx: sx, ty: sy, radius, refs: 0 };
}

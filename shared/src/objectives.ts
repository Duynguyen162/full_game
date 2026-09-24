// Mục tiêu trên bản đồ: 5 cứ điểm sông (cầu + bãi cạn) và cờ hiệu trên đỉnh
// các cao nguyên hàng trong (vành ② Nội địa) của mỗi phe. Sinh thuần từ GameMap
// nên tất định — server lockstep và client cho cùng kết quả.
import { BRIDGE_ROWS, CAP_FLAG_R, CAP_RIVER_R, FORD_ROWS, MH, MW, N } from "./constants";
import { passable, type GameMap } from "./map";

export const OBJ_RIVER = 0;
export const OBJ_FLAG = 1;

export interface Objective {
  id: number;
  kind: number;      // OBJ_RIVER | OBJ_FLAG
  home: number;      // cờ: phe sở hữu vành đai đó; cứ điểm sông: -1
  tx: number;
  ty: number;
  r: number;         // bán kính chiếm (ô)
  top: number;       // cờ: tầng cao nhất — chỉ quân đứng ở tầng này mới được tính
  label: string;
}

export function buildObjectives(m: GameMap): Objective[] {
  const out: Objective[] = [];
  const add = (o: Omit<Objective, "id">) => out.push({ ...o, id: out.length });

  const crossings: [string, [number, number]][] = [
    ["Cầu bắc", BRIDGE_ROWS[0]], ["Bãi cạn bắc", FORD_ROWS[0]], ["Cầu giữa", BRIDGE_ROWS[1]],
    ["Bãi cạn nam", FORD_ROWS[1]], ["Cầu nam", BRIDGE_ROWS[2]],
  ];
  for (const [label, [a, b]] of crossings) {
    const y = (a + b) >> 1;
    add({ kind: OBJ_RIVER, home: -1, tx: (m.riverL[y] + m.riverR[y]) >> 1, ty: y, r: CAP_RIVER_R, top: 0, label });
  }

  // Cao nguyên phía Tây: thành phần liên thông của level >= 1.
  // Hàng trong nằm sát vùng xuất quân (tâm x < ~170), hàng ngoài sát sông.
  const lab = new Int32Array(N);
  const stack: number[] = [];
  const flags: { tx: number; ty: number; top: number }[] = [];
  let id = 0;
  for (let i = 0; i < N; i++) {
    if (lab[i] || !m.level[i] || i % MW >= MW / 2) continue;
    id++;
    const tiles: number[] = [];
    lab[i] = id;
    stack.push(i);
    let top = 0;
    while (stack.length) {
      const j = stack.pop()!;
      tiles.push(j);
      if (m.level[j] > top) top = m.level[j];
      const x = j % MW;
      for (const k of [j - 1, j + 1, j - MW, j + MW]) {
        if (k < 0 || k >= N || Math.abs((k % MW) - x) > 1) continue;
        if (!lab[k] && m.level[k] && k % MW < MW / 2) { lab[k] = id; stack.push(k); }
      }
    }
    if (tiles.length < 200) continue;
    let sx = 0, sy = 0, c = 0;
    for (const j of tiles) if (m.level[j] === top) { sx += j % MW; sy += (j / MW) | 0; c++; }
    const cx = sx / c, cy = sy / c;
    if (cx >= 170) continue;
    // ô đỉnh đi được gần tâm nhất
    let best = -1, bd = Infinity;
    for (const j of tiles) {
      if (m.level[j] !== top || !passable(m, j) || m.ramp[j]) continue;
      const d = (j % MW - cx) ** 2 + (((j / MW) | 0) - cy) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    if (best >= 0) flags.push({ tx: best % MW, ty: (best / MW) | 0, top });
  }
  flags.sort((a, b) => a.ty - b.ty);
  flags.forEach((f, k) => add({ kind: OBJ_FLAG, home: 0, tx: f.tx, ty: f.ty, r: CAP_FLAG_R, top: f.top, label: `Cờ Tây ${k + 1}` }));
  // Phía Đông: bản đồ đối xứng xoay (x, y) → (MW-1-x, MH-1-y)
  flags.forEach((f, k) => add({ kind: OBJ_FLAG, home: 1, tx: MW - 1 - f.tx, ty: MH - 1 - f.ty, r: CAP_FLAG_R, top: f.top, label: `Cờ Đông ${k + 1}` }));
  return out;
}

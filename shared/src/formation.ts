// Xếp đội hình theo địa hình.
// - LocalNav: Dijkstra nhỏ (cửa sổ quanh tâm khối) chỉ đường về tâm khối, dùng cho chặng cuối
//   thay vì trường lực chung (trường lực chung chỉ dẫn tới đích lệnh, không tới từng ô đội hình).
// - planFormation: ưu tiên khối vuông (10x10 cho 100 lính); chỉ khi địa hình kẹp mới dịch tâm,
//   rồi mới đổi hình (dẹt/hẹp: 5x20, 20x5...), cuối cùng lấp phần thiếu bằng các ô trống gần tâm.
//   Mọi ô đội hình đều đi tới được từ tâm khối; lính không thấy đường thẳng tới ô thì đi theo
//   đường ngắn nhất tâm → ô (xem World.slotWaypoint) → không bị kẹt đứng yên.
import { MH, MW, T, WATER } from "./constants";
import { DX, DY, navMask } from "./flowfield";
import { canStep, type GameMap } from "./map";

export const FORM_SPACING = 40;
const UNREACHED = 0xffff;

export interface LocalNav {
  id: number;
  cx: number; // ô tâm (đích của nav)
  cy: number;
  x0: number; // góc trên-trái cửa sổ (ô)
  y0: number;
  w: number;
  h: number;
  dist: Uint16Array; // chi phí x10 tới tâm, UNREACHED = không tới được
  dir: Uint8Array; // hướng đi tiếp (0..7), 8 = đã ở tâm, 255 = không có
  order: Int32Array; // các ô (chỉ số cửa sổ) theo thứ tự chi phí tăng dần
}

let navSeq = 1;

// Dijkstra 8 hướng (chi phí 10 / 14) trong cửa sổ bán kính R quanh (cx, cy).
export function buildLocalNav(m: GameMap, cx: number, cy: number, R: number, swim = false): LocalNav {
  const nav = navMask(m, swim);
  const x0 = Math.max(0, cx - R), y0 = Math.max(0, cy - R);
  const x1 = Math.min(MW - 1, cx + R), y1 = Math.min(MH - 1, cy + R);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const dist = new Uint16Array(w * h).fill(UNREACHED);
  const dir = new Uint8Array(w * h).fill(255);
  const order: number[] = [];
  // hàng đợi ưu tiên nhị phân đơn giản
  const hn: number[] = [], hk: number[] = [];
  const push = (n: number, k: number) => {
    let i = hn.length;
    hn.push(n); hk.push(k);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= k) break;
      hn[i] = hn[p]; hk[i] = hk[p]; i = p;
    }
    hn[i] = n; hk[i] = k;
  };
  const pop = () => {
    const top = hn[0], topK = hk[0];
    const n = hn.pop()!, k = hk.pop()!;
    if (hn.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= hn.length) break;
        if (c + 1 < hn.length && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= k) break;
        hn[i] = hn[c]; hk[i] = hk[c]; i = c;
      }
      hn[i] = n; hk[i] = k;
    }
    return [top, topK];
  };
  const c0 = (cy - y0) * w + (cx - x0);
  dist[c0] = 0;
  dir[c0] = 8;
  push(c0, 0);
  while (hn.length) {
    const [c, k] = pop();
    if (k > dist[c]) continue;
    order.push(c);
    const lx = c % w, ly = (c / w) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = lx + DX[d], ny = ly + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const gn = (ny + y0) * MW + (nx + x0);
      const back = (d + 4) & 7; // hướng từ n về c
      if (!((nav[gn] >> back) & 1)) continue;
      const n = ny * w + nx;
      const nk = k + (d & 1 ? 14 : 10);
      if (nk < dist[n]) {
        dist[n] = nk;
        dir[n] = back;
        push(n, nk);
      }
    }
  }
  return { id: navSeq++, cx, cy, x0, y0, w, h, dist, dir, order: Int32Array.from(order) };
}

// Chỉ số cửa sổ của ô toàn cục, -1 nếu ngoài cửa sổ.
export function navCell(n: LocalNav, tile: number): number {
  const x = (tile % MW) - n.x0, y = ((tile / MW) | 0) - n.y0;
  if (x < 0 || y < 0 || x >= n.w || y >= n.h) return -1;
  return y * n.w + x;
}

export function navReached(n: LocalNav, tile: number): boolean {
  const c = navCell(n, tile);
  return c >= 0 && n.dist[c] !== UNREACHED;
}

// Giống World.stepSim: bước giữa 2 ô kề (chéo thì qua 1 trong 2 ô cạnh).
export function stepTiles(m: GameMap, a: number, b: number, swim = false): boolean {
  if (a === b) return true;
  const d = b - a;
  if (d === 1 || d === -1 || d === MW || d === -MW) return canStep(m, a, b, swim);
  const ax = a % MW, bx = b % MW;
  const ay = (a / MW) | 0, by = (b / MW) | 0;
  if (Math.abs(ax - bx) > 1 || Math.abs(ay - by) > 1) return false;
  const c1 = ay * MW + bx, c2 = by * MW + ax;
  return (canStep(m, a, c1, swim) && canStep(m, c1, b, swim)) || (canStep(m, a, c2, swim) && canStep(m, c2, b, swim));
}

function tileOf(x: number, y: number) {
  const tx = Math.min(MW - 1, Math.max(0, Math.floor(x / T)));
  const ty = Math.min(MH - 1, Math.max(0, Math.floor(y / T)));
  return ty * MW + tx;
}

// Đoạn thẳng đi được: duyệt CHÍNH XÁC mọi ô mà đoạn thẳng chạm tới (DDA), mỗi lần chuyển ô phải
// bước được (cùng tầng / qua dốc). Lấy mẫu thưa sẽ nhảy qua góc ô → báo "đi được" trong khi lính
// đi thật lại cắt vào góc ô khác tầng rồi kẹt dao động mãi ở mép địa hình.
export function lineWalkable(m: GameMap, x0: number, y0: number, x1: number, y1: number, swim = false): boolean {
  let tx = Math.floor(x0 / T), ty = Math.floor(y0 / T);
  const ex = Math.floor(x1 / T), ey = Math.floor(y1 / T);
  if (tx < 0 || ty < 0 || tx >= MW || ty >= MH || ex < 0 || ey < 0 || ex >= MW || ey >= MH) return false;
  const dx = x1 - x0, dy = y1 - y0;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const idx = dx !== 0 ? Math.abs(T / dx) : Infinity, idy = dy !== 0 ? Math.abs(T / dy) : Infinity;
  let tmx = dx !== 0 ? ((dx > 0 ? (tx + 1) * T - x0 : x0 - tx * T) / Math.abs(dx)) : Infinity;
  let tmy = dy !== 0 ? ((dy > 0 ? (ty + 1) * T - y0 : y0 - ty * T) / Math.abs(dy)) : Infinity;
  let cur = ty * MW + tx;
  for (let guard = 0; guard < 4 * (MW + MH) && (tx !== ex || ty !== ey); guard++) {
    let nxt: number;
    if (Math.abs(tmx - tmy) < 1e-9) {
      // đi đúng qua góc ô: chéo, hợp lệ nếu vòng qua được một trong hai ô cạnh
      if (tmx > 1) break;
      nxt = (ty + sy) * MW + tx + sx;
      if (!stepTiles(m, cur, nxt, swim)) return false;
      tx += sx; ty += sy; tmx += idx; tmy += idy;
    } else if (tmx < tmy) {
      if (tmx > 1) break;
      nxt = cur + sx;
      if (!canStep(m, cur, nxt, swim)) return false;
      tx += sx; tmx += idx;
    } else {
      if (tmy > 1) break;
      nxt = cur + sy * MW;
      if (!canStep(m, cur, nxt, swim)) return false;
      ty += sy; tmy += idy;
    }
    cur = nxt;
  }
  return true;
}

// Các điểm đã có lính khác nhận (khối khác) — tra nhanh theo ô.
export class SlotClaims {
  private map = new Map<number, number[]>();
  private tiles = new Set<number>();
  add(x: number, y: number) {
    const t = tileOf(x, y);
    this.tiles.add(t);
    let a = this.map.get(t);
    if (!a) this.map.set(t, (a = []));
    a.push(x, y);
  }
  near(x: number, y: number, r: number): boolean {
    if (!this.tiles.size) return false;
    const t = tileOf(x, y);
    const tx = t % MW, ty = (t / MW) | 0;
    const r2 = r * r;
    const k = Math.ceil(r / T);
    for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) {
      const a = this.map.get((ty + dy) * MW + tx + dx);
      if (!a) continue;
      for (let k = 0; k < a.length; k += 2) {
        const ex = a[k] - x, ey = a[k + 1] - y;
        if (ex * ex + ey * ey < r2) return true;
      }
    }
    return false;
  }
}

export interface Slot {
  row: number; // hàng (0 = hàng đầu)
  side: number; // toạ độ ngang trong khối (để xếp trái → phải)
  x: number; // vị trí thế giới
  y: number;
}

export interface FormationPlan {
  cx: number; // tâm khối sau khi dịch (px)
  cy: number;
  cols: number;
  rows: number;
  ux: number; // hướng mặt khối (hàng 0 ở phía này)
  uy: number;
  slots: Slot[];
}

// Các cách xếp số cột, theo thứ tự ưu tiên: vuông trước, rồi lệch dần (hẹp trước rộng sau).
// Với 100 lính: 10x10 → 8 cột → 13 cột → 6 → 16 → 5x20 → 20x5 → ...
const ASPECTS = [1, 0.8, 1.25, 0.6, 1.6, 0.5, 2, 0.35, 3, 0.25, 4, 0.15, 6];
function shapeOrder(n: number): number[] {
  const c0 = Math.sqrt(n);
  const out: number[] = [];
  const rowsSeen = new Set<number>();
  for (const a of ASPECTS) {
    const cols = Math.max(1, Math.min(n, a === 1 ? Math.ceil(c0) : Math.round(c0 * a)));
    const rows = Math.ceil(n / cols);
    if (rowsSeen.has(rows)) continue; // cùng số hàng = cùng hình
    rowsSeen.add(rows);
    out.push(cols);
  }
  return out;
}

// Các độ dịch tâm (theo trục dọc/ngang của khối, đơn vị px), gần trước xa sau.
const SHIFT_STEP = 32;
const SHIFT_ALONG = 6; // tối đa ±6 bước (±3 ô) dọc hướng tiến
const SHIFT_ACROSS = 8; // ±4 ô sang ngang (một bên bị chắn thì né sang bên kia)
const SHIFTS: [number, number][] = (() => {
  const s: [number, number][] = [];
  for (let a = -SHIFT_ALONG; a <= SHIFT_ALONG; a++)
    for (let b = -SHIFT_ACROSS; b <= SHIFT_ACROSS; b++) s.push([a * SHIFT_STEP, b * SHIFT_STEP]);
  // ưu tiên dịch lùi/ngang hơn dịch vượt lên (a > 0 là tiến lên), rồi theo khoảng cách
  s.sort((p, q) => (Math.hypot(p[0] * (p[0] > 0 ? 1.3 : 1), p[1]) - Math.hypot(q[0] * (q[0] > 0 ? 1.3 : 1), q[1])));
  return s;
})();

// Toạ độ (back, side) của ô thứ k trong khối cols cột (hàng cuối thiếu thì căn giữa).
function gridOffsets(n: number, cols: number): { row: number; back: number; side: number }[] {
  const rows = Math.ceil(n / cols);
  const out: { row: number; back: number; side: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const cnt = Math.min(cols, n - r * cols);
    const off = (cnt - 1) / 2;
    const back = r * FORM_SPACING - ((rows - 1) * FORM_SPACING) / 2;
    for (let c = 0; c < cnt; c++) out.push({ row: r, back, side: (c - off) * FORM_SPACING });
  }
  return out;
}

// Các hướng quay khối: hướng tiến quân gốc, rồi các trục ngang/dọc của bản đồ
// (hành lang, bờ sông, vách đá đều chạy theo trục ô → khối xoay theo trục dễ lọt hơn).
function orientations(ux: number, uy: number): [number, number][] {
  const out: [number, number][] = [[ux, uy]];
  const main: [number, number] = Math.abs(ux) >= Math.abs(uy) ? [Math.sign(ux) || 1, 0] : [0, Math.sign(uy) || 1];
  const other: [number, number] = main[0] !== 0 ? [0, Math.sign(uy) || 1] : [Math.sign(ux) || 1, 0];
  for (const o of [main, other]) if (Math.abs(o[0] * ux + o[1] * uy) < 0.999) out.push(o);
  return out;
}

// Lập đội hình cho n lính quanh tâm nav (nav.cx, nav.cy), hướng tiến (ux, uy).
// Thứ tự ưu tiên: hình (vuông trước) → hướng quay → độ dịch tâm.
export function planFormation(
  m: GameMap, nav: LocalNav, n: number, ux0: number, uy0: number, claims: SlotClaims, keepGap = 0,
): FormationPlan {
  const gx = nav.cx * T + 32, gy = nav.cy * T + 32; // điểm lính tới trước khi rẽ vào ô
  const MIN_GAP = FORM_SPACING * 0.8;
  // keepGap: khoảng cách tối thiểu tới khối khác ở vòng 1 (khối vừa trọn); vòng 2 chỉ cần không đè
  const okPoint = (x: number, y: number, gap = MIN_GAP) => {
    if (x < 8 || y < 8 || x > MW * T - 8 || y > MH * T - 8) return false;
    const t = tileOf(x, y);
    if (!navReached(nav, t) || m.ground[t] === WATER) return false; // ô đội hình luôn trên cạn
    return !claims.near(x, y, gap);
  };
  const gap1 = Math.max(MIN_GAP, keepGap);

  const shapes = shapeOrder(n);
  const orients = orientations(ux0, uy0);

  // Vòng 1: phương án đầu tiên mà MỌI ô đều đứng được (cùng vùng đi tới được với tâm) → dùng luôn.
  // Kiểm ô viền trước vì hay vướng nhất.
  for (const cols of shapes) {
    const offs = gridOffsets(n, cols);
    const check = offs.slice().sort((p, q) => Math.max(Math.abs(q.back), Math.abs(q.side)) - Math.max(Math.abs(p.back), Math.abs(p.side)));
    for (const [ux, uy] of orients) {
      const px = -uy, py = ux;
      for (const [sa, sb] of SHIFTS) {
        const cx = gx + ux * sa + px * sb, cy = gy + uy * sa + py * sb;
        let ok = true;
        for (const o of check) {
          if (!okPoint(cx - ux * o.back + px * o.side, cy - uy * o.back + py * o.side, gap1)) { ok = false; break; }
        }
        if (ok) return makePlan(cx, cy, cols, offs, ux, uy);
      }
    }
  }

  // Vòng 2: không phương án nào vừa trọn (chỗ quá chật) → chọn phương án có nhiều ô đứng được
  // nhất (khối lớn thì đếm mẫu cho nhanh), giữ các ô đó, phần thiếu lấp bằng các điểm trống
  // gần tâm nhất theo đường đi.
  const stride = Math.max(1, Math.ceil(n / 400));
  let best = { cx: gx, cy: gy, cols: shapes[0], ux: ux0, uy: uy0 };
  let bestCount = -1;
  for (const cols of shapes) {
    const offs = gridOffsets(n, cols);
    for (const [ux, uy] of orients) {
      const px = -uy, py = ux;
      for (const [sa, sb] of SHIFTS) {
        if (((sa / SHIFT_STEP) & 1) || ((sb / SHIFT_STEP) & 1)) continue; // lưới dịch thưa hơn
        const cx = gx + ux * sa + px * sb, cy = gy + uy * sa + py * sb;
        let cnt = 0;
        for (let k = 0; k < offs.length; k += stride) {
          const o = offs[k];
          if (okPoint(cx - ux * o.back + px * o.side, cy - uy * o.back + py * o.side)) cnt++;
        }
        if (cnt > bestCount) { bestCount = cnt; best = { cx, cy, cols, ux, uy }; }
      }
    }
  }
  const { ux, uy } = best, px = -uy, py = ux;
  const plan = makePlan(best.cx, best.cy, best.cols, [], ux, uy);
  for (const o of gridOffsets(n, best.cols)) {
    const x = best.cx - ux * o.back + px * o.side, y = best.cy - uy * o.back + py * o.side;
    if (okPoint(x, y)) plan.slots.push({ row: o.row, side: o.side, x, y });
  }
  plan.rows = Math.ceil(n / best.cols);
  if (plan.slots.length < n) fillSlots(m, nav, plan, n, gx, gy, px, py, claims, MIN_GAP);
  return plan;
}

function makePlan(cx: number, cy: number, cols: number, offs: ReturnType<typeof gridOffsets>, ux: number, uy: number): FormationPlan {
  const px = -uy, py = ux;
  const rows = offs.length ? offs[offs.length - 1].row + 1 : 0;
  return {
    cx, cy, cols, rows, ux, uy,
    slots: offs.map((o) => ({ row: o.row, side: o.side, x: cx - ux * o.back + px * o.side, y: cy - uy * o.back + py * o.side })),
  };
}

const SUB = [[0, 0], [-16, -16], [16, -16], [-16, 16], [16, 16]];

function fillSlots(
  m: GameMap, nav: LocalNav, plan: FormationPlan, n: number, gx: number, gy: number, px: number, py: number,
  claims: SlotClaims, gap: number,
) {
  const own = new SlotClaims();
  for (const s of plan.slots) own.add(s.x, s.y);
  const extraRow = plan.rows;
  for (let k = 0; k < nav.order.length && plan.slots.length < n; k++) {
    const c = nav.order[k];
    const tx = (c % nav.w) + nav.x0, ty = ((c / nav.w) | 0) + nav.y0;
    if (m.ground[ty * MW + tx] === WATER) continue;
    for (const [ox, oy] of SUB) {
      if (plan.slots.length >= n) break;
      const x = tx * T + 32 + ox, y = ty * T + 32 + oy;
      if (own.near(x, y, gap) || claims.near(x, y, gap)) continue;
      own.add(x, y);
      plan.slots.push({ row: extraRow, side: (x - gx) * px + (y - gy) * py, x, y });
    }
  }
  // Bất đắc dĩ (khu vực quá chật): dồn vào tâm, lực tách sẽ đẩy ra.
  while (plan.slots.length < n) plan.slots.push({ row: extraRow, side: 0, x: gx, y: gy });
}

// Tỉ lệ ô của khối vuông (tâm cx, cy) đứng được trong `nav` và không đè khối khác — dùng để chọn chỗ đặt khối.
export function squareFit(m: GameMap, nav: LocalNav, n: number, cx: number, cy: number, ux: number, uy: number, claims: SlotClaims): number {
  const px = -uy, py = ux;
  const offs = gridOffsets(n, Math.ceil(Math.sqrt(n)));
  const stride = Math.max(1, Math.ceil(n / 200));
  let ok = 0, all = 0;
  for (let k = 0; k < offs.length; k += stride) {
    const o = offs[k];
    const x = cx - ux * o.back + px * o.side, y = cy - uy * o.back + py * o.side;
    all++;
    if (x < 8 || y < 8 || x > MW * T - 8 || y > MH * T - 8) continue;
    const t = tileOf(x, y);
    if (navReached(nav, t) && m.ground[t] !== WATER && !claims.near(x, y, FORM_SPACING * 0.8)) ok++;
  }
  return all ? ok / all : 0;
}

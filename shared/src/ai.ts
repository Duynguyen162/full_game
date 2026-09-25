// Chỉ huy máy: điều một phe theo luật "Bốn vành đai" (docs/game_mechanics.md mục 8–9).
//
// Nguyên tắc:
// - Chơi công bằng: chỉ biết vị trí địch trong tầm nhìn của phe mình (visCount + rừng),
//   kèm trí nhớ ngắn hạn về nơi đã thấy địch. Chủ sở hữu mục tiêu là thông tin công khai.
// - Chia quân thành đội có vai trò: 3 đội chủ lực giữ 3 cầu, 2 đội kỵ binh giữ bãi cạn /
//   phản ứng nhanh / truy kích / đột kích cờ, 5 trinh sát canh các ngả vượt sông.
// - Mỗi đội là một máy trạng thái: tiến → giữ → rút (hành quân) → hồi sức trong rừng → tiến.
//   Khi rút mà quân địch đuổi theo bị Rối loạn thì Quay đầu phản công (rút lui giả).
// - Kỵ binh chỉ truy kích quân đang rút khi không có rừng gần đó (tránh bị dụ vào phục kích).
// - Ra lệnh qua hàng đợi, tối đa 1 trường lực mỗi 0.3s để không làm giật khung hình.
import { ARCHER, LANCER, MONK, PAWN, WARRIOR } from "./assets-def";
import { MAX_BUILT_BRIDGES, MH, MW, PRESTIGE_WIN, STANCE_DEFEND, STANCE_PURSUE, T, WATER } from "./constants";
import { passable } from "./map";
import { OBJ_FLAG, OBJ_RIVER } from "./objectives";
import { MOVE_ATTACK, MOVE_MARCH, STATS, type World } from "./world";

const VALUE = [1.0, 0.9, 1.6, 0.5, 0.1]; // sức mạnh tương đối theo binh chủng
const CELL = 16;                         // ô nhớ 16×16 ô bản đồ
const GW = MW / CELL;
const THINK_DT = 1.0;
const ORDER_DT = 0.3;

type Role = "line" | "cav" | "scout";
type State = "advance" | "contain" | "hold" | "withdraw" | "regroup" | "pursue" | "raid" | "respond" | "assault"
  | "depot"   // đi lấy Kho lương
  | "bridge"  // đang cho một toán thợ bắc cầu vòng sườn (phần còn lại chốt đầu cầu)
  | "flank";  // qua cầu vòng sườn, đánh vào sau lưng quân địch đang giữ chỗ vượt sông
// Trạng thái đánh chủ động: ra lệnh Tấn công kiểu vùng chiến đấu (không dàn trận)
const LOOSE_STATES: State[] = ["assault", "respond", "pursue", "raid", "depot", "flank"];

interface Squad {
  name: string;
  role: Role;
  units: number[];
  initStr: number;
  post: number;            // mục tiêu được giao canh giữ
  state: State;
  stateT: number;          // thời điểm vào trạng thái
  task: number;            // mục tiêu đột kích / ứng cứu
  braced: boolean;         // đã cho bộ binh Giữ vị trí
  until: number;           // hạn của trạng thái truy kích / trinh sát lánh mặt
  depot: number;           // chỉ số kho lương đang đi lấy (-1 = không)
  crew: number[];          // thợ đang bắc cầu (tách khỏi units để lệnh của đội không huỷ việc bắc cầu)
  bridge: number;          // id cầu tự xây đang làm / vừa làm (-1 = không)
  flank: number;           // 0 = đang qua cầu, 1 = đang đánh vào sau lưng
}

interface Order { key: string; units: number[]; tx: number; ty: number; mode: number; loose: boolean }

// Phản ứng cấp toàn quân trước một đạo quân lớn ("dồn cục") của địch
type ArmyMode = "normal" | "converge" | "engage" | "evade";
interface Army { mode: ArmyMode; t: number; rx: number; ry: number; mx: number; my: number; ms: number; seenT: number }

export class AICommander {
  private squads: Squad[] = [];
  private queue: Order[] = [];
  private last = new Map<string, { tx: number; ty: number; mode: number; t: number }>();
  private nextThink = 0;
  private nextOrder = 0;
  private memStr = new Float32Array(GW * GW);
  private memT = new Float32Array(GW * GW).fill(-999);
  private visible: number[] = [];
  private army: Army = { mode: "normal", t: 0, rx: 0, ry: 0, mx: 0, my: 0, ms: 0, seenT: -99 };
  private readonly dir: number; // hướng về nhà theo trục x (+1 phe Đông, -1 phe Tây)
  readonly log: string[] = [];

  constructor(private w: World, readonly side: 0 | 1) {
    this.dir = side === 1 ? 1 : -1;
    this.nextOrder = side * 0.15; // lệch nhịp với chỉ huy còn lại (nếu có) để không dồn 2 trường lực vào 1 khung
    this.formSquads();
  }

  // ------------------------------------------------------------ lập đội

  private formSquads() {
    const w = this.w, s = this.side;
    const byType: number[][] = [[], [], [], [], []];
    for (let i = 0; i < w.n; i++) if (w.alive[i] && w.side[i] === s) byType[w.type[i]].push(i);
    for (const l of byType) l.sort((a, b) => w.y[a] - w.y[b]);
    // chia theo trục y: bắc / giữa / nam
    const split = (l: number[], fr: number[]) => {
      const out: number[][] = [];
      let k = 0;
      fr.forEach((f, idx) => {
        const n = idx === fr.length - 1 ? l.length - k : Math.round(l.length * f);
        out.push(l.slice(k, k + n));
        k += n;
      });
      return out;
    };
    const [wN, wC, wS] = split(byType[WARRIOR], [0.28, 0.44, 0.28]);
    const [aN, aC, aS] = split(byType[ARCHER], [0.27, 0.46, 0.27]);
    const [mN, mC, mS] = split(byType[MONK], [0.26, 0.48, 0.26]);
    const [cN, cS] = split(byType[LANCER], [0.5, 0.5]);
    const river = this.w.obj.filter((o) => o.kind === OBJ_RIVER).sort((a, b) => a.ty - b.ty).map((o) => o.id);
    // river[0..4] = cầu bắc, bãi cạn bắc, cầu giữa, bãi cạn nam, cầu nam
    const mk = (name: string, role: Role, units: number[], post: number): Squad => ({
      name, role, units, initStr: this.strength(units), post, state: "advance", stateT: 0, task: -1, braced: false, until: 0,
      depot: -1, crew: [], bridge: -1, flank: 0,
    });
    this.squads = [
      mk("Chủ lực giữa", "line", [...wC, ...aC, ...mC], river[2]),
      mk("Cánh bắc", "line", [...wN, ...aN, ...mN], river[0]),
      mk("Cánh nam", "line", [...wS, ...aS, ...mS], river[4]),
      mk("Kỵ binh bắc", "cav", cN, river[1]),
      mk("Kỵ binh nam", "cav", cS, river[3]),
      ...byType[PAWN].map((u, k) => mk(`Trinh sát ${k + 1}`, "scout", [u], river[k % river.length])),
    ];
    for (const sq of this.squads) if (sq.role !== "scout") this.w.orderStance(sq.units, STANCE_DEFEND);
  }

  // ------------------------------------------------------------ vòng lặp

  update() {
    const w = this.w;
    if (w.winner >= 0) return;
    if (w.time >= this.nextThink) {
      this.nextThink = w.time + THINK_DT;
      this.perceive();
      this.plan();
    }
    this.flush();
  }

  status(): string[] {
    const a = this.army;
    const head = a.mode === "normal" ? [] : [`TOÀN QUÂN: ${ARMY_VI[a.mode]} — đạo quân lớn của địch ~${Math.round(a.ms)} sức mạnh tại (${Math.round(a.mx)}, ${Math.round(a.my)})`];
    return head.concat(this.squads
      .filter((q) => q.units.length)
      .map((q) => `${q.name}: ${STATE_VI[q.state]} · ${q.units.length} quân${q.task >= 0 ? ` → ${this.w.obj[q.task].label}` : ""}`));
  }

  // ------------------------------------------------------------ nhận thức

  private perceive() {
    const w = this.w, s = this.side, e = 1 - s, vc = w.visCount[s];
    const cur = new Float32Array(GW * GW);
    this.visible.length = 0;
    for (let j = 0; j < w.n; j++) {
      if (!w.alive[j] || w.side[j] !== e) continue;
      const t = w.tile[j];
      if (!vc[t] || !w.targetable(s, j)) continue;
      this.visible.push(j);
      cur[this.cellOf(t)] += this.unitStr(j);
    }
    for (let c = 0; c < GW * GW; c++) {
      const cx = (c % GW) * CELL + (CELL >> 1), cy = ((c / GW) | 0) * CELL + (CELL >> 1);
      if (vc[cy * MW + cx] > 0 || cur[c] > 0) { this.memStr[c] = cur[c]; this.memT[c] = w.time; }
    }
    // "Bụi mù": đạo quân lớn của địch lộ vị trí gần đúng dù trong sương mù (thông tin công khai của luật)
    for (const b of w.bigArmies) {
      if (b.side !== e) continue;
      const c = this.cellOf(Math.max(0, Math.min(MH - 1, b.ty)) * MW + Math.max(0, Math.min(MW - 1, b.tx)));
      if (this.memT[c] < w.time) { this.memStr[c] = Math.max(this.memStr[c], b.n * 0.85); this.memT[c] = w.time; }
    }
  }

  private cellOf(t: number) {
    return (((t / MW) | 0) / CELL | 0) * GW + ((t % MW) / CELL | 0);
  }

  private unitStr(i: number) {
    const t = this.w.type[i];
    return VALUE[t] * (this.w.hp[i] / STATS[t].hp);
  }

  private strength(units: number[]) {
    let s = 0;
    for (const i of units) if (this.w.alive[i]) s += this.unitStr(i);
    return s;
  }

  // Sức mạnh địch quanh (tx, ty) bán kính r ô: đang thấy = 100%, nhớ < 25s = 70%.
  private enemyNear(tx: number, ty: number, r: number) {
    let sum = 0;
    const c0x = Math.max(0, ((tx - r) / CELL) | 0), c1x = Math.min(GW - 1, ((tx + r) / CELL) | 0);
    const c0y = Math.max(0, ((ty - r) / CELL) | 0), c1y = Math.min(GW - 1, ((ty + r) / CELL) | 0);
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      const c = cy * GW + cx;
      const age = this.w.time - this.memT[c];
      if (age > 25) continue;
      sum += this.memStr[c] * (age <= 1.5 ? 1 : 0.7);
    }
    return sum;
  }

  private centroid(units: number[]): [number, number] | null {
    let x = 0, y = 0, c = 0;
    for (const i of units) if (this.w.alive[i]) { x += this.w.x[i]; y += this.w.y[i]; c++; }
    return c ? [x / c / T, y / c / T] : null;
  }

  private avgHp(units: number[]) {
    let h = 0, c = 0;
    for (const i of units) if (this.w.alive[i]) { h += this.w.hp[i] / STATS[this.w.type[i]].hp; c++; }
    return c ? h / c : 0;
  }

  // Quân địch đang thấy trong bán kính r quanh (tx, ty)
  private visibleNear(tx: number, ty: number, r: number) {
    const out: number[] = [];
    const r2 = (r * T) ** 2, px = tx * T, py = ty * T;
    for (const j of this.visible) if ((this.w.x[j] - px) ** 2 + (this.w.y[j] - py) ** 2 <= r2) out.push(j);
    return out;
  }

  private forestAround(tx: number, ty: number, r: number) {
    let c = 0;
    for (let y = Math.max(0, ty - r); y <= Math.min(MH - 1, ty + r); y++)
      for (let x = Math.max(0, tx - r); x <= Math.min(MW - 1, tx + r); x++) if (this.w.m.forest[y * MW + x]) c++;
    return c;
  }

  // ------------------------------------------------------------ vị trí

  private front(objId: number): [number, number] {
    const o = this.w.obj[objId];
    return o.kind === OBJ_RIVER ? [o.tx + this.dir * 2, o.ty] : [o.tx, o.ty];
  }

  // Điểm lui quân: lùi ~24 ô về phía nhà, ưu tiên ô rừng (hồi máu + phục kích)
  private fallback(objId: number): [number, number] {
    const o = this.w.obj[objId], m = this.w.m;
    const bx = Math.max(2, Math.min(MW - 3, o.tx + this.dir * 24)), by = o.ty;
    let best: [number, number] = [bx, by], bd = Infinity;
    for (let y = Math.max(0, by - 12); y <= Math.min(MH - 1, by + 12); y++) {
      for (let x = Math.max(0, bx - 12); x <= Math.min(MW - 1, bx + 12); x++) {
        const t = y * MW + x;
        if (!m.forest[t] || !passable(m, t) || m.level[t] !== 0) continue;
        const d = (x - bx) ** 2 + (y - by) ** 2;
        if (d < bd) { bd = d; best = [x, y]; }
      }
    }
    return best;
  }

  // ------------------------------------------------------------ ra lệnh

  private issue(key: string, units: number[], tx: number, ty: number, mode: number, force = false, loose = false) {
    const live = units.filter((i) => this.w.alive[i]);
    if (!live.length) return;
    const l = this.last.get(key);
    const same = l && l.mode === mode && Math.hypot(l.tx - tx, l.ty - ty) < 4;
    // cùng đích: chỉ ra lại khi quân đã dừng hẳn ở xa đích (bị kéo lệch / mất trường lực), tối đa 12s/lần
    if (same && !force && !(this.w.time - l.t > 12 && this.stalled(live, tx, ty))) return;
    this.queue = this.queue.filter((q) => q.key !== key);
    this.queue.push({ key, units: live, tx: Math.round(tx), ty: Math.round(ty), mode, loose });
    this.last.set(key, { tx, ty, mode, t: this.w.time });
  }

  // Đa số quân không còn trường lực mà tâm đội vẫn cách đích > 10 ô
  private stalled(units: number[], tx: number, ty: number) {
    let idle = 0;
    for (const i of units) if (this.w.field[i] < 0 && !this.w.returning[i]) idle++;
    const c = this.centroid(units);
    return !!c && idle > units.length * 0.6 && Math.hypot(c[0] - tx, c[1] - ty) > 10;
  }

  private flush() {
    if (!this.queue.length || this.w.time < this.nextOrder) return;
    const q = this.queue.shift()!;
    this.w.orderMove(q.units.filter((i) => this.w.alive[i] && this.w.buildTask[i] < 0), q.tx, q.ty, q.mode, false, q.loose);
    this.nextOrder = this.w.time + ORDER_DT;
  }

  private setState(sq: Squad, st: State, why?: string) {
    if (sq.state === st) return;
    sq.state = st;
    sq.stateT = this.w.time;
    sq.braced = false;
    if (why) {
      this.log.push(`[${fmt(this.w.time)}] ${sq.name}: ${why}`);
      if (this.log.length > 12) this.log.shift();
    }
  }

  // Đưa đội tới (tx, ty): bộ binh + tu sĩ ở trước, cung thủ lùi 5 ô về phía nhà.
  // Trạng thái đánh chủ động (LOOSE_STATES) + Tấn công → vùng chiến đấu: lính tự chọn chỗ đánh, không dàn trận.
  private moveSquad(sq: Squad, tx: number, ty: number, mode: number, force = false) {
    const loose = mode === MOVE_ATTACK && LOOSE_STATES.includes(sq.state);
    if (sq.role === "line") {
      const melee = sq.units.filter((i) => this.w.type[i] !== ARCHER);
      const ranged = sq.units.filter((i) => this.w.type[i] === ARCHER);
      this.issue(`${sq.name}/m`, melee, tx, ty, mode, force, loose);
      const back = this.w.obj[sq.post].kind === OBJ_FLAG && mode !== MOVE_MARCH ? 0 : 5;
      this.issue(`${sq.name}/r`, ranged, tx + this.dir * back, ty, mode, force, loose);
    } else this.issue(sq.name, sq.units, tx, ty, mode, force, loose);
  }

  private forget(sq: Squad) {
    this.last.delete(`${sq.name}/m`);
    this.last.delete(`${sq.name}/r`);
    this.last.delete(sq.name);
  }

  // ------------------------------------------------------------ kế hoạch

  private plan() {
    const w = this.w, s = this.side, e = 1 - s;
    for (const sq of this.squads) { sq.units = sq.units.filter((i) => w.alive[i]); sq.crew = sq.crew.filter((i) => w.alive[i]); }
    this.mergeWeak();
    const myAlive = w.combatAlive(s), enAlive = w.combatAlive(e);
    const assault = w.time > 240 && myAlive > enAlive * 1.7;
    const desperate = w.prestige[e] > PRESTIGE_WIN * 0.7 && w.prestige[e] > w.prestige[s] + 60;
    this.updateArmy();
    this.planDepots();
    for (const sq of this.squads) {
      if (sq.crew.length && sq.state !== "bridge") this.mergeCrew(sq); // bị kéo sang việc khác → gọi thợ về
      if (!sq.units.length) continue;
      if (sq.role !== "scout" && this.armyOverride(sq)) { sq.depot = -1; continue; }
      if (sq.state === "depot" && this.runDepot(sq)) continue;
      if (sq.role === "line") this.planLine(sq, assault, desperate);
      else if (sq.role === "cav") this.planCav(sq, desperate);
    }
    this.planScouts();
  }

  // ------------------------------------------------------------ phản ứng toàn quân

  // Tìm cụm địch mạnh nhất (bán kính 20 ô) trong trí nhớ. Mạnh hơn hẳn mọi đội của mình = "dồn cục".
  private findMass(): [number, number, number] | null {
    let best = 0, bx = 0, by = 0;
    const now = this.w.time;
    for (let c = 0; c < GW * GW; c++) {
      if (now - this.memT[c] > 25 || this.memStr[c] < 40) continue;
      const cx = (c % GW) * CELL + 8, cy = ((c / GW) | 0) * CELL + 8;
      const st = this.enemyNear(cx, cy, 20);
      if (st > best) { best = st; bx = cx; by = cy; }
    }
    return best > 0 ? [bx, by, best] : null;
  }

  private updateArmy() {
    const a = this.army, now = this.w.time;
    const fighters = this.squads.filter((q) => q.role !== "scout" && q.units.length);
    const strongest = Math.max(0, ...fighters.map((q) => this.strength(q.units)));
    const total = fighters.reduce((s, q) => s + this.strength(q.units), 0);
    const mass = this.findMass();
    const isBlob = !!mass && mass[2] > strongest * 1.3 && mass[2] > 700;
    if (isBlob) { a.mx = mass![0]; a.my = mass![1]; a.ms = mass![2]; a.seenT = now; }
    const lost = now - a.seenT > 20;

    if (a.mode === "normal") {
      if (!isBlob) return;
      this.setRally();
      if (total >= a.ms * 0.95) this.setArmy("converge", `phát hiện đạo quân lớn (~${Math.round(a.ms)}) → tập trung toàn quân`);
      else this.setArmy("evade", `đạo quân lớn (~${Math.round(a.ms)}) mạnh hơn toàn quân → né, đánh chỗ trống`);
      return;
    }
    if (lost || a.ms < total * 0.3) { this.setArmy("normal", "đạo quân lớn đã tan / mất dấu → trở lại thế trận thường"); return; }
    if (a.mode === "converge") {
      // tụ đủ 70% lực lượng, hoặc quá 45s, hoặc địch đã áp sát điểm tụ → xuất trận cùng lúc
      let near = 0;
      for (const q of fighters) { const c = this.centroid(q.units); if (c && Math.hypot(c[0] - a.rx, c[1] - a.ry) < 22) near += this.strength(q.units); }
      if (near >= total * 0.7 || now - a.t > 45 || Math.hypot(a.mx - a.rx, a.my - a.ry) < 16) this.setArmy("engage", "đã tập trung → toàn quân xuất kích cùng lúc");
      else if (total < a.ms * 0.8) this.setArmy("evade", "lực lượng không đủ → chuyển sang né");
    } else if (a.mode === "engage") {
      if (total < a.ms * 0.6) { this.setRally(); this.setArmy("evade", "thua thế → rút, bảo toàn lực lượng"); }
    } else if (a.mode === "evade") {
      if (total >= a.ms * 1.05) { this.setRally(); this.setArmy("converge", "lực lượng đã đủ → tập trung phản công"); }
    }
  }

  private setArmy(mode: ArmyMode, why: string) {
    this.army.mode = mode;
    this.army.t = this.w.time;
    this.log.push(`[${fmt(this.w.time)}] TOÀN QUÂN: ${why}`);
    if (this.log.length > 12) this.log.shift();
    for (const q of this.squads) { this.last.delete(`${q.name}/m`); this.last.delete(`${q.name}/r`); this.last.delete(q.name); }
  }

  // Điểm tụ quân: lùi ~28 ô từ đạo quân địch về phía Thành mình, ưu tiên cao nguyên (cung +2 tầm) rồi rừng.
  private setRally() {
    const a = this.army, m = this.w.m;
    const castle = this.w.castleOf(this.side);
    const hx = castle ? castle.tx : this.side === 1 ? MW - 30 : 30, hy = castle ? castle.ty : MH / 2;
    const d = Math.hypot(hx - a.mx, hy - a.my) || 1;
    const k = Math.min(28, d * 0.6);
    const bx = Math.round(a.mx + ((hx - a.mx) / d) * k), by = Math.round(a.my + ((hy - a.my) / d) * k);
    let best: [number, number] = [bx, by], bs = -Infinity;
    for (let y = Math.max(0, by - 10); y <= Math.min(MH - 1, by + 10); y++) {
      for (let x = Math.max(0, bx - 10); x <= Math.min(MW - 1, bx + 10); x++) {
        const t = y * MW + x;
        if (!passable(m, t) || m.ramp[t]) continue;
        const score = m.level[t] * 3 + (m.forest[t] ? 2 : 0) - Math.hypot(x - bx, y - by) * 0.3;
        if (score > bs) { bs = score; best = [x, y]; }
      }
    }
    a.rx = best[0]; a.ry = best[1];
  }

  // Trả về true nếu chế độ toàn quân đã điều khiển đội này
  private armyOverride(sq: Squad): boolean {
    const a = this.army;
    if (a.mode === "normal") return false;
    const c = this.centroid(sq.units);
    if (!c) return true;
    if (a.mode === "converge") {
      // đội đang ở sát đạo quân địch thì hành quân (không vướng đánh) về điểm tụ
      const close = Math.hypot(c[0] - a.mx, c[1] - a.my) < 18;
      this.moveSquad(sq, a.rx, a.ry, close ? MOVE_MARCH : MOVE_ATTACK);
      if (sq.state !== "respond") this.setState(sq, "respond");
      sq.task = -1;
      return true;
    }
    if (a.mode === "engage") {
      this.w.orderStance(sq.units, STANCE_DEFEND);
      this.moveSquad(sq, a.mx, a.my, MOVE_ATTACK);
      if (sq.state !== "assault") this.setState(sq, "assault");
      return true;
    }
    // evade: đội trong vòng 30 ô quanh đạo quân địch rút về điểm tụ; đội khác chơi bình thường (đánh chỗ trống)
    if (Math.hypot(c[0] - a.mx, c[1] - a.my) < 30) {
      this.moveSquad(sq, a.rx, a.ry, MOVE_MARCH);
      if (sq.state !== "withdraw") this.setState(sq, "withdraw");
      return true;
    }
    return false;
  }

  // Đội chủ lực quá yếu thì nhập vào đội gần nhất để khỏi bị ăn mòn từng phần.
  private mergeWeak() {
    const lines = this.squads.filter((q) => q.role === "line" && q.units.length);
    for (const q of lines) {
      if (lines.length < 2 || this.strength(q.units) > q.initStr * 0.22) continue;
      const c = this.centroid(q.units);
      if (!c) continue;
      let best: Squad | null = null, bd = Infinity;
      for (const o of lines) {
        if (o === q || !o.units.length) continue;
        const oc = this.centroid(o.units);
        if (!oc) continue;
        const d = Math.hypot(oc[0] - c[0], oc[1] - c[1]);
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) continue;
      best.units.push(...q.units);
      this.log.push(`[${fmt(this.w.time)}] ${q.name} nhập vào ${best.name}`);
      q.units = [];
      this.last.delete(`${best.name}/m`);
      this.last.delete(`${best.name}/r`);
    }
  }

  private planLine(sq: Squad, assault: boolean, desperate: boolean) {
    const w = this.w, s = this.side, e = 1 - s;
    const c = this.centroid(sq.units)!;
    const my = this.strength(sq.units);
    const local = this.enemyNear(c[0], c[1], 12);
    const [fx, fy] = this.front(sq.post);
    const now = w.time;

    // Tổng tấn công khi áp đảo: chủ lực giữa đánh thẳng vào Thành địch
    if (assault && sq.name === "Chủ lực giữa" && sq.state !== "withdraw") {
      const castle = w.castleOf(e);
      if (castle && castle.hp > 0) {
        this.setState(sq, "assault", "áp đảo quân số → tổng tấn công Thành địch");
        this.moveSquad(sq, castle.tx + castle.fw / 2 - this.dir * 4, castle.ty + 1, MOVE_ATTACK);
        return;
      }
    }
    // Địch sắp thắng bằng Uy thế: 2 đội gần nhất dồn quân lấy lại cứ điểm sông yếu nhất của địch
    if (desperate && sq.state !== "withdraw") {
      const tgt = this.weakestEnemyRiver();
      if (tgt >= 0 && this.nearestLines(tgt, 2).includes(sq)) {
        sq.task = tgt;
        this.setState(sq, "respond", `địch sắp đủ Uy thế → dồn quân chiếm ${w.obj[tgt].label}`);
        const [tx, ty] = this.front(tgt);
        this.moveSquad(sq, tx, ty, MOVE_ATTACK);
        return;
      }
    }

    // Đội đang tiến quân / giữ trận:
    //  - đứng ở mặt trận (≤ 18 ô) mà địch vẫn giữ chỗ vượt sông trước mặt quá 45 giây → bắc cầu vòng sườn
    //  - mình giữ được chỗ vượt sông, quanh đội yên ổn → tách một toán đi cắm cờ nội địa địch
    //    (cờ chỉ cho điểm khi có đầu cầu)
    if (sq.state === "advance" || sq.state === "hold") {
      if (w.objOwner[sq.post] !== s) {
        if (now - sq.stateT > 45 && Math.hypot(c[0] - fx, c[1] - fy) < 18) this.tryBridge(sq, my);
      } else if (now > 150 && this.visibleNear(c[0], c[1], 12).length < 6) this.tryFlagParty(sq, my);
    }

    switch (sq.state) {
      case "assault":
      case "respond":
      case "advance": {
        if (sq.state !== "advance" && !assault && !desperate) { sq.task = -1; this.setState(sq, "advance"); }
        if (local > my * 1.5 && my < sq.initStr * 0.7) {
          this.setState(sq, "withdraw", "địch đông hơn nhiều → hành quân rút về rừng");
          break;
        }
        // Địch giữ cứ điểm mạnh hơn mình: không lao lên cầu chịu tiêu hao, chốt đầu cầu chờ thời
        if (sq.state === "advance" && this.enemyNear(fx, fy, 10) > my * 1.3) {
          this.setState(sq, "contain", `${w.obj[sq.post].label} bị giữ chặt → chốt đầu cầu`);
          break;
        }
        this.moveSquad(sq, fx, fy, MOVE_ATTACK);
        if (Math.hypot(c[0] - fx, c[1] - fy) < 9) this.setState(sq, "hold", `đã tới ${w.obj[sq.post].label}, dàn trận giữ`);
        break;
      }
      case "contain": {
        const o = w.obj[sq.post];
        const sx = o.tx + this.dir * 14, sy = o.ty;
        if (local > my * 1.6) { this.setState(sq, "withdraw", "bị tấn công mạnh ở đầu cầu → rút"); break; }
        this.moveSquad(sq, sx, sy, MOVE_ATTACK);
        // thế địch yếu đi (bị rút quân đi nơi khác / bị tiêu hao) → tiến lên
        if (now - sq.stateT > 8 && this.enemyNear(fx, fy, 10) < my * 1.05) { this.setState(sq, "advance", `địch ở ${o.label} yếu đi → tiến công`); break; }
        // chốt lâu mà địch vẫn giữ chặt → bắc cầu vòng sườn ở đoạn sông vắng
        if (now - sq.stateT > 20) this.tryBridge(sq, my);
        break;
      }
      case "bridge": {
        const br = w.builtBridges[sq.bridge];
        const o = w.obj[sq.post];
        if (!br || !br.alive || now - sq.stateT > 150 || local > my * 1.6) {
          const why = !br || !br.alive ? "cầu vòng sườn bị phá → quay lại chốt đầu cầu"
            : local > my * 1.6 ? "bị tấn công mạnh → bỏ bắc cầu, rút" : "bắc cầu quá lâu → bỏ dở";
          this.mergeCrew(sq);
          this.setState(sq, local > my * 1.6 ? "withdraw" : "contain", why);
          break;
        }
        if (br.done) {
          this.mergeCrew(sq);
          sq.flank = 0;
          this.setState(sq, "flank", `bắc xong cầu vòng sườn → qua sông đánh sau lưng quân giữ ${o.label}`);
          break;
        }
        this.moveSquad(sq, fx, fy, MOVE_ATTACK); // phần còn lại vẫn giữ đầu cầu phía mình
        break;
      }
      case "flank": {
        const br = w.builtBridges[sq.bridge];
        const o = w.obj[sq.post];
        if (w.objOwner[sq.post] === s || now - sq.stateT > 180) { this.setState(sq, "advance", `vòng sườn xong, về giữ ${o.label}`); break; }
        if (my < sq.initStr * 0.35 || local > my * 1.5) { this.setState(sq, "withdraw", "vòng sườn thất bại → rút"); break; }
        if (sq.flank === 0 && br) {
          // đầu cầu phía địch
          const ex = br.dir > 0 ? br.xb + 8 : br.xa - 8, ey = (br.y0 + br.y1) >> 1;
          this.moveSquad(sq, ex, ey, MOVE_ATTACK);
          if (Math.hypot(c[0] - ex, c[1] - ey) < 9 || !br.alive) { sq.flank = 1; this.forget(sq); }
        } else {
          // đánh vào quân địch ở phía bên kia chỗ vượt sông (sau lưng chúng)
          this.moveSquad(sq, o.tx - this.dir * 8, o.ty, MOVE_ATTACK);
        }
        break;
      }
      case "hold": {
        const near = this.visibleNear(fx, fy, 12);
        if (local > my * 1.6 || my < sq.initStr * 0.35) {
          this.setState(sq, "withdraw", "thế yếu → rút lui có tổ chức");
          break;
        }
        // có địch áp sát: bộ binh Giữ vị trí (nhận 60% sát thương), cung thủ tự bắn
        if (near.length > 10 && !sq.braced) {
          w.orderHold(sq.units.filter((i) => w.type[i] === WARRIOR));
          sq.braced = true;
        } else if (!near.length && sq.braced && now - sq.stateT > 20) {
          w.orderStance(sq.units, STANCE_DEFEND); // bỏ Hold để có thể đuổi ngắn
          sq.braced = false;
        }
        // bị kéo lệch khỏi vị trí (đuổi theo địch) mà quanh đó không còn địch → về lại
        if (!near.length && Math.hypot(c[0] - fx, c[1] - fy) > 10) this.moveSquad(sq, fx, fy, MOVE_ATTACK, true);
        break;
      }
      case "withdraw": {
        const [bx, by] = this.fallback(sq.post);
        this.moveSquad(sq, bx, by, MOVE_MARCH);
        // Rút lui giả: đã rút >= 3s, quân đuổi theo đang Rối loạn và mình không yếu hơn → Quay đầu
        const chasers = this.visibleNear(c[0], c[1], 9);
        if (now - sq.stateT >= 3 && chasers.length >= 12) {
          let dis = 0, cs = 0;
          for (const j of chasers) { if (w.disorder[j]) dis++; cs += this.unitStr(j); }
          if (dis / chasers.length >= 0.3 && my >= cs * 0.8) {
            w.orderRally(sq.units);
            this.last.delete(`${sq.name}/m`);
            this.last.delete(`${sq.name}/r`);
            this.setState(sq, "advance", `địch đuổi bị Rối loạn → QUAY ĐẦU phản công`);
            break;
          }
        }
        if (Math.hypot(c[0] - bx, c[1] - by) < 7) this.setState(sq, "regroup", "về tới rừng, hồi sức");
        break;
      }
      case "regroup": {
        const threat = this.enemyNear(fx, fy, 18);
        const ready = now - sq.stateT > 10 && (this.avgHp(sq.units) >= 0.85 || now - sq.stateT > 35);
        if (ready && local < my * 0.8 && (threat < my * 1.2 || desperate)) this.setState(sq, "advance", `hồi sức xong, tiến lại ${w.obj[sq.post].label}`);
        else if (local > my * 1.3) {
          // bị đánh ngay tại rừng: đứng lại đánh (lợi thế phục kích) — không rút tiếp
          this.moveSquad(sq, c[0], c[1], MOVE_ATTACK);
        }
        break;
      }
      default:
        this.setState(sq, "advance");
    }
  }

  // ------------------------------------------------------------ toán cắm cờ

  // Đội chủ lực đang giữ đầu cầu tách ~35% bộ binh + một ít cung thủ thành toán cắm cờ. Toán này chạy
  // theo logic đột kích của kỵ binh (planCav: raid → cắm xong đánh tiếp cờ khác / gặp địch mạnh thì rút).
  private flagParties = 0;
  private tryFlagParty(sq: Squad, my: number) {
    const w = this.w;
    if (this.squads.some((q) => q.name.startsWith("Toán cắm cờ") && q.units.length && q.post === sq.post)) return;
    if (sq.units.length < 80 || my < sq.initStr * 0.25) return;
    const c = this.centroid(sq.units)!;
    const k = this.pickRaidTarget(c, my * 0.6, true);
    if (k < 0 || w.obj[k].front !== w.obj[sq.post].front) return;
    const melee = sq.units.filter((i) => w.type[i] === WARRIOR || w.type[i] === LANCER);
    const ranged = sq.units.filter((i) => w.type[i] === ARCHER);
    const party = [...melee.slice(0, Math.floor(melee.length * 0.35)), ...ranged.slice(0, Math.floor(ranged.length * 0.2))];
    if (party.length < 25) return;
    const set = new Set(party);
    sq.units = sq.units.filter((i) => !set.has(i));
    this.forget(sq);
    const q: Squad = {
      name: `Toán cắm cờ ${++this.flagParties}`, role: "cav", units: party, initStr: this.strength(party), post: sq.post,
      state: "raid", stateT: w.time, task: k, braced: false, until: 0, depot: -1, crew: [], bridge: -1, flank: 0,
    };
    this.squads.push(q);
    w.orderStance(party, STANCE_DEFEND);
    this.log.push(`[${fmt(w.time)}] ${sq.name}: giữ được đầu cầu → tách ${party.length} quân đi cắm ${w.obj[k].label}`);
    if (this.log.length > 12) this.log.shift();
    this.sendScoutToBlind(k);
  }

  // ------------------------------------------------------------ bắc cầu vòng sườn

  // Chỗ bắc cầu: đoạn sông cách chỗ vượt sông đang bị chốt 24–60 ô, bắc được, gần như không có địch
  // trong 20 ô; gần nhất trước.
  private findBridgeSpot(post: number, my: number): [number, number] | null {
    const w = this.w, o = w.obj[post], m = w.m;
    let best: [number, number] | null = null, bs = Infinity;
    for (let off = 24; off <= 60; off += 2) for (const sgn of [1, -1]) {
      const y = o.ty + sgn * off;
      if (y < 6 || y > MH - 7) continue;
      // dòng sông ở hàng này: dải nước sâu gần chỗ vượt sông nhất
      let a = -1, b = -1;
      for (let x = Math.max(0, o.tx - 30); x <= Math.min(MW - 1, o.tx + 30); x++) {
        if (m.ground[y * MW + x] === WATER) { if (a < 0) a = x; b = x; } else if (a >= 0) break;
      }
      if (a < 0) continue;
      const x = (a + b) >> 1;
      if (!w.planBridge(this.side, x, y).ok) continue;
      // phải thật vắng: bị thấy lúc đang xây là mất cầu (và mất lượt xây)
      const g = this.enemyNear(x, y, 20);
      if (g > 12) continue;
      const sc = off + g * 4;
      if (sc < bs) { bs = sc; best = [x, y]; }
    }
    return best;
  }

  private tryBridge(sq: Squad, my: number) {
    const w = this.w, s = this.side;
    if (this.squads.some((q) => q.state === "bridge")) return; // mỗi lúc chỉ một công trình
    if (w.builtBridges.filter((b) => b.alive && b.side === s).length >= MAX_BUILT_BRIDGES) return;
    if (sq.units.length < 60) return;
    const spot = this.findBridgeSpot(sq.post, my);
    if (!spot) return;
    const [x, y] = spot;
    let pool = sq.units.filter((i) => w.type[i] === WARRIOR);
    if (pool.length < 12) pool = sq.units.filter((i) => w.type[i] !== ARCHER && w.type[i] !== MONK);
    const crew = pool.sort((a, b) => Math.hypot(w.x[a] / T - x, w.y[a] / T - y) - Math.hypot(w.x[b] / T - x, w.y[b] / T - y) || a - b).slice(0, 24);
    if (crew.length < 8) return;
    const err = w.orderBuildBridge(crew, x, y);
    if (err) return;
    const set = new Set(crew);
    sq.crew = crew;
    sq.units = sq.units.filter((i) => !set.has(i));
    sq.bridge = w.builtBridges.length - 1;
    this.forget(sq);
    this.setState(sq, "bridge", `${w.obj[sq.post].label} bị giữ chặt → bắc cầu vòng sườn tại (${x}, ${y})`);
  }

  private mergeCrew(sq: Squad) {
    // cầu còn dở mà thợ bị gọi về → tháo bỏ để trả lại lượt xây (mỗi phe chỉ có 2 lượt)
    if (sq.bridge >= 0) this.w.abandonBridge(sq.bridge);
    if (!sq.crew.length) return;
    sq.units.push(...sq.crew.filter((i) => this.w.alive[i]));
    sq.crew = [];
    this.forget(sq);
  }

  // ------------------------------------------------------------ kho lương

  // Kho lương đang mở mà chưa đội nào đi lấy: giao cho đội rảnh gần nhất đủ sức (ưu tiên kỵ binh — nhanh,
  // và không kéo chủ lực rời chỗ vượt sông). Không lấy nếu phải bỏ trống cứ điểm đang bị đe doạ.
  private planDepots() {
    const w = this.w;
    w.depots.forEach((d, k) => {
      if (d.claimed || d.expired || this.w.time - d.spawnT > 110) return;
      if (this.squads.some((q) => q.state === "depot" && q.depot === k)) return;
      const guard = this.enemyNear(d.tx, d.ty, 12);
      // kho bên phần sân địch: địch cũng sẽ tới lấy → chỉ đi khi gần như không có ai canh
      const enemyHalf = this.side === 0 ? d.tx >= MW / 2 : d.tx < MW / 2;
      if (enemyHalf && (guard > 0 || this.w.time - d.spawnT < 40)) return;
      let best: Squad | null = null, bs = Infinity;
      for (const q of this.squads) {
        if (!q.units.length || q.role === "scout") continue;
        if (q.state !== "advance" && q.state !== "hold" && q.state !== "contain") continue;
        const c = this.centroid(q.units);
        if (!c) continue;
        const my = this.strength(q.units);
        const dist = Math.hypot(c[0] - d.tx, c[1] - d.ty);
        if (q.role === "line" && dist > 60) continue;          // chủ lực chỉ lấy kho ngay gần
        if (this.enemyNear(c[0], c[1], 12) > my * 0.25) continue; // đang giao chiến thì không rút đi lấy kho
        if (dist > 150 || my < guard * 1.3 + 15) continue;
        const [fx, fy] = this.front(q.post);
        if (this.enemyNear(fx, fy, 12) > my * 0.5) continue;  // cứ điểm của đội đang bị đe doạ
        const sc = dist + (q.role === "line" ? 40 : 0) + (enemyHalf ? 80 : 0);
        if (sc < bs) { bs = sc; best = q; }
      }
      if (!best) return;
      best.depot = k;
      const bc = this.centroid(best.units)!;
      best.until = Math.hypot(bc[0] - d.tx, bc[1] - d.ty); // khoảng cách lúc nhận việc (để biết có tiến triển không)
      this.setState(best, "depot", `đi lấy Kho lương tại (${d.tx}, ${d.ty})`);
    });
  }

  // Trả về true nếu đội vẫn đang lo việc lấy kho
  private runDepot(sq: Squad): boolean {
    const w = this.w, d = w.depots[sq.depot];
    const c = this.centroid(sq.units)!;
    if (!d || d.claimed || d.expired) {
      sq.depot = -1;
      this.setState(sq, "advance", d?.claimed ? "xong việc kho lương, về vị trí" : "kho lương đã hết hạn, về vị trí");
      return false;
    }
    if (this.enemyNear(c[0], c[1], 12) > this.strength(sq.units) * 1.2) {
      sq.depot = -1;
      this.setState(sq, "withdraw", "gặp địch mạnh trên đường lấy kho → rút");
      return false;
    }
    // 40 giây mà không lại gần kho hơn (bị cuốn vào trận / kẹt đường) → bỏ
    const dist = Math.hypot(c[0] - d.tx, c[1] - d.ty);
    if (this.w.time - sq.stateT > 40 && dist > sq.until * 0.8 && dist > 10) {
      sq.depot = -1;
      this.setState(sq, "advance", "không tới được kho lương, về vị trí");
      return false;
    }
    // đường xa: hành quân (không sa vào đánh dọc đường); tới gần mới Tấn công để dọn chỗ và đứng giữ
    this.moveSquad(sq, d.tx, d.ty, dist > 25 ? MOVE_MARCH : MOVE_ATTACK);
    return true;
  }

  private nearestLines(objId: number, k: number) {
    const o = this.w.obj[objId];
    return this.squads
      .filter((q) => q.role === "line" && q.units.length)
      .map((q) => ({ q, d: (() => { const c = this.centroid(q.units)!; return Math.hypot(c[0] - o.tx, c[1] - o.ty); })() }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k)
      .map((x) => x.q);
  }

  private weakestEnemyRiver() {
    let best = -1, bs = Infinity;
    for (const o of this.w.obj) {
      if (o.kind !== OBJ_RIVER || this.w.objOwner[o.id] !== 1 - this.side) continue;
      const st = this.enemyNear(o.tx, o.ty, 14);
      if (st < bs) { bs = st; best = o.id; }
    }
    return best;
  }

  private planCav(sq: Squad, desperate: boolean) {
    const w = this.w, s = this.side, e = 1 - s;
    const c = this.centroid(sq.units)!;
    const my = this.strength(sq.units);
    const local = this.enemyNear(c[0], c[1], 12);
    const now = w.time;
    const [fx, fy] = this.front(sq.post);

    if (sq.state === "withdraw") {
      const [bx, by] = this.fallback(sq.post);
      this.moveSquad(sq, bx, by, MOVE_MARCH);
      const chasers = this.visibleNear(c[0], c[1], 9);
      let dis = 0, cs = 0;
      for (const j of chasers) { if (w.disorder[j]) dis++; cs += this.unitStr(j); }
      if (now - sq.stateT >= 3 && chasers.length >= 8 && dis / chasers.length >= 0.3 && my >= cs * 0.8) {
        w.orderRally(sq.units);
        this.last.delete(sq.name);
        this.setState(sq, "advance", "kỵ binh QUAY ĐẦU đánh quân đuổi đang Rối loạn");
      } else if (Math.hypot(c[0] - bx, c[1] - by) < 7) this.setState(sq, "regroup", "kỵ binh về rừng hồi sức");
      return;
    }
    if (sq.state === "regroup") {
      // phải nghỉ tối thiểu 12s và quanh đó phải yên — tránh giật qua lại sát mặt địch
      const ready = now - sq.stateT > 12 && (this.avgHp(sq.units) >= 0.85 || now - sq.stateT > 30);
      if (ready && local < my * 0.8 && this.enemyNear(fx, fy, 12) < my) this.setState(sq, "advance", "kỵ binh sẵn sàng trở lại");
      else if (local > my * 1.2 && now - sq.stateT > 4) {
        // địch áp sát chỗ nghỉ: lui sâu hơn về phía nhà
        const [bx, by] = this.fallback(sq.post);
        this.moveSquad(sq, bx + this.dir * 20, by, MOVE_MARCH);
      }
      return;
    }
    if (sq.state === "pursue") {
      if (now > sq.until || local > my * 0.9) {
        w.orderStance(sq.units, STANCE_DEFEND);
        this.setState(sq, "advance", "dừng truy kích, về vị trí");
        this.moveSquad(sq, fx, fy, MOVE_MARCH, true);
      }
      return;
    }
    // Thua trận cục bộ → rút
    if (local > my * 1.2) {
      w.orderStance(sq.units, STANCE_DEFEND);
      this.setState(sq, "withdraw", "kỵ binh gặp địch mạnh → rút");
      return;
    }

    // 1) Ứng cứu: cứ điểm / cờ nhà của mình đang bị địch chiếm
    const threatened = this.threatenedObjective(c);
    if (threatened >= 0 && sq.state !== "raid") {
      const o = w.obj[threatened];
      if (this.enemyNear(o.tx, o.ty, 12) < my * 1.3) {
        sq.task = threatened;
        this.setState(sq, "respond", `ứng cứu ${o.label}`);
        const [tx, ty] = this.front(threatened);
        this.moveSquad(sq, tx, ty, MOVE_ATTACK);
        return;
      }
    }
    if (sq.state === "respond") {
      const k = sq.task;
      if (k < 0 || (w.objOwner[k] === s && w.objCapSide[k] !== e)) { sq.task = -1; this.setState(sq, "advance", "đã giữ được mục tiêu, về vị trí"); }
      else return;
    }

    // 2) Truy kích quân đang rút — nhưng không đuổi vào gần rừng (sợ phục kích)
    const fleeing = this.visibleNear(c[0], c[1], 16).filter((j) => w.moveMode[j] === MOVE_MARCH && w.field[j] >= 0);
    if (fleeing.length >= 15 && sq.state !== "raid") {
      const fc = this.centroidOf(fleeing);
      const safe = this.forestAround(Math.round(fc[0]), Math.round(fc[1]), 5) < 6;
      if (safe && this.enemyNear(fc[0], fc[1], 10) < my * 0.8) {
        w.orderStance(sq.units, STANCE_PURSUE);
        sq.until = now + 8;
        this.setState(sq, "pursue", `truy kích ${fleeing.length} quân địch đang rút`);
        this.moveSquad(sq, fc[0], fc[1], MOVE_ATTACK, true);
        return;
      }
    }

    // 3) Đột kích cờ nội địa địch khi đang lép vế trên sông / Uy thế
    const myRiver = this.riverCount(s), enRiver = this.riverCount(e);
    const raiding = this.squads.some((q) => q !== sq && q.state === "raid");
    if (sq.state === "raid") {
      const k = sq.task;
      if (local > my * 0.9) {
        this.setState(sq, "withdraw", "đột kích bị phát hiện → rút về rừng");
        return;
      }
      if (w.objOwner[k] === s) {
        // đã cắm cờ: chuyển sang cờ địch kế tiếp gần nhất nếu còn an toàn
        const next = this.pickRaidTarget(c, my);
        if (next >= 0 && next !== k) { sq.task = next; this.setState(sq, "raid", `cắm xong cờ, đánh tiếp ${w.obj[next].label}`); }
      }
      const o = w.obj[sq.task];
      this.moveSquad(sq, o.tx, o.ty, MOVE_ATTACK);
      return;
    }
    // chỉ đột kích khi thật sự lép vế — và bãi cạn của mình không đang bị đe doạ
    const behind = myRiver < enRiver || w.prestige[s] + 20 < w.prestige[e];
    // Có đầu cầu ở mặt trận nào thì cờ địch ở mặt trận đó cho điểm (+1/giây) → đi cắm ngay, không đợi thua thế
    const opening = this.pickRaidTarget(c, my, true) >= 0;
    if (!raiding && !desperate && now > 150 && (behind || opening) && my > sq.initStr * 0.5 && this.enemyNear(fx, fy, 12) < my * 0.5) {
      const k = this.pickRaidTarget(c, my, opening && !behind);
      if (k >= 0) {
        sq.task = k;
        this.setState(sq, "raid", `lép vế trên sông → đột kích ${w.obj[k].label}`);
        this.sendScoutToBlind(k);
        const o = w.obj[k];
        this.moveSquad(sq, o.tx, o.ty, MOVE_ATTACK);
        return;
      }
    }

    // 4) Mặc định: giữ bãi cạn được giao
    if (sq.state !== "advance" && sq.state !== "hold") this.setState(sq, "advance");
    this.moveSquad(sq, fx, fy, MOVE_ATTACK);
    if (sq.state === "advance" && Math.hypot(c[0] - fx, c[1] - fy) < 9) this.setState(sq, "hold", `giữ ${w.obj[sq.post].label}`);
  }

  private centroidOf(units: number[]): [number, number] {
    return this.centroid(units) ?? [0, 0];
  }

  private riverCount(side: number) {
    let c = 0;
    for (const o of this.w.obj) if (o.kind === OBJ_RIVER && this.w.objOwner[o.id] === side) c++;
    return c;
  }

  // Mục tiêu của mình đang bị địch chiếm dở / cờ nhà đã mất — chọn cái gần nhất
  private threatenedObjective(c: [number, number]) {
    const w = this.w, s = this.side, e = 1 - s;
    let best = -1, bd = Infinity;
    for (const o of w.obj) {
      const mine = w.objOwner[o.id] === s;
      const lostHome = o.kind === OBJ_FLAG && o.home === s && w.objOwner[o.id] === e;
      const beingTaken = mine && w.objCapSide[o.id] === e && w.objProg[o.id] > 0.15;
      if (!lostHome && !beingTaken) continue;
      const d = Math.hypot(o.tx - c[0], o.ty - c[1]);
      if (d < bd) { bd = d; best = o.id; }
    }
    return best;
  }

  // Cờ địch để cắm: ít quân canh, gần; ưu tiên mặt trận mình đang có đầu cầu (cờ ở đó mới cho điểm).
  // scoring = true → chỉ xét cờ ở mặt trận đang có đầu cầu.
  private pickRaidTarget(c: [number, number], my: number, scoring = false) {
    const w = this.w, s = this.side, e = 1 - s;
    let best = -1, bs = Infinity;
    for (const o of w.obj) {
      if (o.kind !== OBJ_FLAG || o.home !== e || w.objOwner[o.id] === s) continue;
      const bh = w.bridgehead[s][o.front];
      if (scoring && !bh) continue;
      const guard = this.enemyNear(o.tx, o.ty, 20);
      if (guard > my * 0.4) continue;
      const score = guard * 3 + Math.hypot(o.tx - c[0], o.ty - c[1]) - (bh ? 40 : 0);
      if (score < bs) { bs = score; best = o.id; }
    }
    return best;
  }

  private sendScoutToBlind(objId: number) {
    const o = this.w.obj[objId];
    let best: Squad | null = null, bd = Infinity;
    for (const q of this.squads) {
      if (q.role !== "scout" || !q.units.length || q.task >= 0) continue;
      const c = this.centroid(q.units)!;
      const d = Math.hypot(c[0] - o.tx, c[1] - o.ty);
      if (d < bd) { bd = d; best = q; }
    }
    if (best) {
      best.task = objId;
      this.setState(best, "raid", `làm mù ${o.label}`);
    }
  }

  // Trinh sát: canh bờ bên kia của 5 ngả vượt sông; gặp địch thì lánh về, 12s sau quay lại.
  private planScouts() {
    const w = this.w, now = w.time;
    for (const sq of this.squads) {
      if (sq.role !== "scout" || !sq.units.length) continue;
      const c = this.centroid(sq.units)!;
      const u = sq.units[0];
      if (sq.state === "raid" && sq.task >= 0) {
        const o = w.obj[sq.task];
        if (w.objBlindUntil[o.id] > now || w.objOwner[o.id] === this.side) { sq.task = -1; this.setState(sq, "advance"); }
        else { this.issue(sq.name, [u], o.tx, o.ty, MOVE_MARCH); continue; }
      }
      const o = w.obj[sq.post];
      const threat = this.visibleNear(c[0], c[1], 6).length > 0;
      if (threat && sq.state !== "withdraw") {
        sq.until = now + 12;
        this.setState(sq, "withdraw");
      }
      if (sq.state === "withdraw") {
        this.issue(sq.name, [u], o.tx + this.dir * 14, o.ty, MOVE_MARCH);
        if (now > sq.until) this.setState(sq, "advance");
        continue;
      }
      this.issue(sq.name, [u], o.tx - this.dir * 16, o.ty, MOVE_MARCH);
    }
  }
}

const ARMY_VI: Record<ArmyMode, string> = { normal: "thường", converge: "tập trung", engage: "xuất kích", evade: "né tránh" };

const STATE_VI: Record<State, string> = {
  advance: "tiến quân", contain: "chốt đầu cầu", hold: "giữ trận", withdraw: "rút lui", regroup: "hồi sức", pursue: "truy kích",
  raid: "đột kích", respond: "ứng cứu", assault: "tổng tấn công",
  depot: "lấy kho lương", bridge: "bắc cầu vòng sườn", flank: "đánh vòng sườn",
};

function fmt(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Battle simulation for 40,000 units, stored as structure-of-arrays.
import { AN, ANIMS, ARCHER, LANCER, MONK, PAWN, WARRIOR, lancerDir } from "./assets-def";
import {
  AMBUSH_MULT, BIG_ARMY, BIG_ARMY_CELL, BUILDING_PRESTIGE, CHARGE_MULT, CROWD_ARROW_TAKEN, CROWD_CELL, CROWD_LIMIT,
  CROWD_MELEE, CROWD_SPEED, FORD_TAKEN, MELEE_CAP, VOLLEY_MIN, VOLLEY_SPLASH, CAP_ENEMY_T, CAP_NEUTRAL_T, DISORDER_CHASE_T, DISORDER_CLEAR_T, DISORDER_DIST,
  DISORDER_MULT, ELITE_CAP_MULT, FLAG_VISION_R, FORD, FOREST_REGEN, FOREST_REST_T, LEASH_R, MH, MW, N, PRESTIGE_WIN,
  RALLY_DUR, RALLY_MIN_RETREAT, RALLY_MULT, REAR_MULT, REAR_MULT_LANCER, ROUT_KILLS_PER_PRESTIGE, SCOUT_BLIND_DUR,
  SCOUT_BLIND_T, SPAWN_W, STANCE_DEFEND, STANCE_PURSUE, SURRENDER_FRAC, T, TIME_LIMIT, TOWER_CD, TOWER_DMG, TOWER_RANGE,
  WORLD_H, WORLD_W, type Side,
  RIVER_PRESTIGE_RATE, FLAG_BRIDGEHEAD_RATE, FLAG_ISOLATE_T, REAR_DMG_NO_BRIDGE,
  WATER, BRIDGE, SWIM_TAKEN, MAX_BUILT_BRIDGES, BRIDGE_ROWS_BUILT, BRIDGE_MAX_LEN, BRIDGE_COL_WORK, BRIDGE_CREW_CAP,
  BRIDGE_HP_PER_COL, BRIDGE_BASE_HP,
  FLAG_HOME_HEAL_R, FLAG_HOME_HEAL_RATE, FLAG_HOME_REST_T,
  DEPOT_SCHEDULE, DEPOT_WARN_T, DEPOT_VALUE, DEPOT_CAP_T, DEPOT_CAP_R, DEPOT_EXPIRE_T,
} from "./constants";
import { OBJ_FLAG, OBJ_RIVER, FRONT_MID, buildObjectives, type Objective } from "./objectives";
import { DIR_GOAL, DIR_NONE, DX, DY, buildFlowField, invalidateNav, navMask, nearestPassable, type FlowField } from "./flowfield";
import { canStep, passable, tileSpeed, type Building, type GameMap } from "./map";
import { FORM_SPACING, SlotClaims, buildLocalNav, lineWalkable, stepTiles, navCell, navReached, planFormation, squareFit, type LocalNav } from "./formation";
import { mulberry32 } from "./rng";

// ---- Tính sẵn mặt nạ tầm nhìn hình tròn cho bán kính 1..20 (tính 1 lần lúc khởi động)
// Mỗi mask[r] là mảng các cặp [dx, dy] thoả dx²+dy²<=r². Lính dùng tối đa 15, cờ nhà dùng 20.
const VIS_MASKS: Int8Array[] = [];
for (let r = 0; r <= FLAG_VISION_R; r++) {
  const pts: number[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy <= r * r) { pts.push(dx); pts.push(dy); }
  }
  VIS_MASKS[r] = new Int8Array(pts);
}

// Bán kính tầm nhìn cơ bản theo binh chủng (ô bản đồ) — tăng +2 so với mặc định
// Warrior=7, Archer=8, Lancer=6, Monk=5, Scout=14
export const VIS_RADIUS = [7, 8, 6, 5, 14];

export interface UnitStats {
  hp: number;
  dmg: number;
  range: number;
  cd: number;
  speed: number;
  aggro: number; // tiles
}
export const STATS: UnitStats[] = [
  { hp: 120, dmg: 14, range: 40, cd: 1.0, speed: 62, aggro: 5 }, // warrior
  { hp: 70, dmg: 10, range: 6 * T, cd: 1.8, speed: 58, aggro: 7 }, // archer
  { hp: 160, dmg: 22, range: 54, cd: 1.4, speed: 88, aggro: 6 }, // lancer
  { hp: 60, dmg: 14, range: 4 * T, cd: 2.2, speed: 56, aggro: 5 }, // monk (dmg = heal)
  { hp: 30, dmg: 4,  range: 36, cd: 1.2, speed: 95, aggro: 12 }, // scout - máu yếu, chạy nhanh nhất, tầm nhìn xa nhất
];
export const ARMY: [number, number][] = [
  [WARRIOR, 1800],
  [LANCER, 1000],
  [ARCHER, 1500],
  [MONK, 500],
];
export const PAWNS_PER_SIDE = 5;
export const BUILDING_VI: Record<string, string> = {
  Castle: "Thành", Barracks: "Trại lính", Archery: "Trường bắn", Monastery: "Tu viện", Tower: "Tháp canh",
  House1: "Nhà", House2: "Nhà", House3: "Nhà",
};
export const PER_SIDE = ARMY.reduce((s, a) => s + a[1], 0) + PAWNS_PER_SIDE; // 20,000
const CAP = PER_SIDE * 2;

export const S_IDLE = 0;
export const S_MOVE = 1;
export const S_ATTACK = 2;
export const S_WORK = 3;

// pawn tasks / phases
const TK_GOLD = 0, TK_WOOD = 1, TK_MEAT = 2, TK_BUILD = 3, TK_IDLE = 4, TK_FIGHT = 5;
const PH_GO = 0, PH_WORK = 1, PH_BACK = 2, PH_DROP = 3;
// tool indices into PAWN_TOOLS
const TOOL_NONE = 0, TOOL_AXE = 1, TOOL_GOLD = 2, TOOL_HAMMER = 3, TOOL_KNIFE = 4, TOOL_MEAT = 5, TOOL_PICK = 6, TOOL_WOOD = 7;

export const FX_DUST = 0;
export const FX_EXPLOSION = 1;
export const FX_SPLASH = 2;
export const FX_HEAL = 3;
export interface Fx { k: number; x: number; y: number; t0: number; v: number }
export interface GameEvent { t: number; side: number; text: string }

// Cầu tự xây: lát dần từng cột ngang sông. Chỉ để đánh úp — KHÔNG tính là chỗ vượt sông / đầu cầu.
export interface BuiltBridge {
  id: number;
  side: number;
  y0: number; y1: number;  // các hàng ô của cầu
  xa: number; xb: number;  // cột nước đầu/cuối (gồm cả hai)
  dir: 1 | -1;             // hướng lát: 1 = từ tây sang đông
  built: number;           // số cột đã lát xong
  work: number;            // công đã góp cho cột đang lát
  hp: number;
  maxHp: number;
  alive: boolean;          // false = đã bị phá
  done: boolean;
}
export const BRIDGE_TARGET = 10000; // btarget >= BRIDGE_TARGET: đang nhắm cầu tự xây (BRIDGE_TARGET + id)
export type WinReason = "prestige" | "castle" | "surrender" | "time";
export const MOVE_ATTACK = 0;
export const MOVE_MARCH = 1;

const MAX_ARROWS = 8000;
const MAX_FX = 900;
const MAX_FIELDS = 40;
const MAX_NAVS = 64; // số nav cục bộ (chặng cuối tới ô đội hình) giữ đồng thời
const ENGAGE_R = 160;
// Ưu tiên mục tiêu (px trừ vào khoảng cách) — xem findEnemy
const PRI_ATTACKER = 48, PRI_ARCHER = 16, PRI_LOWHP = 24, PRI_MAX = PRI_ATTACKER + PRI_ARCHER + PRI_LOWHP;
// Thời gian vung vũ khí tới lúc trúng (giây) — sát thương áp đúng "khoảnh khắc trúng đòn" của hoạt ảnh
const WINDUP = [0.2, 0, 0.25, 0, 0.2]; // kiếm sĩ, cung thủ (tên bay riêng), thương kỵ, tu sĩ (hồi máu ngay), trinh sát
// Vùng chiến đấu: lệnh Tấn công (F) và tiếp viện khi quân ta bị đánh — trong vùng lính tự chọn chỗ đánh,
// không bị dây xích Phòng thủ neo vào chỗ đứng, đánh xong thì dừng tại chỗ (không quay về xếp hàng).
const ZONE_ATTACK_R = 12;   // ô: bán kính vùng của lệnh Tấn công
const ZONE_CALL_R = 10;     // ô: bán kính vùng tiếp viện quanh chỗ bị đánh
const ZONE_CALL_T = 6;      // giây: vùng tiếp viện tự tắt sau chừng này giây không còn giao chiến
const CALL_CELL = 8;        // ô: lưới gom "chỗ đang bị đánh"
const RANGE_HYST = 10; // px: đang đánh thì cho lệch thêm chừng này mới chuyển sang đuổi (chống rung ở mép tầm) // px: lính cận chiến trong bán kính này mới tính là "đang vây đánh" mục tiêu (gồm cả lính sắp tới)
const SEP = 24; // separation radius (px) - hẹp lại để lính xếp hàng dọc thay vì tràn ngang

export class World {
  m: GameMap;
  n = 0;
  x = new Float32Array(CAP);
  y = new Float32Array(CAP);
  side = new Uint8Array(CAP);
  type = new Uint8Array(CAP);
  state = new Uint8Array(CAP);
  anim = new Uint16Array(CAP);
  animT = new Float32Array(CAP);
  hp = new Float32Array(CAP);
  target = new Int32Array(CAP).fill(-1);
  btarget = new Int16Array(CAP).fill(-1);
  groupTarget = new Int32Array(CAP).fill(-1);
  alertUntil: [number, number] = [0, 0];
  cd = new Float32Array(CAP);
  face = new Int8Array(CAP);
  field = new Int16Array(CAP).fill(-1);
  alive = new Uint8Array(CAP);
  hold = new Uint8Array(CAP);
  sel = new Uint8Array(CAP);
  owner = new Array<string | null>(CAP).fill(null);
  armyGroupId = new Int32Array(CAP).fill(-1);
  tile = new Int32Array(CAP);
  stuck = new Float32Array(CAP);
  formDX = new Float32Array(CAP);
  formDY = new Float32Array(CAP);
  formTargetX = new Float32Array(CAP);
  formTargetY = new Float32Array(CAP);
  formNav = new Int16Array(CAP).fill(-1); // chỉ số trong navs (-1 = không có)
  formNavId = new Int32Array(CAP);         // id nav lúc nhận lệnh (nav bị ghi đè thì không khớp)
  formBest = new Float32Array(CAP);        // khoảng cách gần ô nhất đã đạt (đo tiến triển chặng cuối)
  stallX = new Float32Array(CAP);          // vị trí mốc để phát hiện giằng co (di chuyển mà không đi đâu)
  stallY = new Float32Array(CAP);
  stallT = new Float32Array(CAP);
  lastHitBy = new Int32Array(CAP).fill(-1);
  hitAt = new Float32Array(CAP);                  // đòn cận chiến đang vung: thời điểm trúng
  hitTg = new Int32Array(CAP).fill(-1);           // …mục tiêu (lính ≥ 0, công trình/cầu = −2 − bt, −1 = không có)
  hitDmg = new Float32Array(CAP);
  lastHitT = new Float32Array(CAP).fill(-100);    // lần cuối bị trúng đòn
  zoneX = new Float32Array(CAP);                  // tâm vùng chiến đấu (px)
  zoneY = new Float32Array(CAP);
  zoneR = new Float32Array(CAP);                  // bán kính (px), 0 = không có vùng
  zoneUntil = new Float32Array(CAP);              // hết hạn (Infinity = vùng của lệnh Tấn công)
  private _hitCells: [Uint8Array, Uint8Array] = [
    new Uint8Array((MW / CALL_CELL) * (MH / CALL_CELL)), new Uint8Array((MW / CALL_CELL) * (MH / CALL_CELL)),
  ];       // lính địch vừa đánh mình (để biết bị đánh từ trước hay sau)
  lastTargetT = new Float32Array(CAP).fill(-100); // lần cuối có mục tiêu (để không kéo lính về chỗ cũ giữa trận)
  formDirect = new Uint8Array(CAP);        // 1 = đã thấy đường thẳng tới ô, đang đi thẳng vào ô
  formWp = new Int32Array(CAP).fill(-1);   // ô dẫn đường (trên đường ngắn nhất tâm khối → ô), -1 = chưa có
  formNoShort = new Float32Array(CAP);     // tới thời điểm này: không đi tắt, chỉ bám đường tìm được (gỡ giằng co)
  swim = new Uint8Array(CAP);              // 1 = có lệnh Bơi qua sông (được xuống nước sâu)
  buildTask = new Int16Array(CAP).fill(-1); // id cầu tự xây đang được giao lát (-1 = không)
  builtBridges: BuiltBridge[] = [];
  private bridgeCrew: number[] = [];
  // ---- Lệnh di chuyển, tư thế, rút lui & truy kích
  moveMode   = new Uint8Array(CAP);    // MOVE_ATTACK | MOVE_MARCH (hành quân = bỏ qua địch, dùng để rút)
  stance     = new Uint8Array(CAP);    // STANCE_DEFEND (đuổi tối đa LEASH_R ô) | STANCE_PURSUE
  anchorX    = new Float32Array(CAP);  // điểm neo: nơi nhóm dừng lại
  anchorY    = new Float32Array(CAP);
  returning  = new Uint8Array(CAP);    // đang quay về điểm neo sau khi đuổi quá xa
  chaseT     = new Float32Array(CAP);  // thời gian đuổi liên tục
  stillT     = new Float32Array(CAP);  // thời gian đứng yên liên tục
  disorder   = new Uint8Array(CAP);    // Rối loạn: nhận +25% sát thương, mất giảm sát thương Hold
  retreatT   = new Float32Array(CAP);  // thời gian đã hành quân (rút) liên tục
  rallyUntil = new Float32Array(CAP);  // Quay đầu phản công: +30% sát thương tới thời điểm này
  lastCombat = new Float32Array(CAP).fill(-100); // lần cuối đánh / bị đánh
  // Sát thương gom trong tick, trừ đồng loạt cuối tick (giải quyết đồng thời, không phe nào ra đòn trước)
  private pendDmg = new Float32Array(CAP);
  private pendRouted = new Uint8Array(CAP);
  // ---- Cân bằng chống dồn cục
  engaged = new Uint8Array(CAP);       // số lính cận chiến đang nhắm vào lính này
  crowded = new Uint8Array(CAP);       // 1 = đang Chen chúc
  private crowdCnt: [Uint16Array, Uint16Array] = [
    new Uint16Array((MW / CROWD_CELL) * (MH / CROWD_CELL)), new Uint16Array((MW / CROWD_CELL) * (MH / CROWD_CELL)),
  ];
  // Đạo quân lớn lộ "bụi mù" cho đối phương: vị trí gần đúng (lệch tới ±8 ô)
  bigArmies: { side: number; tx: number; ty: number; n: number }[] = [];
  // ---- Trạng thái bao vây & cuồng chiến
  encircled = new Uint8Array(CAP);   // 1 = đang bị bao vây
  berserk   = new Uint8Array(CAP);   // 1 = đang cuồng chiến (kéo dài đến chết)
  // ---- Sương mù chiến tranh (Fog of War) cho mỗi phe
  // visCount: ô có giá trị > 0 nghĩa là đang được nhìn thấy trong tick hiện tại
  visCount:   [Uint8Array, Uint8Array] = [new Uint8Array(N), new Uint8Array(N)];
  // explored: ô đã từng được khám phá (vẽ mờ thay vì đen đặc)
  explored:   [Uint8Array, Uint8Array] = [new Uint8Array(N), new Uint8Array(N)];
  // thời điểm cập nhật vision cuối (tính bằng giây game)
  private _visLastT = -1;
  // memory pools (để giảm Garbage Collection)
  private _visBestR = new Uint8Array(N);
  private _encCnt0 = new Uint16Array(Math.ceil(MW / 8) * Math.ceil(MH / 8));
  private _encCnt1 = new Uint16Array(Math.ceil(MW / 8) * Math.ceil(MH / 8));
  private _encGrid0 = new Uint8Array(Math.ceil(MW / 8) * Math.ceil(MH / 8));
  private _encGrid1 = new Uint8Array(Math.ceil(MW / 8) * Math.ceil(MH / 8));
  private _big0 = new Uint16Array((MW / 16) * (MH / 16));
  private _big1 = new Uint16Array((MW / 16) * (MH / 16));
  // pawn data
  task = new Uint8Array(CAP);
  phase = new Uint8Array(CAP);
  taskT = new Float32Array(CAP);
  gx = new Float32Array(CAP);
  gy = new Float32Array(CAP);
  // spatial grid (one cell per tile)
  head = new Int32Array(N);
  next = new Int32Array(CAP);
  presence: [Int32Array, Int32Array];
  aliveCount: [number, number] = [0, 0];
  typeCount: [number[], number[]] = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
  kills: [number, number] = [0, 0];
  res: [{ gold: number; wood: number; meat: number }, { gold: number; wood: number; meat: number }] = [
    { gold: 0, wood: 0, meat: 0 },
    { gold: 0, wood: 0, meat: 0 },
  ];
  fields: (FlowField | null)[] = new Array(MAX_FIELDS).fill(null);
  navs: (LocalNav | null)[] = new Array(MAX_NAVS).fill(null);
  private navRing = 0;
  // arrows
  arN = 0;
  arX0 = new Float32Array(MAX_ARROWS);
  arY0 = new Float32Array(MAX_ARROWS);
  arX1 = new Float32Array(MAX_ARROWS);
  arY1 = new Float32Array(MAX_ARROWS);
  arT = new Float32Array(MAX_ARROWS);
  arDur = new Float32Array(MAX_ARROWS);
  arTgt = new Int32Array(MAX_ARROWS);
  arDmg = new Float32Array(MAX_ARROWS);
  arSide = new Uint8Array(MAX_ARROWS);
  arType = new Uint8Array(MAX_ARROWS); // binh chủng bắn (255 = Tháp canh)
  fx: Fx[] = [];
  // sheep
  shN = 0;
  shX = new Float32Array(120);
  shY = new Float32Array(120);
  shS = new Uint8Array(120); // 0 idle, 1 move, 2 grass
  shT = new Float32Array(120);
  shGX = new Float32Array(120);
  shGY = new Float32Array(120);
  shF = new Int8Array(120);
  shSide = new Uint8Array(120);

  // ---- Mục tiêu & Uy thế
  obj: Objective[];
  objOwner: Int8Array;       // -1 trung lập, 0/1
  objCapSide: Int8Array;     // phe đang chiếm dở
  objProg: Float32Array;     // tiến độ chiếm 0..1
  objContested: Uint8Array;
  objScoutT: Float32Array;   // thời gian Trinh sát địch đứng trên đỉnh cờ
  objBlindUntil: Float32Array;
  prestige: [number, number] = [0, 0];
  events: GameEvent[] = [];
  combat0: [number, number] = [0, 0]; // quân chiến đấu ban đầu
  bAlive = [{ Monastery: true, Archery: true, Barracks: true }, { Monastery: true, Archery: true, Barracks: true }];
  towerCd: Float32Array;

  // ---- V2: Đầu cầu, cờ cô lập, kho lương
  // Mỗi phe có đầu cầu ở 3 mặt trận (0=Bắc, 1=Giữa, 2=Nam)
  // bridgehead[side][front] = true nếu phe side đang giữ ≥1 cứ điểm sông ở mặt trận front
  bridgehead: [boolean[], boolean[]] = [[false, false, false], [false, false, false]];
  // Thời điểm cờ bị cô lập (mất đầu cầu) — dùng để đếm ngược 30s
  flagIsolateT: Float32Array = new Float32Array(0); // khởi tạo sau khi biết số obj
  // Kho lương
  depots: { tx: number; ty: number; spawnT: number; side: number; prog: [number, number]; claimed: boolean; expired: boolean }[] = [];
  private _depotIdx = 0; // chỉ số schedule tiếp theo
  private _depotWarned = new Set<number>();
  private _objLastT = 0;

  time = 0;
  tick = 0;
  winner = -1;
  winReason: WinReason | null = null;
  started = false;
  rnd = mulberry32(99);
  chargeField: [number, number] = [-1, -1];

  constructor(m: GameMap, deploymentLayout?: { type: number, px: number, py: number }[]) {
    this.m = m;
    this.presence = [new Int32Array(m.zoneCount + 1), new Int32Array(m.zoneCount + 1)];
    // Người chơi là tướng quân đã biết địa hình — toàn bộ bản đồ luôn "đã khám phá".
    // Sương mù chỉ che vị trí quân địch, không che địa hình.
    this.explored[0].fill(1);
    this.explored[1].fill(1);
    this.spawn(deploymentLayout);
    for (const s of [0, 1]) this.combat0[s] = this.aliveCount[s] - this.typeCount[s][PAWN];
    this.obj = buildObjectives(m);
    const K = this.obj.length;
    this.objOwner = new Int8Array(K);
    this.objCapSide = new Int8Array(K).fill(-1);
    this.objProg = new Float32Array(K);
    this.objContested = new Uint8Array(K);
    this.objScoutT = new Float32Array(K);
    this.objBlindUntil = new Float32Array(K);
    this.flagIsolateT = new Float32Array(K); // 0 = không bị cô lập
    for (const o of this.obj) this.objOwner[o.id] = o.kind === OBJ_FLAG ? o.home : -1;
    this.towerCd = new Float32Array(m.buildings.length);
    navMask(m); // dựng sẵn bảng hướng đi cho flow field
  }

  combatAlive(s: number) {
    return this.aliveCount[s] - this.typeCount[s][PAWN];
  }

  private pushEvent(side: number, text: string) {
    this.events.push({ t: this.time, side, text });
    if (this.events.length > 8) this.events.shift();
  }

  // ------------------------------------------------------------ helpers

  tileAt(px: number, py: number) {
    const tx = Math.min(MW - 1, Math.max(0, Math.floor(px / T)));
    const ty = Math.min(MH - 1, Math.max(0, Math.floor(py / T)));
    return ty * MW + tx;
  }

  // Continuous movement across a tile edge; a diagonal crossing is allowed via either neighbour.
  stepSim(a: number, b: number, swim = false) {
    return stepTiles(this.m, a, b, swim);
  }

  // Lính được xuống nước sâu: có lệnh bơi, hoặc đang ở dưới nước (luôn bơi vào bờ được).
  canSwim(i: number) {
    return this.swim[i] === 1 || this.m.ground[this.tile[i]] === WATER;
  }

  tryMove(i: number, vx: number, vy: number): boolean {
    const ox = this.x[i], oy = this.y[i], ot = this.tile[i];
    const nx = Math.min(WORLD_W - 2, Math.max(2, ox + vx));
    const ny = Math.min(WORLD_H - 2, Math.max(2, oy + vy));
    const sw = this.canSwim(i);
    let nt = this.tileAt(nx, ny);
    if (this.stepSim(ot, nt, sw)) return this.commit(i, nx, ny, ot, nt);
    nt = this.tileAt(nx, oy);
    if (Math.abs(vx) > 0.01 && this.stepSim(ot, nt, sw)) return this.commit(i, nx, oy, ot, nt);
    nt = this.tileAt(ox, ny);
    if (Math.abs(vy) > 0.01 && this.stepSim(ot, nt, sw)) return this.commit(i, ox, ny, ot, nt);
    return false;
  }

  private commit(i: number, nx: number, ny: number, ot: number, nt: number) {
    this.x[i] = nx;
    this.y[i] = ny;
    if (nt !== ot) {
      this.tile[i] = nt;
      const gn = this.m.ground[nt];
      if ((gn === FORD || gn === WATER) && this.m.ground[ot] !== gn && this.rnd() < (gn === WATER ? 0.6 : 0.25)) this.addFx(FX_SPLASH, nx, ny, 0);
    }
    return true;
  }

  setAnim(i: number, a: number) {
    if (this.anim[i] !== a) {
      this.anim[i] = a;
      this.animT[i] = this.time;
    }
  }

  animDone(i: number) {
    const d = ANIMS[this.anim[i]];
    return this.time - this.animT[i] >= d.frames / d.fps;
  }

  addFx(k: number, x: number, y: number, v: number) {
    if (this.fx.length >= MAX_FX) this.fx.shift();
    this.fx.push({ k, x, y, t0: this.time, v });
  }

  // Can `s` see/target unit j? Units hidden in a forest zone are invisible
  // until `s` has its own units inside that same zone.
  targetable(s: number, j: number) {
    const z = this.m.forest[this.tile[j]];
    return z === 0 || this.presence[s][z] > 0;
  }

  // ------------------------------------------------------------ spawn

  private addUnit(s: Side, t: number, px: number, py: number, ownerId: string | null = null) {
    const i = this.n++;
    this.x[i] = px;
    this.y[i] = py;
    this.side[i] = s;
    this.type[i] = t;
    this.owner[i] = ownerId;
    this.hp[i] = STATS[t].hp;
    this.alive[i] = 1;
    this.face[i] = s === 0 ? 1 : -1;
    this.tile[i] = this.tileAt(px, py);
    this.animT[i] = -this.rnd() * 2;
    this.anim[i] = this.idleAnim(i);
    this.anchorX[i] = px;
    this.anchorY[i] = py;
    this.aliveCount[s]++;
    this.typeCount[s][t]++;
    return i;
  }

  private spawn(deploymentLayout?: { type: number, px: number, py: number, ownerId?: string | null, side?: number }[]) {
    const m = this.m;
    const rnd = mulberry32(m.seed ^ 0x5eed);
    
    if (deploymentLayout && deploymentLayout.length > 0) {
      const hasSides = deploymentLayout.some(b => b.side !== undefined);
      if (hasSides) {
        // PvP: Sử dụng layout đã tính toán riêng cho từng phe
        for (const b of deploymentLayout) {
          this.addUnit(b.side! as Side, b.type, b.px, b.py, b.ownerId || null);
        }
      } else {
        // AI: Tự động clone đạo quân sang 2 bên
        for (const b of deploymentLayout) {
          this.addUnit(0, b.type, b.px, b.py, b.ownerId || null);
          this.addUnit(1, b.type, WORLD_W - b.px, WORLD_H - b.py, null);
        }
      }
      return;
    }
    
    const west: [number, number, number, string | null][] = [];
    
    // Bố trí tự động mặc định (cũ / AI)
    const sp = 40;
    const blk = 10;
    const frontX = (SPAWN_W - 5) * T;
    const cy = (MH / 2) * T;
    const rows = 8;
    const order: number[] = [0];
    for (let k = 1; order.length < rows; k++) { order.push(k); if (order.length < rows) order.push(-k); }
    
    let ai = 0, left = ARMY[0][1];
    outer: for (let cb = 0; cb < 20; cb++) {
      for (const rb of order) {
        const bx = frontX - cb * (blk + 2) * sp;
        const by = cy + rb * (blk + 2) * sp - (blk * sp) / 2;
        for (let c = 0; c < blk; c++) for (let r = 0; r < blk; r++) {
          const px = bx - c * sp + (rnd() - 0.5) * 6;
          const py = by + r * sp + (rnd() - 0.5) * 6;
          const t = this.tileAt(px, py);
          if (!passable(m, t) || m.level[t] !== 0 || m.forest[t] || m.ramp[t]) continue;
          west.push([ARMY[ai][0], px, py, null]);
          if (--left === 0) {
            if (++ai >= ARMY.length) break outer;
            left = ARMY[ai][1];
          }
        }
      }
    }

    
    for (const [t, px, py, owner] of west) this.addUnit(0, t, px, py, owner);
    for (const [t, px, py, owner] of west) this.addUnit(1, t, WORLD_W - px, WORLD_H - py, null);
    // Trinh sát: sinh 1 nhóm tập trung gần căn cứ, giữ vị trí chờ lệnh người chơi
    for (let s = 0 as Side; s <= 1; s = (s + 1) as Side) {
      // Điểm tập kết: gần cạnh bên trong, trung tâm theo chiều dọc
      const baseX = s === 0 ? 15 * T : (WORLD_W - 15 * T);
      const baseY = (MH / 2) * T;
      for (let k = 0; k < PAWNS_PER_SIDE; k++) {
        const angle = (k / PAWNS_PER_SIDE) * Math.PI * 2;
        const px = baseX + Math.cos(angle) * 2.5 * T;
        const py = baseY + Math.sin(angle) * 2.5 * T;
        const t = this.tileAt(px, py);
        const tx = (passable(m, t) ? px : baseX);
        const ty = (passable(m, t) ? py : baseY);
        const i = this.addUnit(s, PAWN, tx, ty);
        // Giữ vị trí ngay từ đầu — không tự di chuyển cho đến khi người chơi ra lệnh
        this.hold[i] = 1;
      }
      if (s === 1) break;
    }
    // sheep
    for (let s = 0; s < 2; s++) {
      const [px, py] = m.pasture[s];
      for (let k = 0; k < 40; k++) {
        const i = this.shN++;
        this.shX[i] = this.shGX[i] = px + (rnd() - 0.5) * 8 * T;
        this.shY[i] = this.shGY[i] = py + (rnd() - 0.5) * 6 * T;
        this.shT[i] = rnd() * 4;
        this.shF[i] = rnd() < 0.5 ? 1 : -1;
        this.shSide[i] = s;
      }
    }
    
    // Gom nhóm đạo quân tự động (armyGroupId)
    let nextGroupId = 0;
    const maxDistSq = 120 * 120; // Thay vì 512, để các block đặt rời rạc sẽ tạo ra các armyGroupId riêng biệt
    for (let i = 0; i < this.n; i++) {
      if (this.type[i] === PAWN) continue; // Trinh sát không vào đạo quân
      if (this.armyGroupId[i] !== -1) continue;
      
      // Bắt đầu một cụm mới
      const q: number[] = [i];
      this.armyGroupId[i] = nextGroupId;
      let head = 0;
      
      while (head < q.length) {
        const curr = q[head++];
        for (let j = i + 1; j < this.n; j++) {
          if (this.armyGroupId[j] === -1 && this.side[j] === this.side[curr] && this.type[j] !== PAWN) {
            const dx = this.x[curr] - this.x[j];
            const dy = this.y[curr] - this.y[j];
            if (dx * dx + dy * dy <= maxDistSq) {
              this.armyGroupId[j] = nextGroupId;
              q.push(j);
            }
          }
        }
      }
      nextGroupId++;
    }
  }

  private pickNode(i: number) {
    const nodes = this.m.pawnNodes[this.side[i]];
    const list = [nodes.gold, nodes.wood, nodes.meat, nodes.build][this.task[i]];
    if (!list || !list.length) {
      this.gx[i] = this.x[i] + (this.rnd() - 0.5) * 6 * T;
      this.gy[i] = this.y[i] + (this.rnd() - 0.5) * 6 * T;
      return;
    }
    const [nx, ny] = list[Math.floor(this.rnd() * list.length)];
    this.gx[i] = nx + (this.rnd() - 0.5) * 50;
    this.gy[i] = ny + (this.rnd() - 0.5) * 30;
  }

  // ------------------------------------------------------------ animation choice

  idleAnim(i: number) {
    switch (this.type[i]) {
      case WARRIOR: return this.hold[i] ? AN.W_GUARD : AN.W_IDLE;
      case ARCHER: return AN.A_IDLE;
      case LANCER: return this.hold[i] ? AN.L_DEF[0] : AN.L_IDLE;
      case MONK: return AN.M_IDLE;
      default: return AN.P_IDLE[this.task[i] === TK_FIGHT ? TOOL_KNIFE : TOOL_NONE];
    }
  }
  runAnim(i: number) {
    switch (this.type[i]) {
      case WARRIOR: return AN.W_RUN;
      case ARCHER: return AN.A_RUN;
      case LANCER: return AN.L_RUN;
      case MONK: return AN.M_RUN;
      default: return AN.P_RUN[TOOL_KNIFE];
    }
  }

  // ------------------------------------------------------------ orders

  private allocField(f: FlowField): number {
    let slot = this.fields.findIndex((x) => x === null || x.refs <= 0);
    if (slot < 0) {
      let min = Infinity;
      this.fields.forEach((x, k) => { if (x && x.refs < min) { min = x.refs; slot = k; } });
      for (let i = 0; i < this.n; i++) if (this.field[i] === slot) this.field[i] = -1;
    }
    this.fields[slot] = f;
    return slot;
  }

  private setField(i: number, slot: number) {
    const old = this.field[i];
    if (old >= 0 && this.fields[old]) this.fields[old]!.refs--;
    this.field[i] = slot;
    if (slot >= 0) this.fields[slot]!.refs++;
    this.formNav[i] = -1;
  }

  private allocNav(nav: LocalNav): number {
    const k = this.navRing;
    this.navRing = (k + 1) % MAX_NAVS;
    this.navs[k] = nav;
    return k;
  }

  // Đưa quân tới một ô. mode = MOVE_ATTACK: đánh mọi địch gặp trên đường;
  // MOVE_MARCH: hành quân bỏ qua địch (dùng để rút lui). Trả về false nếu không tới được.
  // swim = Bơi qua sông: được đi thẳng qua nước sâu (chậm, yếu, không đánh được khi đang bơi).
  // loose = lệnh Tấn công kiểu AoE: quanh điểm đến là vùng chiến đấu, lính tự chọn chỗ đánh, không dàn trận.
  orderMove(units: number[], tx: number, ty: number, mode = MOVE_ATTACK, swim = false, loose = false): boolean {
    const list = units.filter((i) => this.alive[i]);
    if (!list.length) return false;
    if (loose) this.setZone(list, tx * T + 32, ty * T + 32, ZONE_ATTACK_R * T);
    else this.setZone(list, 0, 0, 0);
    // có lính đang dưới nước (cầu sập, đang bơi dở) thì cả nhóm đi theo đường bơi để lên bờ được
    const sw = swim || list.some((i) => this.m.ground[this.tile[i]] === WATER);
    
    const start = nearestPassable(this.m, tx, ty);
    if (start >= 0) {
      tx = start % MW;
      ty = (start / MW) | 0;
    }

    // Gom nhóm theo đạo quân; lính lẻ (không thuộc đạo quân nào) gom chung một khối
    const groups: Map<number, number[]> = new Map();
    for (const i of list) {
      const g = this.armyGroupId[i];
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(i);
    }

    // Hướng tiến quân chung
    const gx = tx * T + 32, gy = ty * T + 32;
    // Tính tâm chung của TẤT CẢ lính để xác định hướng tiến quân
    let allMx = 0, allMy = 0;
    for (const i of list) { allMx += this.x[i]; allMy += this.y[i]; }
    allMx /= list.length; allMy /= list.length;

    let ux = gx - allMx, uy = gy - allMy;
    const ul = Math.hypot(ux, uy);
    if (ul < 1) { ux = 1; uy = 0; } else { ux /= ul; uy /= ul; }
    const px = -uy, py = ux;

    // Kích thước mỗi khối theo hình vuông ưu tiên
    const blockCenters: { gid: number, units: number[], mx: number, my: number, w: number, d: number, dist: number }[] = [];
    for (const [gid, gUnits] of groups.entries()) {
      let gMx = 0, gMy = 0;
      for (const i of gUnits) { gMx += this.x[i]; gMy += this.y[i]; }
      gMx /= gUnits.length; gMy /= gUnits.length;

      const cols = Math.ceil(Math.sqrt(gUnits.length));
      const rows = Math.ceil(gUnits.length / cols);

      blockCenters.push({
        gid,
        units: gUnits,
        mx: gMx,
        my: gMy,
        w: cols * FORM_SPACING,
        d: rows * FORM_SPACING,
        dist: Math.hypot(gMx - gx, gMy - gy)
      });
    }

    // Sắp xếp các nhóm theo khoảng cách đến đích: nhóm gần nhất xếp đầu (sẽ đứng trung tâm)
    blockCenters.sort((a, b) => a.dist - b.dist || a.gid - b.gid);

    // MỘT flow field chung cho chặng xa (tránh tràn 40 fields); chặng cuối mỗi khối dùng nav cục bộ riêng.
    const allTiles = list.map((i) => this.tile[i]);
    const f = buildFlowField(this.m, tx, ty, 4, allTiles, sw);
    if (!f) return false;
    const slot = this.allocField(f);

    // Vùng đi tới được quanh đích: tâm khối rơi vào vách/nước/khu tách biệt thì kéo về ô gần nhất trong vùng.
    const AREA_R = 48;
    const area = buildLocalNav(this.m, tx, ty, AREA_R, sw);
    const claims = new SlotClaims();

    // Bố trí nhiều khối theo lưới trước/sau (gần vuông: 4 nhánh → 2x2, 6 → 3x2...), không dàn hết
    // thành một hàng ngang. Ô lưới nào bị địa hình chắn thì khối lùi sang ô kế tiếp (ra sau / ra cánh).
    // Giữa các nhánh chừa khoảng trống rộng để dễ bấm chọn từng nhánh.
    const BLOCK_GAP = 256; // px (4 ô) giữa hai khối
    let maxW = 0, maxD = 0;
    for (const b of blockCenters) { maxW = Math.max(maxW, b.w); maxD = Math.max(maxD, b.d); }
    const cellW = maxW + BLOCK_GAP, cellD = maxD + BLOCK_GAP;
    const gridCols = Math.min(5, Math.ceil(Math.sqrt(blockCenters.length)));
    const cells: [number, number][] = []; // (lệch ngang theo số ô lưới, hàng: 0 = đầu, 1 = sau...)
    const colsPref: number[] = [];
    for (let c = 0; c < gridCols; c++) colsPref.push(c - (gridCols - 1) / 2);
    colsPref.sort((p, q) => Math.abs(p) - Math.abs(q) || p - q); // giữa trước, rồi hai cánh
    const maxRows = blockCenters.length + 3;
    for (let r = 0; r < maxRows; r++) for (const c of colsPref) cells.push([c, r]);
    const edge = (gridCols - 1) / 2;
    for (let r = 0; r < maxRows; r++) for (let j = 1; j <= 2; j++) { cells.push([edge + j, r]); cells.push([-edge - j, r]); }
    const usedCell = new Uint8Array(cells.length);

    for (const b of blockCenters) {
      const gUnits = b.units;
      const n = gUnits.length;
      let ctx = tx, cty = ty;
      if (blockCenters.length > 1) {
        // ô lưới đầu tiên (theo thứ tự ưu tiên) mà khối vuông đứng vừa ≥ 85%; không có thì lấy ô tốt nhất
        let bestK = -1, bestFit = -1, bestT: [number, number] = [tx, ty];
        for (let k = 0; k < cells.length; k++) {
          if (usedCell[k]) continue;
          const [c, r] = cells[k];
          const dx = Math.max(32, Math.min(MW * T - 32, gx + px * c * cellW - ux * r * cellD));
          const dy = Math.max(32, Math.min(MH * T - 32, gy + py * c * cellW - uy * r * cellD));
          const dtx = Math.floor(dx / T), dty = Math.floor(dy / T);
          const st = this.snapToArea(area, dtx, dty, tx, ty);
          if (Math.hypot(st[0] - dtx, st[1] - dty) > 3) continue; // chỗ này không tới được
          const fit = squareFit(this.m, area, n, st[0] * T + 32, st[1] * T + 32, ux, uy, claims);
          if (fit > bestFit) { bestFit = fit; bestK = k; bestT = st; }
          if (fit >= 0.85) break;
        }
        if (bestK >= 0) { usedCell[bestK] = 1; [ctx, cty] = bestT; }
      }

      // Nav cục bộ: phủ cả khối + khoảng dịch tâm + đường tiếp cận
      const half = Math.ceil(Math.max(b.w, b.d * 2.5) / T / 2);
      const offT = Math.ceil(Math.hypot(ctx - tx, cty - ty));
      const R = Math.max(16, Math.min(48, half + 12 + offT));
      const nav = buildLocalNav(this.m, ctx, cty, R, sw);
      // nhiều nhánh: khi tự dịch/đổi hình vẫn giữ cách nhánh khác ≥ ~3 ô (chật quá mới cho sát lại)
      const plan = planFormation(this.m, nav, n, ux, uy, claims, blockCenters.length > 1 ? 192 : 0);
      for (const sl of plan.slots) claims.add(sl.x, sl.y);
      const navIdx = this.allocNav(nav);

      // Ghép lính ↔ ô: hàng đầu nhận lính đang ở phía trước, trong hàng xếp trái → phải
      const along = (i: number) => (this.x[i] - b.mx) * plan.ux + (this.y[i] - b.my) * plan.uy;
      const across = (i: number) => (this.x[i] - b.mx) * -plan.uy + (this.y[i] - b.my) * plan.ux;
      const sortedUnits = gUnits.slice().sort((p, q) => along(q) - along(p) || p - q);
      const slots = plan.slots.slice().sort((p, q) => p.row - q.row || p.side - q.side);
      let k = 0;
      while (k < n) {
        let e = k;
        while (e < n && slots[e].row === slots[k].row) e++;
        const rowUnits = sortedUnits.slice(k, e).sort((p, q) => across(p) - across(q) || p - q);
        for (let c = 0; c < rowUnits.length; c++) {
          const i = rowUnits[c];
          this.formDX[i] = slots[k + c].x - plan.cx;
          this.formDY[i] = slots[k + c].y - plan.cy;
        }
        k = e;
      }

      for (const i of gUnits) {
        this.setField(i, slot);
        this.formNav[i] = navIdx;
        this.formNavId[i] = nav.id;
        this.hold[i] = 0;
        this.stuck[i] = 0;
        this.formBest[i] = Infinity;
        this.formDirect[i] = 0;
        this.formWp[i] = -1;
        this.formNoShort[i] = 0;
        this.swim[i] = sw ? 1 : 0;
        this.buildTask[i] = -1;
        this.stallX[i] = this.x[i];
        this.stallY[i] = this.y[i];
        this.stallT[i] = this.time;
        if (mode === MOVE_MARCH) { this.target[i] = -1; this.btarget[i] = -1; }
        this.returning[i] = 0;
        if (mode === MOVE_MARCH && this.moveMode[i] !== MOVE_MARCH) this.retreatT[i] = 0;
        this.moveMode[i] = mode;
        this.formTargetX[i] = plan.cx;
        this.formTargetY[i] = plan.cy;
      }
    }
    this.started = true;
    return true;
  }

  // Ô gần (x, y) nhất nằm trong vùng đi tới được `area`; không có thì trả về đích (fx, fy).
  private snapToArea(area: LocalNav, x: number, y: number, fx: number, fy: number): [number, number] {
    for (let r = 0; r <= 24; r++) {
      let best = -1, bd = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
          if (!navReached(area, ny * MW + nx)) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 < bd) { bd = d2; best = ny * MW + nx; }
        }
      }
      if (best >= 0) return [best % MW, (best / MW) | 0];
    }
    return [fx, fy];
  }

  // ------------------------------------------------------------ cầu tự xây

  // Kiểm tra chỗ xây cầu quanh ô nước (tx, ty). Cầu nằm ngang sông, rộng BRIDGE_ROWS_BUILT hàng.
  planBridge(side: number, tx: number, ty: number): { ok: true; y0: number; y1: number; xa: number; xb: number } | { ok: false; reason: string } {
    const m = this.m;
    const half = (BRIDGE_ROWS_BUILT - 1) >> 1;
    const y0 = ty - half, y1 = y0 + BRIDGE_ROWS_BUILT - 1;
    if (tx < 1 || tx >= MW - 1 || y0 < 1 || y1 >= MH - 1) return { ok: false, reason: "Ngoài bản đồ" };
    if (m.ground[ty * MW + tx] !== WATER) return { ok: false, reason: "Chọn một điểm trên sông (nước sâu)" };
    const alive = this.builtBridges.filter((b) => b.alive && b.side === side).length;
    if (alive >= MAX_BUILT_BRIDGES) return { ok: false, reason: `Mỗi phe chỉ được ${MAX_BUILT_BRIDGES} cầu tự xây (cầu bị phá thì được xây lại)` };
    let xa = MW, xb = -1;
    for (let y = y0; y <= y1; y++) {
      if (m.ground[y * MW + tx] !== WATER) return { ok: false, reason: "Quá sát cầu / bãi cạn có sẵn" };
      let a = tx, b = tx;
      while (a - 1 >= 0 && m.ground[y * MW + a - 1] === WATER) a--;
      while (b + 1 < MW && m.ground[y * MW + b + 1] === WATER) b++;
      xa = Math.min(xa, a); xb = Math.max(xb, b);
    }
    if (xb - xa + 1 > BRIDGE_MAX_LEN) return { ok: false, reason: "Sông quá rộng ở chỗ này" };
    for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = xa; x <= xb; x++) {
      const g = m.ground[y * MW + x];
      if (g === FORD || g === BRIDGE) return { ok: false, reason: "Quá sát cầu / bãi cạn có sẵn" };
    }
    // hai đầu cầu phải chạm đất đi được, cùng độ cao mặt nước
    const lvl = m.level[ty * MW + tx];
    for (const x of [xa - 1, xb + 1]) {
      const e = ty * MW + x;
      if (!passable(m, e) || m.level[e] !== lvl) return { ok: false, reason: "Bờ bên kia là vách/đất cao — không bắc cầu được" };
    }
    for (const b of this.builtBridges) {
      if (!b.alive) continue;
      if (b.y0 - 2 <= y1 && y0 <= b.y1 + 2 && b.xa <= xb && xa <= b.xb) return { ok: false, reason: "Trùng một cầu tự xây khác" };
    }
    return { ok: true, y0, y1, xa, xb };
  }

  // Giao cho quân đã chọn xây cầu tại ô nước (tx, ty). Quân nào cũng xây được; tối đa BRIDGE_CREW_CAP×1.5
  // lính gần nhất làm thợ, số còn lại đi theo hộ tống. Trả về null nếu thành công, hoặc lý do không xây được.
  orderBuildBridge(units: number[], tx: number, ty: number): string | null {
    const list0 = units.filter((i) => this.alive[i]);
    if (!list0.length) return "Chưa chọn quân";
    const side = this.side[list0[0]];
    const list = list0.filter((i) => this.side[i] === side);
    const p = this.planBridge(side, tx, ty);
    if (!p.ok) return p.reason;
    let mx = 0;
    for (const i of list) mx += this.x[i];
    mx /= list.length;
    const dir: 1 | -1 = mx < ((p.xa + p.xb + 1) / 2) * T ? 1 : -1;
    const len = p.xb - p.xa + 1;
    const br: BuiltBridge = {
      id: this.builtBridges.length, side, y0: p.y0, y1: p.y1, xa: p.xa, xb: p.xb, dir,
      built: 0, work: 0, hp: BRIDGE_BASE_HP, maxHp: BRIDGE_BASE_HP + BRIDGE_HP_PER_COL * len, alive: true, done: false,
    };
    this.builtBridges.push(br);
    this.bridgeCrew.push(0);
    const bankX = dir > 0 ? p.xa - 1 : p.xb + 1, midY = (p.y0 + p.y1) >> 1;
    // tới bờ bằng đường thường (không bơi)
    this.orderMove(list, bankX, midY, MOVE_ATTACK, false);
    const bx = (bankX + 0.5) * T, by = (midY + 0.5) * T;
    const crew = list.slice().sort((a, b) => Math.hypot(this.x[a] - bx, this.y[a] - by) - Math.hypot(this.x[b] - bx, this.y[b] - by) || a - b)
      .slice(0, Math.ceil(BRIDGE_CREW_CAP * 1.5));
    for (const i of crew) this.buildTask[i] = br.id;
    this.pushEvent(side, `Quân ${side === 0 ? "Tây" : "Đông"} bắt đầu bắc cầu (${len} ô)`);
    return null;
  }

  // Cột nước thứ k (0 = sát bờ khởi công) của cầu.
  bridgeCol(br: BuiltBridge, k: number) {
    return br.dir > 0 ? br.xa + k : br.xb - k;
  }

  // Điểm gần (x, y) nhất trên cầu (phần đã lát + giàn giáo ở mũi cầu).
  private bridgeNearest(br: BuiltBridge, x: number, y: number): [number, number] {
    const k = Math.max(0, br.built);
    const c0 = this.bridgeCol(br, 0), c1 = this.bridgeCol(br, Math.min(k, br.xb - br.xa));
    const lx = Math.min(c0, c1) * T, rx = (Math.max(c0, c1) + 1) * T;
    return [Math.max(lx, Math.min(rx, x)), Math.max(br.y0 * T, Math.min((br.y1 + 1) * T, y))];
  }

  // Chỗ thợ đứng: cột vừa lát xong (hoặc bờ khi chưa lát), rải theo các hàng của cầu.
  private bridgeStand(br: BuiltBridge, i: number): [number, number] {
    const x = br.built > 0 ? this.bridgeCol(br, br.built - 1) : br.dir > 0 ? br.xa - 1 : br.xb + 1;
    const rows = br.y1 - br.y0 + 1;
    const r = i % rows, back = ((i / rows) | 0) % 3;
    return [(x + 0.5) * T - br.dir * back * 20, (br.y0 + r + 0.5) * T];
  }

  // Bỏ dở cầu đang xây (tháo giàn giáo, trả lại lượt xây). Cầu đã xong thì giữ nguyên.
  abandonBridge(id: number) {
    const br = this.builtBridges[id];
    if (!br || !br.alive || br.done) return;
    this.damageBridge(id, Infinity, true);
  }

  private damageBridge(id: number, amount: number, quiet = false) {
    const br = this.builtBridges[id];
    if (!br || !br.alive) return;
    br.hp -= amount;
    if (br.hp > 0) return;
    br.hp = 0;
    br.alive = false;
    const m = this.m;
    for (let k = 0; k < br.built; k++) {
      const x = this.bridgeCol(br, k);
      for (let y = br.y0; y <= br.y1; y++) if (m.ground[y * MW + x] === BRIDGE) m.ground[y * MW + x] = WATER;
      if (k % 3 === 0) this.addFx(FX_SPLASH, (x + 0.5) * T, ((br.y0 + br.y1 + 1) / 2) * T, 0);
    }
    invalidateNav(m, br.xa, br.y0, br.xb, br.y1);
    for (let i = 0; i < this.n; i++) if (this.buildTask[i] === id) this.buildTask[i] = -1;
    if (!quiet) this.pushEvent(1 - br.side, `Cầu tự xây của quân ${br.side === 0 ? "Tây" : "Đông"} bị phá sập!`);
  }

  // Lát cầu theo số thợ đang đứng ở mũi cầu (đếm trong updateUnit).
  private updateBridges(dt: number) {
    const m = this.m;
    for (const br of this.builtBridges) {
      const crew = Math.min(BRIDGE_CREW_CAP, this.bridgeCrew[br.id]);
      this.bridgeCrew[br.id] = 0;
      if (!br.alive || br.done || crew === 0) continue;
      br.work += crew * dt;
      const len = br.xb - br.xa + 1;
      while (br.work >= BRIDGE_COL_WORK && br.built < len) {
        br.work -= BRIDGE_COL_WORK;
        const x = this.bridgeCol(br, br.built);
        for (let y = br.y0; y <= br.y1; y++) if (m.ground[y * MW + x] === WATER) m.ground[y * MW + x] = BRIDGE;
        invalidateNav(m, x, br.y0, x, br.y1);
        br.built++;
        br.hp += BRIDGE_HP_PER_COL;
      }
      if (br.built >= len) {
        br.done = true;
        br.work = 0;
        for (let i = 0; i < this.n; i++) if (this.buildTask[i] === br.id) this.buildTask[i] = -1;
        this.pushEvent(br.side, `Quân ${br.side === 0 ? "Tây" : "Đông"} bắc xong cầu mới!`);
      }
    }
  }

  orderHold(units: number[]) {
    for (const i of units) {
      if (!this.alive[i] || this.type[i] === PAWN) continue;
      this.setField(i, -1);
      this.buildTask[i] = -1;
      this.zoneR[i] = 0;
      this.hold[i] = 1;
      this.target[i] = -1;
      this.moveMode[i] = MOVE_ATTACK;
      this.returning[i] = 0;
      this.anchorX[i] = this.x[i];
      this.anchorY[i] = this.y[i];
    }
  }

  // Tư thế truy kích: STANCE_DEFEND (đuổi tối đa LEASH_R ô rồi quay về) | STANCE_PURSUE (đuổi tới cùng).
  // Bỏ luôn Giữ vị trí để lính được phép đuổi theo tư thế mới.
  orderStance(units: number[], stance: number) {
    for (const i of units) {
      if (!this.alive[i]) continue;
      this.stance[i] = stance;
      if (this.type[i] !== PAWN) this.hold[i] = 0;
    }
  }

  // Quay đầu: dừng hành quân và đánh lại ngay. Quân đã rút >= RALLY_MIN_RETREAT giây
  // được +30% sát thương trong RALLY_DUR giây (rút lui giả).
  orderRally(units: number[]) {
    let bonus = 0;
    for (const i of units) {
      if (!this.alive[i]) continue;
      const marching = this.moveMode[i] === MOVE_MARCH && this.field[i] >= 0;
      if (marching && this.retreatT[i] >= RALLY_MIN_RETREAT) { this.rallyUntil[i] = this.time + RALLY_DUR; bonus++; }
      this.setField(i, -1);
      this.buildTask[i] = -1;
      this.zoneR[i] = 0;
      this.moveMode[i] = MOVE_ATTACK;
      this.hold[i] = 0;
      this.returning[i] = 0;
      this.retreatT[i] = 0;
      this.target[i] = -1;
      this.anchorX[i] = this.x[i];
      this.anchorY[i] = this.y[i];
    }
    return bonus;
  }

  castleOf(s: number): Building | undefined {
    return this.m.buildings.find((b) => b.side === s && b.kind === "Castle");
  }

  // Both armies (or one side) attack-move toward the enemy castle.
  orderCharge(sides: number[]) {
    for (const s of sides) {
      const c = this.castleOf(1 - s);
      if (!c) continue;
      const units: number[] = [];
      for (let i = 0; i < this.n; i++) if (this.alive[i] && this.side[i] === s && this.type[i] !== PAWN) units.push(i);
      const f = buildFlowField(this.m, c.tx + (s === 0 ? c.fw + 2 : -3), c.ty + 1, 12, units.map((i) => this.tile[i]));
      if (!f) continue;
      const slot = this.allocField(f);
      for (const i of units) {
        this.setField(i, slot);
        this.buildTask[i] = -1;
        this.zoneR[i] = 0;
        this.swim[i] = 0;
        this.hold[i] = 0;
        this.moveMode[i] = MOVE_ATTACK;
        this.returning[i] = 0;
        // không có ô đội hình: đi theo trường lực tới tận nơi
        this.formTargetX[i] = (c.tx + (s === 0 ? c.fw + 2 : -3)) * T + 32;
        this.formTargetY[i] = (c.ty + 1) * T + 32;
        this.formDX[i] = 0;
        this.formDY[i] = 0;
      }
      this.chargeField[s] = slot;
    }
    this.started = true;
  }

  selectRect(x0: number, y0: number, x1: number, y1: number, sideFilter: number, add = false, ownerFilter?: string | null) {
    if (!add) this.sel.fill(0);
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    let c = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      if (sideFilter >= 0 && this.side[i] !== sideFilter) continue;
      if (ownerFilter && this.owner[i] !== ownerFilter) continue; // Lọc chủ sở hữu
      const px = this.x[i], py = this.y[i] - 20;
      if (px >= ax && px <= bx && py >= ay && py <= by) { this.sel[i] = 1; c++; }
    }
    return c;
  }

  selectType(t: number, sideFilter: number, ownerFilter?: string | null) {
    this.sel.fill(0);
    for (let i = 0; i < this.n; i++) {
      if (this.alive[i] && (t < 0 || this.type[i] === t) && (sideFilter < 0 || this.side[i] === sideFilter) && (t === PAWN || this.type[i] !== PAWN)) {
        if (ownerFilter && this.owner[i] !== ownerFilter) continue;
        this.sel[i] = 1;
      }
    }
  }

  selected(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.sel[i] && this.alive[i]) out.push(i);
    return out;
  }

  getClusters(type: number, side: number): { x: number, y: number, count: number }[] {
    const clusters: { x: number, y: number, count: number }[] = [];
    const threshold = 15 * T;

    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.side[i] !== side) continue;
      if (type !== -1 && this.type[i] !== type) continue;
      if (type === -1 && this.type[i] === PAWN) continue;

      let found = false;
      for (const c of clusters) {
        if (Math.hypot(c.x - this.x[i], c.y - this.y[i]) < threshold) {
          c.x = (c.x * c.count + this.x[i]) / (c.count + 1);
          c.y = (c.y * c.count + this.y[i]) / (c.count + 1);
          c.count++;
          found = true;
          break;
        }
      }
      if (!found) {
        clusters.push({ x: this.x[i], y: this.y[i], count: 1 });
      }
    }
    return clusters;
  }

  // ------------------------------------------------------------ simulation

  step(dt: number) {
    this.time += dt;
    this.tick++;
    this.rebuildGrid();
    this.engaged.fill(0);
    // Giới hạn vây đánh: chỉ đếm lính cận chiến đang ở SÁT mục tiêu (≤ ENGAGE_R). Đếm cả lính đứng xa
    // (cả nhánh cùng nhận một mục tiêu chung) làm mục tiêu "đầy" giả → cả nhánh đứng chờ, không đánh.
    const ER2 = ENGAGE_R * ENGAGE_R;
    for (let i = 0; i < this.n; i++) {
      const tg = this.target[i];
      if (tg < 0 || !this.alive[i] || this.type[i] === ARCHER || this.type[i] === MONK || this.engaged[tg] >= 255) continue;
      const dx = this.x[tg] - this.x[i], dy = this.y[tg] - this.y[i];
      if (dx * dx + dy * dy <= ER2) this.engaged[tg]++;
    }
    // Đảo chiều duyệt mỗi tick để di chuyển / chọn mục tiêu không ưu tiên phe có chỉ số nhỏ (phe Tây)
    const fwd = (this.tick & 1) === 0;
    for (let k = 0; k < this.n; k++) {
      const i = fwd ? k : this.n - 1 - k;
      if (!this.alive[i]) continue;
      // Trinh sát (PAWN) luôn chạy AI quân sự, không chạy AI nông dân
      this.updateUnit(i, dt);
    }
    this.updateArrows(dt);
    this.applyDamage();
    if (this.builtBridges.length) this.updateBridges(dt);
    this.updateSheep(dt);
    // Cập nhật sương mù và bao vây 3 lần/giây (mỗi ~333ms game)
    if (this.time - this._visLastT >= 0.33) {
      this._visLastT = this.time;
      const dtv = this.time - this._objLastT;
      this._objLastT = this.time;
      if (this.winner < 0) this.updateObjectives(dtv);
      if (this.winner < 0) this.updateDepots(dtv);
      this.updateFlagHomeHeal(dtv);
      this.updateVision();
      this.updateEncirclement();
      this.updateUnitStatus(dtv);
      this.updateCallToArms();
      this.updateCrowding();
      this.updateTowers(dtv);
      if (this.winner < 0) this.checkVictory();
    }
    const now = this.time;
    this.fx = this.fx.filter((f) => now - f.t0 < 1.6);
  }

  private setWinner(s: number, reason: WinReason) {
    if (this.winner >= 0) return;
    this.winner = s;
    this.winReason = reason;
  }

  private checkVictory() {
    for (const s of [0, 1]) {
      const c = this.castleOf(s);
      if (c && c.hp <= 0) return this.setWinner(1 - s, "castle");
    }
    // V2: Uy thế cần 500
    if (this.prestige[0] >= PRESTIGE_WIN || this.prestige[1] >= PRESTIGE_WIN) {
      return this.setWinner(this.prestige[0] >= this.prestige[1] ? 0 : 1, "prestige");
    }
    const r0 = this.combatAlive(0) / this.combat0[0], r1 = this.combatAlive(1) / this.combat0[1];
    if (r0 < SURRENDER_FRAC || r1 < SURRENDER_FRAC) return this.setWinner(r0 < r1 ? 1 : 0, "surrender");
    // V2: Hết 20 phút: so Uy thế, rồi so chỗ vượt sông, rồi tổng HP
    if (this.time >= TIME_LIMIT) {
      if (Math.abs(this.prestige[0] - this.prestige[1]) >= 1) {
        return this.setWinner(this.prestige[0] > this.prestige[1] ? 0 : 1, "time");
      }
      // So số chỗ vượt sông đang giữ
      const rc = [0, 0];
      for (const o of this.obj) if (o.kind === OBJ_RIVER && this.objOwner[o.id] >= 0) rc[this.objOwner[o.id]]++;
      if (rc[0] !== rc[1]) return this.setWinner(rc[0] > rc[1] ? 0 : 1, "time");
      // Cuối cùng: so tổng HP
      const hp = [0, 0];
      for (let i = 0; i < this.n; i++) if (this.alive[i]) hp[this.side[i]] += this.hp[i];
      this.setWinner(hp[0] >= hp[1] ? 0 : 1, "time");
    }
  }

  // Chức năng đầu hàng chủ động
  surrender(side: number) {
    if (this.winner >= 0) return;
    this.setWinner(1 - side, "surrender");
    this.pushEvent(-1, `Phe ${side === 0 ? "Tây" : "Đông"} đã đầu hàng!`);
  }

  // ---- V2: Cứ điểm sông, cờ cao nguyên, Đầu cầu, cờ cô lập & Uy thế (3Hz)
  private updateObjectives(dtv: number) {
    const m = this.m;
    const elite = [this.combatAlive(0) < this.combatAlive(1), this.combatAlive(1) < this.combatAlive(0)];
    const riverCount: [number, number] = [0, 0];
    // 1) Tính bridgehead: mỗi phe có đầu cầu ở front nào?
    const bh: [boolean[], boolean[]] = [[false, false, false], [false, false, false]];

    for (const o of this.obj) {
      const cnt = [0, 0];
      let scout = 0;
      const r = o.r;
      for (let yy = Math.max(0, o.ty - r); yy <= Math.min(MH - 1, o.ty + r); yy++) {
        for (let xx = Math.max(0, o.tx - r); xx <= Math.min(MW - 1, o.tx + r); xx++) {
          if ((xx - o.tx) ** 2 + (yy - o.ty) ** 2 > r * r) continue;
          const t = yy * MW + xx;
          if (o.kind === OBJ_FLAG && m.level[t] < o.top) continue;
          for (let j = this.head[t]; j >= 0; j = this.next[j]) {
            if (!this.alive[j]) continue;
            if (this.type[j] === PAWN) { if (this.side[j] !== o.home) scout++; continue; }
            cnt[this.side[j]]++;
          }
        }
      }
      const k = o.id;
      const owner = this.objOwner[k];
      this.objContested[k] = cnt[0] > 0 && cnt[1] > 0 ? 1 : 0;
      const solo = cnt[0] > 0 && cnt[1] === 0 ? 0 : cnt[1] > 0 && cnt[0] === 0 ? 1 : -1;
      if (solo >= 0 && solo !== owner) {
        if (this.objCapSide[k] !== solo) { this.objCapSide[k] = solo; this.objProg[k] = 0; }
        const need = owner < 0 ? CAP_NEUTRAL_T : CAP_ENEMY_T;
        this.objProg[k] += (dtv / need) * (elite[solo] ? ELITE_CAP_MULT : 1);
        if (this.objProg[k] >= 1) {
          this.objOwner[k] = solo;
          this.objProg[k] = 0;
          this.objCapSide[k] = -1;
          this.pushEvent(solo, `Quân ${solo === 0 ? "Tây" : "Đông"} chiếm ${o.label}`);
        }
      } else if (!this.objContested[k] && this.objProg[k] > 0) {
        this.objProg[k] = Math.max(0, this.objProg[k] - dtv / CAP_NEUTRAL_T);
        if (this.objProg[k] === 0) this.objCapSide[k] = -1;
      }
      if (o.kind === OBJ_RIVER) {
        if (this.objOwner[k] >= 0) {
          riverCount[this.objOwner[k]]++;
          bh[this.objOwner[k]][o.front] = true; // giữ ≥1 cứ điểm sông → có đầu cầu
        }
      } else {
        // Trinh sát địch đứng trên đỉnh cờ nhà đủ lâu → tắt tầm nhìn cố định của cờ
        if (scout > 0 && owner === o.home) {
          this.objScoutT[k] += dtv;
          if (this.objScoutT[k] >= SCOUT_BLIND_T && this.objBlindUntil[k] < this.time) {
            this.objBlindUntil[k] = this.time + SCOUT_BLIND_DUR;
            this.pushEvent(1 - o.home, `Trinh sát làm mù ${o.label}`);
          }
        } else this.objScoutT[k] = 0;
      }
    }
    this.bridgehead = bh;
    
    // V2: Đầu cầu toàn cục (có bất kỳ cứ điểm sông nào HOẶC có cầu tự xây đã hoàn thành)
    const globalBh = [
      riverCount[0] > 0 || this.builtBridges.some((b) => b.side === 0 && b.alive && b.done),
      riverCount[1] > 0 || this.builtBridges.some((b) => b.side === 1 && b.alive && b.done),
    ];

    // 2) V2: Uy thế từ cờ — chỉ khi có đầu cầu toàn cục
    for (const o of this.obj) {
      if (o.kind !== OBJ_FLAG) continue;
      const ow = this.objOwner[o.id];
      if (ow < 0 || ow === o.home) continue; // chưa chiếm hoặc cờ nhà → không cho điểm
      if (globalBh[ow]) {
        // Có đầu cầu → cờ cho điểm
        this.prestige[ow] += FLAG_BRIDGEHEAD_RATE * dtv;
        this.flagIsolateT[o.id] = 0; // reset cô lập timer
      } else {
        // Mất đầu cầu → cờ bị cô lập, không cho điểm
        if (this.flagIsolateT[o.id] === 0) {
          this.flagIsolateT[o.id] = this.time;
          this.pushEvent(1 - ow, `Mất toàn bộ đầu cầu — cờ bị cô lập, còn ${FLAG_ISOLATE_T}s`);
        }
        // Sau FLAG_ISOLATE_T giây, cờ tự trả về cho chủ cũ
        if (this.time - this.flagIsolateT[o.id] >= FLAG_ISOLATE_T) {
          this.objOwner[o.id] = o.home;
          this.flagIsolateT[o.id] = 0;
          this.pushEvent(o.home, `${o.label} được trả về do mất đầu cầu quá ${FLAG_ISOLATE_T}s`);
        }
      }
    }

    // 3) V2: Ưu thế sông (chỉ tạo áp lực nhẹ)
    const diff = riverCount[0] - riverCount[1];
    if (diff > 0) this.prestige[0] += diff * RIVER_PRESTIGE_RATE * dtv;
    else if (diff < 0) this.prestige[1] += -diff * RIVER_PRESTIGE_RATE * dtv;

    // Hiệu ứng công trình
    for (const s of [0, 1]) {
      const alive = (k: string) => m.buildings.some((b) => b.side === s && b.kind === k && b.hp > 0);
      this.bAlive[s].Monastery = alive("Monastery");
      this.bAlive[s].Archery = alive("Archery");
      this.bAlive[s].Barracks = alive("Barracks");
    }
  }

  // ---- V2: Cờ nhà hồi máu cho quân mình (3Hz)
  private updateFlagHomeHeal(dtv: number) {
    for (const o of this.obj) {
      if (o.kind !== OBJ_FLAG) continue;
      const ow = this.objOwner[o.id];
      if (ow < 0 || ow !== o.home) continue; // chỉ cờ nhà còn giữ
      const R = FLAG_HOME_HEAL_R;
      for (let yy = Math.max(0, o.ty - R); yy <= Math.min(MH - 1, o.ty + R); yy++) {
        for (let xx = Math.max(0, o.tx - R); xx <= Math.min(MW - 1, o.tx + R); xx++) {
          if ((xx - o.tx) ** 2 + (yy - o.ty) ** 2 > R * R) continue;
          const t = yy * MW + xx;
          for (let j = this.head[t]; j >= 0; j = this.next[j]) {
            if (!this.alive[j] || this.side[j] !== ow) continue;
            if (this.time - this.lastCombat[j] < FLAG_HOME_REST_T) continue;
            const max = STATS[this.type[j]].hp;
            if (this.hp[j] < max) {
              this.hp[j] = Math.min(max, this.hp[j] + max * FLAG_HOME_HEAL_RATE * dtv);
            }
          }
        }
      }
    }
  }

  // ---- V2: Kho lương (3Hz)
  private updateDepots(dtv: number) {
    // Kiểm tra lịch sinh kho
    while (this._depotIdx < DEPOT_SCHEDULE.length) {
      const schedT = DEPOT_SCHEDULE[this._depotIdx];
      // Cảnh báo trước 60s
      if (this.time >= schedT - DEPOT_WARN_T && !this._depotWarned.has(this._depotIdx)) {
        this._depotWarned.add(this._depotIdx);
        this.pushEvent(-1, `Kho lương sẽ xuất hiện sau ${Math.ceil(schedT - this.time)}s`);
      }
      if (this.time >= schedT) {
        // Sinh 1 cặp kho đối xứng ở vùng bờ sông (x=180..232)
        const rnd = this.rnd;
        const tx0 = 180 + Math.floor(rnd() * 52);
        const ty0 = 100 + Math.floor(rnd() * (MH - 200));
        this.depots.push({ tx: tx0, ty: ty0, spawnT: this.time, side: -1, prog: [0, 0], claimed: false, expired: false });
        this.depots.push({ tx: MW - 1 - tx0, ty: MH - 1 - ty0, spawnT: this.time, side: -1, prog: [0, 0], claimed: false, expired: false });
        this.pushEvent(-1, `Kho lương xuất hiện!`);
        this._depotIdx++;
      } else break;
    }
    // Cập nhật từng kho
    const elite = [this.combatAlive(0) < this.combatAlive(1), this.combatAlive(1) < this.combatAlive(0)];
    for (const d of this.depots) {
      if (d.claimed || d.expired) continue;
      if (this.time - d.spawnT >= DEPOT_EXPIRE_T) { d.expired = true; continue; }
      const R = DEPOT_CAP_R;
      const cnt = [0, 0];
      for (let yy = Math.max(0, d.ty - R); yy <= Math.min(MH - 1, d.ty + R); yy++) {
        for (let xx = Math.max(0, d.tx - R); xx <= Math.min(MW - 1, d.tx + R); xx++) {
          if ((xx - d.tx) ** 2 + (yy - d.ty) ** 2 > R * R) continue;
          const t = yy * MW + xx;
          for (let j = this.head[t]; j >= 0; j = this.next[j]) {
            if (!this.alive[j] || this.type[j] === PAWN) continue;
            cnt[this.side[j]]++;
          }
        }
      }
      const solo = cnt[0] > 0 && cnt[1] === 0 ? 0 : cnt[1] > 0 && cnt[0] === 0 ? 1 : -1;
      if (solo >= 0) {
        const s = solo as 0 | 1;
        const mult = elite[s] ? ELITE_CAP_MULT : 1;
        d.prog[s] += (dtv / DEPOT_CAP_T) * mult;
        if (d.prog[s] >= 1) {
          d.claimed = true;
          this.prestige[s] += DEPOT_VALUE;
          this.pushEvent(s, `Quân ${s === 0 ? "Tây" : "Đông"} lấy Kho lương (+${DEPOT_VALUE} Uy thế)`);
        }
      }
      // nếu có địch thì tiến độ đứng yên (cả hai phe reset)
      if (cnt[0] > 0 && cnt[1] > 0) { d.prog[0] = 0; d.prog[1] = 0; }
    }
  }

  // ---- Chen chúc (lưới 4×4 ô) & bụi mù đạo quân lớn (lưới 16×16 ô), 3Hz
  private updateCrowding() {
    const CW = MW / CROWD_CELL;
    const [c0, c1] = this.crowdCnt;
    c0.fill(0); c1.fill(0);
    const BW = MW / BIG_ARMY_CELL;
    const big0 = this._big0, big1 = this._big1;
    big0.fill(0); big1.fill(0);
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const t = this.tile[i], tx = t % MW, ty = (t / MW) | 0;
      const c = ((ty / CROWD_CELL) | 0) * CW + ((tx / CROWD_CELL) | 0);
      const b = ((ty / BIG_ARMY_CELL) | 0) * BW + ((tx / BIG_ARMY_CELL) | 0);
      if (this.side[i]) { c1[c]++; big1[b]++; } else { c0[c]++; big0[b]++; }
    }
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) { this.crowded[i] = 0; continue; }
      this.crowded[i] = this.crowdCount(this.side[i], this.tile[i]) > CROWD_LIMIT ? 1 : 0;
    }
    this.bigArmies.length = 0;
    for (const [s, g] of [[0, big0], [1, big1]] as const) {
      for (let b = 0; b < g.length; b++) {
        if (g[b] <= BIG_ARMY) continue;
        const jx = ((this.rnd() - 0.5) * 16) | 0, jy = ((this.rnd() - 0.5) * 16) | 0;
        this.bigArmies.push({ side: s, tx: (b % BW) * BIG_ARMY_CELL + 8 + jx, ty: ((b / BW) | 0) * BIG_ARMY_CELL + 8 + jy, n: g[b] });
      }
    }
  }

  crowdCount(side: number, tile: number) {
    const CW = MW / CROWD_CELL;
    return this.crowdCnt[side][(((tile / MW) | 0) / CROWD_CELL | 0) * CW + ((tile % MW) / CROWD_CELL | 0)];
  }

  private moveMul(i: number) {
    return this.crowded[i] ? CROWD_SPEED : 1;
  }

  // ---- Tiếp viện (3Hz): quân ta bị đánh ở đâu thì lính đang rảnh quanh đó (≤ ~1–2 ô lưới 8 ô) nhận
  // vùng chiến đấu tạm tại chỗ đó và lao vào đánh. Vùng tự tắt sau ZONE_CALL_T giây không còn bị đánh;
  // khi tắt, lính neo lại tại chỗ đang đứng (không kéo cả đám về chỗ cũ).
  private updateCallToArms() {
    const G = MW / CALL_CELL;
    for (let s = 0; s < 2; s++) this._hitCells[s].fill(0);
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.time - this.lastHitT[i] > 0.5) continue;
      const c = Math.floor(this.y[i] / T / CALL_CELL) * G + Math.floor(this.x[i] / T / CALL_CELL);
      if (this._hitCells[this.side[i]][c] < 255) this._hitCells[this.side[i]][c]++;
    }
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      // hết hạn vùng tiếp viện
      if (this.zoneR[i] > 0 && this.zoneUntil[i] !== Infinity && this.time > this.zoneUntil[i]) {
        this.zoneR[i] = 0;
        if (this.field[i] < 0) { this.anchorX[i] = this.x[i]; this.anchorY[i] = this.y[i]; }
      }
      // chỉ lính đang rảnh: không có lệnh di chuyển, không Giữ vị trí, không đang làm thợ, không phải trinh sát/tu sĩ
      const t = this.type[i];
      if (this.field[i] >= 0 || this.hold[i] || this.buildTask[i] >= 0 || t === PAWN || t === MONK) continue;
      if (this.zoneR[i] > 0 && this.zoneUntil[i] === Infinity) continue; // đang theo lệnh Tấn công
      const hc = this._hitCells[this.side[i]];
      const cx = Math.floor(this.x[i] / T / CALL_CELL), cy = Math.floor(this.y[i] / T / CALL_CELL);
      let best = -1, bn = 0, bd = Infinity;
      const maxD2 = ((ZONE_CALL_R + 4) * T) ** 2;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= G || y >= G) continue;
        const n = hc[y * G + x];
        if (n < 2) continue;
        const d2 = ((x + 0.5) * CALL_CELL * T - this.x[i]) ** 2 + ((y + 0.5) * CALL_CELL * T - this.y[i]) ** 2;
        if (d2 > maxD2) continue;
        // gần hơn thì ưu tiên; cùng mức gần thì chỗ bị đánh đông hơn
        const sc = d2 - n * 4 * T * T;
        if (sc < bd) { bd = sc; bn = n; best = y * G + x; }
      }
      if (best < 0 || bn < 2) continue; // lẻ tẻ 1 lính trúng tên thì chưa kéo cả khu
      this.zoneX[i] = ((best % G) + 0.5) * CALL_CELL * T;
      this.zoneY[i] = (((best / G) | 0) + 0.5) * CALL_CELL * T;
      this.zoneR[i] = ZONE_CALL_R * T;
      this.zoneUntil[i] = this.time + ZONE_CALL_T;
    }
  }

  // ---- Rối loạn, hồi máu trong rừng (3Hz)
  private updateUnitStatus(dtv: number) {
    const forest = this.m.forest;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      if (!this.disorder[i]) {
        const far = this.field[i] < 0 && this.target[i] >= 0 &&
          Math.hypot(this.x[i] - this.anchorX[i], this.y[i] - this.anchorY[i]) > DISORDER_DIST * T;
        if (this.chaseT[i] > DISORDER_CHASE_T || far) this.disorder[i] = 1;
      } else if (this.stillT[i] >= DISORDER_CLEAR_T) this.disorder[i] = 0;
      if (forest[this.tile[i]] && this.time - this.lastCombat[i] >= FOREST_REST_T) {
        const max = STATS[this.type[i]].hp;
        if (this.hp[i] < max) this.hp[i] = Math.min(max, this.hp[i] + max * FOREST_REGEN * dtv);
      }
    }
  }

  // ---- Tháp canh tự bắn quân địch trong TOWER_RANGE ô
  private updateTowers(dtv: number) {
    const bs = this.m.buildings;
    for (let k = 0; k < bs.length; k++) {
      const b = bs[k];
      if (b.kind !== "Tower" || b.hp <= 0) continue;
      this.towerCd[k] -= dtv;
      if (this.towerCd[k] > 0) continue;
      const cx = b.tx + (b.fw >> 1), cy = b.ty;
      let best = -1, bd = Infinity;
      const R = TOWER_RANGE;
      for (let yy = Math.max(0, cy - R); yy <= Math.min(MH - 1, cy + R); yy++) {
        for (let xx = Math.max(0, cx - R); xx <= Math.min(MW - 1, cx + R); xx++) {
          for (let j = this.head[yy * MW + xx]; j >= 0; j = this.next[j]) {
            if (!this.alive[j] || this.side[j] === b.side) continue;
            const d = (xx - cx) ** 2 + (yy - cy) ** 2;
            if (d < bd && d <= R * R) { bd = d; best = j; }
          }
        }
      }
      if (best < 0 || this.arN >= MAX_ARROWS) continue;
      this.towerCd[k] = TOWER_CD;
      const a = this.arN++;
      this.arX0[a] = (cx + 0.5) * T;
      this.arY0[a] = (cy - 2) * T;
      this.arX1[a] = this.x[best];
      this.arY1[a] = this.y[best] - 24;
      this.arT[a] = 0;
      this.arDur[a] = Math.max(0.3, Math.hypot(this.arX1[a] - this.arX0[a], this.arY1[a] - this.arY0[a]) / 520);
      this.arTgt[a] = best;
      this.arDmg[a] = TOWER_DMG;
      this.arSide[a] = b.side;
      this.arType[a] = 255;
    }
  }

  // ---- Hệ thống Tầm nhìn / Sương mù (Vision System) ----
  // Chạy 3Hz (mỗi ~333ms), KHÔNG chạy mỗi frame.
  // Tất cả bộ nhớ được tái dùng, không cấp phát mới.
  private updateVision() {
    const m = this.m;
    for (let s = 0; s < 2; s++) {
      const vc = this.visCount[s];
      const ex = this.explored[s];
      // Bước 1: xóa mảng đếm tầm nhìn hiện tại
      vc.fill(0);

      // Bước 2: dùng mảng thưa bestR (lưu bán kính tốt nhất cho mỗi ô có lính)
      // Vì lính nhiều ô được gộp vt, dùng head/next grid đã dựng sẵn
      const bestR = this._visBestR;
      bestR.fill(0);

      for (let i = 0; i < this.n; i++) {
        if (!this.alive[i] || this.side[i] !== s) continue;
        const tile = this.tile[i];
        // Tính bán kính hiệu dụng theo biến môi trường
        let r = VIS_RADIUS[this.type[i]];
        if (m.forest[tile])   r = Math.floor(r * 0.5); // trong rừng: giảm 50%
        if (m.level[tile] > 1) r = Math.min(15, r + 3); // trên đồi cao: +3
        r = Math.max(1, Math.min(15, r));
        // Ghi bán kính tối ưu vào ô lính đứng
        if (r > bestR[tile]) bestR[tile] = r;
      }

      // Bước 3: stamp mặt nạ (circular mask) cho các ô có bestR > 0
      // O(số ô có lính x bán kính²), không phải O(n lính x bán kính²)
      for (let t = 0; t < N; t++) {
        const r = bestR[t];
        if (r === 0) continue;
        const tx = t % MW, ty = (t / MW) | 0;
        const mask = VIS_MASKS[r];
        for (let k = 0; k < mask.length; k += 2) {
          const nx = tx + mask[k], ny = ty + mask[k + 1];
          if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
          const ni = ny * MW + nx;
          if (vc[ni] < 255) vc[ni]++; // bão hoà: tránh tràn Uint8 thành 0 (lỗ sương mù)
          ex[ni] = 1; // đánh dấu đã khám phá
        }
      }
      // Cờ nhà còn giữ & chưa bị Trinh sát làm mù: tầm nhìn cố định FLAG_VISION_R ô
      if (this.obj) for (const o of this.obj) {
        if (o.kind !== OBJ_FLAG || o.home !== s || this.objOwner[o.id] !== s || this.objBlindUntil[o.id] > this.time) continue;
        const mask = VIS_MASKS[FLAG_VISION_R];
        for (let k = 0; k < mask.length; k += 2) {
          const nx = o.tx + mask[k], ny = o.ty + mask[k + 1];
          if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
          const ni = ny * MW + nx;
          if (vc[ni] < 255) vc[ni]++;
        }
      }
    }
  }

  // ---- Hệ thống Bao vây (Encirclement System) ----
  // Dùng lưới thô 8x8 ô để tránh O(n²). Mỗi tick chỉ đếm 1 lượt.
  private updateEncirclement() {
    // Kích thước ô lưới thô: 8x8 ô bản đồ
    const CS = 8;
    const GW = Math.ceil(MW / CS), GH = Math.ceil(MH / CS);
    const GN = GW * GH;
    // Bộ nhớ đếm lính phe tây / phe đông trong mỗi ô lưới thô
    const cnt0 = this._encCnt0; cnt0.fill(0);
    const cnt1 = this._encCnt1; cnt1.fill(0);

    // Bước 1: đếm lính vào từng ô lưới thô
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const tx = (this.tile[i] % MW) >> 3; // chia 8
      const ty = ((this.tile[i] / MW) | 0) >> 3;
      const gc = ty * GW + tx;
      if (this.side[i] === 0) cnt0[gc]++; else cnt1[gc]++;
    }

    // Bước 2: xác định ô lưới bị bao vây (với từng phe)
    // Ô của phe s bị bao vây khi:
    //   - enemy > 1.5 * friend (số địch áp đảo)
    //   - Địch có mặt ở ít nhất 1 cặp ô lân cận đối diện nhau (trái-phải hoặc trên-dưới)
    const encGrid0 = this._encGrid0; encGrid0.fill(0);
    const encGrid1 = this._encGrid1; encGrid1.fill(0);

    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const gc = gy * GW + gx;
      // Kiểm tra phe 0 bị bao vây
      if (cnt0[gc] > 0) {
        const enemy = cnt1[gc];
        if (enemy > cnt0[gc] * 1.5) {
          // Kiểm tra địch có ở cả hai hướng đối diện không
          const hasL = gx > 0 && cnt1[(gy) * GW + gx - 1] > 0;
          const hasR = gx < GW - 1 && cnt1[(gy) * GW + gx + 1] > 0;
          const hasT = gy > 0 && cnt1[(gy - 1) * GW + gx] > 0;
          const hasB = gy < GH - 1 && cnt1[(gy + 1) * GW + gx] > 0;
          if ((hasL && hasR) || (hasT && hasB)) encGrid0[gc] = 1;
        }
      }
      // Kiểm tra phe 1 bị bao vây
      if (cnt1[gc] > 0) {
        const enemy = cnt0[gc];
        if (enemy > cnt1[gc] * 1.5) {
          const hasL = gx > 0 && cnt0[(gy) * GW + gx - 1] > 0;
          const hasR = gx < GW - 1 && cnt0[(gy) * GW + gx + 1] > 0;
          const hasT = gy > 0 && cnt0[(gy - 1) * GW + gx] > 0;
          const hasB = gy < GH - 1 && cnt0[(gy + 1) * GW + gx] > 0;
          if ((hasL && hasR) || (hasT && hasB)) encGrid1[gc] = 1;
        }
      }
    }

    // Bước 3: gán trạng thái encircled cho từng lính
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) { this.encircled[i] = 0; continue; }
      const tx = (this.tile[i] % MW) >> 3;
      const ty = ((this.tile[i] / MW) | 0) >> 3;
      const gc = ty * GW + tx;
      const prevEnc = this.encircled[i];
      this.encircled[i] = (this.side[i] === 0 ? encGrid0[gc] : encGrid1[gc]);

      // Cuồng chiến (Berserk): 5% cơ hội khi bị bao vây và máu thấp
      // Chỉ kiểm tra khi mới chuyển sang trạng thái bao vây (prevEnc === 0)
      if (this.encircled[i] && !prevEnc && !this.berserk[i]) {
        const maxHp = [120, 70, 160, 60, 50][this.type[i]];
        const hpPct = this.hp[i] / maxHp;
        // Khả năng cuồng chiến tăng dần khi máu giảm (tối đa 5%)
        const berProb = hpPct < 0.5 ? 0.05 * (1 - hpPct * 2) + 0.05 : 0;
        if (this.rnd() < berProb) {
          this.berserk[i] = 1;
          this.addFx(FX_DUST, this.x[i], this.y[i], 1); // hiệu ứng bụi đỏ
        }
      }
    }
  }

  private rebuildGrid() {
    this.head.fill(-1);
    const p0 = this.presence[0], p1 = this.presence[1];
    p0.fill(0);
    p1.fill(0);
    const forest = this.m.forest;
    // Đảo chiều chèn mỗi tick: đầu danh sách mỗi ô không luôn là lính chỉ số lớn (phe Đông).
    // Thứ tự này quyết định ai được tách ra / chọn làm mục tiêu trước — để cố định sẽ thiên vị một phe.
    const fwd = (this.tick & 1) === 0;
    for (let k = 0; k < this.n; k++) {
      const i = fwd ? k : this.n - 1 - k;
      if (!this.alive[i]) continue;
      const t = this.tile[i];
      this.next[i] = this.head[t];
      this.head[t] = i;
      const z = forest[t];
      if (z) (this.side[i] ? p1 : p0)[z]++;
    }
  }

  // cap: bỏ qua địch đã có đủ `cap` lính cận chiến vây đánh (giới hạn mặt trận)
  // Lính đang bị dây xích Phòng thủ: không có lệnh di chuyển, không Giữ vị trí, tư thế Phòng thủ.
  private leashed(i: number) {
    return this.stance[i] === STANCE_DEFEND && this.field[i] < 0 && !this.hold[i];
  }

  // Vùng giới hạn chọn mục tiêu của lính: vùng chiến đấu nếu đang có, không thì dây xích quanh điểm neo.
  private leashArea(i: number): [number, number, number] {
    if (this.zoneR[i] > 0) return [this.zoneX[i], this.zoneY[i], this.zoneR[i]];
    return [this.anchorX[i], this.anchorY[i], LEASH_R * T];
  }

  // Giao vùng chiến đấu cho quân (lệnh Tấn công). r = 0 → xoá vùng.
  setZone(units: number[], x: number, y: number, r: number, until = Infinity) {
    for (const i of units) { this.zoneX[i] = x; this.zoneY[i] = y; this.zoneR[i] = r; this.zoneUntil[i] = until; }
  }

  // Tìm mục tiêu tốt nhất trong `radius` ô (kiểu AoE: không chỉ "gần nhất").
  // Điểm = khoảng cách (px) − thưởng; điểm thấp nhất được chọn:
  //   −PRI_ATTACKER  địch đang đánh chính mình (phản công trước)
  //   −PRI_ARCHER    cung thủ (mối đe doạ tầm xa) — chỉ với lính cận chiến
  //   −PRI_LOWHP×(1−hp%) địch sắp chết (kết liễu nhanh)
  // leash: bỏ địch nằm ngoài vùng dây xích (LEASH_R ô quanh điểm neo) — đã không đuổi tới được thì đừng
  // nhận, nếu không lính sẽ lặp "lao lên → bị kéo về" mãi. Riêng kẻ đang đánh mình thì luôn được nhận.
  private findEnemy(i: number, radius: number, cap = 255, leash = false): number {
    const s = this.side[i];
    const t0 = this.tile[i];
    const tx = t0 % MW, ty = (t0 / MW) | 0;
    const px = this.x[i], py = this.y[i];
    const melee = this.type[i] !== ARCHER && this.type[i] !== MONK;
    const [ax, ay, lr] = this.leashArea(i);
    const lr2 = lr * lr;
    let best = -1, bs = Infinity;
    for (let r = 0; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        const yy = ty + dy;
        if (yy < 0 || yy >= MH) continue;
        const edge = dy === -r || dy === r;
        for (let dx = -r; dx <= r; dx += edge ? 1 : 2 * r || 1) {
          const xx = tx + dx;
          if (xx < 0 || xx >= MW) continue;
          for (let j = this.head[yy * MW + xx]; j >= 0; j = this.next[j]) {
            if (this.side[j] === s || !this.alive[j] || this.engaged[j] >= cap) continue;
            const hitsMe = this.target[j] === i;
            if (leash && !hitsMe && (this.x[j] - ax) ** 2 + (this.y[j] - ay) ** 2 > lr2) continue;
            const d = Math.sqrt((this.x[j] - px) ** 2 + (this.y[j] - py) ** 2);
            let sc = d - PRI_LOWHP * (1 - this.hp[j] / STATS[this.type[j]].hp);
            if (hitsMe) sc -= PRI_ATTACKER;
            if (melee && this.type[j] === ARCHER) sc -= PRI_ARCHER;
            if (sc < bs && this.targetable(s, j)) { bs = sc; best = j; }
          }
        }
      }
      // mọi địch ở vòng r+1 cách ít nhất r·T, điểm ít nhất r·T − PRI_MAX → không thể tốt hơn thì dừng
      if (best >= 0 && r * T - PRI_MAX > bs) break;
    }
    return best;
  }

  private findWounded(i: number, radius: number): number {
    const s = this.side[i];
    const t0 = this.tile[i];
    const tx = t0 % MW, ty = (t0 / MW) | 0;
    let best = -1, bd = Infinity;
    for (let yy = Math.max(0, ty - radius); yy <= Math.min(MH - 1, ty + radius); yy++) {
      for (let xx = Math.max(0, tx - radius); xx <= Math.min(MW - 1, tx + radius); xx++) {
        for (let j = this.head[yy * MW + xx]; j >= 0; j = this.next[j]) {
          if (j === i || this.side[j] !== s || !this.alive[j]) continue;
          if (this.hp[j] > STATS[this.type[j]].hp * 0.85) continue;
          const d = (this.x[j] - this.x[i]) ** 2 + (this.y[j] - this.y[i]) ** 2;
          if (d < bd) { bd = d; best = j; }
        }
      }
    }
    return best;
  }

  // Đường ngắn nhất tâm khối → ô đội hình (lần ngược nav từ ô về tâm). Trả về ô trên đường đó
  // gần ô đội hình nhất mà lính nhìn thẳng thấy được; -1 nếu không có.
  private slotWaypoint(i: number, nav: LocalNav, sx: number, sy: number): number {
    let t = this.tileAt(sx, sy);
    const chain: number[] = [];
    for (let k = 0; k < 256; k++) {
      const c = navCell(nav, t);
      if (c < 0) break;
      const dd = nav.dir[c];
      if (dd === 255) break;
      chain.push(t);
      if (dd === 8) break;
      t += DY[dd] * MW + DX[dd];
    }
    // chain[0] là ô chứa ô đội hình (đã biết không thấy thẳng) → xét từ chain[1]
    for (let k = 1; k < chain.length; k++) {
      const c = chain[k];
      const x = (c % MW) * T + 32, y = ((c / MW) | 0) * T + 32;
      if (Math.abs(x - this.x[i]) > 900 || Math.abs(y - this.y[i]) > 900) continue;
      if (c === this.tile[i] || this.clearLine(i, x, y)) return c;
    }
    return -1;
  }

  // Đi thẳng tới (x, y); vướng địa hình thì thử các hướng khác.
  private steerTo(i: number, x: number, y: number, sp: number, d: number): boolean {
    const l = Math.hypot(x - this.x[i], y - this.y[i]) || 1;
    const vx = (x - this.x[i]) / l, vy = (y - this.y[i]) / l;
    const s = Math.min(sp, l);
    if (Math.abs(vx) > 0.1) this.face[i] = vx > 0 ? 1 : -1;
    return this.tryMove(i, vx * s, vy * s) || this.tryMoveFlowFallback(i, d, s);
  }

  // Bước theo hướng d (0..7) từ ô cur: nhắm tâm ô kế tiếp, pha thêm hướng gốc cho mượt.
  private stepDir(i: number, cur: number, d: number, sp: number): boolean {
    const tx = (cur % MW) + DX[d], ty = ((cur / MW) | 0) + DY[d];
    let vx = tx * T + 32 - this.x[i];
    let vy = ty * T + 32 - this.y[i];
    const l = Math.hypot(vx, vy) || 1;
    const dl = Math.hypot(DX[d], DY[d]);
    vx = vx / l * 0.6 + (DX[d] / dl) * 0.4;
    vy = vy / l * 0.6 + (DY[d] / dl) * 0.4;
    if (Math.abs(vx) > 0.1) this.face[i] = vx > 0 ? 1 : -1;
    return this.tryMove(i, vx * sp, vy * sp) || this.tryMoveFlowFallback(i, d, sp);
  }

  // Straight-line walkability (so melee units don't chase across rivers/cliffs).
  // Khử rung lắc khi di chuyển theo FlowField
  private tryMoveFlowFallback(i: number, d: number, sp: number): boolean {
    const base = (i + this.tick) & 7;
    for (let k = 0; k < 8; k++) {
      const dir = (base + k) & 7;
      if (dir === d) continue;
      if (this.tryMove(i, DX[dir] * sp, DY[dir] * sp)) return true;
    }
    return false;
  }

  // Khử rung lắc khi đuổi mục tiêu
  private tryMoveChaseFallback(i: number, sp: number): boolean {
    const s = sp * 0.7;
    if (this.tryMove(i, s, 0)) return true;
    if (this.tryMove(i, -s, 0)) return true;
    if (this.tryMove(i, 0, s)) return true;
    if (this.tryMove(i, 0, -s)) return true;
    return false;
  }

  // Straight-line walkability (so melee units don't chase across rivers/cliffs).
  private clearLine(i: number, x1: number, y1: number): boolean {
    return lineWalkable(this.m, this.x[i], this.y[i], x1, y1, this.canSwim(i));
  }

  private findBuilding(i: number): number {
    const s = this.side[i];
    const r = STATS[this.type[i]].aggro * T;
    const bs = this.m.buildings;
    for (let k = 0; k < bs.length; k++) {
      const b = bs[k];
      if (b.side === s || b.hp <= 0) continue;
      if (this.distToBuilding(i, b) < r) return k;
    }
    // cầu tự xây của địch trong tầm → phá
    for (const br of this.builtBridges) {
      if (!br.alive || br.side === s) continue;
      const [bx, by] = this.bridgeNearest(br, this.x[i], this.y[i]);
      if (Math.hypot(bx - this.x[i], by - this.y[i]) < r) return BRIDGE_TARGET + br.id;
    }
    return -1;
  }

  private bTargetAlive(bt: number) {
    if (bt >= BRIDGE_TARGET) { const br = this.builtBridges[bt - BRIDGE_TARGET]; return !!br && br.alive; }
    return this.m.buildings[bt].hp > 0;
  }

  distToBuilding(i: number, b: Building) {
    const cx = Math.max(b.tx * T, Math.min((b.tx + b.fw) * T, this.x[i]));
    const cy = Math.max(b.ty * T, Math.min((b.ty + b.fh) * T, this.y[i]));
    return Math.hypot(cx - this.x[i], cy - this.y[i]);
  }

  private separate(i: number) {
    const t = this.tile[i];
    let pushX = 0, pushY = 0, c = 0;
    const px = this.x[i], py = this.y[i];
    // Lính đang hành quân không bị lính đứng yên đẩy lùi (lính đứng yên tự dạt ra rồi về chỗ),
    // nếu không sẽ giằng co mãi khi phải đi xuyên qua một khối quân đang đứng.
    const mover = this.field[i] >= 0;
    for (let j = this.head[t]; j >= 0 && c < 8; j = this.next[j], c++) {
      if (j === i) continue;
      if (mover && this.field[j] < 0 && this.side[j] === this.side[i]) continue;
      let dx = px - this.x[j];
      let dy = py - this.y[j];
      const d2 = dx * dx + dy * dy;
      if (d2 >= SEP * SEP) continue;
      if (d2 < 0.01) { dx = this.rnd() - 0.5; dy = this.rnd() - 0.5; }
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const k = (SEP - d) / d * 0.8;
      pushX += dx * k;
      pushY += dy * k;
    }
    if (pushX || pushY) this.tryMove(i, Math.max(-8, Math.min(8, pushX)), Math.max(-8, Math.min(8, pushY)));
  }

  // attackerType: binh chủng gây sát thương (255 = Tháp canh, -1 = không rõ)
  damage(j: number, amount: number, attackerSide: number, attackerType = -1, attackerId = -1) {
    if (!this.alive[j]) return;
    // Rối loạn: mất giảm sát thương của Giữ vị trí và nhận thêm 25%
    if (this.disorder[j]) amount *= DISORDER_MULT;
    else if (this.hold[j]) amount *= 0.6;
    // Bị bao vây: nhận thêm 20% sát thương
    if (this.encircled[j] && !this.berserk[j]) amount *= 1.2;
    // Đánh vào lưng quân đang hành quân (rút lui)
    const routed = this.moveMode[j] === MOVE_MARCH && this.field[j] >= 0;
    if (routed) amount *= attackerType === LANCER ? REAR_MULT_LANCER : REAR_MULT;
    // Chen chúc: dễ trúng tên · Đang lội bãi cạn: nhận thêm sát thương
    if (attackerType === ARCHER && this.crowded[j]) amount *= CROWD_ARROW_TAKEN;
    if (this.m.ground[this.tile[j]] === FORD) amount *= FORD_TAKEN;
    else if (this.m.ground[this.tile[j]] === WATER) amount *= SWIM_TAKEN; // đang bơi: dễ bị hạ
    // Trại lính còn đứng: Kiếm sĩ & Thương kỵ bền hơn 10% (tương đương +10% HP tối đa)
    if ((this.type[j] === WARRIOR || this.type[j] === LANCER) && this.bAlive[this.side[j]].Barracks) amount /= 1.1;
    this.lastCombat[j] = this.time;
    this.pendDmg[j] += amount;
    if (routed) this.pendRouted[j] = 1;
    // Ghi nhận mục tiêu và báo động cho cả phe (để cung thủ ở block khác cũng thấy)
    if (attackerId >= 0) this.lastHitBy[j] = attackerId;
    this.lastHitT[j] = this.time;
    if (attackerId >= 0 && this.armyGroupId[j] !== -1) {
      this.groupTarget[this.armyGroupId[j]] = attackerId;
    }
    this.alertUntil[this.side[j]] = this.time + 3;
  }

  // Trừ toàn bộ sát thương của tick cùng lúc: lính bị hạ trong tick này vẫn kịp ra đòn của mình.
  private applyDamage() {
    for (let j = 0; j < this.n; j++) {
      const d = this.pendDmg[j];
      if (d === 0) continue;
      this.pendDmg[j] = 0;
      const routed = this.pendRouted[j];
      this.pendRouted[j] = 0;
      if (!this.alive[j]) continue;
      this.hp[j] -= d;
      if (this.hp[j] > 0) continue;
      const s = this.side[j], by = 1 - s;
      if (routed && this.type[j] !== PAWN) this.prestige[by] += 1 / ROUT_KILLS_PER_PRESTIGE;
      this.alive[j] = 0;
      this.aliveCount[s]--;
      this.typeCount[s][this.type[j]]--;
      this.kills[by]++;
      this.setField(j, -1);
      this.sel[j] = 0;
      this.addFx(FX_DUST, this.x[j], this.y[j], this.rnd() < 0.5 ? 0 : 1);
    }
  }

  private damageBuilding(k: number, amount: number, attackerSide?: number) {
    if (k >= BRIDGE_TARGET) return this.damageBridge(k - BRIDGE_TARGET, amount);
    const b = this.m.buildings[k];
    if (b.hp <= 0) return;
    // V2: Không giữ Cầu giữa → công trình và Thành địch chỉ nhận 25% sát thương
    if (attackerSide !== undefined && !this.bridgehead[attackerSide][FRONT_MID]) {
      amount *= REAR_DMG_NO_BRIDGE;
    }
    b.hp -= amount;
    if (b.hp <= 0) {
      b.hp = 0;
      const by = 1 - b.side;
      if (b.kind === "Castle") this.setWinner(by, "castle");
      else {
        const p = BUILDING_PRESTIGE[b.kind] ?? 0;
        this.prestige[by] += p;
        this.pushEvent(by, `Quân ${by === 0 ? "Tây" : "Đông"} phá ${BUILDING_VI[b.kind] ?? b.kind} (+${p} Uy thế)`);
      }
      for (let y = b.ty; y < b.ty + b.fh; y++) for (let x = b.tx; x < b.tx + b.fw; x++) this.m.block[y * MW + x] = 0;
      invalidateNav(this.m, b.tx, b.ty, b.tx + b.fw - 1, b.ty + b.fh - 1);
      for (let e = 0; e < 5; e++) this.addFx(FX_EXPLOSION, (b.tx + this.rnd() * b.fw) * T, (b.ty + b.fh - this.rnd() * 3) * T, e & 1);
    }
  }

  private arrive(i: number) {
    this.setField(i, -1);
    if (this.m.ground[this.tile[i]] !== WATER) this.swim[i] = 0; // lên bờ rồi: đứng yên không trôi xuống nước
    this.moveMode[i] = MOVE_ATTACK;
    this.anchorX[i] = this.x[i];
    this.anchorY[i] = this.y[i];
  }

  private updateUnit(i: number, dt: number) {
    const t = this.type[i];
    const st = STATS[t];
    const s = this.side[i];
    this.cd[i] -= dt;
    const retarget = (i + this.tick) % 8 === 0;
    if (this.state[i] === S_MOVE) this.stillT[i] = 0; else this.stillT[i] += dt;
    const prevChase = this.chaseT[i];
    this.chaseT[i] = 0;
    // --- đòn cận chiến đang vung: tới khoảnh khắc trúng mới trừ máu (mục tiêu đã chạy khỏi tầm thì trượt)
    if (this.hitTg[i] !== -1 && this.time >= this.hitAt[i]) this.resolveHit(i);

    // --- hành quân (rút lui): bỏ qua địch, chỉ đi theo trường lực
    if (this.moveMode[i] === MOVE_MARCH && this.field[i] < 0) this.moveMode[i] = MOVE_ATTACK;
    const marching = this.moveMode[i] === MOVE_MARCH;
    if (marching) {
      this.retreatT[i] += dt;
      this.target[i] = -1;
      this.btarget[i] = -1;
    } else this.retreatT[i] = 0;

    // --- quay về điểm neo sau khi đuổi quá xa (tư thế Phòng thủ)
    if (this.returning[i] && !marching) {
      const dx = this.anchorX[i] - this.x[i], dy = this.anchorY[i] - this.y[i];
      const d = Math.hypot(dx, dy);
      if (d < T * 1.5 || this.field[i] >= 0) this.returning[i] = 0;
      else {
        const sp = (st.speed * this.moveMul(i) * tileSpeed(this.m, this.tile[i]) * dt) / d;
        this.face[i] = dx > 0 ? 1 : -1;
        this.target[i] = -1;
        if (this.tryMove(i, dx * sp, dy * sp)) {
          this.state[i] = S_MOVE;
          this.setAnim(i, this.runAnim(i));
          this.stuck[i] = 0;
          this.separate(i);
          return;
        }
        this.stuck[i] += dt;
        if (this.stuck[i] > 1.5) {
          // kẹt đường: neo lại tại chỗ
          this.stuck[i] = 0;
          this.returning[i] = 0;
          this.anchorX[i] = this.x[i];
          this.anchorY[i] = this.y[i];
        }
      }
    }

    // --- validate / acquire target
    let tg = this.target[i];
    let lostNow = false;
    if (tg >= 0) {
      const lost = !this.alive[tg] || (t === MONK ? this.hp[tg] >= STATS[this.type[tg]].hp : !this.targetable(s, tg));
      if (lost) { tg = -1; lostNow = true; }
    }
    // Searching (AoE): vừa mất mục tiêu thì dò lại NGAY, không đợi tới lượt 8 tick
    const scan = retarget || lostNow;
    const leash = this.leashed(i);
    if (!marching && scan && (tg < 0 || t === ARCHER)) {
      if (t === MONK) tg = this.findWounded(i, 4);
      else {
        let range = st.aggro;
        if (this.time < this.alertUntil[s] || this.zoneR[i] > 0) {
          range += 8; // Tăng aggro khi phe đang có báo động (combat gần đó) hoặc đang trong vùng chiến đấu
        }
        if (t === ARCHER && this.m.level[this.tile[i]] > 0) range += 2;
        // Giữ vị trí, hoặc đang làm thợ bắc cầu: chỉ đánh địch áp sát (≤ 2 ô), không bỏ việc đi đuổi
        const close = (this.hold[i] && t !== ARCHER) || this.buildTask[i] >= 0;
        const e = this.findEnemy(i, close ? 2 : range, t === ARCHER ? 255 : MELEE_CAP, leash);
        if (e >= 0 && (t === ARCHER || this.clearLine(i, this.x[e], this.y[e]))) {
          tg = e;
          if (t !== ARCHER && this.engaged[e] < 255) this.engaged[e]++;
          this.alertUntil[s] = this.time + 3;
          if (this.armyGroupId[i] !== -1) {
            this.groupTarget[this.armyGroupId[i]] = e;
          }
        }
        else if (t === ARCHER) tg = -1;
      }
    }
    // Kế thừa mục tiêu từ đoàn quân nếu đang rảnh và không rút lui
    if (!marching && tg < 0 && this.armyGroupId[i] !== -1 && t !== MONK && scan && this.buildTask[i] < 0) {
      const gt = this.groupTarget[this.armyGroupId[i]];
      const melee = t !== ARCHER;
      const [lax, lay, lr] = this.leashArea(i);
      const inLeash = gt >= 0 && (!leash || (this.x[gt] - lax) ** 2 + (this.y[gt] - lay) ** 2 <= lr * lr);
      if (gt >= 0 && inLeash && this.alive[gt] && this.targetable(s, gt) && (!melee || this.engaged[gt] < MELEE_CAP)) {
        tg = gt;
      } else if (gt >= 0 && melee) {
        // mục tiêu chung đã đủ người vây / ngoài dây xích: tìm địch khác còn chỗ quanh mình
        const e = this.findEnemy(i, st.aggro + 6, MELEE_CAP, leash);
        if (e >= 0 && this.clearLine(i, this.x[e], this.y[e])) tg = e;
      }
    }
    if (tg >= 0) this.lastTargetT[i] = this.time;
    // Đang bơi: không đánh được (chỉ bơi tiếp / vào bờ)
    const swimming = this.m.ground[this.tile[i]] === WATER;
    if (swimming) tg = -1;
    this.target[i] = tg;
    let bt = this.btarget[i];
    if (bt >= 0 && !this.bTargetAlive(bt)) bt = -1;
    if (swimming) bt = -1;
    else if (!marching && tg < 0 && bt < 0 && t !== MONK && (i + this.tick) % 16 === 0) bt = this.findBuilding(i);
    this.btarget[i] = bt;

    // --- engage
    if (tg >= 0 || bt >= 0) {
      let dx: number, dy: number, dist: number;
      if (tg >= 0) {
        dx = this.x[tg] - this.x[i];
        dy = this.y[tg] - this.y[i];
        dist = Math.hypot(dx, dy);
      } else if (bt >= BRIDGE_TARGET) {
        // cầu tự xây: đánh vào điểm gần nhất của phần cầu đã lát / giàn giáo
        const [bx, by] = this.bridgeNearest(this.builtBridges[bt - BRIDGE_TARGET], this.x[i], this.y[i]);
        dx = bx - this.x[i];
        dy = by - this.y[i];
        dist = Math.hypot(dx, dy);
      } else {
        const b = this.m.buildings[bt];
        dx = (b.tx + b.fw / 2) * T - this.x[i];
        dy = (b.ty + b.fh / 2) * T - this.y[i];
        dist = this.distToBuilding(i, b);
      }
      let range = st.range;
      const high = tg >= 0 && this.m.level[this.tile[i]] > this.m.level[this.tile[tg]];
      if (t === ARCHER && high) range += 2 * T;
      const hyst = this.state[i] === S_ATTACK ? RANGE_HYST : 0;
      if (dist <= range + (t === ARCHER || t === MONK ? 0 : 14) + hyst) {
        this.state[i] = S_ATTACK;
        if (Math.abs(dx) > 4) this.face[i] = dx > 0 ? 1 : -1;
        if (this.cd[i] <= 0) {
          this.cd[i] = st.cd * (0.85 + this.rnd() * 0.3);
          this.attack(i, tg, bt, dx, dy, dist, high);
        } else if (this.animDone(i) || this.anim[i] === this.runAnim(i)) {
          this.setAnim(i, this.idleAnim(i));
        }
        this.separate(i);
        return;
      }
      // Tư thế Phòng thủ: không đuổi quá LEASH_R ô quanh điểm neo
      // (đang có vùng chiến đấu thì xích theo vùng, rộng hơn 4 ô; quay về tâm vùng)
      if (!this.hold[i] && this.field[i] < 0 && this.stance[i] === STANCE_DEFEND) {
        const [lax, lay, lr] = this.leashArea(i);
        if (Math.hypot(this.x[i] - lax, this.y[i] - lay) > lr + (this.zoneR[i] > 0 ? 4 * T : 0)) {
          this.target[i] = -1;
          this.btarget[i] = -1;
          if (this.zoneR[i] > 0) { this.anchorX[i] = lax; this.anchorY[i] = lay; }
          this.returning[i] = 1;
          return;
        }
      }
      if (!this.hold[i]) {
        this.chaseT[i] = prevChase + dt;
        const sp = (st.speed * this.moveMul(i) * tileSpeed(this.m, this.tile[i]) * dt) / (dist || 1);
        this.face[i] = dx > 0 ? 1 : -1;
        
        // Combat spacing: lính đánh gần không chen lên nếu mục tiêu đã quá đông
        const isMelee = t === WARRIOR || t === LANCER || t === PAWN;
        // (lính đã ở sát mục tiêu thì chính nó cũng nằm trong số đếm — không tự chặn mình)
        const others = this.engaged[tg] - (dist <= ENGAGE_R ? 1 : 0);
        if (isMelee && dist > range + 14 && tg >= 0 && others >= MELEE_CAP) {
           // Mục tiêu đã đủ người vây: đổi sang địch khác còn chỗ; không có thì mới đứng chờ phía sau
           const alt = retarget ? this.findEnemy(i, st.aggro + 4, MELEE_CAP, leash) : -1;
           if (alt >= 0 && alt !== tg && this.clearLine(i, this.x[alt], this.y[alt])) {
             this.target[i] = alt;
             this.engaged[alt]++;
           } else {
             this.state[i] = S_IDLE;
             this.setAnim(i, this.idleAnim(i));
             this.separate(i);
             return;
           }
        }

        if (this.tryMove(i, dx * sp, dy * sp)) {
          this.state[i] = S_MOVE;
          this.setAnim(i, this.runAnim(i));
          this.stuck[i] = 0;
          this.separate(i);
          return;
        }
        this.stuck[i] += dt;
        if (this.stuck[i] > 0.6) { this.target[i] = -1; this.btarget[i] = -1; this.stuck[i] = 0; }
      }
    }

    // --- follow flow field or formation
    const fi = this.field[i];
    if (fi >= 0 && this.fields[fi]) {
      const f = this.fields[fi]!;
      const cur = this.tile[i];
      const gx = this.formTargetX[i] + this.formDX[i];
      const gy = this.formTargetY[i] + this.formDY[i];
      const distToSlot = Math.hypot(gx - this.x[i], gy - this.y[i]);

      // Lệnh Tấn công: đã vào vùng chiến đấu mà vừa đánh nhau → dừng tại chỗ, không quay về xếp hàng.
      // Chưa gặp địch thì chỉ cần tới gần ô (≤ 2 ô) là dừng — không dàn trận chỉnh tề.
      const inZone = this.zoneR[i] > 0 && Math.hypot(this.x[i] - this.zoneX[i], this.y[i] - this.zoneY[i]) < this.zoneR[i];
      if (inZone && (this.time - this.lastCombat[i] < 4 || distToSlot < 2 * T)) {
        this.arrive(i);
      } else if (distToSlot < 10) {
        this.arrive(i); // tới ô đội hình: neo đúng vào ô
        this.anchorX[i] = gx;
        this.anchorY[i] = gy;
      } else {
        const sp = st.speed * this.moveMul(i) * tileSpeed(this.m, cur) * dt;
        const ni = this.formNav[i];
        const nav = ni >= 0 && this.navs[ni] && this.navs[ni]!.id === this.formNavId[i] ? this.navs[ni]! : null;
        const lc = nav ? navCell(nav, cur) : -1;
        const ld = lc >= 0 ? nav!.dir[lc] : 255; // hướng nav cục bộ về tâm khối (8 = đang ở ô tâm)
        const d = f.dir[cur];
        let moved: boolean;
        // Nhìn thẳng thấy ô → đi thẳng vào ô. Đã đi thẳng thì giữ nguyên (tránh dao động giữa
        // "về tâm khối" và "vào ô"); dò đường thẳng thưa dần theo khoảng cách cho nhẹ.
        const noShort = this.time < this.formNoShort[i];
        if (noShort) {
          this.formDirect[i] = 0;
        } else if (this.formDirect[i]) {
          if ((i + this.tick) % 4 === 0 && !this.clearLine(i, gx, gy)) this.formDirect[i] = 0;
        } else if (distToSlot < 150 || ld === 8 || d === DIR_GOAL ||
                   (distToSlot < 1600 && (i + this.tick) % 8 === 0)) {
          if (this.clearLine(i, gx, gy)) this.formDirect[i] = 1;
        }
        if (this.formDirect[i]) {
          moved = this.steerTo(i, gx, gy, sp, d);
        } else if (ld !== 255 && noShort) {
          if (ld === 8) moved = this.steerTo(i, gx, gy, sp, d);
          else moved = this.stepDir(i, cur, ld, sp);
        } else if (ld !== 255) {
          // Gần khối nhưng ô bị che (sau vách, vòng quanh cao nguyên...): đi tới ô dẫn đường xa nhất
          // nhìn thấy được trên đường ngắn nhất tâm khối → ô. Tính lại định kỳ hoặc khi đã tới ô dẫn đường.
          let wp = this.formWp[i];
          const reached = wp >= 0 && Math.hypot((wp % MW) * T + 32 - this.x[i], ((wp / MW) | 0) * T + 32 - this.y[i]) < 20;
          if (reached || (i + this.tick) % (wp < 0 ? 4 : 16) === 0) wp = this.formWp[i] = this.slotWaypoint(i, nav!, gx, gy);
          if (wp >= 0) moved = this.steerTo(i, (wp % MW) * T + 32, ((wp / MW) | 0) * T + 32, sp, d);
          else if (ld === 8) moved = this.steerTo(i, gx, gy, sp, d);
          else moved = this.stepDir(i, cur, ld, sp);
        } else if (d !== DIR_NONE && d !== DIR_GOAL) {
          moved = this.stepDir(i, cur, d, sp); // chặng xa: trường lực chung
        } else {
          // ngoài cả hai (bị đẩy lệch ra): nhắm thẳng tâm khối
          moved = this.steerTo(i, this.formTargetX[i], this.formTargetY[i], sp, d);
        }

        if (this.field[i] >= 0) {
          // Kẹt = không nhúc nhích được, hoặc đã sát ô mà không lại gần thêm (bị đám đông chắn).
          const NEAR = 120;
          let progress = moved;
          if (distToSlot < NEAR) {
            progress = distToSlot < this.formBest[i] - 2;
            if (progress) this.formBest[i] = distToSlot;
          }
          if (progress) this.stuck[i] = 0;
          else this.stuck[i] += dt;
          // Giằng co trong phạm vi khối: vẫn "đi" nhưng 4 giây không rời chỗ cũ quá 1/2 ô.
          // (Ngoài phạm vi khối thì không tính — có thể đang xếp hàng qua cầu/dốc.)
          const fromCenter = Math.hypot(this.formTargetX[i] - this.x[i], this.formTargetY[i] - this.y[i]);
          const inBlock = distToSlot < NEAR || fromCenter < Math.hypot(this.formDX[i], this.formDY[i]) + 150;
          // Ngoài phạm vi khối mà 6 giây không rời chỗ quá 1/2 ô (dao động ở mép địa hình): tạm bỏ
          // đi tắt, bám đúng đường tìm được 4 giây — đường này luôn tiến dần về đích nên không lặp.
          let stalled = false;
          // Đang hành quân mà bị đánh và bị chặn đứng (kẹt giữa quân địch): quay sang đánh trả,
          // vẫn giữ lệnh — hết địch thì đi tiếp vào ô đội hình.
          // Tới khu đội hình rồi mà bị đánh, hoặc bị đánh từ PHÍA TRƯỚC (đang hành quân lao vào quân địch,
          // không phải rút lui): cũng đánh trả. Bị đánh từ phía sau (đang rút) thì vẫn chạy như cũ.
          if (this.moveMode[i] === MOVE_MARCH && this.time - this.lastCombat[i] < 1) {
            const hb = this.lastHitBy[i];
            const ahead = hb >= 0 && this.alive[hb] &&
              (this.x[hb] - this.x[i]) * (gx - this.x[i]) + (this.y[hb] - this.y[i]) * (gy - this.y[i]) > 0;
            const blocked = this.time - this.stallT[i] > 2 && Math.hypot(this.x[i] - this.stallX[i], this.y[i] - this.stallY[i]) < T / 2;
            if (inBlock || ahead || blocked) this.moveMode[i] = MOVE_ATTACK;
          }
          if (this.time - this.stallT[i] > (inBlock ? 4 : 6)) {
            const still = Math.hypot(this.x[i] - this.stallX[i], this.y[i] - this.stallY[i]) < T / 2;
            if (still && inBlock && !noShort) { this.formNoShort[i] = this.time + 4; }
            else if (still && inBlock) stalled = true;
            else if (still) this.formNoShort[i] = this.time + 4;
            this.stallX[i] = this.x[i];
            this.stallY[i] = this.y[i];
            this.stallT[i] = this.time;
          }
          if (stalled || this.stuck[i] > (distToSlot < NEAR ? 3 : 2)) {
            this.arrive(i); // kẹt quá lâu -> dừng lại (fail-safe)
            this.stuck[i] = 0;
          } else {
            this.state[i] = S_MOVE;
            this.setAnim(i, this.runAnim(i));
            // Trong phạm vi khối: không tách khỏi lính đã đứng hàng, để len được vào chỗ của mình
            if (!inBlock) this.separate(i);
            return;
          }
        }
      }
    }
    // --- thợ bắc cầu: tới mũi cầu rồi đứng lát (đếm công cho updateBridges)
    const bk = this.buildTask[i];
    if (bk >= 0) {
      const br = this.builtBridges[bk];
      if (!br || !br.alive || br.done) this.buildTask[i] = -1;
      else {
        const [sx, sy] = this.bridgeStand(br, i);
        const d = Math.hypot(sx - this.x[i], sy - this.y[i]);
        if (d > 14) {
          const sp = st.speed * this.moveMul(i) * tileSpeed(this.m, this.tile[i]) * dt;
          if (this.steerTo(i, sx, sy, sp, DIR_NONE)) {
            this.stuck[i] = 0;
            this.state[i] = S_MOVE;
            this.setAnim(i, this.runAnim(i));
          } else if ((this.stuck[i] += dt) > 4) { this.buildTask[i] = -1; this.stuck[i] = 0; }
        } else {
          this.state[i] = S_IDLE;
          this.face[i] = br.dir;
          if (this.animDone(i) || this.anim[i] === this.runAnim(i)) this.setAnim(i, this.idleAnim(i));
        }
        if (d < 1.6 * T) this.bridgeCrew[bk]++;
        this.anchorX[i] = this.x[i];
        this.anchorY[i] = this.y[i];
        return;
      }
    }
    this.state[i] = S_IDLE;
    const a = this.anim[i];
    const ad = ANIMS[a];
    if (ad.loop || this.animDone(i)) this.setAnim(i, this.idleAnim(i));
    // Đứng hàng: bị lính khác len qua đẩy lệch khỏi chỗ thì từ từ về lại điểm neo
    // (không làm khi vừa đánh / vừa có mục tiêu — giữa trận mà kéo về chỗ cũ thì lính đi qua đi lại, bỏ đánh)
    const ax = this.anchorX[i] - this.x[i], ay = this.anchorY[i] - this.y[i];
    const ad2 = ax * ax + ay * ay;
    const calm = this.zoneR[i] === 0 && this.time - this.lastCombat[i] > 6 && this.time - this.lastTargetT[i] > 6;
    if (calm && ad2 > 10 * 10 && ad2 < 150 * 150 && (i + this.tick) % 2 === 1) {
      const d = Math.sqrt(ad2);
      const sp = Math.min(d - 4, st.speed * 0.6 * this.moveMul(i) * tileSpeed(this.m, this.tile[i]) * dt * 2);
      if (this.tryMove(i, (ax / d) * sp, (ay / d) * sp) && d > 24) {
        this.state[i] = S_MOVE;
        this.face[i] = ax > 0 ? 1 : -1;
        this.setAnim(i, this.runAnim(i));
      }
      return;
    }
    if ((i + this.tick) % 2 === 0) this.separate(i);
  }

  private attack(i: number, tg: number, bt: number, dx: number, dy: number, dist: number, high: boolean) {
    const t = this.type[i];
    const st = STATS[t];
    const s = this.side[i];
    let roll = 0.8 + this.rnd() * 0.4;
    // Phục kích: đòn đầu từ rừng khi địch chưa nhìn thấy mình
    const tile = this.tile[i];
    if (t !== MONK && this.m.forest[tile] && this.visCount[1 - s][tile] === 0 && this.time - this.lastCombat[i] > 3) roll *= AMBUSH_MULT;
    // Quay đầu phản công
    if (this.rallyUntil[i] > this.time) roll *= RALLY_MULT;
    // Chen chúc: cận chiến vướng víu · Thương kỵ xung phong vào khối đang Chen chúc (đòn đầu)
    if (t !== ARCHER && t !== MONK && this.crowded[i]) roll *= CROWD_MELEE;
    if (t === LANCER && tg >= 0 && this.crowded[tg] && this.time - this.lastCombat[i] > 3) roll *= CHARGE_MULT;
    if (t !== MONK) this.lastCombat[i] = this.time;
    switch (t) {
      case WARRIOR:
        this.anim[i] = this.rnd() < 0.5 ? AN.W_ATK1 : AN.W_ATK2;
        this.animT[i] = this.time;
        break;
      case LANCER: {
        const [d, flip] = lancerDir(dx, dy);
        this.face[i] = flip ? -1 : 1;
        this.anim[i] = AN.L_ATK[d];
        this.animT[i] = this.time;
        break;
      }
      case ARCHER: {
        this.anim[i] = AN.A_SHOOT;
        this.animT[i] = this.time;
        if (this.arN < MAX_ARROWS) {
          const k = this.arN++;
          this.arX0[k] = this.x[i] + this.face[i] * 10;
          this.arY0[k] = this.y[i] - 34;
          this.arX1[k] = this.x[i] + dx;
          this.arY1[k] = this.y[i] + dy - (tg >= 0 ? 24 : 40);
          this.arT[k] = 0;
          this.arDur[k] = Math.max(0.25, dist / 520);
          this.arTgt[k] = tg >= 0 ? tg : -2 - bt;
          this.arDmg[k] = st.dmg * roll * (high ? 1.3 : 1) * (this.bAlive[s].Archery ? 1.1 : 1);
          this.arSide[k] = s;
          this.arType[k] = t;
        }
        return;
      }
      case MONK:
        this.anim[i] = AN.M_HEAL;
        this.animT[i] = this.time;
        if (tg >= 0) {
          this.hp[tg] = Math.min(STATS[this.type[tg]].hp, this.hp[tg] + st.dmg * (this.bAlive[s].Monastery ? 1.25 : 1));
          this.addFx(FX_HEAL, this.x[tg], this.y[tg], 0);
        }
        return;
      default:
        this.anim[i] = AN.P_INT.Knife;
        this.animT[i] = this.time;
    }
    // Tính sát thương cuối, áp dụng các hiệu ứng trạng thái
    let finalDmg = st.dmg * roll;
    if (this.berserk[i]) {
      // Cuồng chiến: sát thương x2, miễn nhiễm phạt bao vây
      finalDmg *= 2.0;
    } else if (this.encircled[i]) {
      // Bị bao vây: sát thương -30%
      finalDmg *= 0.7;
    }
    // Trúng đòn ở giữa hoạt ảnh vung (WINDUP), không phải lúc bắt đầu vung
    this.hitTg[i] = tg >= 0 ? tg : bt >= 0 ? -2 - bt : -1;
    this.hitDmg[i] = finalDmg;
    this.hitAt[i] = this.time + WINDUP[t];
    if (WINDUP[t] <= 0) this.resolveHit(i);
  }

  // Áp đòn cận chiến đã vung. Mục tiêu đã chết / chạy ra khỏi tầm (+ dung sai) thì đòn trượt.
  private resolveHit(i: number) {
    const h = this.hitTg[i];
    this.hitTg[i] = -1;
    if (h === -1) return;
    const reach = STATS[this.type[i]].range + 14 + RANGE_HYST + 16;
    if (h >= 0) {
      if (!this.alive[h] || Math.hypot(this.x[h] - this.x[i], this.y[h] - this.y[i]) > reach) return;
      this.damage(h, this.hitDmg[i], this.side[i], this.type[i], i);
    } else {
      const bt = -2 - h;
      if (!this.bTargetAlive(bt)) return;
      this.damageBuilding(bt, this.hitDmg[i], this.side[i]);
    }
  }

  private updateArrows(dt: number) {
    let k = 0;
    while (k < this.arN) {
      this.arT[k] += dt;
      if (this.arT[k] >= this.arDur[k]) {
        const tg = this.arTgt[k];
        if (tg >= 0) {
          if (this.alive[tg] && Math.hypot(this.x[tg] - this.arX1[k], this.y[tg] - 24 - this.arY1[k]) < 48) {
            this.damage(tg, this.arDmg[k], this.arSide[k], this.arType[k]);
            // Mưa tên: rơi vào chỗ đông địch thì trúng thêm một lính cạnh đó
            const vs = this.side[tg];
              if (this.crowdCount(vs, this.tile[tg]) > VOLLEY_MIN) {
              for (let j = this.head[this.tile[tg]]; j >= 0; j = this.next[j]) {
                if (j !== tg && this.alive[j] && this.side[j] === vs) { this.damage(j, this.arDmg[k] * VOLLEY_SPLASH, this.arSide[k], this.arType[k], this.arTgt[k]); break; }
              }
            }
          }
        } else if (tg <= -2) this.damageBuilding(-2 - tg, this.arDmg[k], this.arSide[k]);
        // swap-remove
        const l = --this.arN;
        this.arX0[k] = this.arX0[l]; this.arY0[k] = this.arY0[l];
        this.arX1[k] = this.arX1[l]; this.arY1[k] = this.arY1[l];
        this.arT[k] = this.arT[l]; this.arDur[k] = this.arDur[l];
        this.arTgt[k] = this.arTgt[l]; this.arDmg[k] = this.arDmg[l]; this.arSide[k] = this.arSide[l]; this.arType[k] = this.arType[l];
        continue;
      }
      k++;
    }
  }

  // Workers: go to node → interact → carry resource back to the castle.
  private updatePawn(i: number, dt: number) {
    if ((i + this.tick) % 16 === 0) {
      const e = this.findEnemy(i, 3);
      if (e >= 0) {
        this.task[i] = TK_FIGHT;
        this.target[i] = e;
        return;
      }
    }
    const s = this.side[i];
    const task = this.task[i];
    const tools = [TOOL_PICK, TOOL_AXE, TOOL_KNIFE, TOOL_HAMMER, TOOL_NONE];
    const carry = [TOOL_GOLD, TOOL_WOOD, TOOL_MEAT, TOOL_HAMMER, TOOL_NONE];
    const interact = [AN.P_INT.Pickaxe, AN.P_INT.Axe, AN.P_INT.Knife, AN.P_INT.Hammer, AN.P_IDLE[0]];
    const walkTo = (x: number, y: number, a: number) => {
      const dx = x - this.x[i], dy = y - this.y[i];
      const d = Math.hypot(dx, dy);
      if (d < 10) return true;
      const sp = STATS[PAWN].speed * dt / d;
      this.face[i] = dx > 0 ? 1 : -1;
      if (!this.tryMove(i, dx * sp, dy * sp)) {
        this.stuck[i] += dt;
        if (this.stuck[i] > 1.5) { this.stuck[i] = 0; this.pickNode(i); }
      }
      this.setAnim(i, a);
      this.state[i] = S_MOVE;
      return false;
    };
    switch (this.phase[i]) {
      case PH_GO:
        if (walkTo(this.gx[i], this.gy[i], AN.P_RUN[tools[task]])) {
          this.phase[i] = PH_WORK;
          this.taskT[i] = 3 + this.rnd() * 4;
          if (task === TK_IDLE) this.taskT[i] = 2 + this.rnd() * 3;
        }
        break;
      case PH_WORK:
        this.state[i] = S_WORK;
        this.setAnim(i, task === TK_IDLE ? AN.P_IDLE[0] : interact[task]);
        this.taskT[i] -= dt;
        if (this.taskT[i] <= 0) {
          if (task === TK_BUILD || task === TK_IDLE) {
            this.phase[i] = PH_DROP;
            this.taskT[i] = 1.5;
          } else this.phase[i] = PH_BACK;
        }
        break;
      case PH_BACK: {
        const [dx, dy] = this.m.pawnNodes[s].drop;
        if (walkTo(dx + (i % 7 - 3) * 12, dy + (i % 5 - 2) * 8, AN.P_RUN[carry[task]])) {
          this.phase[i] = PH_DROP;
          this.taskT[i] = 0.8;
          const r = this.res[s];
          if (task === TK_GOLD) r.gold++;
          else if (task === TK_WOOD) r.wood++;
          else if (task === TK_MEAT) r.meat++;
        }
        break;
      }
      default:
        this.state[i] = S_IDLE;
        this.setAnim(i, AN.P_IDLE[carry[task]]);
        this.taskT[i] -= dt;
        if (this.taskT[i] <= 0) {
          this.phase[i] = PH_GO;
          this.pickNode(i);
        }
    }
  }

  private updateSheep(dt: number) {
    for (let i = 0; i < this.shN; i++) {
      this.shT[i] -= dt;
      if (this.shS[i] === 1) {
        const dx = this.shGX[i] - this.shX[i], dy = this.shGY[i] - this.shY[i];
        const d = Math.hypot(dx, dy);
        if (d < 4) { this.shS[i] = this.rnd() < 0.6 ? 2 : 0; this.shT[i] = 2 + this.rnd() * 5; continue; }
        const nx = this.shX[i] + (dx / d) * 22 * dt, ny = this.shY[i] + (dy / d) * 22 * dt;
        if (passable(this.m, this.tileAt(nx, ny))) { this.shX[i] = nx; this.shY[i] = ny; }
        else this.shS[i] = 0;
        this.shF[i] = dx > 0 ? 1 : -1;
      } else if (this.shT[i] <= 0) {
        const [px, py] = this.m.pasture[this.shSide[i]];
        this.shGX[i] = px + (this.rnd() - 0.5) * 9 * T;
        this.shGY[i] = py + (this.rnd() - 0.5) * 6 * T;
        this.shS[i] = 1;
      }
    }
  }
}

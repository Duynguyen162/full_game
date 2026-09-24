// Grid & world constants shared by map generator, simulation and renderer.
export const T = 64; // tile size in world pixels (matches the Tiny Swords tileset)
export const MW = 512;
export const MH = 512;
export const N = MW * MH;
export const WORLD_W = MW * T;
export const WORLD_H = MH * T;

// ground[] values
export const WATER = 0;
export const LAND = 1;
export const FORD = 2;
export const BRIDGE = 3;

// ramp[] values: art from tileset columns 0 (left slope) and 3 (right slope), rows 4-5
export const RAMP_L_TOP = 1;
export const RAMP_L_BOT = 2;
export const RAMP_R_TOP = 3;
export const RAMP_R_BOT = 4;

export const MAX_LEVEL = 3;

// Tactical zone geometry (fraction of map width)
export const SPAWN_FRAC = 0.2;
export const SPAWN_W = Math.floor(MW * SPAWN_FRAC); // 102 tiles

// Rows where the river is crossed. Rotationally symmetric: y ↔ MH-1-y.
export const BRIDGE_ROWS: [number, number][] = [
  [92, 95],
  [254, 257],
  [416, 419],
];
export const FORD_ROWS: [number, number][] = [
  [168, 181],
  [330, 343],
];

export const SPEED_FORD = 0.5;
export const FOREST_REVEAL_ALPHA = 0.4;

export type Side = 0 | 1; // 0 = West, 1 = East
export const COLORS = ["Blue", "Red", "Yellow", "Purple", "Black"] as const;
export type TeamColor = (typeof COLORS)[number];
export const COLOR_HEX: Record<TeamColor, string> = {
  Blue: "#4f8fd6",
  Red: "#e0524a",
  Yellow: "#e6c34a",
  Purple: "#a26ad0",
  Black: "#5b6470",
};
export const COLOR_VI: Record<TeamColor, string> = {
  Blue: "Lam",
  Red: "Đỏ",
  Yellow: "Vàng",
  Purple: "Tím",
  Black: "Đen",
};

// ---- Luật chiến thắng "Đầu cầu" bản 2 (xem docs/rules_v2_dau_cau.md)
export const PRESTIGE_WIN = 500;        // Uy thế cần để thắng (V2: 500)
export const TIME_LIMIT = 20 * 60;      // giây game; hết giờ thì so Uy thế
export const SURRENDER_FRAC = 0.15;     // còn dưới 15% quân chiến đấu → đầu hàng

// ---- Uy thế V2
export const RIVER_PRESTIGE_RATE = 0;     // chiếm cầu KHÔNG cộng Uy thế nữa
export const FLAG_BRIDGEHEAD_RATE = 1;    // cờ địch đang cắm & còn đầu cầu: +1/giây
export const FLAG_ISOLATE_T = 30;         // cờ bị cô lập (mất đầu cầu) tự trả về sau 30 giây
export const REAR_DMG_NO_BRIDGE = 0.25;   // không giữ Cầu giữa: công trình/Thành địch chỉ nhận 25% sát thương
export const CAP_RIVER_R = 8;           // bán kính cứ điểm sông (ô)
export const CAP_FLAG_R = 6;            // bán kính cờ cao nguyên (ô, chỉ tính quân trên đỉnh)
export const CAP_NEUTRAL_T = 10;        // giây chiếm cứ điểm trung lập
export const CAP_ENEMY_T = 20;          // giây chiếm cứ điểm đang thuộc địch
export const ELITE_CAP_MULT = 1.5;      // phe ít quân hơn chiếm nhanh hơn
export const FLAG_VISION_R = 20;        // tầm nhìn cố định của cờ nhà
export const SCOUT_BLIND_T = 5;         // Trinh sát đứng trên đỉnh địch bao lâu để tắt tầm nhìn cờ
export const SCOUT_BLIND_DUR = 60;
export const FOREST_REST_T = 8;         // giây không giao chiến để hồi máu trong rừng
export const FOREST_REGEN = 0.01;       // % HP tối đa mỗi giây
export const AMBUSH_MULT = 1.5;
export const LEASH_R = 8;               // tư thế Phòng thủ: đuổi tối đa 8 ô quanh điểm neo
export const DISORDER_CHASE_T = 6;      // đuổi liên tục quá 6 giây → Rối loạn
export const DISORDER_DIST = 12;        // hoặc cách neo quá 12 ô
export const DISORDER_CLEAR_T = 4;      // đứng yên 4 giây thì hết Rối loạn
export const DISORDER_MULT = 1.25;      // nhận thêm sát thương khi Rối loạn
export const REAR_MULT = 1.5;           // đánh vào lưng quân đang rút
export const REAR_MULT_LANCER = 2;
export const ROUT_KILLS_PER_PRESTIGE = 20;
export const RALLY_MIN_RETREAT = 3;     // phải rút ít nhất 3 giây mới được thưởng Quay đầu
export const RALLY_DUR = 5;
export const RALLY_MULT = 1.3;
export const TOWER_RANGE = 8;
export const TOWER_DMG = 12;
export const TOWER_CD = 1.5;
export const BUILDING_PRESTIGE: Record<string, number> = {
  Monastery: 40, Archery: 40, Barracks: 40, Tower: 25, House1: 10, House2: 10, House3: 10,
};

export const STANCE_DEFEND = 0;
export const STANCE_PURSUE = 1;

// ---- Cân bằng chống "dồn cục" (docs/game_mechanics.md mục 6)
export const MELEE_CAP = 3;             // tối đa số lính cận chiến cùng đánh một mục tiêu
export const CROWD_CELL = 4;            // ô lưới Chen chúc: 4×4 ô bản đồ
export const CROWD_LIMIT = 60;          // quá số lính cùng phe trong một ô → Chen chúc
export const CROWD_SPEED = 0.7;
export const CROWD_MELEE = 0.8;
export const CROWD_ARROW_TAKEN = 1.3;
export const VOLLEY_MIN = 6;            // Mưa tên: ô có quá số lính địch này thì tên trúng thêm 1 lính
export const VOLLEY_SPLASH = 0.5;
export const CHARGE_MULT = 1.5;         // Thương kỵ xung phong vào khối Chen chúc
export const FORD_TAKEN = 1.25;         // đang lội bãi cạn nhận thêm sát thương
export const BIG_ARMY = 600;            // cụm lớn hơn thế này trong vùng 16×16 ô lộ "bụi mù"
export const BIG_ARMY_CELL = 16;

// ---- Bố trí đội hình (Deployment)
export const DEPLOYMENT_BOUNDS = {
  WEST: { xMin: 50, xMax: 98, yMin: 160, yMax: 352 },
  EAST: { xMin: 414, xMax: 462, yMin: 160, yMax: 352 },
};
// Khoảng cách tối đa (pixel) giữa các khối quân để tự động gom chung thành 1 đạo quân
export const ARMY_GROUP_LINK_DISTANCE = 512; // 8 ô bản đồ

// ---- Cờ nhà (V2 mục 4): lợi thế phòng thủ
export const FLAG_HOME_HEAL_R = 12;       // bán kính hồi máu quanh cờ nhà (ô)
export const FLAG_HOME_HEAL_RATE = 0.02;  // 2% HP tối đa mỗi giây
export const FLAG_HOME_REST_T = 5;        // không giao chiến 5 giây mới hồi
export const FLAG_HOME_ARCHER_RANGE = 1;  // cung thủ trên đỉnh cờ nhà +1 ô tầm bắn

// ---- Kho lương (V2 mục 5)
export const DEPOT_SCHEDULE = [5 * 60, 9 * 60, 13 * 60, 17 * 60]; // phút 5, 9, 13, 17 (giây game)
export const DEPOT_WARN_T = 60;           // báo trước 60 giây
export const DEPOT_VALUE = 60;            // +60 Uy thế khi lấy được
export const DEPOT_CAP_T = 15;            // giữ 15 giây để lấy
export const DEPOT_CAP_R = 6;             // bán kính chiếm (ô)
export const DEPOT_EXPIRE_T = 120;        // kho tồn tại 2 phút rồi biến mất

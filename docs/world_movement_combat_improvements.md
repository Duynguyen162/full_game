# Kế hoạch cải thiện: Di chuyển, Đội hình, Giao tranh & Hiệu năng

Tài liệu mô tả **các thay đổi cụ thể** (file, hàm, thuật toán, hằng số, tiêu chí nghiệm thu) để giảm lôn xộn, sửa bug di chuyển và giảm giật/lag. Bám kiến trúc hiện tại: SoA, Flow Field, spatial grid trong `shared/src/world.ts`.

**Phạm vi không đổi (trừ khi ghi rõ):** quy mô ~40k slot, không A* từng lính, sim ~10 Hz (`TICK = 0.1`), vision/objectives ~3 Hz.

---

## Tóm tắt ưu tiên

| Phase | Mục tiêu | Effort ước lượng | Rủi ro gameplay |
|-------|---------|------------------|-----------------|
| **P1** | Hết moonwalk, kẹt formation, jitter vô hướng | 2–4 ngày | Thấp |
| **P2** | Mặt trận rõ, hàng sau tham chiến, ít xoay vòng | 3–5 ngày | Trung bình |
| **P3** | CPU/GC, LOD sim, render mượt hơn | 3–7 ngày | Thấp (chủ yếu kỹ thuật) |

Thứ tự triển khai: **P1 → P2 → P3**. Mỗi phase có thể ship độc lập nếu test pass.

---

## P1 — Formation & vật lý di chuyển local

### P1.1 Snap slot đội hình vào ô đi được

**Vấn đề:** `orderMove` gán `formTargetX/Y + formDX/DY` theo hình học; slot có thể nằm sông/vách. Khi `distToSlot < 150` và `clearLine`, lính steer thẳng vào slot unwalkable → moonwalk vĩnh viễn.

**File:** `shared/src/world.ts`, `shared/src/flowfield.ts` (tái dùng `nearestPassable`, có thể thêm helper).

**Thay đổi:**

1. Thêm helper (đặt trong `flowfield.ts` hoặc private trên `World`):

   ```ts
   // Tìm pixel center gần (px, py) nhất trên ô passable (có thể cùng level / canStep từ tile hiện tại nếu truyền tile nguồn).
   export function snapFormationSlot(m: GameMap, px: number, py: number, fromTile?: number): { px: number; py: number; tile: number } | null
   ```

   - Bước 1: `tile = tileAt(px, py)`; nếu `passable(m, tile)` và (optional) `fromTile` undefined hoặc `canStep` hợp lý → trả `{ px, py, tile }` (clamp pixel vào center ô ± jitter nhỏ cố định theo unit id nếu cần tránh trùng).
   - Bước 2: spiral từ `nearestPassable(m, tx, ty)` trong bán kính `R_FORM_SNAP` (đề xuất **12–20 ô**), chọn ô đầu tiên passable; pixel = `(tx+0.5)*T, (ty+0.5)*T`.

2. Trong `orderMove`, sau khi tính `formDX/DY` cho từng lính `i`:

   - `gx = dstX + formDX[i]`, `gy = dstY + formDY[i]`
   - Gọi `snapFormationSlot(m, gx, gy, this.tile[i])`
   - Nếu null → fallback center đạo (`dstX`, `dstY`) đã snap
   - Cập nhật lại offset tương đối:  
     `formDX[i] = snapped.px - formTargetX[i]`, `formDY[i] = snapped.py - formTargetY[i]`
   - (Tuỳ chọn) lưu `formTile[i]` = `Int32Array(CAP)` để debug / kiểm tra arrive

3. **Hằng số mới** (`shared/src/constants.ts`):

   ```ts
   export const FORM_SNAP_R = 16;        // ô tìm slot thay thế
   export const FORM_DIRECT_STEER = 150; // px — thay magic number trong updateUnit
   export const FORM_ARRIVE_DIST = 10;   // px — giữ hoặc tăng nhẹ lên 14
   ```

**Tiêu chí nghiệm thu:**

- Lệnh di chuyển tới bờ sông/vách: ≥95% lính chuyển `S_IDLE` trong ≤ `FORM_STUCK_ARRIVE` (xem P1.3), không moonwalk >3s.
- Slot snap không đặt lính lên ramp không cùng level với đạo (nếu `canStep` từ tile trung bình đạo fail → bỏ qua ô đó trong spiral).

---

### P1.2 Direct-steer có điều kiện

**Vấn đề:** Steer thẳng slot khi `clearLine` true nhưng đích vẫn blocked (line sample thưa, 24px bước).

**File:** `shared/src/world.ts` — nhánh formation trong `updateUnit`.

**Thay đổi:**

Thay điều kiện:

```ts
(d === DIR_GOAL || distToSlot < FORM_DIRECT_STEER) && this.clearLine(i, gx, gy)
```

Thành **tất cả**:

- `distToSlot < FORM_DIRECT_STEER`
- `passable(m, tileAt(gx, gy))`
- `this.clearLine(i, gx, gy)`
- `d === DIR_GOAL || f.cost[cur] < Infinity` (vẫn trong vùng field hợp lệ)

Nếu fail → **không** random jitter; rơi xuống nhánh follow flow (P1.3).

**Tiêu chí:** Không còn trạng thái `S_MOVE` với `distToSlot` giảm <2px trong 2s liên tiếp khi đích unwalkable.

---

### P1.3 Thay jitter ngẫu nhiên bằng fallback 8 hướng

**Vấn đề:** `(rnd()-0.5)*6` gây lắc, phá hàng, khó reproduce bug.

**File:** `shared/src/world.ts`.

**Thay đổi:**

1. Thêm private method:

   ```ts
   private tryMoveFlowFallback(i: number, f: FlowField, sp: number): boolean
   ```

   - Thứ tự thử: hướng `f.dir[cur]` trước, sau đó 7 hướng còn lại xoay từ `(i + tick) & 7` (đồng bộ với `flowfield.ts` tie-break).
   - Mỗi hướng: vector tới center ô láng giềng × `sp`, gọi `tryMove`.
   - Trả về true nếu bất kỳ hướng nào thành công.

2. Thay mọi chỗ formation:

   ```ts
   if (!this.tryMove(i, vx * sp, vy * sp)) this.tryMove(i, (this.rnd() - 0.5) * 6, ...);
   ```

   bằng `tryMove` chính → `tryMoveFlowFallback`.

3. **Chase combat** (đuổi mục tiêu): khi `tryMove` fail, thử 4 hướng trục (±x, ±y) scaled `sp*0.7` trước khi tăng `stuck` (không random).

**Hằng số:**

```ts
export const FORM_STUCK_ARRIVE = 1.3;  // giữ — seconds stuck → arrive()
export const CHASE_STUCK_DROP = 0.6;   // giữ — có thể tăng 0.9 nếu bridge kẹt
```

**Tiêu chí:** Replay cùng seed: quỹ đạo lính ổn định hơn (visual); số lần đổi hướng ngẫu nhiên = 0 trong log test.

---

### P1.4 Quy tắc `arrive()` và kẹt

**Vấn đề:** `distToSlot < 10` có thể arrive sớm khi cả đạo chưa vào; hoặc ngược lại không arrive khi slot unreachable.

**File:** `shared/src/world.ts` — `arrive`, nhánh formation.

**Thay đổi:**

1. **`arrive(i)`** giữ clear field + anchor; thêm reset `formDX/DY = 0` (tuỳ chọn — nếu muốn giữ hàng thì không reset).

2. Điều kiện arrive **một trong**:

   - `distToSlot <= FORM_ARRIVE_DIST` **và** `passable` tại tile slot
   - `d === DIR_NONE` **và** `distToSlot <= FORM_DIRECT_STEER * 0.5` (đã tới vùng đích field nhưng không có hướng — thường do kẹt địa hình)
   - `stuck[i] >= FORM_STUCK_ARRIVE` (fail-safe hiện có)

3. **Không** gọi `arrive` chỉ vì `d === DIR_GOAL` nếu `distToSlot` vẫn lớn (tránh dừng giữa đường trên ô goal area).

**Tiêu chí:** Sau lệnh march 500m, centroid đạo lệch ≤2 ô so với bản build hiện tại hoặc tốt hơn; không unit `field>=0` + `S_MOVE` >30s.

---

### P1.5 (Tuỳ chọn nhỏ) `orderCharge` spread nhẹ

**File:** `shared/src/world.ts` — `orderCharge`.

**Thay đổi:** Giống một hàng `orderMove`: sort unit theo across-axis, gán `formDX/DY` spacing 32px, snap passable (P1.1). Một field, nhiều slot — không thêm flow field.

**Tiêu chí:** Xung phong thành không phải một pixel; FPS không đổi.

---

## P2 — Giao tranh có tổ chức & hỗ trợ đồng đội

### P2.1 Contact broadcast (không phụ thuộc sát thương)

**Vấn đề:** `groupTarget[armyGroupId]` chỉ set trong `damage()` → hàng sau đứng im khi tiền đạo giao chiến chưa ai bị hit.

**File:** `shared/src/world.ts`.

**Thay đổi:**

1. Thêm mảng SoA (size = max group id + 1, hoặc map sparse — hiện `groupTarget` index bằng `armyGroupId`):

   ```ts
   groupContactUntil = new Float32Array(MAX_ARMY_GROUPS); // hoặc CAP nếu id < CAP
   ```

2. Helper:

   ```ts
   private signalGroupContact(gId: number, enemyId: number, duration = GROUP_CONTACT_T): void
   ```

   Set `groupTarget[gId] = enemyId`, `groupContactUntil[gId] = this.time + duration`.

3. Gọi `signalGroupContact` khi:

   - `findEnemy` trả về `e >= 0` và lính **sẽ** engage (melee/archer trong range hoặc chuẩn bị chase)
   - Hoặc vào nhánh attack (`dist <= range`)
   - **Không** gọi khi `MOVE_MARCH`

4. Trong nhánh kế thừa mục tiêu:

   ```ts
   if (tg < 0 && armyGroupId >= 0 && this.time < groupContactUntil[gId]) {
     const gt = groupTarget[gId];
     // validate alive + targetable
   }
   ```

**Hằng số:**

```ts
export const GROUP_CONTACT_T = 2.5;  // giây duy trì “đang giao tranh”
export const MAX_ARMY_GROUPS = 4096; // upper bound id từ spawn BFS
```

**Tiêu chí:** Scenario “100 vs 100, hàng 3 ô”: ≥70% lính hàng 2+ có `target >= 0` trong 1.5s sau contact hàng 1 (không cần damage).

---

### P2.2 Aggro depth khi báo động / contact

**File:** `shared/src/world.ts` — `updateUnit` retarget block.

**Thay đổi:**

Khi tính `range` cho `findEnemy`:

```ts
let range = st.aggro;
if (this.time < this.alertUntil[s]) range += 8;
if (this.armyGroupId[i] >= 0 && this.time < this.groupContactUntil[this.armyGroupId[i]]) {
  range += GROUP_AGGRO_BONUS; // đề xuất 4–6 ô
}
if (this.hold[i] && t !== ARCHER) range = Math.max(range, HOLD_AGGRO_MIN); // đề xuất 4 thay vì 2
```

**Hằng số:**

```ts
export const GROUP_AGGRO_BONUS = 5;
export const HOLD_AGGRO_MIN = 4;
```

**Tiêu chí:** Hold line vẫn không đuổi xa (leash giữ nguyên); hàng sau bắt địch trong contact.

---

### P2.3 Combat ring slots quanh mục tiêu (bổ sung MELEE_CAP)

**Vấn đề:** Lính vượt cap **đứng idle** `separate` → cục loạn; nhiều lính cùng tile.

**File:** `shared/src/world.ts`, `constants.ts`.

**Thiết kế:**

- Với mục tiêu `tg`, slot index `s = hash(i, tg) % RING_SLOTS` hoặc assign tĩnh: lính thứ k trong danh sách đuổi cùng `tg` nhận slot k.
- Offset slot trên vòng tròn bán kính `MELEE_RING_R` (px, ~ `range` warrior):

  ```ts
  slotX = x[tg] + cos(2π*s/RING_SLOTS) * MELEE_RING_R
  slotY = y[tg] + sin(2π*s/RING_SLOTS) * MELEE_RING_R
  ```

- Nếu `engaged[tg] >= MELEE_CAP` **và** `dist > range + 14`: di chuyển tới **slot** thay vì `S_IDLE`.
- Snap slot passable (P1.1 lite, bán kính nhỏ 3 ô).

**Hằng số:**

```ts
export const RING_SLOTS = 8;
export const MELEE_RING_R = 36; // px, tune theo STATS[WARRIOR].range
```

**Tiêu chí:** Quanh 1 target, số lính cận chiến active ≈ min(cap, ring filled); hình ảnh vòng thay vì chồng chất.

---

### P2.4 `groupTarget` đa mục tiêu (tuỳ chọn phase 2b)

**Vấn đề:** Một `attackerId` chết → cả đạo mất focus.

**Thay đổi:**

- `groupTarget[gId]` → 3 slot: `groupTargets[gId*3+0..2]` + timestamp
- Cập nhật 3 Hz trong `updateGroupTargets()` (gọi cùng block vision): centroid đạo, lấy 3 enemy gần nhất targetable
- Lính rảnh chọn target đầu tiên còn alive; retarget khi chết

**Effort cao hơn** — có thể defer sau P2.1–P2.3.

---

### P2.5 Đồng bộ `engaged` trong tick

**Vấn đề:** Đếm `engaged` đầu tick + `++` khi acquire → vượt cap trong cùng tick.

**Thay đổi:**

- **Cách A (đơn giản):** Khi acquire, chỉ `++` nếu `engaged[e] < MELEE_CAP`; nếu không, không set `tg` (hoặc chuyển ring slot P2.3).
- **Cách B:** Pass 2 — pass 1 chỉ quyết định target, pass 2 mới move (phá vỡ 1 pass hiện tại — không khuyến nghị trừ khi cần deterministic tuyệt đối).

**Khuyến nghị:** Cách A.

---

### P2.6 Retarget tick

**Thay đổi:**

```ts
const retarget = (i + this.tick) % (this.time < this.alertUntil[s] ? 4 : 10) === 0;
```

Archer khi alert: mỗi 4 tick (~0.4s); bình thường 10 tick (~1s). Monk/wounded giữ logic riêng.

---

## P3 — Hiệu năng sim & render

### P3.1 Pool buffer 3 Hz (giảm GC)

**Vấn đề:** Mỗi ~333ms: `new Uint8Array(N)` trong `updateVision`, `new Uint16Array` trong `updateEncirclement`, `updateCrowding`.

**File:** `shared/src/world.ts`.

**Thay đổi:**

Trên class `World`:

```ts
private _visBestR = new Uint8Array(N);
private _encCnt0 = new Uint16Array(GN);
// ... tương tự encGrid, crowd big grids
```

Mỗi frame: `.fill(0)` thay vì `new`. Kích thước `GN` tính một lần trong constructor.

**Tiêu chí:** Chrome Performance — giảm GC spike khi 20k unit; CPU vision ±5%.

---

### P3.2 Giảm chi phí `findEnemy`

**Thay đổi:**

1. Không retarget nếu `tg >= 0` và target còn valid và (melee) `clearLine` — trừ archer periodic.
2. `MOVE_MARCH` / `field[i] >= 0` march: **skip** `findEnemy` hoàn toàn (đã gần đúng — verify).
3. Hold + không alert: cap radius scan `min(range, HOLD_AGGRO_MIN)`.

---

### P3.3 LOD cập nhật unit (tuỳ chọn)

**Điều kiện “sleep”** (vẫn rebuild grid mỗi tick — bắt buộc):

- `field[i] < 0`, `target[i] < 0`, không hold combat, không trong depot/objective radius
- Cập nhật full mỗi tick thứ 3: `(i + tick) % 3 === 0`
- Khi có `alertUntil` side hoặc `groupContactUntil` gần — luôn full rate

**File:** `world.ts` `step` loop hoặc đầu `updateUnit`.

**Rủi ro:** Determinism multiplayer — nếu server authoritative, LOD phải **deterministic** (chỉ phụ thuộc `i, tick`, không camera).

**Client-only LOD không áp dụng** cho `shared/world.ts` nếu server dùng cùng file.

---

### P3.4 Render: interpolation vị trí

**File:** `game/lib/game/renderer.ts`, `BattleMap.tsx`.

**Thay đổi:**

- Lưu `prevX/prevY` snapshot trước mỗi `w.step` (copy mảng hoặc double buffer trên World export read-only).
- Vẽ sprite tại `lerp(prev, curr, acc/TICK)`.

**Tiêu chí:** Camera pan ở 60fps mượt hơn khi sim 10Hz; không đổi logic sim.

---

### P3.5 Render LOD

- Zoom xa: chỉ `drawUnitDots` (đã có).
- Zoom gần: giới hạn sprite draw count viewport + ưu tiên selected / type officer (nếu có).

---

## Bảng hằng số đề xuất (tổng hợp)

| Hằng số | Giá trị đề xuất | File |
|---------|-----------------|------|
| `FORM_SNAP_R` | 16 | constants.ts |
| `FORM_DIRECT_STEER` | 150 | constants.ts |
| `FORM_ARRIVE_DIST` | 12 | constants.ts |
| `FORM_STUCK_ARRIVE` | 1.3 | constants.ts |
| `GROUP_CONTACT_T` | 2.5 | constants.ts |
| `GROUP_AGGRO_BONUS` | 5 | constants.ts |
| `HOLD_AGGRO_MIN` | 4 | constants.ts |
| `RING_SLOTS` | 8 | constants.ts |
| `MELEE_RING_R` | 36 | constants.ts |
| `SEP` | 24 → 28 combat-only (tuỳ chọn) | constants.ts / separate() |

Giữ nguyên trừ khi playtest: `MELEE_CAP=3`, `CROWD_*`, `LEASH_R`.

---

## File & hàm chạm tới (checklist dev)

| File | Hàm / vùng |
|------|------------|
| `shared/src/constants.ts` | Hằng số P1–P2 |
| `shared/src/flowfield.ts` | `snapFormationSlot` (hoặc export từ đây) |
| `shared/src/world.ts` | `orderMove`, `orderCharge`, `updateUnit` (formation + chase), `separate`, `arrive`, `damage` / retarget, `signalGroupContact` |
| `shared/src/world.ts` | `updateVision`, `updateEncirclement`, `updateCrowding` (pool P3) |
| `game/components/BattleMap.tsx` | Snapshot cho lerp (P3.4) |
| `game/lib/game/renderer.ts` | Lerp draw (P3.4) |

**Không bắt buộc phase 1:** `ai.ts`, `Deployment.tsx`, `objectives.ts`.

---

## Kịch bản test thủ công

1. **Moonwalk:** Chọn 200 warrior, right-click đích sát vách sông vuông góc — quan sát 10s, không unit RUN vô hạn sát vách.
2. **Cầu hẹp:** 500 lính march qua 1 ford — không deadlock; thời gian qua cầu < 2× baseline hoặc crowd speed hợp lý.
3. **Contact hàng sau:** 50 vs 50, hold front — hàng 2 tham chiến trong 2s (P2).
4. **MELEE ring:** Zoom 1 target, đếm sprite attack đồng thời ≤ MELEE_CAP + tolerance.
5. **Perf:** 20k vs 20k, speed 3x, 60s — FPS không sụt >15% sau P3.1; Memory stable (không tăng liên tục).

---

## Kịch bản test tự động (đề xuất thêm sau)

- Unit test `snapFormationSlot` trên map fixture (water tile, cliff).
- Deterministic replay: cùng seed + lệnh `orderMove` → hash `(x,y,tile)` sau 100 tick P1.

---

## Ghi chú tương thích & rủi ro

- **Multiplayer / server:** `server/src/index.ts` dùng cùng `World` — mọi thay đổi P1–P2 phải deterministic (không dùng `rnd()` trong snap slot; jitter đã bỏ).
- **`groupTarget` index:** Hiện index bằng `armyGroupId`; đảm bảo `MAX_ARMY_GROUPS` > max id thực tế hoặc resize mảng khi spawn.
- **`updatePawn`:** Không được gọi — scout chạy `updateUnit`. Phase riêng: gọi `updatePawn` khi task nông dân, hoặc xóa dead code (ngoài phạm vi doc này).
- **Tài liệu liên quan:** `docs/tech_review_combat_formation.md` (phân tích bug hiện tại).

---

## Lộ trình commit gợi ý

1. `feat(formation): snap passable slots + steer guards` (P1.1–P1.2)
2. `feat(move): flow 8-dir fallback, arrive rules` (P1.3–P1.4)
3. `feat(combat): group contact + aggro depth` (P2.1–P2.2)
4. `feat(combat): melee ring slots + engaged cap fix` (P2.3, P2.5)
5. `perf(world): pool vision/crowd buffers` (P3.1)
6. `perf(render): sim interpolation` (P3.4)

Mỗi commit kèm 1 dòng trong CHANGELOG hoặc PR test plan tick các scenario trên.

---

*Tài liệu tạo để triển khai cải thiện `shared/src/world.ts`. Cập nhật version khi merge từng phase.*

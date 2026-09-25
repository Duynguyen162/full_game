# Cơ chế tấn công tự động của lính

> **Cập nhật:** đã áp dụng các ý từ `docs/thuat_toan_aoe.md` — lọc mục tiêu theo dây xích, ưu tiên mục tiêu,
> dò lại ngay khi mất mục tiêu, vùng đệm ở mép tầm đánh, sát thương đúng lúc vung vũ khí. Xem mục 8.

Tài liệu mô tả code **hiện tại** trong `shared/src/world.ts` (số dòng tính tại thời điểm viết, có thể lệch vài dòng khi code thay đổi).
Toàn bộ logic nằm trong `World.updateUnit(i, dt)`, được gọi cho **từng lính, mỗi tick** (mặc định 0,1 giây/tick).

---

## 1. Tổng quan: một tick của một lính

`updateUnit` chạy lần lượt các bước sau. Bước nào `return` thì các bước sau **không chạy** trong tick đó.

```
updateUnit(i)
 ├─ 0. Hành quân?   moveMode = MOVE_MARCH → xoá mục tiêu, bỏ qua địch
 ├─ 1. Quay về neo? returning = 1 → đi về anchor ─────────────── return
 ├─ 2. Kiểm tra / tìm mục tiêu (tg = lính địch, bt = công trình/cầu)
 │     • 8 tick/lần: findEnemy trong bán kính aggro
 │     • không có → thừa hưởng mục tiêu chung của nhánh (groupTarget)
 ├─ 3. Có mục tiêu → ENGAGE
 │     ├─ trong tầm đánh → đánh ──────────────────────────────── return
 │     ├─ Phòng thủ & đã xa neo > LEASH_R → returning = 1 ───── return
 │     ├─ mục tiêu đã đủ MELEE_CAP người vây → đổi mục tiêu / đứng chờ ── return
 │     └─ đuổi thẳng tới mục tiêu (tryMove) ────────────────── return
 ├─ 4. Có lệnh di chuyển (field ≥ 0) → đi theo đường / vào ô đội hình ── return
 ├─ 5. Thợ bắc cầu → tới mũi cầu ──────────────────────────── return
 └─ 6. Đứng yên (idle): từ từ về lại điểm neo nếu bị đẩy lệch
```

Các thông số liên quan (dòng 46–50 và `constants.ts`):

| Binh chủng | Tầm đánh `range` | Tầm phát hiện `aggro` (ô) | Tốc độ |
|---|---|---|---|
| Kiếm sĩ | 40 px | 5 | 62 |
| Cung thủ | 6 ô | 7 | 58 |
| Thương kỵ | 54 px | 6 | 88 |
| Tu sĩ (hồi máu) | 4 ô | 5 | 56 |
| Trinh sát | 36 px | 12 | 95 |

| Hằng số | Giá trị | Ý nghĩa |
|---|---|---|
| `LEASH_R` | 8 ô | Tư thế Phòng thủ: đuổi tối đa 8 ô quanh điểm neo |
| `MELEE_CAP` | 3 | Tối đa 3 lính cận chiến cùng vây một mục tiêu |
| `ENGAGE_R` | 160 px | Chỉ lính cận chiến trong bán kính này mới được đếm là "đang vây" |
| Báo động | +8 ô aggro | Phe vừa có giao chiến (3 giây gần nhất) → tầm phát hiện +8 ô |

---

## 2. Điểm neo (anchor) và tư thế

- **Điểm neo** là "chỗ đứng" của lính: gán khi tới ô đội hình (`arrive`), khi Giữ vị trí, khi Quay đầu.
- **Tư thế mặc định là Phòng thủ** (`STANCE_DEFEND = 0`): đuổi địch tối đa `LEASH_R = 8` ô tính từ điểm neo, quá thì quay về.
- **Truy kích** (`STANCE_PURSUE`, phím T): đuổi tới cùng, không giới hạn.
- **Giữ vị trí** (H): chỉ tìm địch trong 2 ô, không đuổi.

---

## 3. Tìm mục tiêu

### 3.1 Tìm địch gần nhất — `findEnemy` (dòng ~1506)

Quét vòng vuông từ ô của lính ra ngoài tới bán kính `radius`, bỏ qua địch đã đủ `cap` người vây (`engaged[j] >= cap`) và địch đang ẩn trong rừng mà phe mình chưa có mặt (`targetable`).

```ts
private findEnemy(i: number, radius: number, cap = 255): number {
  ...
  for (let r = 0; r <= radius; r++) {                 // vòng r = 0, 1, 2, … ô
    for (/* các ô trên viền vòng r */) {
      for (let j = this.head[ô]; j >= 0; j = this.next[j]) {
        if (this.side[j] === s || !this.alive[j] || this.engaged[j] >= cap) continue;
        const d = (this.x[j] - px) ** 2 + (this.y[j] - py) ** 2;
        if (d < bd && this.targetable(s, j)) { bd = d; best = j; }
      }
    }
    if (best >= 0 && bd <= (r * T) ** 2) break;       // đã chắc là gần nhất → dừng
  }
  return best;
}
```

### 3.2 Chọn / giữ mục tiêu (dòng ~1804)

```ts
const retarget = (i + this.tick) % 8 === 0;          // mỗi lính 8 tick (0,8 giây) mới dò lại một lần

let tg = this.target[i];
if (tg >= 0 && (!this.alive[tg] || !this.targetable(s, tg))) tg = -1;   // mục tiêu chết / mất dấu

if (!marching && retarget && (tg < 0 || t === ARCHER)) {                // cung thủ luôn dò lại
  let range = st.aggro;
  if (this.time < this.alertUntil[s]) range += 8;                       // ⚠ BÁO ĐỘNG: +8 ô
  if (t === ARCHER && this.m.level[this.tile[i]] > 0) range += 2;       // cung thủ trên cao
  const e = this.findEnemy(i, this.hold[i] && t !== ARCHER ? 2 : range,
                           t === ARCHER ? 255 : MELEE_CAP);             // cận chiến: bỏ địch đã đủ người
  if (e >= 0 && (t === ARCHER || this.clearLine(i, this.x[e], this.y[e]))) {  // cận chiến cần đường thẳng
    tg = e;
    this.alertUntil[s] = this.time + 3;                                 // báo động cả phe 3 giây
    this.groupTarget[this.armyGroupId[i]] = e;                          // báo cho cả nhánh
  }
}
```

`alertUntil[s]` được đặt lại mỗi khi **bất kỳ lính nào của phe** tìm được mục tiêu hoặc bị đánh (`damage`, dòng ~1700). Giữa trận, cờ báo động gần như **luôn bật**, nên tầm phát hiện thực tế của kiếm sĩ là **5 + 8 = 13 ô**.

### 3.3 Thừa hưởng mục tiêu của nhánh (dòng ~1830)

Lính rảnh (chưa có mục tiêu) lấy mục tiêu chung của nhánh, **nếu mục tiêu đó còn chỗ vây**; nếu đầy thì tự tìm địch khác trong `aggro + 6` ô.

```ts
if (!marching && tg < 0 && this.armyGroupId[i] !== -1 && t !== MONK && retarget) {
  const gt = this.groupTarget[this.armyGroupId[i]];
  const melee = t !== ARCHER;
  if (gt >= 0 && this.alive[gt] && this.targetable(s, gt) && (!melee || this.engaged[gt] < MELEE_CAP)) {
    tg = gt;
  } else if (gt >= 0 && melee) {
    const e = this.findEnemy(i, st.aggro + 6, MELEE_CAP);
    if (e >= 0 && this.clearLine(i, this.x[e], this.y[e])) tg = e;
  }
}
```

`groupTarget` cũng được ghi khi một lính trong nhánh **bị đánh** (kẻ đánh trở thành mục tiêu chung, dòng ~1696). Vì vậy một nhánh có thể bị "hút" về phía một kẻ bắn tên từ xa.

### 3.4 Đếm số người đang vây — `engaged` (đầu `step()`, dòng ~1012)

Tính lại mỗi tick. Chỉ đếm lính cận chiến có mục tiêu là `tg` **và** đang ở trong 160 px quanh `tg`:

```ts
const ER2 = ENGAGE_R * ENGAGE_R;
for (let i = 0; i < this.n; i++) {
  const tg = this.target[i];
  if (tg < 0 || !this.alive[i] || this.type[i] === ARCHER || this.type[i] === MONK) continue;
  const dx = this.x[tg] - this.x[i], dy = this.y[tg] - this.y[i];
  if (dx * dx + dy * dy <= ER2) this.engaged[tg]++;
}
```

---

## 4. Giao chiến — ENGAGE (dòng ~1853)

### 4.1 Trong tầm → đánh

```ts
if (dist <= range + (t === ARCHER || t === MONK ? 0 : 14)) {   // cận chiến được +14 px dung sai
  this.state[i] = S_ATTACK;
  if (this.cd[i] <= 0) { this.cd[i] = st.cd * (0.85 + rnd * 0.3); this.attack(i, tg, bt, ...); }
  this.separate(i);
  return;
}
```

### 4.2 Dây xích Phòng thủ (dòng ~1887)

```ts
if (!this.hold[i] && this.field[i] < 0 && this.stance[i] === STANCE_DEFEND &&
    Math.hypot(this.x[i] - this.anchorX[i], this.y[i] - this.anchorY[i]) > LEASH_R * T) {
  this.target[i] = -1;
  this.returning[i] = 1;          // → bước 1 ở các tick sau: đi thẳng về anchor
  return;
}
```

Lưu ý: điều kiện xét **vị trí của chính lính** so với neo, không xét vị trí của mục tiêu.

### 4.3 Mục tiêu đã đủ người vây (dòng ~1900)

```ts
const others = this.engaged[tg] - (dist <= ENGAGE_R ? 1 : 0);    // không tự đếm mình
if (isMelee && dist > range + 14 && others >= MELEE_CAP) {
  const alt = retarget ? this.findEnemy(i, st.aggro + 4, MELEE_CAP) : -1;
  if (alt >= 0 && alt !== tg && this.clearLine(...)) { this.target[i] = alt; }   // đổi sang địch còn chỗ
  else { this.state[i] = S_IDLE; this.separate(i); return; }                    // đứng chờ phía sau
}
```

### 4.4 Đuổi

```ts
const sp = (st.speed * this.moveMul(i) * tileSpeed(...) * dt) / dist;
if (this.tryMove(i, dx * sp, dy * sp)) { this.state[i] = S_MOVE; this.separate(i); return; }
this.stuck[i] += dt;
if (this.stuck[i] > 0.6) { this.target[i] = -1; ... }             // kẹt địa hình 0,6 giây → bỏ mục tiêu
```

Đuổi là **đi thẳng** về phía mục tiêu (không tìm đường). Mỗi bước còn bị `separate` đẩy ra khỏi lính cùng phe đứng sát.

---

## 5. Các trạng thái phụ ảnh hưởng tới đánh

| Trạng thái | Kích hoạt | Tác dụng |
|---|---|---|
| **Hành quân** (chuột phải) | `moveMode = MOVE_MARCH` | Bỏ qua địch tới khi tới nơi. Quay lại đánh nếu bị đánh **từ phía trước**, đã vào khu đội hình, hoặc bị chặn đứng (dòng ~2000) |
| **Rối loạn** | đuổi liên tục > 6 giây, hoặc cách neo > 12 ô | Nhận +25% sát thương; đứng yên 4 giây để hết |
| **Đang bơi** | ô nước sâu | Không có mục tiêu, không đánh |
| **Về lại điểm neo khi đứng yên** | bị đẩy lệch 10–150 px **và** 6 giây không đánh, không có mục tiêu (dòng ~2067) | Đi chậm về neo |

---

## 6. Vì sao lính "chạy loanh quanh một chỗ" dù phía trước còn chỗ trống

### 6.1 Nguyên nhân chính: tầm phát hiện lớn hơn dây xích Phòng thủ

- Giữa trận, cờ báo động luôn bật → kiếm sĩ **thấy** địch tới **13 ô**.
- Tư thế Phòng thủ chỉ cho **đi xa neo tối đa 8 ô**.
- Địch đứng ở khoảng **8–13 ô** tính từ neo → lính lặp vô hạn:

```
   neo ─────── 8 ô (dây xích) ─────── 13 ô (tầm thấy khi báo động)
    │                 │                    │
    ├── thấy địch (≤13 ô) → lao lên ───────►│
    │                 │ quá 8 ô → returning = 1
    ◄──── đi về neo (tới khi còn < 1,5 ô) ──┤
    ├── 8 tick sau: thấy lại địch → lao lên ─►  … lặp mãi
```

Lính không bao giờ tới được địch, cũng không đứng yên, trông như chạy vòng quanh một chỗ.

**Đo bằng mô phỏng**: 100 kiếm sĩ đứng Phòng thủ, 100 kiếm sĩ địch Giữ vị trí cách GAP ô, gần đó có một trận nhỏ để giữ cờ báo động. Chạy 90 giây.

| Khối địch cách | Lính lặp ≥ 3 vòng đuổi/về | Lính·giây **chạy** | Lính·giây **đánh** | Địch còn |
|---|---|---|---|---|
| 6 ô | 82 / 100 | 6.379 | 1.053 | 30 / 100 |
| 10 ô | **100 / 100** | 8.416 | 158 | 90 / 100 |
| 12 ô | 94 / 100 | 8.758 | **4** | 100 / 100 |
| 15 ô (ngoài tầm thấy) | 0 / 100 | 1.838 | 5 | 100 / 100 |

Ở 6 ô vẫn có 82 lính lặp vì khối địch sâu 10 hàng: hàng đầu cách 6 ô nhưng hàng sau cách tới ~12 ô.

### 6.2 Các nguyên nhân phụ

1. **Đuổi thẳng, không tìm đường.** Lính ở hàng sau lao thẳng về mục tiêu, đâm vào lưng hàng đầu của chính mình. `separate` đẩy nó ra hai bên, nên nó trượt dọc hàng quân thay vì vòng qua. Khi địa hình chắn, `stuck > 0,6 s` bỏ mục tiêu, rồi 8 tick sau lại chọn lại đúng mục tiêu đó.
2. **Đứng chờ vì đủ người vây.** Đây là luật có chủ đích (`MELEE_CAP = 3`). Lính hàng sau đứng chờ, và mỗi 0,8 giây dò lại địch còn chỗ nên có thể nhích qua nhích lại.
3. **Mục tiêu chung bị kẻ bắn tên kéo đi.** Nhánh bị cung thủ địch bắn → kẻ bắn thành `groupTarget` → lính rảnh chạy về phía cung thủ ở xa, dễ vấp phải dây xích (mục 6.1).

---

## 7. Hướng sửa đề xuất

**A. Chỉ nhận mục tiêu nằm trong vùng dây xích** (sửa đúng gốc 6.1) — ✅ **đã áp dụng**, xem mục 8. Với lính Phòng thủ đã có neo, bỏ qua địch mà khoảng cách từ **neo** tới địch lớn hơn `LEASH_R`. Đã không nhận thì không lao lên rồi bị kéo về.

```ts
// trong findEnemy (hoặc lọc kết quả): lính Phòng thủ, không có lệnh di chuyển
const leashed = this.stance[i] === STANCE_DEFEND && this.field[i] < 0 && !this.hold[i];
const lr2 = (LEASH_R * T) ** 2;
...
if (leashed && (this.x[j] - this.anchorX[i]) ** 2 + (this.y[j] - this.anchorY[i]) ** 2 > lr2) continue;
```

Áp dụng tương tự cho mục tiêu thừa hưởng từ nhánh (mục 3.3).

**B. Hoặc dời neo theo cả nhánh.** Khi cả nhánh đang thắng thế và tiến lên, cập nhật điểm neo của nhánh về vị trí mới, để mặt trận "trôi" theo trận đánh thay vì bị kéo về chỗ cũ.

**C. Trễ khi quay về.** Lính vừa bị kéo về thì trong vài giây không nhận mục tiêu ở ngoài vùng dây xích, để cắt vòng lặp nếu có trường hợp sót.

**D. Đuổi có tìm đường ngắn.** Khi `clearLine` tới mục tiêu bị chắn (bởi địa hình hoặc hàng quân mình), đi vòng theo hướng ít lính cùng phe hơn thay vì đâm thẳng.

Nên làm **A** trước: sửa gọn, đúng gốc, không đổi luật chơi (Phòng thủ vẫn giữ vị trí trong 8 ô). Sau đó đo lại bằng kịch bản ở mục 6.1.

---

## 8. Đã áp dụng từ `thuat_toan_aoe.md`

| Mục AoE | Thay đổi trong `world.ts` | Kết quả đo |
|---|---|---|
| §3 Phòng thủ + dây xích | `findEnemy(..., leash)` bỏ địch nằm ngoài `LEASH_R` ô quanh **điểm neo** (lính Phòng thủ, không có lệnh di chuyển, không Giữ vị trí). Kẻ đang đánh mình thì luôn được nhận. Mục tiêu chung của nhánh cũng lọc như vậy. Đây là hướng sửa **A** ở mục 7. | Địch cách 10–12 ô: lính lặp đuổi/về **100/100 → 0/100**, chạy vô ích 8.400 → 0 lính·giây. Địch cách 6 ô: 82 → 3 lính lặp |
| §4.2 Ưu tiên mục tiêu | Điểm = khoảng cách − 48 px nếu địch đang đánh mình − 16 px nếu là cung thủ (với lính cận chiến) − tới 24 px theo độ mất máu. Chọn điểm thấp nhất; vẫn dừng quét sớm khi chắc không có ai tốt hơn. | — |
| §2 Searching | Mục tiêu vừa chết / mất dấu → dò lại **ngay tick đó**, không đợi lượt 8 tick (trước đây đứng tới 0,8 giây) | — |
| §7 Rung ở mép tầm | Đang đánh thì được lệch thêm `RANGE_HYST = 10` px mới chuyển sang đuổi | — |
| §5 Khoảnh khắc trúng đòn | Cận chiến: vung → sau `WINDUP` (kiếm sĩ/trinh sát 0,2 s, thương kỵ 0,25 s) mới trừ máu (`resolveHit`). Mục tiêu đã chạy khỏi tầm hoặc kẻ đánh chết trước lúc đó thì đòn trượt. Cung thủ vẫn dùng thời gian bay của tên. | — |

Trận 400 vs 400 cận chiến (lệnh Tấn công): lính kẹt ≥ 5 s cạnh địch còn chỗ 19 → 15; có cả cung thủ 4 → 1.

**Chưa làm** (ảnh hưởng cân bằng lớn, nên bàn trước): cung thủ tự lùi khi bị áp sát (kiting), bảng khắc chế binh chủng, né va chạm kiểu ORCA/RVO, và cho máy chủ động đi lấy Kho lương.

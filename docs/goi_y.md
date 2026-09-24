# Giải pháp thuật toán: Xếp đội hình, Tách khối quân và Giao tranh

Tài liệu này chỉ dựa trên những gì báo cáo kỹ thuật mô tả: kiến trúc SoA, tick logic 3Hz, FlowField theo từng đạo, lưới ô có level và chướng ngại. Các điểm phải giả định được ghi ở mục 6.

## 0. Ý tưởng cốt lõi

Các bug có chung một gốc: **vị trí và mục tiêu được tính bằng hình học hoặc một biến chung, không được kiểm chứng với địa hình và tình trạng của những lính khác**. Hướng sửa gồm bốn phần:

1. **Slot phải hợp lệ trước khi gán.** Dùng chính FlowField làm bộ kiểm tra địa hình.
2. **Mỗi đạo quân là một khối độc lập có vùng chiếm riêng.** Khi chọn nhiều đạo, các khối được đặt cách nhau trước rồi mới sinh slot bên trong từng khối.
3. **Mỗi mục tiêu chỉ nhận một số lượng kẻ tấn công cố định**, chia theo các vị trí đứng riêng quanh nó. Điều này chống chen chúc.
4. **Báo động ở cấp đạo quân là trạng thái có thời hạn**, không phải một mục tiêu duy nhất và không phụ thuộc sát thương.

---

## 1. Xếp đội hình trên địa hình (một đạo quân)

### 1A. Sinh slot dư, lọc bằng FlowField, chọn N slot tốt nhất

Kết hợp cả hai hướng: giữ lưới hình học khi địa hình cho phép, chỗ nào lỗi thì lấy slot dư ở gần nhất để bù. Không cần flood fill riêng cho từng lính.

FlowField của đạo đã BFS từ đích ra toàn bản đồ, nên `dist[cell]` cho biết ô đó có tới được không. Đây là bộ kiểm tra địa hình miễn phí.

```
buildSlots(army, center, forward, N, spacing, zone):     // zone: vùng riêng của khối, xem mục 2
  right = perp(forward)
  cols, rows = kích thước lưới gốc (rows*cols >= N)
  // sinh dư: thêm ~50% hàng về phía sau, thêm 2 cột mỗi bên
  for r in 0 .. rows+extraRows, c in -extraC .. cols+extraC:
      p = center + right*(c - cols/2)*spacing - forward*r*spacing   // hàng 0 ở phía trước
      if !zone.contains(p)             continue   // KHÔNG lấn sang khối khác
      cell = worldToCell(p)
      if !walkable(cell)               continue   // sông, rừng, vách
      d = ff.dist[cell]
      if d == INF                      continue   // không tới được
      if d*cellSize > euclid(p,center)*K + slack  continue  // "bên kia vách": đường vòng quá xa
      if reserved.has(subSlotKey(p))   continue   // slot đã bị đạo khác trong cùng lệnh giữ
      penalty = khoảng cách (tính theo số slot) từ (r,c) tới hình chữ nhật gốc, bằng 0 nếu nằm trong
      candidates.push({p, penalty})
  chọn N slot có penalty nhỏ nhất (sort ổn định), đánh dấu reserved
```

Kết quả:

- Địa hình thoáng: lấy đúng lưới chữ nhật gốc.
- Slot gốc bị sông hoặc vách chặn: chỗ đó được thay bằng slot gần nhất quanh khối, ưu tiên phía sau. Hình dạng được giữ.
- Điều kiện `d*cellSize > euclid*K + slack` loại các slot nằm bên kia vách hoặc sông, nơi đường đi thực tế vòng rất xa. Chỉ dùng `walkable` thì vẫn để lọt những slot này.

### 1B. Gán lính vào slot: sắp xếp theo hình chiếu, chỉ trong cùng đạo

Sắp xếp lính và slot **của cùng một đạo** theo khóa `(hình chiếu lên forward, rồi lên right)` rồi ghép theo thứ hạng. Chi phí O(N log N). Đường đi của lính không cắt nhau nên khi tới nơi ít xô đẩy hơn. Hungarian quá đắt và không cần thiết.

**Quy tắc bắt buộc:** không bao giờ sắp xếp gộp lính của nhiều đạo trong một lần. Lính của đạo A chỉ được gán vào slot của đạo A.

### 1C. Chặn vòng lặp vô tận (moonwalk)

Đổi điều kiện rời FlowField thành **có đường thẳng thông tới slot**, và thêm cơ chế phát hiện kẹt:

```
mỗi logic tick, lính đang ở trạng thái MOVE:
  d = dist(pos, slot)
  if d < ARRIVE_R                          → S_IDLE            // ARRIVE_R ≈ 0.5*spacing
  elif d < 150 and clearLine(pos, slot)    → steer thẳng vào slot
  else                                     → đi theo FlowField
  // fail-safe
  if d < bestDist[i] - 0.5*cellSize: bestDist[i]=d; stuck[i]=0
  else stuck[i]++
  if stuck[i] >= 4 (~1.3s):
      tìm ô trống hợp lệ gần nhất trong bán kính ≤3 ô (BFS cục bộ, có reserved, có zone) → gán slot mới
      nếu không có → S_IDLE tại chỗ
```

`clearLine` là DDA/Bresenham trên lưới, dùng đúng hàm kiểm tra đi được và chuyển level mà FlowField đang dùng. Chỉ chạy khi `d < 150` và ở 3Hz nên rất rẻ. Cơ chế `stuck` là lưới an toàn, đảm bảo lính không đi tại chỗ vô hạn dù còn edge case nào khác.

**Dữ liệu thêm:** `bestDist: Float32Array`, `stuck: Uint8Array`.

---

## 2. Tách khối khi chọn nhiều đạo (MỚI)

### 2.1 Vấn đề

Khi quét chọn 5 đạo rồi ra lệnh di chuyển, các đạo thường đứng sát nhau. Logic hiện tại giữ **cự ly tương đối giữa tâm các đạo**. Nếu tâm hai đạo gần nhau hơn kích thước một khối (100 lính chiếm cỡ 10x10 slot) thì hai lưới đích chồng lên nhau và hòa thành một khối lớn khó tách.

Đây là giả thuyết dựa trên mô tả `orderMove` bước 3 và 4. Kiểm tra nhanh: log khoảng cách giữa các tâm đích và so với kích thước khối. Nếu nhỏ hơn thì đúng nguyên nhân.

Ngoài ra còn hai nguồn gây trộn: (a) bù slot do địa hình (mục 1A) có thể đẩy slot của khối này sang vùng khối kia, (b) nếu có chỗ nào sắp xếp lính gộp nhiều đạo.

### 2.2 Nguyên tắc

1. Mỗi đạo là một **khối** có kích thước hình chữ nhật xác định từ số lính và `spacing`.
2. Trước khi sinh slot, chạy bước **bố trí khối**: đặt tâm các khối sao cho không chồng nhau và cách nhau một khoảng `GAP`, đồng thời giữ thứ tự trái/phải, trước/sau như người chơi đã chọn.
3. Mỗi khối có **vùng riêng (zone)**. Slot của khối chỉ được sinh trong zone của nó. Không khối nào lấn vùng khối khác.

### 2.3 Bước 1: bố trí tâm các khối

Làm việc trong hệ tọa độ `(right, forward)` gốc tại tâm chung `C`.

```
planBlocks(armies, dest, forward):
  right = perp(forward)
  for a in armies:
     (w_a, d_a) = kích thước khối: cols*spacing, rows*spacing      // rộng x sâu
     pos_a = ( dot(centroid_a - C, right), dot(centroid_a - C, forward) )   // vị trí tương đối ban đầu

  // giãn các khối đang chồng nhau
  repeat ITER = 8:
     changed = false
     for each cặp (a,b):
        ox = (w_a + w_b)/2 + GAP - |pos_a.x - pos_b.x|     // độ chồng theo chiều ngang
        oy = (d_a + d_b)/2 + GAP - |pos_a.y - pos_b.y|     // độ chồng theo chiều sâu
        if ox > 0 and oy > 0:                              // chồng cả hai trục thì mới xung đột
            if ox <= 2*oy: đẩy ra theo x, mỗi bên ox/2      // ưu tiên dàn ngang, giữ mặt trận rộng
            else:          đẩy ra theo y, mỗi bên oy/2
            // nếu hai khối trùng tọa độ: chiều đẩy quyết định bằng armyGroupId
            changed = true
     if !changed: break

  căn lại để trung bình pos = 0
  blockCenter_a = dest + right*pos_a.x + forward*pos_a.y
```

Tính chất:

- Nếu người chơi đã chọn các đạo cách xa nhau đủ, giá trị `pos` giữ nguyên. Không thay đổi hành vi hiện tại.
- Nếu các đạo dính sát hoặc trùng tâm, chúng được dàn thành hàng ngang cách nhau `GAP`.
- Thứ tự trái/phải giữ nguyên nên đường đi của các đạo ít cắt nhau khi hành quân.
- Chi phí: 5 khối, 8 vòng, chỉ chạy một lần mỗi lệnh. Không đáng kể.

`GAP` đề xuất: 1,5 đến 2 lần `spacing`. Đủ để nhìn ra ranh giới giữa hai khối.

### 2.4 Bước 2: kiểm tra địa hình cho từng khối

```
for a in armies (khối phía trước xử lý trước):
   score = tỉ lệ slot hợp lệ trong hình chữ nhật khối (walkable + ff.dist hữu hạn + không quá đường vòng)
   if score >= 0.9: giữ nguyên
   else:
      tìm tâm mới trong vòng ring tăng dần (tối đa vài ô) sao cho:
         score >= 0.9  và  không chồng các khối đã đặt (theo GAP)
      chọn tâm gần vị trí gốc nhất
      nếu không tìm được: giảm GAP xuống tối thiểu 1*spacing, thử lại
      nếu vẫn không: xếp khối thành nhiều hàng sâu hơn (thêm rows, bớt cols) thay vì hòa vào khối khác
```

Nguyên tắc ưu tiên khi thiếu chỗ: **dịch cả khối > co GAP > đổi hình khối**. Không bao giờ trộn slot giữa hai khối.

### 2.5 Bước 3: sinh slot trong zone riêng

```
zone_a = hình chữ nhật của khối a, nới thêm margin m
m = min(GAP/2 - epsilon, extraBackRows*spacing)      // chỉ đủ dùng để bù slot, không chạm zone khối bên cạnh
```

`buildSlots` (mục 1A) nhận `zone_a`. Slot dư chỉ được lấy trong zone. Hai zone không bao giờ giao nhau vì `m < GAP/2`. Bảng `reserved` dùng chung cho cả lệnh như cũ, coi như lớp bảo hiểm thứ hai.

### 2.6 Bước 4: gán lính và di chuyển

- Gán lính vào slot **từng đạo một** (mục 1B).
- Mỗi đạo có FlowField riêng trỏ về `blockCenter_a` của chính nó, giữ nguyên như hiện tại.
- Cơ chế `stuck` (1C) khi tìm slot thay thế cũng bị giới hạn trong zone của khối.

Vì vậy khi tới nơi, 5 đạo đứng thành 5 khối 100 lính tách biệt, mỗi khối một `armyGroupId`. Các cơ chế giao tranh ở mục 3 và 4 đều theo `armyGroupId` nên mỗi khối tiếp tục hành động độc lập.

### 2.7 Kiểm tra sau khi bố trí (dùng khi debug)

```
assert: không có hai AABB của zone giao nhau
assert: mỗi slot thuộc đúng một khối (reserved.owner == armyGroupId của lính giữ slot)
assert: mọi lính của đạo a có slotIndex nằm trong zone_a
```

**Dữ liệu thêm:** chỉ là mảng tạm theo số đạo trong một lệnh, không thêm mảng theo lính.

---

## 3. Giao tranh không đè, không chen chúc: vị trí tấn công quanh mục tiêu

Mỗi kẻ địch có K vị trí đứng tấn công (K = 6 đến 8) trên vòng tròn bán kính `r ≈ attackRange` quanh nó. K chọn sao cho hai vị trí kề nhau cách nhau ít nhất một đường kính thân lính. Mỗi vị trí chỉ một lính chiếm. Vì thế không thể có hai lính chồng lên nhau khi cùng đánh một địch.

```
slotOwner: Int32Array (size = N * K), lưu id lính giữ + 1, 0 = trống

isFree(t,k):  o = slotOwner[t*K+k]-1
              return o<0 || !alive[o] || target[o]!=t      // kiểm tra "lười": tự lành, không rò rỉ khi lính chết

claimSlot(s, t):
  k0 = round(atan2(pos[s]-pos[t]) / (2π/K))               // ưu tiên phía lính đang đứng
  for d in 0..K/2: for k in {k0+d, k0-d}:
      p = pos[t] + dir(k)*r
      if isFree(t,k) and walkable(cell(p)):               // né sông/vách
          slotOwner[t*K+k] = s+1; return k
  return -1
```

**Chọn mục tiêu:** lấy các kẻ địch trong bán kính quét từ spatial hash, chọn kẻ **gần nhất mà còn slot trống**.

- Lính tự dàn ra dọc mặt trận thay vì cùng đổ vào một kẻ địch.
- Lính không có slot thì đứng nguyên và quét lại mỗi tick. Khi lính tiền tuyến chết, slot mở ra. Hiệu ứng là hàng chờ tự nhiên, không ai bị đẩy.

Khi mục tiêu di chuyển, tọa độ slot được tính lại mỗi tick. Lính chỉ cần tới trong tầm đánh là tấn công.

**Dữ liệu thêm:** `slotOwner: Int32Array(N*K)`, `slotIdx: Int8Array`.

---

## 4. Truyền aggro trong khối: trạng thái báo động có thời hạn

Không dùng danh sách mục tiêu chung hay một `groupTarget` duy nhất: mục tiêu chết là mất, và cả khối lao vào cùng một kẻ địch gây đúng cái chen chúc ở mục 3. Dùng "Shout/Báo động" kèm timer:

```
alertUntil: Int32Array[armyGroupId]        // tick hết hạn

Kích hoạt (bất kỳ điều nào sau đây):
  - một lính của đạo quét thấy địch trong aggro thường (KHÔNG cần chờ sát thương)
  - một lính của đạo đang ở S_ATTACK (làm mới mỗi tick)
  - damage() cũng đặt alert (trigger phụ, không còn là trigger duy nhất)
  → alertUntil[g] = tick + TTL         // TTL ≈ 9 tick (~3s), gia hạn liên tục khi còn giao tranh

Hiệu lực:
  aggroRadius(s) = (tick < alertUntil[g]) ? R_ALERT : R_BASE
  R_ALERT = độ sâu của khối + R_BASE   // hàng sau vẫn với tới được tiền tuyến
```

| Nguyên nhân bug 2.2 | Cách xử lý |
|---|---|
| 1. Aggro 2 ô quá ngắn | Khi báo động, bán kính thành `R_ALERT`, phủ hết chiều sâu khối |
| 2. Chưa bị sát thương thì không kích hoạt | Trigger là "thấy địch" hoặc "đang tấn công" |
| 3. Mục tiêu chết thì `groupTarget` mất | Báo động là timer, không gắn với mục tiêu nào. Mục tiêu chết thì hàng sau tự quét mục tiêu kế tiếp |
| 4. Chỉ retarget mỗi 8 tick | Lính rảnh trong báo động quét mỗi tick. Lính rảnh bình thường quét mỗi 2 đến 3 tick, lệch pha theo `(tick + id) % 3` |

Nếu "tick" là tick logic 3Hz thì 8 tick ≈ 2,7 giây. Chỉ riêng độ trễ này đã đủ gây hiện tượng đứng nhìn.

Chi phí: tối đa 10000 lính × 3 lần/giây = 30k truy vấn spatial hash mỗi giây, mỗi truy vấn duyệt vài ô. Mức nhẹ.

Báo động theo `armyGroupId` nên 5 khối đã tách ở mục 2 mỗi khối có báo động riêng, khối nào chưa thấy địch không bị kéo vào.

**Dữ liệu thêm:** `alertUntil` (mảng nhỏ theo số đạo quân).

---

## 5. Tóm tắt và thứ tự triển khai

| Vấn đề | Giải pháp |
|---|---|
| Slot rơi vào sông/vách, moonwalk | Sinh slot dư, lọc bằng FlowField, `clearLine` và `stuck` (mục 1) |
| Nhiều đạo hòa thành một khối lớn | Bố trí khối với `GAP`, zone riêng, gán lính từng đạo (mục 2) |
| Lính chen chúc khi đánh | Slot tấn công quanh mục tiêu (mục 3) |
| Lính đứng nhìn đồng đội bị đánh | Báo động cấp đạo theo timer (mục 4) |

**Thứ tự đề xuất:**

1. `stuck` và `clearLine` (1C). Sửa moonwalk, ít rủi ro nhất.
2. Bố trí khối và zone (mục 2). Chỉ chạy một lần mỗi lệnh, sửa lỗi gộp khối ngay.
3. Báo động cấp đạo (mục 4).
4. Slot tấn công (mục 3), cần spatial hash địch hoạt động tốt.
5. Sinh slot dư và sắp xếp gán (1A, 1B) đầy đủ với xử lý địa hình.

## 6. Các điểm giả định, cần xác nhận

1. `spacing` nhỏ hơn hoặc bằng kích thước ô. Nếu không, cần chỉnh K, `spacing`, `ARRIVE_R`.
2. Chưa biết hiện tại có cơ chế đẩy lính tách nhau (separation) khi di chuyển không. Giải pháp xử lý chen chúc lúc **đứng và lúc đánh**. Muốn giảm chồng chéo khi hành quân thì cần biết bước di chuyển hiện tại.
3. Có spatial hash lưu vị trí địch để truy vấn theo bán kính. Nếu chưa có thì cần thêm, vì mục 3 và 4 phụ thuộc vào nó.
4. `walkable` và kiểm tra chuyển level có sẵn trong FlowField và dùng lại được.
5. Nguyên nhân gộp khối ở mục 2.1 là giả thuyết dựa trên mô tả `orderMove`. Cần log khoảng cách tâm đích để xác nhận.
6. Giá trị `GAP`, ngưỡng `score >= 0.9` và `ITER` là điểm khởi đầu, cần chỉnh theo cảm giác chơi thực tế.
7. Kích thước và tỉ lệ khối (cols x rows) do quy tắc lưới hiện có quyết định. Tôi giữ nguyên quy tắc đó.
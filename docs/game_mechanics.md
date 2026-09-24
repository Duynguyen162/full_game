# Cơ chế game (bản đang chạy)

> Tài liệu này mô tả **đúng những gì đang có trong code**. Các thiết kế chưa làm (luật "Đầu cầu", Bảng tin chiến trường, Bố trí đội hình trước trận) nằm ở [`rules_v2_dau_cau.md`](rules_v2_dau_cau.md).
>
> Các con số cân bằng đều nằm trong `shared/src/constants.ts` và `STATS` (`shared/src/world.ts`). Khi sửa số trong code, nhớ sửa luôn bảng tương ứng ở đây.

## 1. Kiến trúc

| Thành phần | File | Vai trò |
|---|---|---|
| Mô phỏng | `shared/src/world.ts` | Toàn bộ logic trận đánh, chạy theo tick 0,1 giây, **tất định** (cùng đầu vào → cùng kết quả). Dữ liệu lính lưu dạng mảng phẳng (SoA: `x`, `y`, `hp`, `side`…) để chạy nhanh với ~9.600 lính |
| Bản đồ | `shared/src/map.ts` | Sinh bản đồ 512×512 ô từ seed, đối xứng xoay giữa Tây và Đông |
| Tìm đường | `shared/src/flowfield.ts` | Flow field (Dijkstra một lần cho cả nhóm), có bảng hướng đi tính sẵn (`navMask`) và dừng sớm khi đã phủ hết lính nhận lệnh — khoảng 30–50 ms mỗi lệnh |
| Mục tiêu | `shared/src/objectives.ts` | Sinh 5 cứ điểm sông và 6 cờ cao nguyên mỗi phe từ bản đồ |
| Máy | `shared/src/ai.ts` | `AICommander` — chỉ huy một phe |
| Giao diện | `game/components/BattleMap.tsx`, `HowToPlay.tsx`, `game/lib/game/renderer.ts` | Next.js + Canvas 2D |
| Server | `server/src/index.ts` | Khung lockstep cho PvP, **chưa nối** với client |

Toàn bộ logic nằm trong `@game/shared` nên server và client dùng chung một mã.

## 2. Quân đội

Mỗi phe có **4.805 quân**, không có tiếp viện và không có kinh tế.

| Binh chủng | Số lượng | HP | Sát thương | Hồi đòn | Tốc độ (px/s) | Tầm đánh | Tầm tự tìm địch | Tầm nhìn |
|---|---|---|---|---|---|---|---|---|
| Kiếm sĩ | 1.800 | 120 | 14 | 1,0 s | 62 | 40 px | 5 ô | 7 ô |
| Cung thủ | 1.500 | 70 | 10 | 1,8 s | 58 | 6 ô | 7 ô | 8 ô |
| Thương kỵ | 1.000 | 160 | 22 | 1,4 s | 88 | 54 px | 6 ô | 6 ô |
| Tu sĩ | 500 | 60 | hồi 14 | 2,2 s | 56 | 4 ô | — | 5 ô |
| Trinh sát | 5 | 30 | 4 | 1,2 s | 95 | 36 px | 12 ô | 14 ô |

- 1 ô = 64 px. Mỗi đòn đánh dao động từ 80% đến 120% sát thương gốc, thời gian hồi đòn dao động ±15%.
- **Tu sĩ** tự tìm đồng minh dưới 85% HP trong bán kính 4 ô để hồi máu.
- **Trinh sát** mới vào trận đứng Giữ vị trí cạnh Thành và chỉ di chuyển khi được ra lệnh.
- **Cung thủ:**
  - Đứng trên cao nguyên (tầng ≥ 1): tầm tự tìm địch +2 ô.
  - Đứng cao hơn mục tiêu: tầm bắn +2 ô và sát thương ×1,3.
  - Mũi tên có thời gian bay. Khi rơi xuống, nếu mục tiêu đã chạy ra xa quá 48 px thì trượt.
- **Lính cận chiến** chỉ nhận mục tiêu khi đường thẳng tới mục tiêu đi được (không vướng sông hay vách đá). Cung thủ không bị giới hạn này.

## 3. Bản đồ

Mỗi nửa bản đồ chia thành 4 vành đai (số liệu đo trên seed 12345, phía Tây; phía Đông đối xứng):

| Vành đai | Phạm vi x | Nội dung |
|---|---|---|
| ① Hậu phương | 0–102 | Thành (HP 9.000), 4 Tháp canh, Trại lính, Trường bắn, Tu viện, 6 Nhà; vị trí quân lúc đầu |
| ② Nội địa | 102–180 | 6 cao nguyên hàng trong (mỗi cái có một Cờ hiệu), ~64 vùng rừng |
| ③ Bờ sông | 180–232 | 6 cao nguyên hàng ngoài (mép gần nhất cách cầu 12–19 ô), ~45 vùng rừng |
| ④ Sông | 232–279 | 3 cầu (y ≈ 93, 255, 417) và 2 bãi cạn (y ≈ 168–181, 330–343; đi chậm 0,5×) |

- **Cao nguyên** có 1–3 tầng, chỉ lên được qua dốc. Vách đá và nước sâu không đi được.
- **Rừng:** quân trong rừng bị ẩn với địch, cho tới khi địch cũng có quân vào đúng vùng rừng đó.
- **Thời gian đi bộ** (tốc độ 1x):

| Quãng đường | Thương kỵ | Kiếm sĩ |
|---|---|---|
| Tiền tuyến → cầu giữa | ~1:42 | ~2:25 |
| Cầu bắc ↔ cầu nam | ~3:56 | ~5:34 |
| Tiền tuyến → Thành địch | ~4:41 | ~6:38 |

## 4. Di chuyển & đội hình

- **Flow field:** mỗi lệnh di chuyển tạo một trường hướng dẫn chung cho cả nhóm. Đi qua bãi cạn tính chi phí gấp đôi, nên quân tự dồn về cầu, dốc và chỗ nông.
- **Đội hình:** khi tới đích, quân xếp thành khối cách nhau 40 px và **quay mặt về hướng tiến quân**. Mặt trận rộng gấp khoảng 2 chiều sâu. Ô trong đội hình được gán **theo vị trí**: lính đi đầu đứng hàng đầu, lính bên trái đứng cột trái.
- **Tách nhau:** lính đẩy nhau ra nếu đứng gần hơn 24 px.
- **Kẹt:** lính đứng yên quá 0,6 giây khi đang đuổi mục tiêu thì bỏ mục tiêu đó.

## 5. Lệnh, tư thế, rút lui & truy kích

| Lệnh | Phím | Hành vi |
|---|---|---|
| **Hành quân** | Chuột phải | Đi tới đích và **bỏ qua địch** trên đường. Dùng để rút lui |
| **Tấn công** | F rồi chuột phải, hoặc Alt + chuột phải | Đi tới đích và đánh mọi địch gặp trên đường. Quân đang đánh được ra lệnh Tấn công lại thì **vẫn giữ mục tiêu hiện tại** |
| **Giữ vị trí** | H | Đứng yên, chỉ tự đánh địch trong 2 ô, **nhận 60% sát thương** |
| **Tư thế Phòng thủ** (mặc định) | T để đổi | Đuổi địch tối đa **8 ô** quanh điểm neo (chỗ nhóm dừng lại), rồi tự quay về |
| **Tư thế Truy kích** | T | Đuổi tới khi mục tiêu chết hoặc mất dấu |
| **Quay đầu** | G | Dừng hành quân và đánh lại ngay. Nếu đã rút **≥ 3 giây** thì được **+30% sát thương trong 5 giây** |
| Xung trận | Nút trên Bàn chỉ huy | Toàn quân tấn công thẳng vào Thành địch |

**Truy kích có lời:**
- Đánh trúng lính đang Hành quân (đang rút): ×1,5 sát thương. Thương kỵ đánh: ×2.
- Cứ hạ 20 lính địch đang rút: +1 Uy thế.

**Truy kích có rủi ro — Rối loạn:**
- Lính bị Rối loạn khi đuổi liên tục quá 6 giây, hoặc cách điểm neo quá 12 ô trong lúc đang có mục tiêu.
- Khi Rối loạn: nhận +25% sát thương và mất giảm sát thương của Giữ vị trí.
- Đứng yên 4 giây thì hết Rối loạn.

## 6. Giao tranh

Các hiệu ứng lên sát thương (nhân dồn với nhau):

| Hiệu ứng | Điều kiện | Tác dụng |
|---|---|---|
| **Giới hạn vây đánh** | Mỗi lính bị tối đa **3 lính cận chiến** nhắm cùng lúc | Lính thứ 4 trở đi phải tìm mục tiêu khác |
| **Chen chúc** | Ô lưới 4×4 ô có **trên 60 lính cùng phe** | Tốc độ −30%, sát thương cận chiến −20%, nhận **+30% sát thương từ tên** |
| **Mưa tên** | Tên trúng lính ở ô có trên 6 lính cùng phe với nạn nhân | Thêm 50% sát thương lên một lính khác trong ô đó |
| **Kỵ binh xung phong** | Thương kỵ đánh mục tiêu đang Chen chúc, sau ≥ 3 giây không giao chiến | ×1,5 sát thương |
| **Lội sông** | Nạn nhân đang đứng trên bãi cạn | Nhận +25% sát thương |
| **Bao vây** | Ô lưới 8×8 ô có địch đông hơn 1,5 lần và địch ở hai phía đối diện | Gây −30% sát thương, nhận +20% |
| **Cuồng chiến** | Khi bị bao vây và HP < 50%, có 5–10% cơ hội | Sát thương ×2 cho tới chết, không bị phạt bao vây |
| **Phục kích** | Đứng trong rừng, ô đó địch không nhìn thấy, ≥ 3 giây không giao chiến | Đòn đầu ×1,5 |
| **Doanh trại rừng** | Đứng trong rừng, ≥ 8 giây không giao chiến | Hồi 1% HP tối đa mỗi giây |
| **Bụi mù** | Cụm **trên 600 quân** trong vùng 16×16 ô | Đối phương biết vị trí gần đúng (lệch ±8 ô) dù trong sương mù. Hiện mới chỉ máy dùng thông tin này, bản đồ con chưa hiển thị |

**Giải quyết đồng thời:** sát thương của cả tick được gom lại rồi trừ cùng lúc ở cuối tick. Lính bị hạ trong tick đó vẫn kịp ra đòn của mình. Thứ tự cập nhật lính và thứ tự lính trong mỗi ô lưới đảo chiều mỗi tick, để **không phe nào được ra đòn trước**.

## 7. Tầm nhìn & sương mù

- Mỗi phe có `visCount` (đang thấy) riêng, cập nhật 3 lần mỗi giây.
- Địa hình đã được biết từ đầu, sương mù chỉ che quân địch.
- Trong rừng tầm nhìn giảm 50%. Đứng trên cao nguyên tầng ≥ 2: tầm nhìn +3 ô (tối đa 15).
- Cờ nhà còn giữ cho tầm nhìn cố định 20 ô quanh cờ.
- Bản đồ con cũng phủ sương mù. Chủ sở hữu mục tiêu trên bản đồ chỉ cập nhật khi phe mình đang có tầm nhìn tới đó.

## 8. Luật chiến thắng (bản 1 — "Bốn vành đai")

### 8.1. Mục tiêu

- **5 cứ điểm sông** (3 cầu + 2 bãi cạn, bán kính 8 ô).
- **Cờ hiệu** trên đỉnh 6 cao nguyên nội địa mỗi phe (bán kính 6 ô, chỉ tính quân đứng ở tầng cao nhất).
- **Cách chiếm:**
  - Trong vòng tròn chỉ có quân chiến đấu của một phe → chiếm trong 10 giây (trung lập) hoặc 20 giây (đang thuộc địch).
  - Cả hai phe cùng có quân → tranh chấp, tiến độ đứng yên.
  - Không ai đứng trong vòng → tiến độ tụt dần.
  - Trinh sát không chiếm được.
  - Phe có **ít quân chiến đấu hơn** chiếm nhanh hơn **1,5 lần**.
- Trinh sát đứng 5 giây trên đỉnh cờ nhà của địch → tắt tầm nhìn cố định của cờ đó trong 60 giây.

### 8.2. Uy thế

| Nguồn | Giá trị |
|---|---|
| Cứ điểm sông | Mỗi giây, phe giữ nhiều hơn nhận (số của mình − số của địch) |
| Cờ trên đất địch | +1/giây mỗi cờ. Cờ nhà không cho điểm |
| Phá công trình | Tu viện / Trường bắn / Trại lính +40 · Tháp canh +25 · Nhà +10 |
| Truy sát | +1 cho mỗi 20 lính địch hạ khi chúng đang rút |

### 8.3. Công trình

- Tu viện còn đứng: Tu sĩ hồi máu +25%.
- Trường bắn còn đứng: Cung thủ +10% sát thương.
- Trại lính còn đứng: Kiếm sĩ và Thương kỵ nhận ít sát thương hơn (÷1,1, tương đương +10% HP).
- Tháp canh: tự bắn quân địch trong 8 ô, 12 sát thương mỗi 1,5 giây.

### 8.4. Điều kiện thắng

Phe nào đạt bất kỳ điều kiện nào trước thì thắng:
1. Đạt **400 Uy thế**.
2. **Phá Thành** địch.
3. Quân chiến đấu của địch còn **dưới 15%** → địch đầu hàng.
4. **Hết 20 phút:** so Uy thế, bằng nhau thì so tổng HP.

## 9. Máy (`AICommander`)

- **Chơi công bằng:** máy chỉ biết vị trí quân địch trong tầm nhìn của phe mình (có tính rừng và sương mù), kèm trí nhớ 25 giây về nơi đã thấy, cộng thêm bụi mù của đạo quân lớn.
- **Chia đội:**
  - 3 đội chủ lực, mỗi đội giữ một cầu.
  - 2 đội Thương kỵ giữ 2 bãi cạn.
  - 5 Trinh sát canh bờ bên kia của 5 ngả vượt sông.
- **Đội chủ lực:**
  - Vòng trạng thái: tiến quân → giữ trận → rút lui → hồi sức trong rừng → tiến quân.
  - Khi địch giữ cầu mạnh hơn: **chốt đầu cầu** ở bờ mình.
  - Khi địch áp sát: bộ binh Giữ vị trí.
  - Đang rút mà quân đuổi theo bị Rối loạn: **Quay đầu**.
  - Đội quá yếu thì nhập vào đội gần nhất.
- **Thương kỵ:**
  - Ứng cứu mục tiêu đang bị chiếm.
  - Truy kích quân đang rút, nhưng không đuổi vào gần rừng.
  - Khi đang thua: đột kích cờ nội địa địch, kèm Trinh sát đi làm mù cờ.
- **Toàn quân** — khi thấy một cụm địch mạnh hơn đội mạnh nhất của máy từ 1,3 lần trở lên ("dồn cục"):
  - **Đủ lực:** tụ toàn quân về một điểm tụ (ưu tiên cao nguyên, rồi rừng) nằm giữa cụm địch và Thành mình, rồi xuất kích cùng lúc.
  - **Yếu hơn:** các đội ở gần cụm địch né đi, các đội còn lại đánh vào chỗ địch vừa bỏ trống.
- **Tình huống đặc biệt:**
  - Áp đảo quân số (gấp 1,7 lần sau phút 4): tổng tấn công Thành địch.
  - Địch sắp đủ Uy thế: dồn quân lấy lại cứ điểm yếu nhất của địch.
- **Ra lệnh:** qua hàng đợi, tối đa 1 lệnh mỗi 0,3 giây để không làm giật khung hình.
- **Xem máy đang nghĩ gì:** chọn góc nhìn "Toàn cảnh" hoặc "Đông".

## 10. Giao diện

- **Màn hình chọn chế độ:** Đánh với máy · PvP (đang khoá) · Hướng dẫn chơi.
- **Bảng điểm:** quân còn lại, thanh Uy thế, số cứ điểm sông, số cờ địch đang cắm, số lính hạ gục, đồng hồ đếm ngược, thông báo sự kiện.
- **Bàn chỉ huy:** nút Hướng dẫn, góc nhìn, nút binh chủng (bấm để nhảy tới cụm quân), Xung trận, Giữ vị trí, lưới NavMesh, mây, bản đồ con, bản đồ mới, tốc độ (dừng / 1x / 3x).
- **Khi đang chọn quân:** hiện tư thế của nhóm và các nút Tấn công (F), Truy kích / Phòng thủ (T), Quay đầu (G), Giữ (H).
- **Phím tắt:** 1–5 chọn theo binh chủng · Q chọn cả đạo quân · Esc bỏ chọn · WASD, kéo chuột phải hoặc chuột giữa để di chuyển camera · lăn chuột để phóng to.

## 11. Kết quả đo cân bằng (mô phỏng không giao diện)

| Kịch bản | Kết quả |
|---|---|
| 1000 vs 1000, đổi phe và vị trí xuất phát (16 trận) | Tây 8 · Đông 8. Đổi phe cho nhau thì kết quả đối xứng hoàn toàn |
| 2000 vs 1000 trên bãi trống | Bên đông mất ~43% quân |
| Máy vs máy (4–6 seed) | Hai phe thắng ngang nhau, một số trận đánh hết 20 phút |
| Người chơi mẫu "dồn cục" vs máy, luật bản 1 | Máy thắng bằng Uy thế ở khoảng phút 5–6 |
| "Dồn cục" vs máy, chỉ tính đánh tiêu diệt (tắt Uy thế) | Dồn cục 2/6 · máy 1/6 · hoà 3/6; tỉ lệ trao đổi 1,16 |
| Thời gian mỗi bước mô phỏng (máy vs máy) | Trung bình ~3 ms, tệ nhất ~30 ms |

**Các lỗi đã sửa để đạt được kết quả trên:**
- Thứ tự danh sách lính trong mỗi ô lưới làm phe Đông luôn bị chọn làm mục tiêu trước. Đây là nguyên nhân chính khiến phe Tây luôn thắng.
- Flow field khi hòa luôn chọn hướng Đông, làm quân đi về phía Tây bị lệch chéo.
- Ô đội hình trước đây gán theo chỉ số lính thay vì theo vị trí.
- `visCount` bị tràn Uint8, gây ra lỗ trên lớp sương mù.

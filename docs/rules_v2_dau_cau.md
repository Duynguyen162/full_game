# Luật chơi bản 2 — "Đầu cầu"

> Trạng thái: **thiết kế, chưa cài đặt** (trừ các phần cân bằng đã ghi ở mục 13). Game hiện đang chạy luật bản 1 — xem [`game_mechanics.md`](game_mechanics.md) mục 8.
> Tài liệu này mô tả:
> - Bộ luật chiến thắng mới.
> - **Bảng tin chiến trường** (cảnh báo đỏ).
> - Chức năng **bố trí đội hình trước trận**.
> - Những việc cân bằng còn lại (mục 13).
>
> Những gì không nhắc tới ở đây thì giữ nguyên như bản 1.

## 1. Vì sao cần bản 2

Kết quả các trận máy đấu máy với luật bản 1 cho thấy:

1. **Gần như toàn bộ Uy thế đến từ 5 cứ điểm sông**, và trận nào cũng kết thúc ở khoảng phút 5–10. Rừng, cao nguyên và nội địa chưa kịp có vai trò thì trận đã xong.
2. **Cứ điểm sông vừa là mục tiêu, vừa là con đường duy nhất sang đất địch.** Vì vậy mọi thứ đều dồn về sông.
3. **Mục tiêu không bao giờ đổi**, nên cách chơi tối ưu là chia quân rải đều 5 chỗ rồi đứng giữ.
4. **Rừng, cao nguyên, rút lui giả chỉ là buff nhỏ**, không có mặt nào quyết định thắng thua.

**Ý chính của bản 2:** sông là **cửa ngõ**, nội địa mới là **nơi ghi điểm**. Muốn ghi điểm phải phá vỡ phòng tuyến ở một chỗ, giữ được đầu cầu, rồi tràn vào đất địch.

## 2. Ba mặt trận trên sông

| Mặt trận | Chỗ vượt sông | Giữ được thì mở ra |
|---|---|---|
| **Bắc** | Cầu bắc (y ≈ 93) + Bãi cạn bắc (y ≈ 174) | Được chiếm **3 cờ bắc** trong nội địa địch |
| **Giữa** | Cầu giữa (y ≈ 255) | Được đánh **Hậu phương** địch (công trình, Thành) với sát thương đầy đủ |
| **Nam** | Bãi cạn nam (y ≈ 336) + Cầu nam (y ≈ 417) | Được chiếm **3 cờ nam** trong nội địa địch |

- Chiếm chỗ vượt sông giống bản 1:
  - Trong bán kính 8 ô chỉ có quân chiến đấu của một phe → chiếm trong 10 giây (chỗ trung lập) hoặc 20 giây (chỗ đang thuộc địch).
  - Cả hai phe cùng có quân → tranh chấp, tiến độ đứng yên.
  - Trinh sát không chiếm được.
- Giữ **ít nhất 1 chỗ vượt sông** của một mặt trận là đã có **đầu cầu** ở mặt trận đó.
- Nếu **không** giữ Cầu giữa, công trình và Thành địch chỉ nhận **25% sát thương**.
- **Chia cờ theo mặt trận** (đo trên seed 12345): cờ 1–3 phía Tây ở y ≈ 43, 140, 198 thuộc mặt trận Bắc; cờ 4–6 ở y ≈ 304, 367, 459 thuộc mặt trận Nam. Phía Đông đối xứng. Khi cài đặt, cờ được gán theo **y nhỏ hơn / lớn hơn tâm bản đồ**, không cố định theo số thứ tự.
- **Quãng đường:** từ chỗ vượt sông vào tới cờ nội địa địch khoảng 100–115 ô. Thương kỵ đi mất khoảng 1 phút 15 giây, bộ binh khoảng 1 phút 50 giây.

## 3. Uy thế — cần 500 để thắng

| Nguồn | Giá trị |
|---|---|
| Cờ nội địa địch đang cắm **và còn đầu cầu** ở mặt trận đó | +1/giây mỗi cờ |
| Kho lương (mục 5) | +60, nhận một lần |
| Phá công trình địch | Tu viện / Trường bắn / Trại lính +40 · Tháp canh +25 · Nhà +10 |
| Truy sát | +1 cho mỗi 20 lính địch hạ được khi chúng đang Hành quân rút |
| Ưu thế sông (chỉ để tạo áp lực) | +0,2 × (số chỗ vượt sông của mình − của địch) mỗi giây, chỉ phe đang nhiều hơn được nhận |

- Chỗ vượt sông **gần như không cho điểm**. Giữ cả 5 chỗ cũng chỉ được +1/giây, tức hơn 8 phút mới thắng. Muốn thắng nhanh thì phải vào nội địa.
- **Cờ bị cô lập:**
  - Mất hết chỗ vượt sông ở mặt trận đó → các cờ đang cắm phía sau **thôi cho điểm** ngay.
  - Sau **30 giây** vẫn chưa lấy lại đầu cầu → cờ tự trả về cho chủ cũ.
  - Hệ quả: phe thủ không cần leo dốc đánh lại từng cờ. Chỉ cần **phản công cắt đầu cầu** là toàn bộ cờ phía sau mất tác dụng.

## 4. Cờ nhà là pháo đài của phe thủ

Giữ cờ trong nội địa của mình **không cho Uy thế**, nhưng cho các lợi thế phòng thủ sau:

| Lợi thế | Chi tiết |
|---|---|
| Tầm nhìn | Tầm nhìn cố định 20 ô quanh cờ (như bản 1). Trinh sát địch đứng 5 giây trên đỉnh sẽ làm mù trong 60 giây |
| Hồi máu | Quân phe mình trong vòng 12 ô quanh cờ, không giao chiến 5 giây, hồi **2% HP/giây** (trong rừng chỉ 1%) |
| Tầm bắn | Cung thủ đứng trên đỉnh cao nguyên có cờ nhà được **+1 ô**, cộng dồn với +2 ô khi đứng trên cao |

→ Phe thủ có chỗ để lùi về, hồi sức rồi phản công, thay vì bị ép phải đứng giữ trên cầu.

## 5. Kho lương — mục tiêu theo đợt

- **Lịch xuất hiện:** từ phút thứ 5, cứ 4 phút một lần (phút 5, 9, 13, 17).
- **Vị trí:** mỗi lần xuất hiện **một cặp đối xứng**, mỗi bên một kho, ở vành bờ sông (x ≈ 180–232 phía Tây, đối xứng phía Đông). Kho được đặt trên cao nguyên hàng ngoài hoặc trong khu rừng lớn.
- **Báo trước 60 giây** cho cả hai bên: hiện vị trí trên bản đồ con, đồng thời có thông báo trên Bảng tin (mục 7).
- **Cách lấy:** có quân trong bán kính 6 ô và không có quân địch, giữ đủ 15 giây thì nhận +60 Uy thế. Sau đó kho biến mất. Phe ít quân lấy nhanh hơn 1,5 lần.
- Kho không ai lấy sẽ tự biến mất sau 2 phút.
- **Lựa chọn chiến thuật mỗi lần có kho:** giữ kho bên mình, cướp kho bên địch, hay dùng kho làm **mồi** để phục kích quân địch kéo tới.

## 6. Điều kiện thắng

Phe nào đạt bất kỳ điều kiện nào dưới đây trước thì thắng:

1. Đạt **500 Uy thế**.
2. **Phá Thành địch.** Thành chỉ nhận sát thương đầy đủ khi đang giữ Cầu giữa.
3. **Địch đầu hàng:** quân chiến đấu của địch còn dưới 15%.
4. **Hết 20 phút:** so Uy thế. Nếu bằng nhau thì so số chỗ vượt sông đang giữ, rồi đến tổng HP quân.

**Giữ nguyên từ bản 1:** Hành quân / Tấn công, tư thế Phòng thủ / Truy kích, Rối loạn, Quay đầu, đánh vào lưng quân đang rút, Phục kích từ rừng, Doanh trại rừng, Quân tinh nhuệ (phe ít quân chiếm nhanh hơn 1,5 lần), hiệu ứng công trình, Tháp canh tự bắn.

## 7. Bảng tin chiến trường (cảnh báo đỏ)

### 7.1. Hiển thị

- **Vị trí:** một tab dọc ở mép phải màn hình, nằm trên bản đồ con.
  - **Nhìn xuyên được:** nền đen trong suốt khoảng 45%. Chuột đi xuyên qua vùng trống để vẫn chọn quân và ra lệnh được bên dưới. Chỉ các dòng thông báo là bấm được.
  - Có thể thu gọn thành một nút nhỏ, trên nút hiện **số cảnh báo chưa xem**.
- **Mỗi dòng thông báo gồm:** biểu tượng loại, thời gian trận (ví dụ 7:42), nội dung ngắn, và tên vị trí gần nhất (ví dụ "gần Cầu bắc", "Cờ Tây 5").
  - **Bấm vào dòng** → camera lướt tới vị trí đó.
  - **Phím Space** → nhảy tới cảnh báo mới nhất.
- **Mức độ:**

| Mức | Màu | Hiệu ứng thêm |
|---|---|---|
| **Khẩn cấp** | Đỏ | Viền màn hình nhấp nháy đỏ 1,5 giây, vòng tròn đỏ nhấp nháy trên bản đồ con tại vị trí đó |
| **Chú ý** | Vàng | Vòng tròn vàng trên bản đồ con |
| **Tin tức** | Trắng | Không có |

- Giữ tối đa 30 dòng, dòng mới ở trên cùng. Dòng cũ hơn 60 giây thì mờ đi.

### 7.2. Các loại thông báo

Chỉ thông báo những gì **phe mình biết được**, không lộ thông tin nằm trong sương mù.

| Thông báo | Mức | Khi nào |
|---|---|---|
| **Nổ ra giao tranh** ở [vị trí] (N quân ta) | Vàng, chuyển **Đỏ** nếu phe mình đang mất quân nhanh hơn địch | Quân mình bắt đầu đánh hoặc bị đánh ở một khu vực mà 20 giây qua chưa có giao tranh |
| [Cứ điểm / cờ nhà] **đang bị chiếm** | Đỏ | Địch bắt đầu chiếm một mục tiêu của mình |
| **Mất** [cứ điểm / cờ] | Đỏ | Mục tiêu đổi chủ sang địch |
| **Mất đầu cầu** mặt trận [Bắc / Nam] — cờ bị cô lập, còn 30 giây | Đỏ | Mất chỗ vượt sông cuối cùng của mặt trận đó trong khi đang cắm cờ phía sau |
| [Công trình] **đang bị tấn công** | Đỏ | Công trình của mình mất máu (mỗi công trình tối đa 1 lần / 30 giây) |
| Trinh sát **phát hiện đạo quân lớn** (~N quân) ở [vị trí] | Vàng | Thấy từ 200 quân địch trở lên tụ lại trong một vùng mà 30 giây qua chưa thấy |
| **Kho lương sắp xuất hiện** sau 60 giây ở [vị trí] | Vàng | Báo trước theo lịch |
| Nhóm [N] đang **Rối loạn** | Vàng | Từ 30% quân của một nhóm bị Rối loạn |
| **Chiếm được** [mục tiêu] / cắm cờ [tên] | Trắng | — |
| Địch đã có **80% Uy thế** | Đỏ | Uy thế địch vượt 400/500 |

### 7.3. Chống spam

- **Gộp theo vùng:** chia bản đồ thành vùng 16×16 ô. Cùng loại thông báo ở cùng vùng trong vòng **20 giây** thì chỉ cập nhật số liệu trên dòng cũ, không tạo dòng mới.
- **Giới hạn chung:** tối đa **1 hiệu ứng viền đỏ mỗi 3 giây**, kể cả khi có nhiều cảnh báo khẩn cấp cùng lúc.

## 8. Bố trí đội hình trước trận

### 8.1. Luồng vào trận

**Chọn chế độ → Màn hình bố trí → bấm "Vào trận" → trận bắt đầu.**

- Trong lúc bố trí, **mô phỏng đứng yên**. Người chơi có thể xem toàn bản đồ và lướt camera tự do.
- Chế độ đánh với máy: không giới hạn thời gian. Chế độ PvP sau này: giới hạn 90 giây.
- Máy cũng tự chọn một đội hình (mục 8.6). Hai bên **không thấy** đội hình của nhau cho tới khi gặp.

### 8.2. Khối quân

- Chia toàn bộ quân thành các **khối 100 quân cùng binh chủng**:

| Binh chủng | Số khối |
|---|---|
| Kiếm sĩ | 18 |
| Cung thủ | 15 |
| Thương kỵ | 10 |
| Tu sĩ | 5 |
| **Tổng** | **48 khối** |

- Mỗi khối vào trận xếp thành ô vuông 10×10, lính cách nhau 40px, tức khoảng 6,25 × 6,25 ô bản đồ.
- **Tên khối:** tên binh chủng kèm số thứ tự, ví dụ "Kiếm sĩ 7". Trên khối hiện biểu tượng binh chủng và màu của nhóm mà khối thuộc về.

### 8.3. Khung bố trí

- **Phía Tây:** x = 50–98, y = 160–352.
  - Khung nằm trước Thành: công trình Tây chỉ tới x = 46.
  - Mình đã kiểm tra trên seed 12345, 777 và 2024: khung không có rừng, nước hay chỗ nào không đi được.
- **Phía Đông:** đối xứng xoay.
- Khung chia thành lưới **ô bố trí 8×8 ô bản đồ**: 6 cột × 24 hàng = **144 ô**. Đặt 48 khối vẫn còn rộng để chừa khoảng trống giữa các nhóm.
- **Cột 1 là tiền tuyến** (x = 90–98, sát phía địch), cột 6 là hậu tuyến.

### 8.4. Thao tác

| Thao tác | Cách làm |
|---|---|
| **Kéo – thả** | Kéo một khối từ danh sách bên trái (hoặc từ ô đang đặt) sang ô trống. Thả vào ô đã có khối thì hai khối **đổi chỗ** |
| **Chọn nhiều** | Kéo khung chọn nhiều khối, hoặc Shift + bấm. Sau đó kéo cả cụm, cụm giữ nguyên hình dạng |
| **Gán nhóm** | Chọn khối rồi bấm **Ctrl + 1…9** để gán vào Nhóm 1–9. Mỗi nhóm một màu viền. Một khối chỉ thuộc một nhóm |
| **Đội hình mẫu** | Bấm để xếp tự động (bảng 8.5), rồi chỉnh lại tùy ý |
| **Lưu / Tải** | Lưu tối đa 3 đội hình riêng, lưu trong trình duyệt (localStorage) |
| **Kiểm tra** | Nút "Vào trận" chỉ bấm được khi đủ 48 khối đã được đặt. Khối nào chưa đặt sẽ hiện viền đỏ |

**Trinh sát luôn đứng đầu:**
- 5 Trinh sát đứng **cố định ở hàng đầu tiên**, trước cả cột 1 (x ≈ 101), dàn ngang giữa khung. Người chơi **không kéo đi được**.
- Trinh sát luôn là **Nhóm 0**: phím **0** (hoặc **`**) để chọn cả 5.
- Nút **"Tỏa trinh sát"** (vừa có trong bố trí, vừa có trong trận): mỗi Trinh sát tự Hành quân tới một trong 5 chỗ vượt sông. Đây là cách nhanh nhất để mở tầm nhìn đầu trận.

### 8.5. Đội hình mẫu

| Tên | Cách xếp | Hợp với lối đánh |
|---|---|---|
| **Cân bằng** (mặc định) | 3 cụm bắc / giữa / nam. Mỗi cụm: Kiếm sĩ ở cột 1–2, Cung thủ cột 3–4, Tu sĩ cột 5. Thương kỵ chia đều hai đầu khung | Giữ cả 3 mặt trận |
| **Mũi dùi bắc / nam** | 60% bộ binh và 7/10 khối kỵ dồn về một đầu khung | Đột phá sớm một mặt trận |
| **Hai cánh kỵ** | Bộ binh và cung thủ ở giữa, 5 khối kỵ ở mỗi đầu khung | Vòng sườn qua hai bãi cạn |
| **Phòng thủ chiều sâu** | Cung thủ ở cột 1–2 (bắn trước), Kiếm sĩ cột 3–4 làm tường chắn, Thương kỵ ở cột 6 làm quân dự bị | Đánh phản công, dụ địch |

- Mỗi đội hình mẫu tự gán nhóm luôn:
  - Nhóm 1 bắc, 2 giữa, 3 nam (bộ binh + cung + tu sĩ).
  - Nhóm 4–5: kỵ binh.
  - Nhóm 6: toàn bộ cung thủ.

### 8.6. Vào trận

- Lính sinh ra đúng vị trí khối của mình, xếp 10×10 và quay mặt về phía địch.
  - Nếu có ô bị vướng thì lính dồn sang ô trống gần nhất, giống cách `spawn()` hiện nay.
- Mỗi lính nhớ khối và nhóm của mình. Trong trận:

| Phím | Tác dụng |
|---|---|
| **1…9** | Chọn Nhóm 1–9 |
| **Bấm đúp** vào một lính | Chọn cả khối của lính đó |
| **Ctrl + 1…9** | Gán lại nhóm cho quân đang chọn |
| **0** | Chọn cả 5 Trinh sát |
| **Shift + 1…5** | Chọn theo binh chủng (trước đây là phím 1–5; đổi để nhường 1–9 cho nhóm) |
| **Q** | Chọn cả đạo quân (giữ nguyên) |

- **Máy chọn đội hình:** ngẫu nhiên một trong 4 đội hình mẫu, có trọng số theo tính cách của máy. Các đội của máy (mục 9) được lập từ đúng các khối trong đội hình đó.

## 9. Thay đổi cho máy (AI)

| Hành vi mới | Mô tả |
|---|---|
| **Chọn chỗ đột phá** | Chấm điểm từng mặt trận theo: sức mạnh địch đã biết ở đó, số cờ địch phía sau, rừng và cao nguyên có sẵn để giữ đầu cầu. Dồn khoảng 60% quân vào mặt trận có điểm cao nhất |
| **Giả đánh** | Trước khi đột phá, gửi 1–2 khối đánh rầm rộ ở một mặt trận khác trong 45–60 giây, rồi Hành quân rút về |
| **Giữ đầu cầu** | Sau khi chiếm chỗ vượt sông: cung thủ lên cao nguyên bờ sông, bộ binh giữ trận ở đầu cầu, kỵ binh chạy vào cắm cờ |
| **Phòng thủ** | Luôn giữ 1 đội dự bị gần giữa bản đồ. Khi địch cắm cờ nhà thì ưu tiên **cắt đầu cầu**, thay vì leo dốc đánh lại cờ |
| **Kho lương** | Quyết định lấy kho, cướp kho bên địch hay phục kích quanh kho, dựa trên quân rảnh ở gần và sức mạnh địch đã biết |

## 10. Bảng hằng số (điểm khởi đầu, sẽ chỉnh sau khi chạy mô phỏng)

| Hằng số | Giá trị |
|---|---|
| Uy thế để thắng | 500 |
| Cờ địch còn đầu cầu | +1/giây |
| Ưu thế sông | +0,2/giây cho mỗi chỗ chênh lệch |
| Cờ cô lập tự trả về sau | 30 giây |
| Hậu phương khi không giữ Cầu giữa | nhận 25% sát thương |
| Cờ nhà: bán kính hồi máu / tốc độ / thời gian nghỉ cần | 12 ô / 2% HP mỗi giây / 5 giây |
| Cờ nhà: thêm tầm bắn cho cung thủ | +1 ô |
| Kho lương: lịch / giá trị / thời gian giữ / thời gian tồn tại | phút 5, 9, 13, 17 / +60 / 15 giây / 2 phút |
| Bảng tin: gộp theo vùng | 16×16 ô, 20 giây |
| Khối quân / ô bố trí / khung | 100 quân / 8×8 ô / x 50–98, y 160–352 |

**Mục tiêu khi cân chỉnh:** trận máy đấu máy nên kéo dài **12–18 phút**, và ít nhất **40% Uy thế** phải đến từ nội địa (cờ + công trình + kho lương), không phải từ sông.

## 11. Ba quyết định đã chốt theo mặc định (có thể đổi)

1. **Cầu giữa chỉ mở Hậu phương**, không mở cờ nào. Nhờ vậy Cầu giữa là "cổng kết liễu", còn hai mặt trận bắc/nam là nơi ghi điểm.
2. **Kho lương xuất hiện theo cặp đối xứng**, để công bằng. Một kho ngẫu nhiên thì kịch tính hơn nhưng may rủi.
3. **Mục tiêu 500 Uy thế**, sẽ chỉnh lại sau khi chạy mô phỏng.

## 12. Vị trí cần sửa trong code khi cài đặt

| Hạng mục | File |
|---|---|
| Mặt trận, đầu cầu, cờ cô lập, kho lương, luật Uy thế mới | `shared/src/objectives.ts`, `shared/src/world.ts` (`updateObjectives`) |
| Hằng số | `shared/src/constants.ts` |
| Cờ nhà hồi máu, thêm tầm bắn; Hậu phương 25% sát thương | `shared/src/world.ts` (`updateUnitStatus`, `attack`, `damageBuilding`) |
| Sinh quân theo đội hình, lưu khối và nhóm của từng lính | `shared/src/world.ts` (`spawn` nhận thêm đội hình; thêm mảng `block`, `group`) |
| Phát hiện giao tranh và các sự kiện cho Bảng tin | `shared/src/world.ts` (ghi sự kiện có vị trí và mức độ) + `game/components/AlertFeed.tsx` (lọc theo tầm nhìn, gộp, hiển thị) |
| Màn hình bố trí | `game/components/Deployment.tsx` (lưới khung, kéo – thả, đội hình mẫu, lưu / tải) |
| Phím nhóm, bấm đúp chọn khối, Space nhảy tới cảnh báo | `game/components/BattleMap.tsx` |
| AI: chọn chỗ đột phá, giả đánh, giữ đầu cầu, đội dự bị, kho lương, chọn đội hình | `shared/src/ai.ts` |

## 13. Cân bằng chống "dồn cục"

**Đã làm** (chi tiết ở `game_mechanics.md` mục 6 và 11):
- Sửa lỗi thiên vị phe Tây.
- Giới hạn vây đánh, Chen chúc, Mưa tên, Kỵ binh xung phong, Lội sông.
- Bụi mù (hiện chỉ máy dùng).
- Máy phản ứng ở cấp toàn quân: tập trung hoặc né.
- Kết quả trong trường hợp xấu nhất (chỉ đánh tiêu diệt): dồn cục thắng 2/6 trận, tỉ lệ trao đổi 1,16. Trước khi làm là 5/6 và 1,74.

**Còn lại, làm cùng bản 2:**

1. **Bụi mù trên bản đồ con của người chơi**, kèm dòng thông báo trên Bảng tin: "Phát hiện bụi mù đạo quân lớn gần [vị trí]".
2. **Đo lại sau khi có luật bản 2.** Cờ cần có đầu cầu và kho lương xuất hiện theo cặp sẽ buộc phải chia quân, nên kỳ vọng tỉ lệ trao đổi của lối dồn cục xuống dưới 1,0.
3. **Kịch bản kiểm thử** (mô phỏng không giao diện, mỗi kịch bản chạy 10 seed):

| # | Kịch bản | Tiêu chí đạt |
|---|---|---|
| 1 | 1000 vs 1000, đổi phe và vị trí xuất phát | Mỗi bên thắng 40–60% |
| 2 | 2000 vs 1000 trên bãi trống | Bên đông mất 35–50% quân (hiện tại ~43%) |
| 3 | 2000 đánh chiếm cầu do 1000 quân giữ (Giữ vị trí + cung thủ trên cao nguyên đầu cầu) | Bên công mất ít nhất 1,2 lần số quân bên thủ mất |
| 4 | 1500 đuổi theo 500 đang rút vào rừng có 500 quân phục kích | Bên đuổi mất nhiều quân hơn |
| 5 | Người chơi mẫu "dồn cục" vs máy, luật bản 2 | Máy thắng ≥ 50%. Những trận dồn cục thắng phải kéo dài > 12 phút |
| 6 | Máy vs máy | Trận dài 12–18 phút, ≥ 40% Uy thế đến từ nội địa, mỗi bên thắng 40–60% |

4. **Máy dùng Chen chúc:** gửi Thương kỵ và Cung thủ đánh vào sườn các khối đang Chen chúc.

# Báo cáo Phân tích Kỹ thuật: Lỗi Xếp Đội Hình và Logic Giao Tranh (Combat/Formation)

Tài liệu này mô tả chi tiết logic hiện tại của hệ thống **Di chuyển/Xếp đội hình (Formation)** và **Tự động giao tranh (Auto-engage)**, kèm theo các lỗ hổng (edge cases) đang gây ra bug trên thực tế để Tech Lead nắm bài toán và đưa ra hướng giải quyết (Solution Architecture).

---

## 0. Bối cảnh & Kiến trúc Dự án (Dành cho người mới tiếp cận)
Để có thể đưa ra giải pháp phù hợp với hiệu năng và luồng code hiện hành, dưới đây là tóm tắt về kiến trúc của game:
- **Thể loại:** Game mô phỏng chiến thuật thời gian thực (RTS) với quy mô cực lớn (lên tới 10000 lính).
- **Kiến trúc dữ liệu (Structure of Arrays - SoA):** Để tối ưu hiệu năng, game KHÔNG dùng hướng đối tượng (OOP) cho từng lính. Thay vào đó, toàn bộ lính được lưu trong các mảng phẳng (`Float32Array`, `Int32Array`) như `this.x`, `this.y`, `this.hp`, `this.target`. Vòng lặp game sẽ duyệt qua các mảng này.
- **Tốc độ cập nhật (Tick Rate):** Logic game (`world.ts`) chỉ chạy ở tốc độ **3Hz** (3 lần/giây) thay vì 60fps nhằm tiết kiệm CPU.
- **Tìm đường (Pathfinding):** KHÔNG sử dụng A* cho từng lính. Game dùng **Trường Véc-tơ (Flow Field)**. Khi người chơi click một điểm đích, hệ thống sẽ lan truyền (BFS) từ đích ra toàn bản đồ để tạo mũi tên hướng đi cho mỗi ô. Lính chỉ việc xem mình đang đứng ở ô nào và đi theo hướng mũi tên của ô đó.
- **Bản đồ (Grid Map):** Bản đồ chia thành lưới các ô. Mỗi ô có thuộc tính cao độ (level), chướng ngại vật (rừng, vách núi, sông).

---

## 1. Bài toán Di chuyển và Xếp đội hình (Formation Logic)

### 1.1 Logic hiện tại
Khi người chơi chọn nhiều đơn vị (ví dụ 5 đạo quân, mỗi đạo 100 lính) và click chuột phải để di chuyển, hệ thống (`orderMove` trong `world.ts`) xử lý như sau:
1. **Phân rã theo nhóm:** Nhóm các lính được chọn theo `armyGroupId`.
2. **Tính vector tiến quân:** Lấy tâm chung của toàn bộ lính được chọn, tạo vector hướng tới điểm đích.
3. **Tính offset từng đạo:** Dịch chuyển điểm đến của từng đạo quân dựa trên khoảng cách tương đối của nó so với tâm chung ban đầu (bảo toàn cự ly đội hình).
4. **Xếp lưới (Grid Formation):** Tại điểm đích của mỗi đạo, lính được phân vào một lưới (hàng x cột) và được gán tọa độ tuyệt đối `(formTargetX, formTargetY)`.
5. **Định tuyến (Pathfinding):** Sinh ra một trường véc-tơ (`FlowField`) cho mỗi đạo quân trỏ về tâm đích. Khi lính tới gần điểm đích (`distToSlot < 150` hoặc FlowField trả về `DIR_GOAL`), lính sẽ bỏ FlowField và đi thẳng (steer) vào tọa độ `formTarget` của mình.

### 1.2 Vấn đề (Bug: Lính kẹt vách núi / bờ sông)
- **Tọa độ lưới bỏ qua địa hình:** Logic tính toán `dstX`, `dstY` và `formTarget` thuần túy là phép chiếu hình học. Nó không kiểm tra xem tọa độ đó có nằm trên mặt nước (Sông) hay vách đá (Mặt nề Level khác nhau) hay không.
- **Vòng lặp vô tận (Infinite Steering):** Khi tọa độ `formTarget` nằm trong vùng không thể đi tới (unwalkable), lính đi tới sát bờ sông/vách núi, lọt vào vùng `distToSlot < 150` và cố gắng đi thẳng vào điểm đó. Tuy nhiên, hệ thống vật lý / map collision chặn lại, khiến lính cứ đi bộ tại chỗ (moonwalk) dọc theo vách núi vĩnh viễn mà không bao giờ chuyển sang trạng thái `S_IDLE`.

### 1.3 Câu hỏi cho Tech Lead
- *Nên giải quyết va chạm đội hình với địa hình như thế nào?* Cắt bỏ những vị trí lỗi và dồn lính lên phía trên? Hay dùng thuật toán đổ nước (Flood Fill) để tìm các ô trống gần nhất hợp lệ xung quanh điểm đích thay vì vẽ lưới hình học cứng nhắc?

---

## 2. Bài toán Giao tranh và Hỗ trợ đồng đội (Combat & Group Assist)

### 2.1 Logic hiện tại
- **Quét mục tiêu (Aggro Scan):** Mỗi lính có một bán kính `aggro` (chỉ 2 ô ~ 64px đối với lính cận chiến). Mỗi 8 tick, lính quét xung quanh, nếu thấy địch thì đổi mục tiêu.
- **Chia sẻ mục tiêu (Group Target):** Khi một lính bị nhận sát thương (trong hàm `damage()`), nó ghi lại id của kẻ tấn công vào `groupTarget[armyGroupId]`.
- Các lính khác trong cùng `armyGroupId` nếu đang rảnh (không có mục tiêu) sẽ lấy `groupTarget` này làm mục tiêu của mình và chạy tới ứng cứu.

### 2.2 Vấn đề (Bug: Lính đứng nhìn đồng đội bị đánh)
Logic trên chạy không ổn định và tạo ra hiện tượng "đứng nhìn" do các nguyên nhân sau:
1. **Aggro quá ngắn:** Bán kính 2 ô là rất hẹp. Khi quân địch lao tới đụng độ hàng tiền đạo, hàng phía sau (cách 3-4 ô) không tự nhìn thấy địch.
2. **Lỗ hổng của `groupTarget` (Phụ thuộc vào sát thương):** Nếu lính địch đi vào tầm ngắm của hàng tiền đạo nhưng **chưa kịp tung đòn đánh**, lính tiền đạo tự động lao lên chém, nhưng KHÔNG CÓ SÁT THƯƠNG nào được tạo ra đối với phe ta. Do đó `groupTarget` không được kích hoạt -> hàng sau đứng yên.
3. **Mục tiêu bị tiêu diệt quá nhanh:** Kẻ địch (`attackerId`) đánh phe ta, kích hoạt `groupTarget`. Hàng sau vừa nhận mục tiêu thì hàng tiền đạo đã chém chết `attackerId`. Biến `groupTarget` bị hủy (trở về -1), hàng sau lại quay về trạng thái mù (aggro 2 ô) và tiếp tục đứng im trong khi còn cả trăm quân địch xung quanh.
4. **Phụ thuộc vào Retarget Tick:** Lính chỉ lấy `groupTarget` vào những frame chia hết cho 8, làm giảm độ nhạy bén.

### 2.3 Câu hỏi cho Tech Lead
- *Cách tốt nhất để truyền "Aggro" trong một khối 100 lính là gì?* 
- Nên gán một danh sách mục tiêu chung cho toàn khối thay vì 1 `groupTarget` duy nhất? 
- Hay dùng hệ thống "Shout/Báo động": Khi 1 lính phát hiện địch (vào tầm nhìn), nó báo động cho các lính xung quanh (bằng cách mở rộng bán kính aggro của cả khối) mà không cần chờ bị nhận sát thương?

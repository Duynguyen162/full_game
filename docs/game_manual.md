# ⚔️ THÔNG SỐ CÁC ĐƠN VỊ QUÂN (UNITS)

*Lưu ý: Mọi đơn vị đều có tốc độ di chuyển và tầm đánh riêng biệt.*

* **Kiếm binh (Warrior)**
  * **Máu (HP):** 120 | **Tấn công:** 14 (Tốc độ đánh: 1.0s/nhát)
  * **Vai trò:** Bộ binh cơ bản, máu trâu, sát thương ổn định. Dùng làm bao cát che chắn tiền tuyến.

* **Kỵ binh (Lancer)**
  * **Máu (HP):** 160 | **Tấn công:** 22 (Tốc độ đánh: 1.4s/nhát)
  * **Vai trò:** Cực kỳ cơ động và sát thương lớn. Đặc biệt nguy hiểm khi húc (Charge) vào đám đông địch đang chen chúc (gây thêm 150% sát thương).

* **Cung thủ (Archer)**
  * **Máu (HP):** 70 | **Tấn công:** 10 (Tốc độ đánh: 1.8s/nhát) | **Tầm xa:** 6 ô
  * **Vai trò:** Mỏng manh nhưng rỉa máu từ xa. Tầm bắn tăng lên 7 ô nếu đứng thủ gần Cờ nhà. Sát thương cực mạnh khi bắn vào đám đông.

* **Tu sĩ (Monk)**
  * **Máu (HP):** 60 | **Hồi máu:** 14 HP (Mỗi 2.2s) | **Tầm xa:** 4 ô
  * **Vai trò:** Không có khả năng tấn công. Tự động đi theo và hồi máu cho quân đồng minh lân cận. Rất dễ chết nếu đi lẻ.

* **Trinh sát (Scout)**
  * **Máu (HP):** 30 | **Tấn công:** 4 
  * **Vai trò:** Chạy nhanh nhất game, tầm nhìn xa nhất bản đồ. Dùng để đi lách vào rừng mở sương mù hoặc thám thính đội hình địch.

---

# 🧮 CƠ CHẾ BUFF / DEBUFF SÁT THƯƠNG

Hệ thống combat tự động tính toán sát thương dựa trên địa hình và tư thế:

* 🛡️ **Giữ vị trí (Hold):** Lính đang bật "Giữ vị trí" (phím H) giảm **40% sát thương nhận vào** từ mọi nguồn.
* ⭕ **Bao vây (Encircled):** Khi bị địch áp đảo (địch đông hơn 1.5 lần và kẹp từ hai phía đối diện), quân ta sẽ bị hoảng loạn: Gây **-30% sát thương** và Nhận **+20% sát thương**.
* 💢 **Cuồng chiến (Berserk):** Khi bị bao vây đường cùng sinh tử (HP < 50%), lính có 5–10% cơ hội "hóa điên", **Sát thương ×2** cho tới lúc chết trận và miễn nhiễm hoàn toàn hình phạt của Bao vây.
* ⚔️ **Đánh lén (Rear Attack):** Đánh vào lưng quân địch đang bỏ chạy gây **150% sát thương** (Kỵ binh đuổi đánh sau lưng gây tới **200% sát thương**).
* 🌳 **Phục kích (Ambush):** Từ trong rừng lao ra đánh úp gây **150% sát thương**.
* 🔄 **Phản công (Rally):** Quân đang rút lui (chạy trốn) ít nhất 3 giây, nếu dũng cảm quay đầu đánh trả sẽ được buff Tinh thần, gây **130% sát thương** trong 5 giây.
* 😵 **Rối loạn (Disorder):** Rượt đuổi địch quá lâu (hơn 6 giây) đội hình sẽ bị Rối loạn, khiến chúng nhận **thêm 25% sát thương**.
* 🎯 **Chen chúc (Crowded):** Khi nhồi nhét quá nhiều lính vào một khe hẹp, tốc độ di chuyển bị giảm. Trúng tên hoặc bị Kỵ binh húc lúc đang chen chúc sẽ nhận **thêm rất nhiều sát thương**.
* 🌊 **Lội cạn (Ford):** Giao chiến khi đang đứng dưới nước (bãi cạn) nhận **thêm 25% sát thương**.

---

# 📖 HƯỚNG DẪN ĐIỀU KHIỂN & CHIẾN THUẬT

## 1. Điều khiển cơ bản
* **Quét chuột trái:** Chọn nhiều đạo quân cùng lúc. (Có thể bấm phím `1 - 5` để gọi nhanh từng loại binh chủng).
* **Chuột phải:** Lệnh hành quân. Quân sẽ giữ form đội hình, tự động đánh nếu gặp địch trên đường.
* **Phím `F` (Lệnh Tấn công):** Chọn mục tiêu rồi bấm chuột phải. Lính sẽ tự phá đội hình, lao lên bằng mọi giá để tìm góc chém mục tiêu.
* **Phím `H` (Giữ vị trí):** Lính đứng im như tượng và KHÔNG rượt đuổi. Cung thủ vẫn xả tên ở tầm xa tối đa. Cận chiến biến thành bức tường thép (nhờ cơ chế giảm 40% sát thương).
* **Phím `V` (Lệnh Bơi):** Ép lính bơi qua sông sâu (Tốc độ cực chậm và không thể đánh trả).

## 2. Chiến thuật Địa hình
* **Tàng hình trong rừng:** Lính trốn trong rừng sẽ vô hình trước mắt địch (trừ khi địch đi sát vào). Nếu đứng yên trong rừng 8 giây không giao chiến, lính sẽ tự động hồi máu.
* **Chiếm Cao Nguyên (Đồi):** Đứng trên cao tầm nhìn rộng hơn. Cung thủ trên đồi bắn xuống sẽ không bị chắn tầm nhìn bởi lính phe mình che khuất ở dưới.
* **Chặn Cầu / Đỉnh Dốc:** Nút thắt cổ chai hoàn hảo. Hãy đưa Kỵ/Kiếm lên đầu cầu, bấm phím `H` (Giữ vị trí) để dựng khiên. Sau đó xếp Cung thủ ở tuyến sau xả tên. Địch dù đông gấp 3 cũng khó qua được.

## 3. Binh Pháp Trận Mạc
* **Nghệ thuật Rút lui:** Đừng để lính đánh tới chết. Khi yếu máu, hãy cho lính chạy lùi về phía sau. Địch nếu hăng máu rượt theo sẽ bị dính hiệu ứng *Rối loạn đội hình*. Chờ đúng lúc địch rối loạn, hãy cho lính quay đầu *Phản công* để lật kèo!
* **Bảo vệ Cờ nhà:** Cờ (Flag) cung cấp tầm nhìn và hào quang hồi máu cho lính. Mất cờ (hoặc bị phá cầu nối), các công trình của phe bạn sẽ bị suy yếu giáp nghiêm trọng.


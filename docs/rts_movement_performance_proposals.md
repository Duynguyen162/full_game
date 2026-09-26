# Đề xuất tối ưu kiến trúc Di chuyển & Va chạm cho RTS

## 1. Quy mô và mục tiêu

- Mỗi bên: **4.800 lính**.
- Hai bên tối đa: khoảng **9.600 unit**.
- Mục tiêu: giữ kiến trúc hiện tại (`Flow Field + Formation + Local Nav + Spatial Hash`) nhưng giảm CPU, giảm jitter và hạn chế tính toán thừa.
- Không sử dụng A* độc lập cho từng lính.

---

## 2. Kiến trúc đề xuất

```text
Player Command
      ↓
Formation Plan
      ↓
Squad Placement / squareFit
      ↓
Formation Anchor
      ↓
Flow Field
      ↓
Squad / Formation Movement
      ↓
┌───────────────┴───────────────┐
│                               │
Far from target             Near target
│                               │
Flow Field only              Local Nav
│                               │
└───────────────┬───────────────┘
                ↓
        Individual Slot Target
                ↓
       Lightweight Steering
                ↓
          Spatial Hash
                ↓
       Collision / Separation
                ↓
           Anti-Stuck
```

Nguyên tắc chính:

> **Đội hình quyết định vị trí mong muốn của unit; Flow Field quyết định hướng di chuyển dài; Local Nav và Separation chỉ sửa sai cục bộ.**

---

## 3. Flow Field

### Giữ nguyên

Flow Field phù hợp vì một field có thể được nhiều unit/squad dùng chung, thay vì chạy A* cho từng lính.

```text
Target
  ↓
BFS
  ↓
Flow Field
  ↓
Nhiều squad cùng đọc hướng
```

### Tối ưu đề xuất

#### 3.1. Không nhất thiết BFS toàn bản đồ

Nếu bản đồ lớn, BFS từ target có thể giới hạn trong vùng cần thiết cho các formation đang di chuyển.

Mục tiêu là tránh xử lý những cell mà không có unit liên quan.

#### 3.2. Cache Flow Field

Nếu bản đồ tĩnh và cùng target cell được dùng lại, có thể cache field theo target/cấu hình phù hợp.

```text
Target A → FlowField A → Cache
Target A → dùng lại cache
```

#### 3.3. Flow Field chỉ xử lý dẫn đường toàn cục

Không để Flow Field giải quyết chi tiết vị trí từng lính. Việc đó thuộc Formation + Local Nav.

---

## 4. Formation

Đây là phần cần tối ưu mạnh nhất sau Flow Field.

### 4.1. Tổ chức theo cấp Squad

Nếu một squad có khoảng 100 lính, không nên tìm vị trí riêng bằng search cho từng unit.

```text
Army
 ├─ Squad 1 (100)
 ├─ Squad 2 (100)
 ├─ Squad 3 (100)
 └─ ...
```

Với 4.800 lính/bên và block 100 lính, số squad chỉ khoảng **48 squad/bên**.

### 4.2. `squareFit` chỉ chạy ở cấp Squad

Thay vì:

```text
Unit → tìm vị trí → kiểm tra địa hình
```

nên là:

```text
Squad → tìm rectangle phù hợp
             ↓
       tạo formation
             ↓
      sinh slot cho unit
```

Điều này biến phần tìm kiếm thành bài toán nhỏ hơn nhiều.

### 4.3. Unit slot nên tính trực tiếp

Sau khi squad có `anchor`, `width`, `depth`, `rotation` và `spacing`, vị trí unit có thể tính bằng công thức từ `slotIndex`.

```text
row = floor(slotIndex / columns)
col = slotIndex % columns

slotPosition = anchor + formationOffset(row, col, spacing, rotation)
```

Không cần search lại cho từng unit.

### 4.4. SlotClaims

Giữ cơ chế chống trùng slot, nhưng ưu tiên quản lý ở cấp formation/rectangle. Chỉ dùng claim riêng cho unit khi thực sự cần.

---

## 5. Spatial Hashing

Cơ chế `head/next` theo tile là phù hợp để tránh kiểm tra O(N²).

### 5.1. Không cập nhật hash mỗi tick nếu unit chưa đổi cell

Đây là tối ưu quan trọng.

Lưu:

```text
unit.cellId
```

Mỗi tick:

```text
newCell = getCell(unit.x, unit.y)

if newCell != unit.cellId:
    update spatial hash
```

Nếu unit vẫn ở cùng cell thì không cần remove/insert lại.

### 5.2. Hiểu đúng về độ phức tạp

Spatial Hash giúp giảm mạnh số cặp cần kiểm tra và thường cho hiệu năng gần tuyến tính trong phân bố bình thường, nhưng không đảm bảo O(N) trong mọi trường hợp.

Nếu quá nhiều unit dồn vào cùng khu vực, số pair check trong cell vẫn có thể tăng lớn.

---

## 6. Separation / Collision

`separate()` là điểm cần kiểm soát chặt để tránh jitter.

### 6.1. Không dùng cùng một mức separation cho mọi unit

Ưu tiên theo quan hệ:

```text
Cùng Squad
    ↓
Formation là chính
Separation rất nhẹ

Khác Squad
    ↓
Separation mạnh hơn nếu cần

Đơn vị khác phe
    ↓
Collision / combat logic
```

Lý do: unit cùng formation đã có slot riêng. Nếu vẫn đẩy nhau mạnh, Formation và Separation sẽ liên tục chống lại nhau.

### 6.2. Separation chỉ là correction nhỏ

Thứ tự ưu tiên:

```text
Flow Field direction
        ↓
Formation correction
        ↓
Small separation correction
```

Không để `separate()` trở thành lực chính điều khiển chuyển động.

### 6.3. Mục tiêu

Giảm hiện tượng:

```text
Formation → đẩy sang trái
Separation → đẩy sang phải
→ đổi hướng liên tục
→ jitter
→ CPU tăng
```

---

## 7. Crowded

Giữ cơ chế `crowded` vì phù hợp với môi trường đông unit.

Khi mật độ lân cận quá cao:

```text
crowded = true
    ↓
speed giảm / movement thận trọng hơn
```

Nên xác định crowding từ các unit trong neighborhood/spatial cells lân cận, không cần kiểm tra toàn cục.

Mục tiêu là hạn chế separation quá mạnh trong vùng đông người.

---

## 8. Local Nav

Giữ Local Nav cho chặng cuối và khu vực chật hẹp.

Không nên dùng Local Nav cho toàn bộ hành trình của 9.600 unit.

```text
Xa target
   ↓
Flow Field

Gần target / chật hẹp
   ↓
Local Nav + Formation
```

Local Nav chỉ nên xử lý phạm vi nhỏ quanh mục tiêu hoặc chướng ngại vật cần thiết.

---

## 9. Anti-Stuck

Cơ chế `stuck` hiện tại là cần thiết, nhưng nên tách **movement problem** khỏi **combat decision**.

### Không nên

```text
stuck
  ↓
tự động attack enemy gần nhất
```

Vì một unit bị kẹt không đồng nghĩa với việc gameplay muốn unit tự đổi mục tiêu.

### Nên

```text
stuck
  ↓
giảm separation / điều chỉnh movement
  ↓
thử slot lân cận
  ↓
nếu cần → local repath
  ↓
nếu vẫn kẹt → tạm bỏ slot hoặc biến dạng formation nhẹ
```

Combat state chỉ thay đổi nếu logic gameplay cho phép.

---

## 10. Ưu tiên tối ưu theo mức độ quan trọng

### Ưu tiên 1 — Formation theo Squad

```text
4.800 unit
    ↓
~48 squad
    ↓
squareFit ở cấp squad
    ↓
sinh slot bằng công thức
```

Đây là cách giảm số lượng phép search đáng kể.

### Ưu tiên 2 — Spatial Hash incremental

Chỉ cập nhật `head/next` khi unit đổi cell.

### Ưu tiên 3 — Giảm Separation trong cùng Squad

Formation đã kiểm soát vị trí, không cần để các unit cùng squad liên tục đẩy nhau mạnh.

### Ưu tiên 4 — Tối ưu Flow Field

Giới hạn vùng BFS khi phù hợp và cache khi có thể.

### Ưu tiên 5 — Anti-Stuck

Ưu tiên đổi slot/repath thay vì tự động đổi sang hành vi combat.

---

## 11. Kiến trúc cuối cùng đề xuất

```text
                 COMMAND
                    ↓
             Formation Plan
                    ↓
           Squad Placement
              (squareFit)
                    ↓
             Formation Anchor
                    ↓
              Global Navigation
               (Flow Field)
                    ↓
        ┌───────────┴───────────┐
        ↓                       ↓
   Far / Open Area        Near / Crowded Area
        ↓                       ↓
   Flow Field Only          Local Nav
        └───────────┬───────────┘
                    ↓
             Unit Slot Target
                    ↓
          Lightweight Steering
                    ↓
              Spatial Hash
                    ↓
          Collision / Separation
                    ↓
                Anti-Stuck
```

---

## 12. Kết luận

Với quy mô **4.800 lính mỗi bên**, không cần thay toàn bộ kiến trúc hiện tại. Hướng phù hợp là giữ:

```text
Flow Field
+ Formation
+ Local Nav
+ Spatial Hash
```

nhưng tối ưu cách chúng phối hợp:

1. **Navigation ở cấp Squad/Formation, không để từng unit tự tìm đường dài.**
2. **`squareFit` chỉ tìm vị trí cho Squad; unit slot sinh bằng công thức.**
3. **Spatial Hash cập nhật incremental khi unit đổi cell.**
4. **Unit cùng Squad ưu tiên Formation, Separation chỉ sửa sai nhẹ.**
5. **Local Nav chỉ dùng cho khu vực gần đích/chật hẹp.**
6. **Anti-Stuck ưu tiên đổi slot và repath, không tự ý quyết định combat.**
7. **Flow Field nên giới hạn phạm vi hoặc cache khi điều kiện cho phép.**

Mục tiêu cuối cùng là biến bài toán từ:

```text
9.600 unit = 9.600 pathfinding / collision logic độc lập
```

thành:

```text
~48 squad / bên
      ↓
formation-level navigation
      ↓
individual lightweight correction
```

Đây là hướng tối ưu trực tiếp dựa trên thuật toán và quy mô đã nêu trong tài liệu, không phụ thuộc vào việc thêm các hệ thống gameplay khác.

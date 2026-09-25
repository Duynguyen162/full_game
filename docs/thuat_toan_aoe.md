# Thuật toán điều khiển lính & tự động tấn công kiểu AoE

Tài liệu này mô tả kiến trúc và thuật toán tham khảo cho hệ thống AI đơn vị (unit) trong game RTS, theo phong cách Age of Empires. Mục tiêu: dễ đọc, dễ implement lại trong engine của bạn (Unity/Godot/custom engine), và có chỗ để cải tiến.

---

## 1. Kiến trúc tổng quan

```
┌─────────────────────────────────────────────────────────┐
│                     Game Tick Loop                        │
│  (chạy cố định, vd 20 tick/giây, tách khỏi frame rate)    │
└─────────────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────┐   ┌────────────────────┐   ┌───────────────────┐
│  Spatial Index      │   │  Unit State Machine │   │  Command Queue     │
│  (Grid / Quadtree)  │◄─►│  (per unit)          │◄─►│  (lệnh người chơi) │
└───────────────────┘   └────────────────────┘   └───────────────────┘
                │                    │
                ▼                    ▼
        Target Selection      Pathfinding / Attack
```

**4 thành phần cốt lõi:**

1. **Spatial Index** – cấu trúc dữ liệu để tìm nhanh "địch nào gần tôi" mà không phải duyệt toàn bộ đơn vị trên bản đồ.
2. **Unit State Machine** – mỗi lính là 1 máy trạng thái hữu hạn (Idle, Moving, Attacking, Fleeing...).
3. **Stance System** – "tính cách" quyết định lính có tự chủ động đánh hay không, đánh xa tới đâu.
4. **Command Queue** – lệnh người chơi luôn có độ ưu tiên cao hơn hành vi tự động, override state hiện tại.

---

## 2. Unit State Machine

### 2.1. Các trạng thái

```csharp
public enum UnitState
{
    Idle,
    MovingToPoint,      // di chuyển theo lệnh, không quan tâm địch
    MovingToAttack,      // đang đuổi theo mục tiêu để vào tầm đánh
    Attacking,           // trong tầm đánh, đang thực hiện đòn đánh
    Searching,           // vừa mất mục tiêu, đang quét lại xung quanh
    Fleeing,             // máu thấp / lệnh rút lui
    Dead
}
```

### 2.2. Bảng chuyển trạng thái (transition table)

| Trạng thái hiện tại | Sự kiện                          | Trạng thái tiếp theo |
|----------------------|-----------------------------------|------------------------|
| Idle                 | Phát hiện địch (stance cho phép)  | MovingToAttack         |
| Idle                 | Nhận lệnh move                    | MovingToPoint          |
| MovingToPoint         | Phát hiện địch trên đường (stance Aggressive) | MovingToAttack (nhớ điểm đến cũ) |
| MovingToAttack        | Vào attack range                  | Attacking               |
| MovingToAttack        | Mất dấu mục tiêu (ra khỏi sight)  | Searching hoặc Idle     |
| Attacking             | Mục tiêu chết / biến mất          | Searching                |
| Attacking             | Mục tiêu ra khỏi attack range     | MovingToAttack (nếu được phép đuổi) hoặc Idle (nếu Stand Ground) |
| Any                   | Nhận lệnh mới từ người chơi        | State theo lệnh mới (override) |
| Any                   | HP < ngưỡng & có flag auto-flee    | Fleeing                  |

### 2.3. Pseudocode vòng lặp state machine (chạy mỗi tick, mỗi unit)

```csharp
void TickUnit(Unit unit)
{
    switch (unit.State)
    {
        case UnitState.Idle:
            if (unit.Stance != Stance.Passive)
            {
                Unit target = FindNearestEnemyInRange(unit, unit.DetectionRange);
                if (target != null)
                {
                    unit.Target = target;
                    unit.State = UnitState.MovingToAttack;
                }
            }
            break;

        case UnitState.MovingToPoint:
            MoveTowards(unit, unit.Destination);
            if (unit.Stance == Stance.Aggressive)
            {
                Unit target = FindNearestEnemyInRange(unit, unit.DetectionRange);
                if (target != null)
                {
                    unit.SavedDestination = unit.Destination; // để quay lại sau
                    unit.Target = target;
                    unit.State = UnitState.MovingToAttack;
                }
            }
            if (HasArrived(unit, unit.Destination))
                unit.State = UnitState.Idle;
            break;

        case UnitState.MovingToAttack:
            if (unit.Target == null || unit.Target.IsDead)
            {
                unit.State = UnitState.Searching;
                break;
            }
            if (unit.Target.IsOutOfDetectionRange(unit) && !unit.IsPlayerOrdered)
            {
                unit.Target = null;
                unit.State = UnitState.Idle;
                break;
            }
            if (Distance(unit, unit.Target) <= unit.AttackRange)
            {
                unit.State = UnitState.Attacking;
            }
            else
            {
                MoveTowards(unit, unit.Target.Position);
            }
            break;

        case UnitState.Attacking:
            if (unit.Target == null || unit.Target.IsDead)
            {
                unit.State = UnitState.Searching;
                break;
            }
            if (Distance(unit, unit.Target) > unit.AttackRange)
            {
                unit.State = unit.Stance == Stance.StandGround
                    ? UnitState.Idle
                    : UnitState.MovingToAttack;
                break;
            }
            PerformAttack(unit, unit.Target); // xử lý cooldown/damage bên trong
            break;

        case UnitState.Searching:
            Unit newTarget = FindNearestEnemyInRange(unit, unit.DetectionRange);
            if (newTarget != null)
            {
                unit.Target = newTarget;
                unit.State = UnitState.MovingToAttack;
            }
            else
            {
                unit.State = unit.SavedDestination != null
                    ? UnitState.MovingToPoint  // quay lại đường cũ (A-move)
                    : UnitState.Idle;
            }
            break;
    }
}
```

> **Điểm cải tiến thường gặp:** tách `PerformAttack` thành 1 sub-state machine riêng (Windup → Hit → Recovery) để đồng bộ animation với thời điểm damage thực sự được áp dụng, tránh trường hợp "đánh trúng" xảy ra trước khi animation vung vũ khí kết thúc.

---

## 3. Stance System (tư thế ứng xử)

```csharp
public enum Stance
{
    Aggressive,   // tự tìm & đuổi theo địch trong DetectionRange
    Defensive,    // chỉ phản công khi địch vào AttackRange hoặc tấn công mình trước
    StandGround,  // không di chuyển, chỉ đánh khi địch tự đi vào tầm
    Passive       // không tự động phản ứng
}
```

Điểm khác biệt cốt lõi giữa các stance nằm ở **2 tham số**:

| Stance      | Có chủ động quét tìm địch? | Có được rời vị trí để đuổi theo? |
|-------------|------------------------------|--------------------------------------|
| Aggressive  | Có (bán kính `DetectionRange`) | Có |
| Defensive   | Không (chỉ phản ứng khi bị tấn công hoặc địch vào `AttackRange`) | Có, nhưng giới hạn khoảng cách (leash range) |
| StandGround | Không | Không |
| Passive     | Không | Không |

```csharp
Unit FindNearestEnemyInRange(Unit unit, float range)
{
    if (unit.Stance == Stance.Passive) return null;
    if (unit.Stance == Stance.StandGround) range = unit.AttackRange;
    if (unit.Stance == Stance.Defensive) range = unit.AttackRange; // chỉ phản ứng khi địch tới gần

    return SpatialIndex.QueryNearestEnemy(unit.Position, range, unit.Team);
}
```

**Leash range (dây xích):** kể cả Aggressive, nên giới hạn khoảng cách tối đa lính được phép đuổi theo tính từ điểm xuất phát, để tránh lính bị dụ đi lạc vào ổ phục kích — đây là lỗi rất phổ biến ở các game RTS tự làm.

```csharp
if (Distance(unit.OriginPosition, unit.Position) > unit.LeashRange)
{
    unit.Target = null;
    unit.State = UnitState.MovingToPoint;
    unit.Destination = unit.OriginPosition;
}
```

---

## 4. Spatial Index — tìm địch nhanh

Duyệt toàn bộ N đơn vị để tìm địch gần nhất cho mỗi lính là **O(N²)**, sẽ sập FPS khi trận đánh có vài trăm quân. Giải pháp chuẩn: chia bản đồ thành **grid ô vuông** (đơn giản, hiệu quả, dễ maintain hơn quadtree cho RTS vì mật độ đơn vị khá đều).

### 4.1. Cấu trúc Grid

```csharp
public class SpatialGrid
{
    private Dictionary<(int, int), List<Unit>> cells = new();
    private float cellSize = 5f; // tuỳ chỉnh theo AttackRange trung bình

    (int, int) GetCell(Vector2 pos) =>
        ((int)(pos.x / cellSize), (int)(pos.y / cellSize));

    public void Insert(Unit unit)
    {
        var cell = GetCell(unit.Position);
        if (!cells.ContainsKey(cell)) cells[cell] = new List<Unit>();
        cells[cell].Add(unit);
    }

    public List<Unit> QueryRadius(Vector2 center, float radius)
    {
        var result = new List<Unit>();
        int cellRadius = Mathf.CeilToInt(radius / cellSize);
        var (cx, cy) = GetCell(center);

        for (int dx = -cellRadius; dx <= cellRadius; dx++)
        for (int dy = -cellRadius; dy <= cellRadius; dy++)
        {
            if (cells.TryGetValue((cx + dx, cy + dy), out var list))
            {
                foreach (var u in list)
                    if (Vector2.Distance(u.Position, center) <= radius)
                        result.Add(u);
            }
        }
        return result;
    }
}
```

- **Rebuild mỗi tick** (hoặc mỗi vài tick) bằng cách: clear toàn bộ cell rồi insert lại tất cả unit — với vài trăm/nghìn unit, việc này vẫn rẻ hơn nhiều so với O(N²) so sánh khoảng cách.
- Tối ưu hơn: chỉ cập nhật cell của unit nào **đã di chuyển sang cell khác** kể từ lần cập nhật trước (dirty-tracking), tránh rebuild toàn bộ.

### 4.2. Target Priority (ưu tiên mục tiêu)

Khi có nhiều địch trong tầm, không nên chỉ chọn "gần nhất":

```csharp
Unit SelectBestTarget(Unit unit, List<Unit> candidates)
{
    return candidates
        .OrderByDescending(c => c.IsAttackingMe(unit) ? 1 : 0)   // ai đang đánh mình thì ưu tiên
        .ThenByDescending(c => GetThreatScore(unit, c))          // đơn vị nguy hiểm hơn (cung, phép)
        .ThenBy(c => c.CurrentHP)                                  // máu thấp dễ finish nhanh
        .ThenBy(c => Distance(unit.Position, c.Position))          // cuối cùng mới xét khoảng cách
        .FirstOrDefault();
}

float GetThreatScore(Unit self, Unit enemy)
{
    // Ví dụ: đơn vị tầm xa và đơn vị khắc chế loại của mình được điểm cao hơn
    float score = enemy.AttackDamage;
    if (enemy.AttackRange > self.AttackRange) score *= 1.5f;
    if (CounterTable.GetMultiplier(enemy.UnitType, self.UnitType) > 1f) score *= 1.3f;
    return score;
}
```

> Đây chính là chỗ để bạn "tinh chỉnh cảm giác" của AI: AoE2 bản gốc chủ yếu ưu tiên khoảng cách + đơn vị đang tấn công mình, còn nhiều mod/game hiện đại thêm hẳn threat score như trên để lính đánh "khôn" hơn.

---

## 5. Attack Execution (thực thi đòn đánh)

```csharp
void PerformAttack(Unit unit, Unit target)
{
    if (unit.AttackCooldown > 0)
    {
        unit.AttackCooldown -= Time.deltaTime;
        return;
    }

    unit.PlayAnimation("Attack"); // animation tự chạy song song

    // Damage được áp dụng đúng vào "impact frame" của animation,
    // không phải ngay khi bắt đầu đòn đánh
    unit.ScheduleDamageEvent(unit.AttackWindupTime, () =>
    {
        if (target.IsDead || Distance(unit, target) > unit.AttackRange) return;

        float damage = CalculateDamage(unit, target);
        target.TakeDamage(damage);
    });

    unit.AttackCooldown = unit.ReloadTime;
}

float CalculateDamage(Unit attacker, Unit defender)
{
    float baseDamage = attacker.AttackDamage;
    float armor = defender.GetArmor(attacker.DamageType);
    float bonus = CounterTable.GetMultiplier(attacker.UnitType, defender.UnitType);

    float finalDamage = Mathf.Max(1f, (baseDamage * bonus) - armor);
    return finalDamage;
}
```

**Bảng khắc chế (counter table)** nên tách riêng thành data (ScriptableObject / JSON) thay vì hard-code, để dễ balance:

```json
{
  "Spearman_vs_Cavalry": 3.0,
  "Cavalry_vs_Archer": 2.0,
  "Archer_vs_Infantry": 1.0
}
```

---

## 6. Điều khiển nhóm & Attack-Move (A-move)

### 6.1. Formation assignment

Khi chọn N lính và ra lệnh di chuyển tới 1 điểm, cần gán mỗi lính vào 1 slot trong đội hình sao cho **tổng quãng đường di chuyển nhỏ nhất** (bài toán gán/assignment). Giải chính xác bằng thuật toán Hungarian là O(N³) — quá nặng cho real-time với N lớn, nên dùng heuristic:

```csharp
void AssignFormationSlots(List<Unit> units, List<Vector2> slots)
{
    // Heuristic đơn giản: mỗi bước chọn cặp (unit, slot) gần nhau nhất còn lại
    var remainingUnits = new List<Unit>(units);
    var remainingSlots = new List<Vector2>(slots);

    while (remainingUnits.Count > 0 && remainingSlots.Count > 0)
    {
        float bestDist = float.MaxValue;
        Unit bestUnit = null;
        Vector2 bestSlot = default;

        foreach (var u in remainingUnits)
        foreach (var s in remainingSlots)
        {
            float d = Vector2.Distance(u.Position, s);
            if (d < bestDist) { bestDist = d; bestUnit = u; bestSlot = s; }
        }

        bestUnit.Destination = bestSlot;
        remainingUnits.Remove(bestUnit);
        remainingSlots.Remove(bestSlot);
    }
}
```

> O(N²) mỗi lần ra lệnh (không phải mỗi tick) nên chấp nhận được với N ~ vài chục lính. Nếu cần scale lớn hơn, cân nhắc thuật toán auction algorithm cho assignment problem.

### 6.2. Attack-move (A-move)

```csharp
void CommandAttackMove(List<Unit> units, Vector2 destination)
{
    foreach (var u in units)
    {
        u.Destination = destination;
        u.SavedDestination = destination;
        u.State = UnitState.MovingToPoint;
        u.IsPlayerOrdered = true; // cho phép rời xa origin để đuổi theo địch trên đường
    }
}
```

Logic này đã được xử lý ở nhánh `MovingToPoint` trong state machine ở mục 2.3: lính sẽ tự rẽ sang đánh nếu gặp địch trên đường, rồi tự quay lại đường cũ sau khi diệt/mất mục tiêu.

---

## 7. Checklist các lỗi thường gặp khi tự implement

- [ ] Lính "rung" qua lại liên tục giữa Attacking và MovingToAttack khi đứng đúng ranh giới `AttackRange` → thêm hysteresis (vd chỉ chuyển state khi khoảng cách chênh > 5% range).
- [ ] Không có leash range → lính bị dụ chạy xuyên bản đồ vào ổ phục kích.
- [ ] Rebuild spatial grid mỗi frame thay vì mỗi tick cố định → tốn CPU không cần thiết.
- [ ] Damage áp dụng ngay khi bắt đầu animation thay vì đúng impact frame → cảm giác đánh "giả", dễ bị exploit (kite bằng cách hủy lệnh ngay sau khi ra lệnh đánh).
- [ ] Không tách "lệnh người chơi" khỏi "hành vi tự động" bằng một flag riêng (`IsPlayerOrdered`) → khó debug khi AI và lệnh thủ công đá nhau.
- [ ] Formation assignment tính lại mỗi tick thay vì chỉ khi ra lệnh mới.

---

## 8. Gợi ý hướng cải thiện tiếp theo

1. **Behavior Tree hoá** thay vì if/else thuần: dễ mở rộng hành vi phức tạp hơn (kỵ binh rút lui khi máu thấp, lính bắn cung tự lùi khi bị cận chiến áp sát – gọi là "kiting").
2. **Influence map**: xây thêm bản đồ ảnh hưởng để lính "cảm nhận" mật độ quân địch xung quanh, tránh việc từng lính đơn lẻ ham đuổi lẻ vào giữa đội hình địch.
3. **Predictive targeting**: với đơn vị tầm xa, tính điểm rơi dự đoán dựa trên vận tốc mục tiêu thay vì bắn thẳng vào vị trí hiện tại.
4. **Local avoidance** (ORCA / RVO2) để lính không dồn cục khi di chuyển theo nhóm đông.

---

*Tài liệu mang tính tham khảo, viết theo style pseudocode C#-like — bạn có thể chuyển sang ngôn ngữ/engine bất kỳ. Phần nào cần đào sâu thêm (pathfinding A*, influence map, ORCA...) thì tách thành tài liệu riêng.*
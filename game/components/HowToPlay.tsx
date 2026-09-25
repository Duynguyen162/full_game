"use client";
import { useEffect, useState } from "react";
import {
  BIG_ARMY, BRIDGE_CREW_CAP, CAP_ENEMY_T, CAP_NEUTRAL_T, CROWD_LIMIT, MAX_BUILT_BRIDGES, MELEE_CAP, PRESTIGE_WIN, SPEED_SWIM, SURRENDER_FRAC, TIME_LIMIT,
} from "@game/shared";

const TABS = ["Mục tiêu", "Uy thế", "Ra lệnh", "Giao tranh", "Rút & Truy kích", "Mẹo"] as const;
type Tab = (typeof TABS)[number];

export function HowToPlay({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("Mục tiêu");
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onClick={onClose}>
      <div className="ts-paper flex max-h-[88vh] w-[720px] max-w-full flex-col text-[var(--ink)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <div className="ts-title text-xl">Hướng dẫn chơi</div>
          <button className="ts-btn !min-h-[36px] text-xs" onClick={onClose}>Đóng</button>
        </div>
        <div className="mb-2 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button key={t} className="ts-btn !min-h-[36px] text-xs" data-on={tab === t} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        <div className="overflow-y-auto pr-1 text-[13px] leading-relaxed">
          {tab === "Mục tiêu" && (
            <>
              <P>Mỗi phe có <b>4.800 quân</b> (Kiếm sĩ, Cung thủ, Thương kỵ, Tu sĩ) và <b>5 Trinh sát</b>. Không có tiếp viện — quân và máu mất là mất hẳn. Thắng bằng <b>vị trí và chiến thuật</b>, không phải bằng số quân.</P>
              <H>Bốn cách chiến thắng</H>
              <Ul>
                <li><b>Uy thế đạt {PRESTIGE_WIN}</b> — con đường chính (xem tab Uy thế).</li>
                <li><b>Phá Thành địch</b> — thắng ngay lập tức.</li>
                <li><b>Địch đầu hàng</b> — quân chiến đấu của địch còn dưới {Math.round(SURRENDER_FRAC * 100)}%.</li>
                <li><b>Hết {TIME_LIMIT / 60} phút</b> — ai nhiều Uy thế hơn thắng (bằng nhau thì so tổng máu quân).</li>
              </Ul>
              <H>Bốn vành đai trên bản đồ (mỗi bên)</H>
              <Ul>
                <li><b>④ Sông</b>: 3 cầu + 2 bãi cạn = <b>5 cứ điểm</b> ◆, cách đều hai phe.</li>
                <li><b>③ Bờ sông</b>: cao nguyên khống chế khoảng đất trước đầu cầu, rừng để tập kết.</li>
                <li><b>② Nội địa</b>: 6 cao nguyên có <b>Cờ hiệu</b> ⚑ trên đỉnh.</li>
                <li><b>① Hậu phương</b>: Thành, Tháp canh, Trại lính, Trường bắn, Tu viện.</li>
              </Ul>
            </>
          )}
          {tab === "Uy thế" && (
            <>
              <H>Chiếm mục tiêu</H>
              <Ul>
                <li>Đứng trong vòng tròn mục tiêu mà <b>không có quân địch</b> → chiếm sau {CAP_NEUTRAL_T}s (trung lập) hoặc {CAP_ENEMY_T}s (đang của địch).</li>
                <li>Cả hai phe cùng có quân → <b>tranh chấp</b> ⚔, tiến độ đứng yên.</li>
                <li><b>Số quân không làm chiếm nhanh hơn</b> — 50 kỵ binh chiếm nhanh như 3.000 lính.</li>
                <li>Cờ cao nguyên: phải đứng <b>trên đỉnh</b> (tầng cao nhất) mới được tính.</li>
                <li>Trinh sát không chiếm được mục tiêu.</li>
                <li>Phe <b>ít quân hơn</b> chiếm nhanh gấp 1,5 lần.</li>
              </Ul>
              <H>Nguồn Uy thế</H>
              <Ul>
                <li><b>Cứ điểm sông</b>: mỗi giây, phe giữ nhiều hơn nhận (số của mình − số của địch). Giữ 3–2 = +1/s, 5–0 = +5/s.</li>
                <li><b>Cờ trên đất địch</b>: +1/s mỗi cờ. Cờ nhà của mình không cho điểm — chỉ cho tầm nhìn 20 ô.</li>
                <li><b>Phá công trình địch</b>: Tu viện / Trường bắn / Trại lính +40, Tháp +25, Nhà +10.</li>
                <li><b>Truy sát</b>: +1 cho mỗi 20 lính địch hạ được khi chúng đang rút lui.</li>
              </Ul>
              <H>Công trình có tác dụng</H>
              <Ul>
                <li>Tu viện: Tu sĩ hồi máu +25% · Trường bắn: Cung thủ +10% sát thương · Trại lính: Kiếm sĩ & Thương kỵ bền hơn 10%.</li>
                <li>Tháp canh tự bắn quân địch trong 8 ô.</li>
              </Ul>
            </>
          )}
          {tab === "Ra lệnh" && (
            <>
              <Ul>
                <li><b>Kéo chuột trái</b>: chọn quân · <b>1–5</b>: chọn theo binh chủng · <b>Q</b>: cả đạo quân · <b>Esc</b>: bỏ chọn.</li>
                <li><b>Chuột phải = Hành quân</b>: đi tới đích, <b>bỏ qua địch</b> trên đường. Dùng để rút lui hoặc cơ động.</li>
                <li><b>F rồi chuột phải</b> (hoặc <b>Alt + chuột phải</b>) = <b>Tấn công</b>: đánh mọi địch gặp trên đường; quanh điểm bấm là <b>vùng chiến đấu 12 ô</b> — lính tự chọn chỗ đánh, không dàn trận, đánh xong đứng tại chỗ.</li>
                <li><b>Tiếp viện tự động</b>: quân ta bị đánh ở đâu thì lính đang rảnh trong khoảng ~10 ô quanh đó tự lao vào giúp (trừ quân đang Giữ vị trí hoặc đang có lệnh khác). Hết giao chiến 6 giây thì thôi.</li>
                <li>Tới nơi, quân tự xếp đội hình <b>quay mặt về hướng tiến quân</b>, mặt trận rộng gấp ~2 chiều sâu, lính đi đầu đứng hàng đầu.</li>
                <li><b>H</b> = Giữ vị trí: đứng yên, chỉ nhận 60% sát thương.</li>
                <li><b>T</b> = đổi tư thế <b>Phòng thủ</b> (chỉ đánh địch trong vùng 8 ô quanh chỗ đứng, hoặc kẻ đang đánh mình; đuổi quá 8 ô thì tự quay về) ⇄ <b>Truy kích</b> (đuổi tới cùng).</li>
                <li><b>G</b> = Quay đầu phản công (xem tab Rút & Truy kích).</li>
                <li><b>WASD / kéo chuột phải / chuột giữa</b>: di chuyển camera · <b>lăn chuột</b>: phóng to.</li>
              </Ul>
            </>
          )}
          {tab === "Giao tranh" && (
            <>
              <P>Đông quân chưa chắc thắng. Dồn cả đạo quân thành một cục có cái giá phải trả:</P>
              <Ul>
                <li><b>Giới hạn vây đánh</b>: mỗi lính chỉ bị tối đa {MELEE_CAP} lính cận chiến đánh cùng lúc. Quân thừa phía sau phải đứng chờ.</li>
                <li><b>Chen chúc</b>: một ô 4×4 có trên {CROWD_LIMIT} lính cùng phe → đi chậm 30%, đánh cận chiến yếu 20%, dính tên nhiều hơn 30%.</li>
                <li><b>Mưa tên</b>: tên rơi vào chỗ đông địch thì trúng thêm một lính bên cạnh (50% sát thương). Cung thủ là khắc tinh của khối dày.</li>
                <li><b>Kỵ binh xung phong</b>: Thương kỵ đâm vào khối đang Chen chúc được ×1,5 đòn đầu.</li>
                <li><b>Lội sông</b>: lính đang đứng trên bãi cạn nhận thêm 25% sát thương.</li>
                <li><b>Bụi mù</b>: đạo quân trên {BIG_ARMY} quân tụ một chỗ bị địch biết vị trí gần đúng, kể cả trong sương mù. Máy sẽ tụ quân chờ sẵn, hoặc né rồi đánh vào chỗ bạn bỏ trống.</li>
              </Ul>
              <H>Địa hình & trạng thái</H>
              <Ul>
                <li><b>Cao nguyên</b>: cung thủ đứng cao hơn mục tiêu được +2 ô tầm bắn và ×1,3 sát thương; tầm nhìn +3 ô.</li>
                <li><b>Bao vây</b>: bị kẹp hai phía bởi quân đông hơn 1,5 lần → gây −30%, nhận +20% sát thương. Lính bị bao vây và máu thấp có thể <b>Cuồng chiến</b> (×2 sát thương).</li>
                <li><b>Rừng</b>: quân trong rừng bị ẩn với địch; đánh từ rừng khi chưa bị phát hiện thì đòn đầu ×1,5; nghỉ 8 giây trong rừng hồi 1% máu/giây.</li>
                <li><b>Giữ vị trí</b> (H): chỉ nhận 60% sát thương — rất mạnh khi chặn cầu.</li>
              </Ul>
              <H>Vượt sông bất ngờ</H>
              <Ul>
                <li><b>Bơi qua sông</b> (V rồi chuột phải vào bờ bên kia): đi thẳng qua nước sâu nhưng chỉ {SPEED_SWIM}x tốc độ, <b>không đánh được</b> khi đang bơi và nhận thêm 50% sát thương. Hợp để đánh úp nhóm nhỏ, không nên đưa cả đạo quân.</li>
                <li><b>Bắc cầu</b> (B rồi chuột phải vào lòng sông): quân nào cũng làm thợ được, tối đa {BRIDGE_CREW_CAP} thợ cùng lát. Mỗi phe có tối đa <b>{MAX_BUILT_BRIDGES} cầu tự xây</b>; cầu bị phá thì được xây lại.</li>
                <li>Cầu tự xây có máu, địch tới gần sẽ tự phá. Cầu sập thì lính trên cầu rơi xuống nước và phải bơi vào bờ. Quân địch cũng đi qua cầu của bạn được.</li>
                <li>Cầu phụ và quân bơi <b>không</b> tính là đầu cầu: cờ nội địa vẫn chỉ cho điểm khi giữ 5 chỗ vượt sông gốc. Dùng để đánh vòng sau lưng, cắt đầu cầu địch, phá công trình, cướp kho lương.</li>
              </Ul>
            </>
          )}
          {tab === "Rút & Truy kích" && (
            <>
              <H>Truy kích có lời…</H>
              <Ul>
                <li>Đánh quân đang <b>Hành quân rút</b>: ×1,5 sát thương và chúng không đánh trả. <b>Thương kỵ ×2</b>.</li>
                <li>Mỗi 20 lính địch hạ khi chúng đang rút = +1 Uy thế.</li>
                <li>Không đuổi thì địch vào rừng hồi máu (1%/giây khi nghỉ 8 giây).</li>
              </Ul>
              <H>…nhưng có rủi ro</H>
              <Ul>
                <li>Đuổi liên tục quá 6 giây (hoặc cách điểm neo quá 12 ô) → <b>Rối loạn</b>: nhận +25% sát thương, mất giảm sát thương của Giữ vị trí. Đứng yên 4 giây để hết.</li>
                <li>Mục tiêu chạy vào rừng sẽ biến mất khỏi tầm nhìn — quân đuổi đứng ở bìa rừng rất dễ bị phục kích.</li>
                <li>Đuổi xa thì cứ điểm bị bỏ trống.</li>
              </Ul>
              <H>Rút lui giả & phục kích</H>
              <Ul>
                <li>Rút (chuột phải) ít nhất <b>3 giây</b> rồi bấm <b>G</b> → +30% sát thương trong 5 giây. Gặp quân đuổi đang Rối loạn thì cộng dồn.</li>
                <li>Đánh từ trong rừng khi địch chưa nhìn thấy: đòn đầu ×1,5.</li>
                <li>Bao vây: địch bị kẹp hai phía gây −30% và nhận +20% sát thương.</li>
              </Ul>
            </>
          )}
          {tab === "Mẹo" && (
            <Ul>
              <li>Cả hai phe mất ~2,5 phút mới chạm nhau ở sông. Gửi <b>Thương kỵ</b> (nhanh nhất) đi chiếm bãi cạn trước.</li>
              <li>Đừng dồn cả đạo quân vào một cầu — cầu bắc và cầu nam cách nhau ~5,5 phút đi bộ.</li>
              <li>Thua trên sông? Vượt bãi cạn cắm cờ trong nội địa địch (+1/s mỗi cờ) để buộc địch chia quân.</li>
              <li>Bắc cầu phụ ở đoạn sông không ai canh để đưa quân ra sau lưng đội đang giữ cầu của địch — rồi phá cầu đó trước khi địch dùng lại.</li>
              <li>Chiếm cao nguyên đầu cầu cho Cung thủ: +2 ô tầm bắn, +3 ô tầm nhìn.</li>
              <li>Dùng Trinh sát soi rừng trước khi cho quân đi qua. Trinh sát đứng 5 giây trên đỉnh cờ địch sẽ làm mù tầm nhìn của cờ đó 60 giây.</li>
              <li>Chỉ bật Truy kích cho Thương kỵ — nhanh nhất nên dễ đuổi kịp và rút về.</li>
              <li>Chia quân thành nhiều khối vừa phải, đánh từ nhiều hướng — tránh Chen chúc và tận dụng Bao vây.</li>
              <li>Giữ cung thủ phía sau bộ binh; dùng Thương kỵ đánh sườn các khối địch đang dồn dày.</li>
              <li>Máy biết rút lui giả, quay đầu khi bạn đuổi bị Rối loạn, và tụ toàn quân khi thấy bạn dồn cục — cẩn thận!</li>
            </Ul>
          )}
        </div>
      </div>
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <div className="ts-title mb-1 mt-2 text-base">{children}</div>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-2">{children}</p>;
}
function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>;
}

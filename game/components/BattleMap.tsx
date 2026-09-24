"use client";
import { io } from "socket.io-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Assets } from "@/lib/game/assets";
import { UNIT_VI, colorPaths, staticPaths } from "@game/shared";
import { COLORS, COLOR_HEX, COLOR_VI, FORD, MH, MW, SPEED_FORD, T, WATER, WORLD_H, WORLD_W, type TeamColor } from "@game/shared";
import { generateMap, passable } from "@game/shared";
import { Renderer, type Camera, type ViewOptions } from "@/lib/game/renderer";
import { World, AICommander, MOVE_ATTACK, MOVE_MARCH, OBJ_FLAG, OBJ_RIVER, PRESTIGE_WIN, STANCE_DEFEND, STANCE_PURSUE, TIME_LIMIT, type GameEvent, type WinReason } from "@game/shared";
import { HowToPlay } from "./HowToPlay";
import { Deployment } from "./Deployment";
import type { GameMap } from "@game/shared";

const UI = "/assets/UI%20Elements/UI%20Elements";
const TICK = 0.1;
const AVATAR_TYPE = [2, 3, 6, 4, 7];

// Mở kết nối
const socket = io(process.env.NEXT_PUBLIC_GAME_SERVER_URL!);
// Lắng nghe sự kiện tick
socket.on("tick", (serverTick) => {
   // Xử lý chạy step game ở đây
});
interface Stats {
  alive: [number, number];
  types: [number[], number[]];
  kills: [number, number];
  res: World["res"];
  sel: number[];
  winner: number;
  started: boolean;
  prestige: [number, number];
  river: [number, number];
  flags: [number, number];     // số cờ nội địa địch đang cắm
  timeLeft: number;
  winReason: WinReason | null;
  events: GameEvent[];
  time: number;
  stance: [number, number, number]; // phòng thủ / truy kích / giữ vị trí của quân đang chọn
  ai: string[];
}

type Mode = "ai" | "pvp";
const PLAYER = 0; // chế độ đánh với máy: người chơi luôn là phe Tây

interface Hover {
  x: number;
  y: number;
  label: string;
  speed: string;
  level: number;
  zone: number;
}

function describeTile(w: World, i: number): Hover {
  const m = w.m;
  const x = i % MW, y = Math.floor(i / MW);
  let label = "Đồng cỏ";
  let speed = "1.0x";
  if (m.ground[i] === WATER) { label = "Nước sâu — không thể đi"; speed = "—"; }
  else if (m.ground[i] === FORD) { label = "Bãi cạn"; speed = `${SPEED_FORD}x`; }
  else if (m.ground[i] === 3) label = "Cầu gỗ (điểm nghẽn)";
  else if (m.block[i]) { label = "Công trình"; speed = "—"; }
  else if (m.cliff[i]) { label = "Vách đá — không thể leo"; speed = "—"; }
  else if (m.ramp[i]) label = `Dốc lên tầng ${m.level[i] + 1}`;
  else if (m.forest[i]) label = "Rừng phục kích (tàng hình)";
  else if (m.level[i]) label = `Cao nguyên tầng ${m.level[i]}`;
  if (!passable(m, i)) speed = "—";
  return { x, y, label, speed, level: m.level[i], zone: m.forest[i] };
}

function clampCam(cam: Camera, vw: number, vh: number) {
  const minZoom = Math.max(vw / WORLD_W, vh / WORLD_H);
  cam.zoom = Math.max(minZoom, Math.min(1.6, cam.zoom));
  const hw = vw / 2 / cam.zoom, hh = vh / 2 / cam.zoom;
  cam.x = Math.max(hw, Math.min(WORLD_W - hw, cam.x));
  cam.y = Math.max(hh, Math.min(WORLD_H - hh, cam.y));
}

function drawMinimap(c: HTMLCanvasElement | null, cam: Camera, opt: ViewOptions, w: World, r: Renderer, vw: number, vh: number) {
  if (!c) return;
  const g = c.getContext("2d")!;
  const S = c.width;
  g.imageSmoothingEnabled = false;
  g.drawImage(r.minimap, 0, 0, S, S);
  // Sương mù: phủ trước khi vẽ quân/công trình để chấm quân ta vẫn nổi rõ
  const fog = r.minimapFog(w, opt.viewer);
  if (fog) {
    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(fog, 0, 0, S, S);
    g.restore();
  }
  const k = S / WORLD_W;
  for (let s = 0; s < 2; s++) {
    g.fillStyle = COLOR_HEX[opt.colors[s]];
    for (let i = s; i < w.n; i += 6) {
      if (!w.alive[i] || w.side[i] !== s) continue;
      // Kiểm tra sương mù: ẩn quân địch ở ô chưa có tầm nhìn
      if (opt.viewer >= 0 && s !== opt.viewer) {
        const vc = w.visCount[opt.viewer as 0 | 1];
        if (vc[w.tile[i]] === 0) continue; // ẩn quân địch trong sương mù
      }
      // Kiểm tra rừng cây (cơ chế cũ)
      if (opt.viewer >= 0 && s !== opt.viewer && w.m.forest[w.tile[i]] && !w.presence[opt.viewer][w.m.forest[w.tile[i]]]) continue;
      g.fillRect(w.x[i] * k, w.y[i] * k, 1.5, 1.5);
    }
  }
  for (const b of w.m.buildings) {
    if (b.hp <= 0) continue;
    g.fillStyle = COLOR_HEX[opt.colors[b.side]];
    g.strokeStyle = "#1b1b1b";
    g.fillRect(b.tx * T * k - 1, b.ty * T * k - 1, b.fw * T * k + 2, b.fh * T * k + 2);
  }
  // Mục tiêu: màu theo chủ sở hữu mà người xem biết (cập nhật khi có tầm nhìn)
  const kt = S / MW;
  for (const o of w.obj) {
    const owner = opt.objKnown ? opt.objKnown[o.id] : w.objOwner[o.id];
    const x = (o.tx + 0.5) * kt, y = (o.ty + 0.5) * kt, r = o.kind === OBJ_RIVER ? 5 : 4;
    g.fillStyle = owner >= 0 ? COLOR_HEX[opt.colors[owner]] : "#f3e9c6";
    g.strokeStyle = "#1b1b1b";
    g.lineWidth = 1.2;
    g.beginPath();
    if (o.kind === OBJ_RIVER) { g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); }
    else { g.moveTo(x - r * 0.6, y + r); g.lineTo(x - r * 0.6, y - r); g.lineTo(x + r, y - r * 0.4); g.lineTo(x - r * 0.6, y + r * 0.1); }
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.strokeStyle = "#fff6c8";
  g.lineWidth = 1.5;
  g.strokeRect((cam.x - vw / 2 / cam.zoom) * k, (cam.y - vh / 2 / cam.zoom) * k, (vw / cam.zoom) * k, (vh / cam.zoom) * k);
}

export default function BattleMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const assetsRef = useRef<Assets | null>(null);
  const worldRef = useRef<World | null>(null);
  const rendRef = useRef<Renderer | null>(null);
  const camRef = useRef<Camera>({ x: 90 * T, y: 256 * T, zoom: 0.7 });
  const optRef = useRef<ViewOptions>({ viewer: 0, colors: ["Blue", "Red"], showClouds: true, showNav: false });
  const speedRef = useRef(1);
  const hoverRef = useRef(-1);
  const boxRef = useRef<[number, number, number, number] | null>(null);
  const keys = useRef(new Set<string>());
  const modeRef = useRef<Mode | null>(null);
  const aiRef = useRef<AICommander | null>(null);
  const mapRef = useRef<GameMap | null>(null);
  const armedRef = useRef(false);          // F: lệnh chuột phải kế tiếp là Tấn công
  const knownRef = useRef<Int8Array | null>(null); // chủ sở hữu mục tiêu phe mình biết

  const [seed, setSeed] = useState(12345);
  const [loading, setLoading] = useState<{ label: string; pct: number } | null>({ label: "Đang tải tài nguyên…", pct: 0 });
  const [viewer, setViewer] = useState(0);
  const [colors, setColors] = useState<[TeamColor, TeamColor]>(["Blue", "Red"]);
  const [showClouds, setShowClouds] = useState(true);
  const [showNav, setShowNav] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [stats, setStats] = useState<Stats | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [zoomPct, setZoomPct] = useState(70);
  const [showTopUI, setShowTopUI] = useState(true);
  const [showLeftUI, setShowLeftUI] = useState(true);
  const [showRightUI, setShowRightUI] = useState(true);
  const [showMinimap, setShowMinimap] = useState(true);
  const [focusType, setFocusType] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState<number>(0);
  const [mode, setMode] = useState<Mode | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [armed, setArmed] = useState(false);
  const [hideVictory, setHideVictory] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [focusGroupId, setFocusGroupId] = useState(-1);
  const cycleGroupRef = useRef<() => void>(() => {});
  const setArmedBoth = useCallback((v: boolean) => { armedRef.current = v; setArmed(v); }, []);

  const handleStartDeployment = useCallback((layout: { type: number, px: number, py: number }[]) => {
    if (!mapRef.current) return;
    const world = new World(mapRef.current, layout);
    worldRef.current = world;
    knownRef.current = Int8Array.from(world.obj.map((o) => (o.kind === OBJ_FLAG ? o.home : -1)));
    optRef.current = { ...optRef.current, objKnown: optRef.current.viewer === PLAYER ? knownRef.current : null };
    
    modeRef.current = "ai";
    setMode("ai");
    setViewer(PLAYER);
    aiRef.current = new AICommander(world, 1);
    setIsDeploying(false);
  }, []);

  const cycleGroup = useCallback(() => {
    const w = worldRef.current;
    if (!w) return;
    const side = modeRef.current === "ai" || viewer !== 1 ? PLAYER : 1;
    let maxId = -1;
    for (let i = 0; i < w.n; i++) {
        if (w.side[i] === side && w.armyGroupId[i] > maxId) maxId = w.armyGroupId[i];
    }
    if (maxId === -1) return;
    
    let nextId = focusGroupId + 1;
    if (nextId > maxId) nextId = 0;
    setFocusGroupId(nextId);
    
    let cx = 0, cy = 0, count = 0;
    w.sel.fill(0);
    for (let i = 0; i < w.n; i++) {
       if (w.side[i] === side && w.armyGroupId[i] === nextId && w.alive[i]) {
           w.sel[i] = 1;
           cx += w.x[i];
           cy += w.y[i];
           count++;
       }
    }
    if (count > 0) {
        camRef.current.targetX = cx / count;
        camRef.current.targetY = cy / count;
    }
  }, [focusGroupId, viewer]);
  
  useEffect(() => {
    cycleGroupRef.current = cycleGroup;
  }, [cycleGroup]);

  const handleFocus = useCallback((type: number) => {
    const w = worldRef.current;
    if (!w) return;
    const side = modeRef.current === "ai" || viewer !== 1 ? PLAYER : 1;
    const clusters = w.getClusters(type, side);
    if (clusters.length === 0) return;
    
    let idx = 0;
    if (focusType === type) {
      idx = (focusIdx + 1) % clusters.length;
    }
    setFocusType(type);
    setFocusIdx(idx);
    
    const c = clusters[idx];
    camRef.current.targetX = c.x;
    camRef.current.targetY = c.y;
  }, [focusType, focusIdx, viewer]);

  useEffect(() => {
    optRef.current = { viewer, colors, showClouds, showNav, objKnown: viewer === PLAYER ? knownRef.current : null };
  }, [viewer, colors, showClouds, showNav]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // ---- load assets + build map
  useEffect(() => {
    let cancelled = false;
    const assets = assetsRef.current ?? new Assets();
    assetsRef.current = assets;
    (async () => {
      const paths = [...staticPaths(), ...colorPaths(optRef.current.colors[0]), ...colorPaths(optRef.current.colors[1])];
      await assets.load(paths, (d, n) => !cancelled && setLoading({ label: "Đang tải tài nguyên Tiny Swords…", pct: (d / n) * 0.5 }));
      if (cancelled) return;
      setLoading({ label: "Đang sinh bản đồ 512×512…", pct: 0.5 });
      await new Promise((r) => setTimeout(r, 30));
      const map = generateMap(seed);
      mapRef.current = map;
      const world = new World(map);
      rendRef.current?.dispose();
      const rend = new Renderer(map, assets);
      // bake far terrain chunks in slices so the progress bar can update
      const total = 64;
      for (let k = 0; k < total; k += 4) {
        if (cancelled) return;
        for (let j = k; j < k + 4; j++) rend.buildFarChunk(j);
        setLoading({ label: "Đang dựng địa hình…", pct: 0.55 + (k / total) * 0.45 });
        await new Promise((r) => setTimeout(r, 0));
      }
      const h = window.location.hash.slice(1).split(",").map(Number);
      if (h.length === 3 && h.every((v) => Number.isFinite(v))) camRef.current = { x: h[0] * T, y: h[1] * T, zoom: h[2] };
      worldRef.current = world;
      rendRef.current = rend;
      // Người chơi biết chủ cờ nhà của hai bên từ đầu; cứ điểm sông ban đầu trung lập
      knownRef.current = Int8Array.from(world.obj.map((o) => (o.kind === OBJ_FLAG ? o.home : -1)));
      optRef.current = { ...optRef.current, objKnown: optRef.current.viewer === PLAYER ? knownRef.current : null };
      aiRef.current = null;
      setHideVictory(false);
      setLoading(null);
    })();
    return () => { cancelled = true; };
  }, [seed]);

  // ---- change team colours (lazy-load the colour's sprites)
  const pickColor = useCallback(async (side: 0 | 1, c: TeamColor) => {
    const other = colors[1 - side];
    if (c === other) return;
    await assetsRef.current?.load(colorPaths(c));
    setColors((prev) => (side === 0 ? [c, prev[1]] : [prev[0], c]));
  }, [colors]);

  // ---- main loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d", { alpha: false })!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let statT = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const w = worldRef.current, r = rendRef.current;
      const dpr = window.devicePixelRatio || 1;
      const vw = canvas.clientWidth, vh = canvas.clientHeight;
      if (canvas.width !== Math.round(vw * dpr) || canvas.height !== Math.round(vh * dpr)) {
        canvas.width = Math.round(vw * dpr);
        canvas.height = Math.round(vh * dpr);
      }
      if (!w || !r) return;
      // keyboard pan
      const cam = camRef.current;
      const k = keys.current;
      const pan = (600 / cam.zoom) * dt;
      if (k.has("a") || k.has("arrowleft")) cam.x -= pan;
      if (k.has("d") || k.has("arrowright")) cam.x += pan;
      if (k.has("w") || k.has("arrowup")) cam.y -= pan;
      if (k.has("s") || k.has("arrowdown")) cam.y += pan;

      // smooth pan camera to target
      if (cam.targetX !== undefined && cam.targetY !== undefined) {
        cam.x += (cam.targetX - cam.x) * (dt * 15);
        cam.y += (cam.targetY - cam.y) * (dt * 15);
        if (Math.hypot(cam.targetX - cam.x, cam.targetY - cam.y) < 5) {
          cam.targetX = undefined;
          cam.targetY = undefined;
        }
      }

      clampCam(cam, vw, vh);

      // Chỉ chạy mô phỏng khi đã chọn chế độ và trận chưa phân thắng bại
      const running = modeRef.current !== null && w.winner < 0;
      acc = running ? acc + dt * speedRef.current : 0;
      let steps = 0;
      while (acc >= TICK && steps < 3) { aiRef.current?.update(); w.step(TICK); acc -= TICK; steps++; }
      if (steps === 3) acc = 0;

      r.dpr = dpr;
      r.render(ctx, w, cam, vw, vh, optRef.current, w.time + acc, boxRef.current, hoverRef.current, dt);

      drawMinimap(miniRef.current, cam, optRef.current, w, r, vw, vh);
      statT += dt;
      if (statT > 0.25) {
        statT = 0;
        const sel = [0, 0, 0, 0, 0];
        const stance: [number, number, number] = [0, 0, 0];
        for (let i = 0; i < w.n; i++) {
          if (!w.sel[i] || !w.alive[i]) continue;
          sel[w.type[i]]++;
          stance[w.hold[i] ? 2 : w.stance[i] === STANCE_PURSUE ? 1 : 0]++;
        }
        // Cập nhật hiểu biết của phe mình về chủ sở hữu mục tiêu (chỉ khi đang có tầm nhìn)
        const known = knownRef.current;
        if (known) for (const o of w.obj) if (w.visCount[PLAYER][o.ty * MW + o.tx] > 0) known[o.id] = w.objOwner[o.id];
        const river: [number, number] = [0, 0], flags: [number, number] = [0, 0];
        for (const o of w.obj) {
          const ow = w.objOwner[o.id];
          if (ow < 0) continue;
          if (o.kind === OBJ_RIVER) river[ow]++;
          else if (ow !== o.home) flags[ow]++;
        }
        setStats({
          alive: [...w.aliveCount] as [number, number],
          types: [[...w.typeCount[0]], [...w.typeCount[1]]],
          kills: [...w.kills] as [number, number],
          res: [{ ...w.res[0] }, { ...w.res[1] }],
          sel,
          winner: w.winner,
          started: w.started,
          prestige: [w.prestige[0], w.prestige[1]],
          river,
          flags,
          timeLeft: Math.max(0, TIME_LIMIT - w.time),
          winReason: w.winReason,
          events: [...w.events],
          time: w.time,
          stance,
          ai: aiRef.current && optRef.current.viewer !== PLAYER ? [...aiRef.current.status(), "—", ...aiRef.current.log.slice(-5)] : [],
        });
        setZoomPct(Math.round(cam.zoom * 100));
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- input
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      keys.current.add(e.key.toLowerCase());
      const w = worldRef.current;
      if (!w) return;
      const side = modeRef.current === "ai" ? PLAYER : optRef.current.viewer;
      const key = e.key.toLowerCase();
      if (e.key >= "1" && e.key <= "5") w.selectType(+e.key - 1, side);
      if (key === "q") w.selectType(-1, side);
      if (e.key === "Escape") { w.sel.fill(0); setArmedBoth(false); }
      if (key === "h") w.orderHold(w.selected());
      if (key === "f") setArmedBoth(!armedRef.current);
      if (key === "t") toggleStance(w);
      if (key === "g") w.orderRally(w.selected());
      if (key === "tab") {
        e.preventDefault();
        cycleGroupRef.current?.();
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    // T: đổi tư thế cả nhóm — đa số đang Phòng thủ thì chuyển Truy kích, ngược lại về Phòng thủ
    const toggleStance = (w: World) => {
      const sel = w.selected();
      const pursue = sel.filter((i) => w.stance[i] === STANCE_PURSUE).length;
      w.orderStance(sel, pursue * 2 < sel.length ? STANCE_PURSUE : STANCE_DEFEND);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [setArmedBoth]);

  const drag = useRef<{ mode: "select" | "pan" | "right"; sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null);
  const toWorld = (sx: number, sy: number) => {
    const c = canvasRef.current!;
    const cam = camRef.current;
    return [cam.x + (sx - c.clientWidth / 2) / cam.zoom, cam.y + (sy - c.clientHeight / 2) / cam.zoom];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const panMode = e.button === 1 || e.pointerType === "touch" || keys.current.has(" ");
    drag.current = { mode: panMode ? "pan" : e.button === 2 ? "right" : "select", sx, sy, cx: camRef.current.x, cy: camRef.current.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const w = worldRef.current;
    const [wx, wy] = toWorld(sx, sy);
    const tx = Math.floor(wx / T), ty = Math.floor(wy / T);
    if (w && tx >= 0 && ty >= 0 && tx < MW && ty < MH) {
      const i = ty * MW + tx;
      if (i !== hoverRef.current) { hoverRef.current = i; setHover(describeTile(w, i)); }
    }
    const d = drag.current;
    if (!d) return;
    if (Math.hypot(sx - d.sx, sy - d.sy) > 5) d.moved = true;
    const cam = camRef.current;
    if (d.mode === "pan" || (d.mode === "right" && d.moved)) {
      d.mode = d.mode === "right" ? "pan" : d.mode;
      cam.x = d.cx - (sx - d.sx) / cam.zoom;
      cam.y = d.cy - (sy - d.sy) / cam.zoom;
    } else if (d.mode === "select" && d.moved) {
      boxRef.current = [d.sx, d.sy, sx, sy];
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    boxRef.current = null;
    const w = worldRef.current;
    if (!d || !w) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const side = modeRef.current === "ai" ? PLAYER : optRef.current.viewer;
    if (d.mode === "select") {
      const [ax, ay] = toWorld(d.sx, d.sy);
      const [bx, by] = toWorld(sx, sy);
      const pad = d.moved ? 0 : 18 / Math.max(0.3, camRef.current.zoom);
      w.selectRect(ax - pad, ay - pad, bx + pad, by + pad, side, e.shiftKey);
    } else if (d.mode === "right") {
      const [wx, wy] = toWorld(sx, sy);
      const sel = w.selected();
      if (sel.length) {
        // Chuột phải = Hành quân (bỏ qua địch, dùng để rút); F rồi chuột phải / Alt + chuột phải = Tấn công
        const attack = armedRef.current || e.altKey;
        w.orderMove(sel, Math.floor(wx / T), Math.floor(wy / T), attack ? MOVE_ATTACK : MOVE_MARCH);
        w.addFx(0, wx, wy, 0); // 0 = FX_DUST
        if (armedRef.current) setArmedBoth(false);
      }
    }
  };
  useEffect(() => {
    const c = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const cam = camRef.current;
      const before = [cam.x + (sx - c.clientWidth / 2) / cam.zoom, cam.y + (sy - c.clientHeight / 2) / cam.zoom];
      cam.zoom *= Math.exp(-e.deltaY * 0.0015);
      clampCam(cam, c.clientWidth, c.clientHeight);
      cam.x = before[0] - (sx - c.clientWidth / 2) / cam.zoom;
      cam.y = before[1] - (sy - c.clientHeight / 2) / cam.zoom;
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, []);

  const miniNav = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === "pointermove" && e.buttons !== 1) return;
    const rect = e.currentTarget.getBoundingClientRect();
    camRef.current.x = ((e.clientX - rect.left) / rect.width) * WORLD_W;
    camRef.current.y = ((e.clientY - rect.top) / rect.height) * WORLD_H;
  };
  const zoomTo = (z: number) => { camRef.current.zoom = z; };

  const selTotal = stats ? stats.sel.reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="ts-game relative h-screen w-screen select-none overflow-hidden text-[13px]" onContextMenu={(e) => e.preventDefault()}>
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full ${hover && hover.speed === "—" ? "ts-blocked" : selTotal ? "ts-order" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { hoverRef.current = -1; setHover(null); }}
      />

      {/* ---- top: army scoreboard */}
      {showTopUI && (
        <div className="pointer-events-none absolute left-1/2 top-2 flex -translate-x-1/2 flex-col items-center">
          <div className="pointer-events-auto flex items-center justify-between w-full">
            <div className={`ts-ribbon ts-ribbon-${colors[0].toLowerCase()} min-w-[420px] px-2 text-lg ts-title mx-auto`}>ĐẠI CHIẾN 9.600 QUÂN</div>
            <button onClick={() => setShowTopUI(false)} className="ts-btn text-xs px-2 py-0 h-6 -ml-10">Ẩn</button>
          </div>
          <div className="ts-wood -mt-2 flex items-center gap-3 text-[var(--cream)]">
            <Army side={0} color={colors[0]} stats={stats} />
            <div className="flex flex-col items-center">
              <span className="ts-title text-2xl text-[#ffd76a] [text-shadow:0_2px_0_#000]">VS</span>
              <span className="text-[11px] opacity-80">Còn lại</span>
              <span className="ts-title text-base tabular-nums">{fmtTime(stats?.timeLeft ?? TIME_LIMIT)}</span>
            </div>
            <Army side={1} color={colors[1]} stats={stats} />
          </div>
          {stats && stats.events.length > 0 && (
            <div className="mt-1 flex flex-col items-center gap-0.5">
              {stats.events.filter((ev) => stats.time - ev.t < 10).slice(-3).map((ev, k) => (
                <div key={`${ev.t}-${k}`} className="rounded bg-black/55 px-2 py-0.5 text-[12px] font-semibold text-white" style={{ borderLeft: `4px solid ${COLOR_HEX[colors[ev.side]]}` }}>{ev.text}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- left: command panel */}
      {showLeftUI && (
        <div className="ts-wood absolute left-2 top-2 w-[292px] text-[var(--cream)]">
          <div className="ts-title mb-1 text-base flex justify-between items-center">
            <span>Bàn chỉ huy</span>
            <button onClick={() => setShowLeftUI(false)} className="ts-btn text-xs px-2 py-0">Ẩn</button>
          </div>
          <button className="ts-btn mb-2 w-full text-sm" onClick={() => setShowHelp(true)}>
            <img src={`${UI}/Icons/Icon_01.png`} alt="" className="h-6 w-6" /> Hướng dẫn &amp; luật thắng
          </button>
          <Label>{mode === "ai" ? "Góc nhìn (Toàn cảnh = xem AI để thử nghiệm)" : "Góc nhìn (tầm nhìn rừng)"}</Label>
          <div className="mb-2 grid grid-cols-3 gap-1">
            {[[0, "Tây"], [-1, "Toàn cảnh"], [1, "Đông"]].map(([v, l]) => (
              <button key={v} className="ts-btn text-xs" data-on={viewer === v} onClick={() => setViewer(v as number)}>{l}</button>
            ))}
          </div>
          <div className="mb-2">
            <Label>Đơn vị quân đội</Label>
            <div className="grid grid-cols-3 gap-1">
              {[0, 1, 2, 3, 4].map((t) => (
                <button
                  key={t}
                  onClick={() => handleFocus(t)}
                  className={`ts-btn min-w-0 !min-h-[64px] !px-0.5 !py-0.5 flex-col !gap-0 ${focusType === t ? "outline outline-2 outline-[#fff6c8]" : ""}`}
                  style={{ borderWidth: 8, borderImageWidth: "8px" }}
                  title={`${UNIT_VI[t]} — bấm để nhảy tới cụm quân`}
                >
                  <img src={`${UI}/Human%20Avatars/Avatars_0${AVATAR_TYPE[t]}.png`} alt="" className="ts-pixel h-8 w-8 mx-auto" />
                  <span className="block w-full truncate text-center text-[10px] leading-tight">{UNIT_VI[t]}</span>
                  <span className="block text-center text-[10px] leading-tight opacity-80">
                    {(stats?.types[mode === "ai" || viewer !== 1 ? PLAYER : 1][t] ?? 0).toLocaleString("vi-VN")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        <div className="mt-2 grid grid-cols-2 gap-1">
          <button className="ts-btn text-sm col-span-2" onClick={cycleGroup}>
            <img src={`${UI}/Icons/Icon_10.png`} alt="" className="h-6 w-6" /> Chuyển Đạo Quân (Tab)
          </button>
          <button className="ts-btn red text-sm" disabled={!!loading || !mode} title="Toàn quân tấn công thẳng vào Thành địch (bỏ các cứ điểm!)" onClick={() => worldRef.current?.orderCharge([PLAYER])}>
            <img src={`${UI}/Icons/Icon_05.png`} alt="" className="h-6 w-6" /> Xung trận
          </button>
          <button className="ts-btn text-sm" onClick={() => { const w = worldRef.current; if (w) w.orderHold(w.selected()); }}>
            <img src={`${UI}/Icons/Icon_06.png`} alt="" className="h-6 w-6" /> Giữ vị trí
          </button>
          <button className="ts-btn text-sm" data-on={showNav} onClick={() => setShowNav(!showNav)}>
            <img src={`${UI}/Icons/Icon_11.png`} alt="" className="h-6 w-6" /> Lưới NavMesh
          </button>
          <button className="ts-btn text-sm" data-on={showClouds} onClick={() => setShowClouds(!showClouds)}>
            <img src={`${UI}/Icons/Icon_12.png`} alt="" className="h-6 w-6" /> Mây trời
          </button>
          <button className="ts-btn text-sm" data-on={showMinimap} onClick={() => setShowMinimap(!showMinimap)}>
            <img src={`${UI}/Icons/Icon_07.png`} alt="" className="h-6 w-6" /> Bản đồ con
          </button>
          <button className="ts-btn text-sm" onClick={() => { setLoading({ label: "Đang sinh bản đồ mới…", pct: 0.5 }); setSeed((s) => (s * 16807) % 2147483647); }}>
            <img src={`${UI}/Icons/Icon_10.png`} alt="" className="h-6 w-6" /> Bản đồ mới
          </button>
          <div className="col-span-2 grid grid-cols-3 gap-1">
            {[0, 1, 3].map((v) => (
              <button key={v} aria-label={v === 0 ? "Tạm dừng" : `Tốc độ ${v}x`} className="ts-btn !min-h-[48px] min-w-0 text-xs" data-on={speed === v} onClick={() => setSpeed(v)}>{v === 0 ? "II" : `${v}x`}</button>
            ))}
          </div>
        </div>
          <div className="mt-2 text-[11px] leading-snug opacity-80">
            Kéo chuột trái: chọn quân · <b>Chuột phải: Hành quân</b> (bỏ qua địch, dùng để rút) · <b>F rồi chuột phải</b> (hoặc Alt + chuột phải): Tấn công · T: Phòng thủ/Truy kích · G: Quay đầu · H: Giữ vị trí · 1–5: chọn binh chủng · Q: cả đạo quân · WASD / kéo chuột phải: di chuyển camera
          </div>
        </div>
      )}

      {/* ---- right: legend + tile info */}
      {showRightUI && (
        <div className="ts-paper absolute right-2 top-2 w-[250px] text-[var(--ink)]">
          <div className="ts-title mb-1 text-base flex justify-between">
            <span>Địa hình</span>
            <button onClick={() => setShowRightUI(false)} className="ts-btn text-xs px-2 py-0">Ẩn</button>
          </div>
          <Legend color="#a5be50" name="Đồng cỏ" note="1.0x" />
          <Legend color="#2c5c34" name="Rừng phục kích" note="1.0x · tàng hình" />
          <Legend color="#8ccdbe" name="Bãi cạn" note={`${SPEED_FORD}x`} />
          <Legend color="#a86e3c" name="Cầu (3 cầu)" note="1.0x · nút thắt" />
          <Legend color="#47aba9" name="Nước sâu" note="chặn" />
          <Legend color="#556e73" name="Vách đá" note="chặn" />
          <Legend color="#c8be6e" name="Dốc lên cao nguyên" note="lối duy nhất" />
          <Legend color="#96b946" name="Cao nguyên 1–3 tầng" note="+2 tầm cung" />
          <div className="mt-2 min-h-[64px] border-t border-[#3b2416]/30 pt-1.5">
          {hover ? (
            <>
              <div className="font-bold">Ô ({hover.x}, {hover.y})</div>
              <div>{hover.label}</div>
              <div className="opacity-75">Tốc độ: {hover.speed} · Độ cao: {hover.level}{hover.zone ? ` · Rừng #${hover.zone}` : ""}</div>
            </>
          ) : (
            <div className="opacity-60">Rê chuột lên bản đồ để xem thông tin ô.</div>
          )}
        </div>
        <div className="mt-1 text-[11px] opacity-70">Thu phóng: {zoomPct}%</div>
          <div className="mt-1 flex gap-1">
            <button className="ts-btn flex-1 !min-h-[40px] text-xs" onClick={() => zoomTo(0.02)}>Toàn bản đồ</button>
            <button className="ts-btn flex-1 !min-h-[40px] text-xs" onClick={() => zoomTo(0.8)}>Cận cảnh</button>
          </div>
        </div>
      )}

      {!showTopUI && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2">
          <button className="ts-btn text-xs px-2 py-1 bg-white opacity-50 hover:opacity-100" onClick={() => setShowTopUI(true)}>Điểm số</button>
        </div>
      )}
      {!showLeftUI && (
        <div className="absolute left-2 top-2">
          <button className="ts-btn text-xs px-2 py-1 bg-white opacity-50 hover:opacity-100" onClick={() => setShowLeftUI(true)}>Chỉ huy</button>
        </div>
      )}
      {!showRightUI && (
        <div className="absolute right-2 top-2">
          <button className="ts-btn text-xs px-2 py-1 bg-white opacity-50 hover:opacity-100" onClick={() => setShowRightUI(true)}>Địa hình</button>
        </div>
      )}

      {/* ---- bottom-right: minimap */}
      {showMinimap && (
        <div className="ts-banner absolute bottom-2 right-2">
          <canvas ref={miniRef} width={220} height={220} className="block h-[220px] w-[220px] [image-rendering:pixelated]" onPointerDown={miniNav} onPointerMove={miniNav} />
        </div>
      )}

      {/* ---- bottom-center: selection */}
      {selTotal > 0 && stats && (
        <div className="ts-paper absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-3 text-[var(--ink)]">
          <div className="ts-title text-sm">Đã chọn<br /><span className="text-xl">{selTotal.toLocaleString("vi-VN")}</span></div>
          {stats.sel.map((n, t) => n > 0 && (
            <div key={t} className="flex flex-col items-center">
              <img src={`${UI}/Human%20Avatars/Avatars_0${AVATAR_TYPE[t]}.png`} alt="" className="ts-pixel h-12 w-12" />
              <span className="text-[11px] font-bold">{UNIT_VI[t]}</span>
              <span className="text-[11px]">{n.toLocaleString("vi-VN")}</span>
            </div>
          ))}
          <div className="flex flex-col gap-1 border-l border-[#3b2416]/30 pl-3">
            <div className="text-[11px]">
              Tư thế: <b>{stats.stance[2] >= stats.stance[0] && stats.stance[2] >= stats.stance[1] ? "Giữ vị trí" : stats.stance[1] > stats.stance[0] ? "Truy kích" : "Phòng thủ"}</b>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button className="ts-btn red !min-h-[36px] text-[11px]" data-on={armed} onClick={() => setArmedBoth(!armed)}>{armed ? "Chọn đích…" : "Tấn công (F)"}</button>
              <button className="ts-btn !min-h-[36px] text-[11px]" onClick={() => {
                const w = worldRef.current; if (!w) return;
                const sel = w.selected();
                w.orderStance(sel, stats.stance[1] * 2 < sel.length ? STANCE_PURSUE : STANCE_DEFEND);
              }}>{stats.stance[1] * 2 < selTotal ? "Truy kích (T)" : "Phòng thủ (T)"}</button>
              <button className="ts-btn !min-h-[36px] text-[11px]" onClick={() => { const w = worldRef.current; if (w) w.orderRally(w.selected()); }}>Quay đầu (G)</button>
              <button className="ts-btn !min-h-[36px] text-[11px]" onClick={() => { const w = worldRef.current; if (w) w.orderHold(w.selected()); }}>Giữ (H)</button>
            </div>
            <div className="text-[10px] opacity-70">{armed ? "Chuột phải vào đích để tấn công" : "Chuột phải = hành quân (bỏ qua địch)"}</div>
          </div>
        </div>
      )}

      {/* ---- AI debug (chỉ khi xem Toàn cảnh / phe Đông) */}
      {mode === "ai" && stats && stats.ai.length > 0 && (
        <div className="absolute bottom-[240px] right-2 w-[300px] rounded bg-black/70 p-2 text-[11px] leading-snug text-[#f3e9c6]">
          <div className="mb-1 font-bold text-[#ffd76a]">Chỉ huy máy (phe Đông) — chế độ thử nghiệm</div>
          {stats.ai.map((l, k) => <div key={k}>{l}</div>)}
        </div>
      )}

      {/* ---- victory */}
      {stats && stats.winner >= 0 && !hideVictory && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="flex flex-col items-center">
            <div className={`ts-ribbon ts-ribbon-${colors[stats.winner].toLowerCase()} ts-title min-w-[480px] max-w-[92vw] px-4 text-center text-3xl text-white [text-shadow:0_3px_0_#000]`}>
              {mode === "ai" ? (stats.winner === PLAYER ? "Bạn chiến thắng!" : "Máy chiến thắng!") : `Quân ${stats.winner === 0 ? "Tây" : "Đông"} chiến thắng!`}
            </div>
            <div className="ts-paper mt-2 max-w-[520px] text-center text-[var(--ink)]">
              <div className="font-bold">{WIN_REASON_VI[stats.winReason ?? "castle"]}</div>
              <div className="text-[12px] opacity-80">
                Uy thế {Math.floor(stats.prestige[0])} – {Math.floor(stats.prestige[1])} · Quân còn {stats.alive[0].toLocaleString("vi-VN")} – {stats.alive[1].toLocaleString("vi-VN")} · Thời gian {fmtTime(stats.time)}
              </div>
              <div className="mt-2 flex justify-center gap-2">
                <button className="ts-btn red text-sm" onClick={() => { modeRef.current = null; setMode(null); aiRef.current = null; setLoading({ label: "Đang sinh bản đồ mới…", pct: 0.5 }); setSeed((s) => (s * 16807) % 2147483647); }}>Chơi lại</button>
                <button className="ts-btn text-sm" onClick={() => setHideVictory(true)}>Xem chiến trường</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- menu chọn chế độ */}
      {!loading && !mode && !isDeploying && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1d3b44]/70">
          <div className="ts-wood w-[440px] max-w-[92vw] text-center text-[var(--cream)]">
            <div className="ts-title text-2xl">Đại chiến 9.600 quân</div>
            <div className="mb-3 text-[12px] opacity-80">Chọn chế độ chơi</div>
            <div className="flex flex-col gap-2">
              <button className="ts-btn red text-base" onClick={() => setIsDeploying(true)}>
                <img src={`${UI}/Icons/Icon_05.png`} alt="" className="h-6 w-6" /> Đánh với máy
              </button>
              <button className="ts-btn text-base opacity-60" disabled title="Đang phát triển">
                <img src={`${UI}/Icons/Icon_08.png`} alt="" className="h-6 w-6" /> PvP — 2 người (sắp ra mắt 🔒)
              </button>
              <button className="ts-btn text-base" onClick={() => setShowHelp(true)}>
                <img src={`${UI}/Icons/Icon_01.png`} alt="" className="h-6 w-6" /> Hướng dẫn chơi
              </button>
            </div>
            <div className="mt-3 text-[11px] opacity-75">Bạn chỉ huy quân Tây (bên trái). Máy chỉ huy quân Đông.</div>
          </div>
        </div>
      )}

      {showHelp && <HowToPlay onClose={() => setShowHelp(false)} />}
      
      {/* ---- màn hình bố trí */}
      {isDeploying && <Deployment onStart={handleStartDeployment} />}

      {/* ---- loading */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1d3b44]">
          <div className="relative flex w-[520px] max-w-[92vw] flex-col items-center">
            <img src="/assets/UI%20Elements/UI%20Banners%20from%20the%20store%20page/Banner/Banner.png" alt="" className="ts-pixel w-full" />
            <div className="absolute inset-x-[14%] top-[30%] flex flex-col items-center gap-3 text-[var(--ink)]">
              <div className="ts-title text-center text-2xl">Tiny Swords<br />Đại chiến 9.600 quân</div>
              <div className="ts-bar w-full"><span style={{ width: `${Math.round(loading.pct * 100)}%` }} /></div>
              <div className="text-sm">{loading.label}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide opacity-80">{children}</div>;
}

function Legend({ color, name, note }: { color: string; name: string; note: string }) {
  return (
    <div className="flex items-center gap-2 py-[1px]">
      <span className="inline-block h-3 w-3 rounded-sm border border-black/40" style={{ background: color }} />
      <span className="flex-1">{name}</span>
      <span className="text-[11px] opacity-70">{note}</span>
    </div>
  );
}

const WIN_REASON_VI: Record<WinReason, string> = {
  prestige: `Đạt ${PRESTIGE_WIN} Uy thế nhờ cắm cờ trên đất địch (cần giữ đầu cầu) và phá công trình.`,
  castle: "Thành địch đã bị phá (cần giữ Cầu giữa để gây đủ sát thương).",
  surrender: "Quân địch còn dưới 15% quân chiến đấu và đã đầu hàng.",
  time: "Hết 20 phút — phân định bằng Uy thế, rồi chỗ vượt sông, rồi tổng HP.",
};

function fmtTime(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Army({ side, color, stats }: { side: 0 | 1; color: TeamColor; stats: Stats | null }) {
  const alive = stats?.alive[side] ?? 4805;
  const prestige = stats?.prestige[side] ?? 0;
  const avatar = side === 0 ? "01" : "05";
  return (
    <div className={`flex items-center gap-2 ${side === 1 ? "flex-row-reverse text-right" : ""}`}>
      <img src={`${UI}/Human%20Avatars/Avatars_${avatar}.png`} alt="" className="ts-pixel h-14 w-14" />
      <div>
        <div className="ts-title [text-shadow:0_1px_0_#000,0_0_6px_rgba(0,0,0,.6)]" style={{ color: COLOR_HEX[color] }}>Quân {side === 0 ? "Tây" : "Đông"} · {COLOR_VI[color]}</div>
        <div className="ts-title text-xl">{alive.toLocaleString("vi-VN")}</div>
        <div className="ts-sword w-[150px]" style={{ borderImageSource: `url(/ui/sword-${color.toLowerCase()}.png)`, width: `${40 + 110 * (alive / 4805)}px` }} />
        <div className={`mt-1 flex items-center gap-1 text-[11px] ${side === 1 ? "flex-row-reverse" : ""}`}>
          <span className="font-bold">Uy thế</span>
          <div className="h-2.5 w-[110px] overflow-hidden rounded-sm border border-black/50 bg-black/40">
            <div className="h-full" style={{ width: `${Math.min(100, (prestige / PRESTIGE_WIN) * 100)}%`, background: COLOR_HEX[color], marginLeft: side === 1 ? "auto" : 0 }} />
          </div>
          <span className="tabular-nums">{Math.floor(prestige)}/{PRESTIGE_WIN}</span>
        </div>
        <div className={`mt-0.5 flex gap-2 text-[11px] ${side === 1 ? "justify-end" : ""}`}>
          <span title="Cứ điểm sông đang giữ">◆ Sông {stats?.river[side] ?? 0}/5</span>
          <span title="Cờ đang cắm trên đất địch">⚑ Cờ địch {stats?.flags[side] ?? 0}</span>
          <span className="flex items-center gap-0.5"><img src={`${UI}/Icons/Icon_09.png`} alt="Hạ gục" className="h-4 w-4" />{stats?.kills[side] ?? 0}</span>
        </div>
      </div>
    </div>
  );
}



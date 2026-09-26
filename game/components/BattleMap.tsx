"use client";
import { io } from "socket.io-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Assets } from "@/lib/game/assets";
import { UNIT_VI, colorPaths, staticPaths } from "@game/shared";
import { COLOR_HEX, COLOR_VI, FORD, MAX_BUILT_BRIDGES, MH, MW, SPEED_FORD, SPEED_SWIM, T, WATER, WORLD_H, WORLD_W, type TeamColor } from "@game/shared";
import { generateMap, passable, DEPLOYMENT_BOUNDS } from "@game/shared";
import { Renderer, type Camera, type ViewOptions } from "@/lib/game/renderer";
import { World, AICommander, MOVE_ATTACK, MOVE_MARCH, OBJ_FLAG, OBJ_RIVER, PRESTIGE_WIN, STANCE_DEFEND, STANCE_PURSUE, TIME_LIMIT, type GameEvent, type WinReason } from "@game/shared";
import { HowToPlay } from "./HowToPlay";
import { Deployment } from "./Deployment";
import type { GameMap } from "@game/shared";
import { myPlayerId } from "@/lib/game/playerId";

const UI = "/assets/UI%20Elements/UI%20Elements";
const TICK = 0.1;
const AVATAR_TYPE = [2, 3, 6, 4, 7];


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
  flags: [number, number];     // sß╗æ cß╗¥ nß╗Öi ─æß╗ïa ─æß╗ïch ─æang cß║»m
  timeLeft: number;
  winReason: WinReason | null;
  events: GameEvent[];
  time: number;
  stance: [number, number, number]; // ph├▓ng thß╗º / truy k├¡ch / giß╗» vß╗ï tr├¡ cß╗ºa qu├ón ─æang chß╗ìn
  ai: string[];
}

type Mode = "ai" | "pvp";
// Lß╗çnh chß╗¥ chuß╗Öt phß║úi kß║┐ tiß║┐p: Tß║Ñn c├┤ng (F) ┬╖ B╞íi qua s├┤ng (V) ┬╖ Bß║»c cß║ºu (B)
type ArmMode = "attack" | "swim" | "bridge" | null;
const ARM_HINT: Record<Exclude<ArmMode, null>, string> = {
  attack: "Chuß╗Öt phß║úi v├áo ─æ├¡ch ─æß╗â Tß║ñN C├öNG ΓÇö qu├ón tß╗▒ chß╗ìn chß╗ù ─æ├ính trong v├╣ng 12 ├┤, kh├┤ng d├án trß║¡n",
  swim: "Chuß╗Öt phß║úi v├áo bß╗¥ b├¬n kia ─æß╗â B╞áI QUA S├öNG (chß║¡m, kh├┤ng ─æ├ính ─æ╞░ß╗úc khi ─æang b╞íi)",
  bridge: "Chuß╗Öt phß║úi v├áo l├▓ng s├┤ng (n╞░ß╗¢c s├óu) ─æß╗â Bß║«C Cß║ªU",
};
const MINI_SIZES = [220, 480];
const MINI_ZOOMS = [1, 2, 4];
const PLAYER = 0; // chß║┐ ─æß╗Ö ─æ├ính vß╗¢i m├íy: ng╞░ß╗¥i ch╞íi lu├┤n l├á phe T├óy

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
  let label = "─Éß╗ông cß╗Å";
  let speed = "1.0x";
  if (m.ground[i] === WATER) { label = "N╞░ß╗¢c s├óu ΓÇö chß╗ë b╞íi ─æ╞░ß╗úc (lß╗çnh B╞íi, V)"; speed = `${SPEED_SWIM}x`; }
  else if (m.ground[i] === FORD) { label = "B├úi cß║ín"; speed = `${SPEED_FORD}x`; }
  else if (m.ground[i] === 3) label = w.builtBridges.some((b) => b.alive && x >= b.xa && x <= b.xb && y >= b.y0 && y <= b.y1) ? "Cß║ºu tß╗▒ x├óy (ph├í ─æ╞░ß╗úc)" : "Cß║ºu gß╗ù (─æiß╗âm nghß║╜n)";
  else if (m.block[i]) { label = "C├┤ng tr├¼nh"; speed = "ΓÇö"; }
  else if (m.cliff[i]) { label = "V├ích ─æ├í ΓÇö kh├┤ng thß╗â leo"; speed = "ΓÇö"; }
  else if (m.ramp[i]) label = `Dß╗æc l├¬n tß║ºng ${m.level[i] + 1}`;
  else if (m.forest[i]) label = "Rß╗½ng phß╗Ñc k├¡ch (t├áng h├¼nh)";
  else if (m.level[i]) label = `Cao nguy├¬n tß║ºng ${m.level[i]}`;
  if (!passable(m, i) && m.ground[i] !== WATER) speed = "ΓÇö";
  return { x, y, label, speed, level: m.level[i], zone: m.forest[i] };
}

function clampCam(cam: Camera, vw: number, vh: number) {
  const minZoom = Math.max(vw / WORLD_W, vh / WORLD_H);
  cam.zoom = Math.max(minZoom, Math.min(1.6, cam.zoom));
  const hw = vw / 2 / cam.zoom, hh = vh / 2 / cam.zoom;
  cam.x = Math.max(hw, Math.min(WORLD_W - hw, cam.x));
  cam.y = Math.max(hh, Math.min(WORLD_H - hh, cam.y));
}

// ─Éiß╗âm giao chiß║┐n tr├¬n bß║ún ─æß╗ô nhß╗Å (gom theo ├┤ l╞░ß╗¢i 16├ù16 ├┤ bß║ún ─æß╗ô)
interface Clash { x: number; y: number; n: number; own: boolean }
const CLASH_CELL = 16;

function findClashes(w: World, viewer: number): Clash[] {
  const G = MW / CLASH_CELL;
  const cnt = new Uint16Array(G * G), own = new Uint8Array(G * G);
  const sx = new Float32Array(G * G), sy = new Float32Array(G * G);
  const vc = w.visCount[viewer as 0 | 1];
  for (let i = 0; i < w.n; i++) {
    if (!w.alive[i] || w.time - w.lastCombat[i] > 1.5) continue;
    const mine = w.side[i] === viewer;
    if (!mine && vc[w.tile[i]] === 0) continue; // giao chiß║┐n cß╗ºa ─æß╗ïch m├á m├¼nh kh├┤ng thß║Ñy ΓåÆ kh├┤ng biß║┐t
    const c = Math.floor(w.y[i] / T / CLASH_CELL) * G + Math.floor(w.x[i] / T / CLASH_CELL);
    cnt[c]++; sx[c] += w.x[i]; sy[c] += w.y[i];
    if (mine) own[c] = 1;
  }
  const out: Clash[] = [];
  for (let c = 0; c < G * G; c++) if (cnt[c] >= 3) out.push({ x: sx[c] / cnt[c], y: sy[c] / cnt[c], n: cnt[c], own: !!own[c] });
  return out.sort((p, q) => q.n - p.n);
}

// V├╣ng thß║┐ giß╗¢i m├á bß║ún ─æß╗ô nhß╗Å ─æang hiß╗ân thß╗ï (ph├│ng to th├¼ b├ím theo camera)
function miniView(cam: Camera, zoom: number): [number, number, number] {
  const span = WORLD_W / zoom;
  const x0 = Math.max(0, Math.min(WORLD_W - span, cam.x - span / 2));
  const y0 = Math.max(0, Math.min(WORLD_H - span, cam.y - span / 2));
  return [x0, y0, span];
}

function drawMinimap(c: HTMLCanvasElement | null, cam: Camera, opt: ViewOptions, w: World, r: Renderer, vw: number, vh: number, zoom: number, clashes: Clash[], now: number) {
  if (!c) return;
  const g = c.getContext("2d")!;
  const S = c.width;
  const [vx0, vy0, span] = miniView(cam, zoom);
  const k = S / span; // px bß║ún ─æß╗ô nhß╗Å / px thß║┐ giß╗¢i
  const tx0 = vx0 / T, ty0 = vy0 / T, tspan = span / T;
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#1d3b44";
  g.fillRect(0, 0, S, S);
  g.drawImage(r.minimap, tx0, ty0, tspan, tspan, 0, 0, S, S);
  // S╞░╞íng m├╣: phß╗º tr╞░ß╗¢c khi vß║╜ qu├ón/c├┤ng tr├¼nh ─æß╗â chß║Ñm qu├ón ta vß║½n nß╗òi r├╡
  const fog = r.minimapFog(w, opt.viewer);
  if (fog) {
    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(fog, tx0, ty0, tspan, tspan, 0, 0, S, S);
    g.restore();
  }
  const X = (x: number) => (x - vx0) * k, Y = (y: number) => (y - vy0) * k;
  // cß║ºu tß╗▒ x├óy: phß║ºn ─æ├ú l├ít ─æß║╖c, phß║ºn c├▓n lß║íi viß╗ün ─æß╗⌐t
  for (const br of w.builtBridges) {
    if (!br.alive) continue;
    const c0 = w.bridgeCol(br, 0), c1 = w.bridgeCol(br, Math.max(0, br.built - 1));
    const bh = (br.y1 - br.y0 + 1) * T * k;
    g.fillStyle = "#a86e3c";
    if (br.built > 0) g.fillRect(X(Math.min(c0, c1) * T), Y(br.y0 * T), (Math.abs(c1 - c0) + 1) * T * k, Math.max(1.5, bh));
    if (!br.done) {
      g.strokeStyle = "#e9c48f";
      g.setLineDash([2, 2]);
      g.lineWidth = 1;
      g.strokeRect(X(br.xa * T), Y(br.y0 * T), (br.xb - br.xa + 1) * T * k, Math.max(1.5, bh));
      g.setLineDash([]);
    }
  }
  const dot = Math.max(1.5, Math.min(3, zoom * 1.2));
  for (let s = 0; s < 2; s++) {
    g.fillStyle = COLOR_HEX[opt.colors[s]];
    const stride = zoom >= 2 ? 2 : 6;
    for (let i = s; i < w.n; i += stride) {
      if (!w.alive[i] || w.side[i] !== s) continue;
      // Kiß╗âm tra s╞░╞íng m├╣: ß║⌐n qu├ón ─æß╗ïch ß╗ƒ ├┤ ch╞░a c├│ tß║ºm nh├¼n
      if (opt.viewer >= 0 && s !== opt.viewer) {
        const vc = w.visCount[opt.viewer as 0 | 1];
        if (vc[w.tile[i]] === 0) continue; // ß║⌐n qu├ón ─æß╗ïch trong s╞░╞íng m├╣
      }
      // Kiß╗âm tra rß╗½ng c├óy (c╞í chß║┐ c┼⌐)
      if (opt.viewer >= 0 && s !== opt.viewer && w.m.forest[w.tile[i]] && !w.presence[opt.viewer][w.m.forest[w.tile[i]]]) continue;
      const px = X(w.x[i]), py = Y(w.y[i]);
      if (px < -2 || py < -2 || px > S + 2 || py > S + 2) continue;
      g.fillRect(px, py, dot, dot);
    }
  }
  for (const b of w.m.buildings) {
    if (b.hp <= 0) continue;
    g.fillStyle = COLOR_HEX[opt.colors[b.side]];
    g.strokeStyle = "#1b1b1b";
    g.fillRect(X(b.tx * T) - 1, Y(b.ty * T) - 1, b.fw * T * k + 2, b.fh * T * k + 2);
    g.lineWidth = 1;
    g.strokeRect(X(b.tx * T) - 1, Y(b.ty * T) - 1, b.fw * T * k + 2, b.fh * T * k + 2);
  }
  // Mß╗Ñc ti├¬u: m├áu theo chß╗º sß╗ƒ hß╗»u m├á ng╞░ß╗¥i xem biß║┐t (cß║¡p nhß║¡t khi c├│ tß║ºm nh├¼n)
  for (const o of w.obj) {
    const owner = opt.objKnown ? opt.objKnown[o.id] : w.objOwner[o.id];
    const x = X((o.tx + 0.5) * T), y = Y((o.ty + 0.5) * T), rr = (o.kind === OBJ_RIVER ? 5 : 4) * Math.min(1.6, Math.sqrt(zoom));
    g.fillStyle = owner >= 0 ? COLOR_HEX[opt.colors[owner]] : "#f3e9c6";
    g.strokeStyle = "#1b1b1b";
    g.lineWidth = 1.2;
    g.beginPath();
    if (o.kind === OBJ_RIVER) { g.moveTo(x, y - rr); g.lineTo(x + rr, y); g.lineTo(x, y + rr); g.lineTo(x - rr, y); }
    else { g.moveTo(x - rr * 0.6, y + rr); g.lineTo(x - rr * 0.6, y - rr); g.lineTo(x + rr, y - rr * 0.4); g.lineTo(x - rr * 0.6, y + rr * 0.1); }
    g.closePath();
    g.fill();
    g.stroke();
  }
  // T├¡n hiß╗çu giao chiß║┐n: v├▓ng ─æß╗Å nhß║Ñp nh├íy (─æß╗Å ─æß║¡m = qu├ón ta ─æang ─æ├ính, cam = ─æß╗ïch ─æ├ính nhau trong tß║ºm nh├¼n)
  const pulse = (now / 700) % 1;
  for (const cl of clashes) {
    const x = X(cl.x), y = Y(cl.y);
    const base = 4 + Math.min(8, Math.sqrt(cl.n));
    g.strokeStyle = cl.own ? `rgba(255,60,40,${1 - pulse})` : `rgba(255,170,40,${1 - pulse})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, base + pulse * 10, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = cl.own ? "#ff3c28" : "#ffaa28";
    g.beginPath();
    g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3); g.moveTo(x + 3, y - 3); g.lineTo(x - 3, y + 3);
    g.strokeStyle = g.fillStyle;
    g.lineWidth = 1.6;
    g.stroke();
  }
  g.strokeStyle = "#fff6c8";
  g.lineWidth = 1.5;
  g.strokeRect(X(cam.x - vw / 2 / cam.zoom), Y(cam.y - vh / 2 / cam.zoom), (vw / cam.zoom) * k, (vh / cam.zoom) * k);
}

import { Socket } from "socket.io-client";

export default function BattleMap({ 
  mode: initialMode, 
  seed: initialSeed, 
  socket, 
  roomId, 
  players, 
  onExit 
}: { 
  mode: "ai" | "pvp", 
  seed: number, 
  socket: Socket | null, 
  roomId: string, 
  players: any[], 
  onExit: () => void 
}) {
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
  const armRef = useRef<ArmMode>(null);    // lß╗çnh chuß╗Öt phß║úi kß║┐ tiß║┐p (F/V/B)
  const clashRef = useRef<Clash[]>([]);    // ─æiß╗âm giao chiß║┐n cho bß║ún ─æß╗ô nhß╗Å
  const miniZoomRef = useRef(1);
  const knownRef = useRef<Int8Array | null>(null); // chß╗º sß╗ƒ hß╗»u mß╗Ñc ti├¬u phe m├¼nh biß║┐t
  const serverTickRef = useRef(0);
  const localTickRef = useRef(0);

  const [loading, setLoading] = useState<{ label: string; pct: number } | null>({ label: "─Éang tß║úi t├ái nguy├¬nΓÇª", pct: 0 });
  
  // Lß║Ñy viewer (side) tß╗½ multiplayer hoß║╖c mß║╖c ─æß╗ïnh l├á 0 (T├óy) khi ch╞íi AI
  const myPlayer = players.find(p => p.playerId === myPlayerId);
  const initialViewer = myPlayer ? myPlayer.side : 0;
  
  const [viewer, setViewer] = useState(initialViewer); 
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
  const [miniSize, setMiniSize] = useState(0);
  const [miniZoom, setMiniZoom] = useState(0);
  const [showMiniLegend, setShowMiniLegend] = useState(false);
  const [clashCount, setClashCount] = useState(0);
  const [notice, setNotice] = useState<{ text: string; t: number } | null>(null);
  const [focusType, setFocusType] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState<number>(0);
  const [mode, setMode] = useState<Mode | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [arm, setArmState] = useState<ArmMode>(null);
  const [hideVictory, setHideVictory] = useState(false);
  const [isDeploying, setIsDeploying] = useState(true);
  const [focusGroupId, setFocusGroupId] = useState(-1);
  const cycleGroupRef = useRef<() => void>(() => {});
  const setArm = useCallback((v: ArmMode) => { armRef.current = v; setArmState(v); }, []);
  const toggleArm = useCallback((v: Exclude<ArmMode, null>) => setArm(armRef.current === v ? null : v), [setArm]);
  const say = useCallback((text: string) => setNotice({ text, t: performance.now() }), []);
  useEffect(() => { miniZoomRef.current = MINI_ZOOMS[miniZoom]; }, [miniZoom]);
  useEffect(() => {
    if (!notice) return;
    const h = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(h);
  }, [notice]);

  const handleStartDeployment = useCallback((layout: { type: number, px: number, py: number, ownerId?: string | null }[]) => {
    if (!mapRef.current) return;
    const world = new World(mapRef.current, layout);
    worldRef.current = world;
    knownRef.current = Int8Array.from(world.obj.map((o) => (o.kind === OBJ_FLAG ? o.home : -1)));
    localTickRef.current = 0;
    serverTickRef.current = 0;
    
    // Find our side
    const myPlayer = players?.find(p => p.playerId === myPlayerId);
    const mySide = myPlayer ? myPlayer.side : PLAYER;
    
    optRef.current = { ...optRef.current, viewer: mySide, objKnown: knownRef.current, myId: myPlayerId };
    
    modeRef.current = initialMode;
    setMode(initialMode);
    setViewer(mySide);
    
    if (initialMode === "ai") {
      aiRef.current = new AICommander(world, 1);
    }
    
    setIsDeploying(false);
  }, [initialMode, players, myPlayerId]);

  const executeCommand = useCallback((cmd: any) => {
    const w = worldRef.current;
    if (!w) return;
    
    // Validate command ownership if it came from the server (has senderId)
    if (!cmd.isLocal && cmd.senderId !== undefined && cmd.sel) {
      cmd.sel = cmd.sel.filter((id: number) => w.owner[id] === cmd.senderId);
      if (cmd.sel.length === 0) return; // Command invalid, skip entirely
    }

    switch (cmd.action) {
      case "move":
        w.orderMove(cmd.sel, cmd.tx, cmd.ty, cmd.mode, cmd.swim, cmd.noFormation);
        break;
      case "buildBridge":
        const err = w.orderBuildBridge(cmd.sel, cmd.tx, cmd.ty);
        if (err && cmd.isLocal) say(err);
        break;
      case "hold":
        w.orderHold(cmd.sel);
        break;
      case "stance":
        w.orderStance(cmd.sel, cmd.stance);
        break;
      case "rally":
        w.orderRally(cmd.sel);
        break;
      case "charge":
        w.orderCharge(cmd.sides);
        break;
    }
  }, [say]);

  const dispatchCommand = useCallback((cmd: any) => {
    cmd.isLocal = true; // For local error messages
    if (socket && modeRef.current === "pvp") {
      socket.emit("command", roomId, cmd);
    } else {
      executeCommand(cmd);
    }
  }, [socket, roomId, executeCommand]);

  useEffect(() => {
    if (socket) {
      const onMatchStarted = (blocks0: any[], blocks1: any[]) => {
        const layout: any[] = [];
        // Use global T = 64 from @game/shared.
        // Each block in UI is 20x20 tiles. In world, that's 20 * T pixels.
        const GRID_SIZE = 9 * T;
        
        const build = (blocks: any[], side: number) => {
          if (!blocks) return;
          blocks.forEach((b: any) => {
            if (b.gx === -1) return;
            const { xMin, yMin } = DEPLOYMENT_BOUNDS.WEST;
            const blockPx = (xMin * T) + (b.gx * GRID_SIZE);
            const blockPy = (yMin * T) + (b.gy * GRID_SIZE);
            
            // A block is 576x576 pixels.
            // Spread 10x10 units with 32px spacing to avoid merging with other blocks
            // 9 * 32 = 288. Offset to center: (576 - 288) / 2 = 144
            for (let c = 0; c < 10; c++) {
              for (let r = 0; r < 10; r++) {
                let px = blockPx + 144 + c * 32;
                let py = blockPy + 144 + r * 32;
                if (side === 1) {
                  px = WORLD_W - px;
                  py = WORLD_H - py;
                }
                layout.push({ type: b.type, px, py, ownerId: b.ownerId, side });
              }
            }
          });
        };
        
        build(blocks0, 0);
        build(blocks1, 1);
        handleStartDeployment(layout);
      };
      const onCommand = (cmd: any) => {
        cmd.isLocal = false; // Came from network
        executeCommand(cmd);
      };
      const onTick = (serverTick: number) => {
        serverTickRef.current = serverTick;
      };
      
      socket.on("match_started", onMatchStarted);
      socket.on("command", onCommand);
      socket.on("tick", onTick);
      
      return () => { 
        socket.off("match_started", onMatchStarted);
        socket.off("command", onCommand);
        socket.off("tick", onTick);
      };
    }
  }, [socket, handleStartDeployment, executeCommand]);

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
       const isMine = modeRef.current !== "pvp" || w.owner[i] === myPlayerId;
       if (w.side[i] === side && w.armyGroupId[i] === nextId && w.alive[i] && isMine) {
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
    optRef.current = { ...optRef.current, viewer, colors, showClouds, showNav, objKnown: viewer === PLAYER ? knownRef.current : null };
  }, [viewer, colors, showClouds, showNav]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // ---- load assets + build map
  useEffect(() => {
    let cancelled = false;
    const assets = assetsRef.current ?? new Assets();
    assetsRef.current = assets;
    (async () => {
      const paths = [...staticPaths(), ...colorPaths(optRef.current.colors[0]), ...colorPaths(optRef.current.colors[1])];
      await assets.load(paths, (d, n) => !cancelled && setLoading({ label: "─Éang tß║úi t├ái nguy├¬n Tiny SwordsΓÇª", pct: (d / n) * 0.5 }));
      if (cancelled) return;
      setLoading({ label: "─Éang sinh bß║ún ─æß╗ô 512├ù512ΓÇª", pct: 0.5 });
      await new Promise((r) => setTimeout(r, 30));
      const map = generateMap(initialSeed);
      mapRef.current = map;
      const world = new World(map);
      rendRef.current?.dispose();
      const rend = new Renderer(map, assets);
      // bake far terrain chunks in slices so the progress bar can update
      const total = 64;
      for (let k = 0; k < total; k += 4) {
        if (cancelled) return;
        for (let j = k; j < k + 4; j++) rend.buildFarChunk(j);
        setLoading({ label: "─Éang dß╗▒ng ─æß╗ïa h├¼nhΓÇª", pct: 0.55 + (k / total) * 0.45 });
        await new Promise((r) => setTimeout(r, 0));
      }
      const h = window.location.hash.slice(1).split(",").map(Number);
      if (h.length === 3 && h.every((v) => Number.isFinite(v))) camRef.current = { x: h[0] * T, y: h[1] * T, zoom: h[2] };
      worldRef.current = world;
      rendRef.current = rend;
      // Ng╞░ß╗¥i ch╞íi biß║┐t chß╗º cß╗¥ nh├á cß╗ºa hai b├¬n tß╗½ ─æß║ºu; cß╗⌐ ─æiß╗âm s├┤ng ban ─æß║ºu trung lß║¡p
      knownRef.current = Int8Array.from(world.obj.map((o) => (o.kind === OBJ_FLAG ? o.home : -1)));
      optRef.current = { ...optRef.current, objKnown: optRef.current.viewer === PLAYER ? knownRef.current : null };
      aiRef.current = null;
      setHideVictory(false);
      setLoading(null);
    })();
    return () => { cancelled = true; };
  }, [initialSeed]);

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

      // Chß╗ë chß║íy m├┤ phß╗Ång khi ─æ├ú chß╗ìn chß║┐ ─æß╗Ö v├á trß║¡n ch╞░a ph├ón thß║»ng bß║íi
      const running = modeRef.current !== null && w.winner < 0;
      if (modeRef.current === "pvp") {
        let steps = 0;
        while (localTickRef.current < serverTickRef.current && steps < 10 && running) {
          w.step(TICK);
          localTickRef.current++;
          steps++;
          acc = 0; // Reset interpolator
        }
        if (running) {
          acc += dt; // Smooth interpolation up to next tick
          if (acc > TICK) acc = TICK;
        }
      } else {
        acc = running ? acc + dt * speedRef.current : 0;
        let steps = 0;
        while (acc >= TICK && steps < 3) { aiRef.current?.update(); w.step(TICK); acc -= TICK; steps++; }
        if (steps === 3) acc = 0;
      }

      r.dpr = dpr;
      r.render(ctx, w, cam, vw, vh, optRef.current, w.time + acc, boxRef.current, hoverRef.current, dt);

      drawMinimap(miniRef.current, cam, optRef.current, w, r, vw, vh, miniZoomRef.current, clashRef.current, now);
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
        // Cß║¡p nhß║¡t hiß╗âu biß║┐t cß╗ºa phe m├¼nh vß╗ü chß╗º sß╗ƒ hß╗»u mß╗Ñc ti├¬u (chß╗ë khi ─æang c├│ tß║ºm nh├¼n)
        const known = knownRef.current;
        if (known) for (const o of w.obj) if (w.visCount[optRef.current.viewer][o.ty * MW + o.tx] > 0) known[o.id] = w.objOwner[o.id];
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
          ai: [],
        });
        setZoomPct(Math.round(cam.zoom * 100));
        clashRef.current = findClashes(w, optRef.current.viewer >= 0 ? optRef.current.viewer : PLAYER);
        setClashCount(clashRef.current.filter((c) => c.own).length);
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
      const ownerFilter = modeRef.current === "pvp" ? myPlayerId : undefined;
      const key = e.key.toLowerCase();
      if (e.key >= "1" && e.key <= "5") w.selectType(+e.key - 1, side, ownerFilter);
      if (key === "q") w.selectType(-1, side, ownerFilter);
      if (e.key === "Escape") { w.sel.fill(0); setArm(null); }
      if (key === "h") dispatchCommand({ action: "hold", sel: Array.from(w.selected()) });
      if (key === "f") toggleArm("attack");
      if (key === "v") toggleArm("swim");
      if (key === "b") toggleArm("bridge");
      if (key === "t") toggleStance(w);
      if (key === "g") dispatchCommand({ action: "rally", sel: Array.from(w.selected()) });
      if (key === "tab") {
        e.preventDefault();
        cycleGroupRef.current?.();
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    // T: ─æß╗òi t╞░ thß║┐ cß║ú nh├│m ΓÇö ─æa sß╗æ ─æang Ph├▓ng thß╗º th├¼ chuyß╗ân Truy k├¡ch, ng╞░ß╗úc lß║íi vß╗ü Ph├▓ng thß╗º
    const toggleStance = (w: World) => {
      const sel = Array.from(w.selected());
      const pursue = sel.filter((i) => w.stance[i] === STANCE_PURSUE).length;
      dispatchCommand({ action: "stance", sel, stance: pursue * 2 < sel.length ? STANCE_PURSUE : STANCE_DEFEND });
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [setArm, toggleArm]);

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
      const ownerFilter = modeRef.current === "pvp" ? myPlayerId : undefined;
      w.selectRect(ax - pad, ay - pad, bx + pad, by + pad, side, e.shiftKey, ownerFilter);
    } else if (d.mode === "right") {
      const [wx, wy] = toWorld(sx, sy);
      issueOrder(wx, wy, e.altKey);
    }
  };
  // Chuß╗Öt phß║úi (tr├¬n bß║ún ─æß╗ô lß╗¢n hoß║╖c bß║ún ─æß╗ô nhß╗Å) = H├ánh qu├ón; F ΓåÆ Tß║Ñn c├┤ng; V ΓåÆ B╞íi qua s├┤ng; B ΓåÆ Bß║»c cß║ºu
  const issueOrder = (wx: number, wy: number, alt: boolean) => {
    const w = worldRef.current;
    if (!w) return;
    const sel = Array.from(w.selected());
    if (!sel.length) return;
    const tx = Math.floor(wx / T), ty = Math.floor(wy / T);
    const mode = armRef.current;
    if (mode === "bridge") {
      dispatchCommand({ action: "buildBridge", sel, tx, ty });
    } else if (mode === "swim") {
      dispatchCommand({ action: "move", sel, tx, ty, mode: MOVE_ATTACK, swim: true, noFormation: true });
    } else if (mode === "attack" || alt) {
      // Tß║Ñn c├┤ng: kh├┤ng d├án trß║¡n ΓÇö quanh ─æiß╗âm bß║Ñm l├á v├╣ng chiß║┐n ─æß║Ñu, l├¡nh tß╗▒ chß╗ìn chß╗ù ─æ├ính
      dispatchCommand({ action: "move", sel, tx, ty, mode: MOVE_ATTACK, swim: false, noFormation: true });
    } else {
      dispatchCommand({ action: "move", sel, tx, ty, mode: MOVE_MARCH });
    }
    w.addFx(0, wx, wy, 0); // 0 = FX_DUST
    if (mode) setArm(null);
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

  // Bß║ún ─æß╗ô nhß╗Å: chuß╗Öt tr├íi (k├⌐o) = dß╗¥i camera ┬╖ chuß╗Öt phß║úi = ra lß╗çnh cho qu├ón ─æang chß╗ìn ┬╖ l─ân chuß╗Öt = ph├│ng to/thu nhß╗Å
  const miniToWorld = (e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    const [x0, y0, span] = miniView(camRef.current, miniZoomRef.current);
    return [x0 + ((e.clientX - rect.left) / rect.width) * span, y0 + ((e.clientY - rect.top) / rect.height) * span];
  };
  const miniNav = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === "pointerdown" && e.button === 2) {
      const [wx, wy] = miniToWorld(e);
      issueOrder(wx, wy, e.altKey);
      return;
    }
    if (e.type === "pointermove" ? e.buttons !== 1 : e.button !== 0) return;
    const [wx, wy] = miniToWorld(e);
    camRef.current.x = wx;
    camRef.current.y = wy;
    camRef.current.targetX = undefined;
    camRef.current.targetY = undefined;
  };
  useEffect(() => {
    const c = miniRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setMiniZoom((z) => Math.max(0, Math.min(MINI_ZOOMS.length - 1, z + (e.deltaY < 0 ? 1 : -1))));
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [showMinimap, miniSize]);
  const jumpToClash = () => {
    const c = clashRef.current.find((x) => x.own) ?? clashRef.current[0];
    if (!c) return;
    camRef.current.targetX = c.x;
    camRef.current.targetY = c.y;
  };
  const zoomTo = (z: number) => { camRef.current.zoom = z; };

  const selTotal = stats ? stats.sel.reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="ts-game relative h-screen w-screen select-none overflow-hidden text-[13px]" onContextMenu={(e) => e.preventDefault()}>
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full ${hover && hover.speed === "ΓÇö" ? "ts-blocked" : selTotal ? "ts-order" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { hoverRef.current = -1; setHover(null); }}
      />

      {/* ---- top: army scoreboard */}
      {showTopUI && (
        <div className="pointer-events-none absolute left-1/2 top-2 flex -translate-x-1/2 flex-col items-center">
          <div className="pointer-events-auto flex items-center justify-between w-full">
            <div className={`ts-ribbon ts-ribbon-${colors[0].toLowerCase()} min-w-[420px] px-2 text-lg ts-title mx-auto`}>─Éß║áI CHIß║╛N 9.600 QU├éN</div>
            <button onClick={() => setShowTopUI(false)} className="ts-btn text-xs px-2 py-0 h-6 -ml-10">ß║¿n</button>
          </div>
          <div className="ts-wood -mt-2 flex items-center gap-3 text-[var(--cream)]">
            <Army side={0} color={colors[0]} stats={stats} />
            <div className="flex flex-col items-center">
              <span className="ts-title text-2xl text-[#ffd76a] [text-shadow:0_2px_0_#000]">VS</span>
              <span className="text-[11px] opacity-80">C├▓n lß║íi</span>
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
            <span>B├án chß╗ë huy</span>
            <button onClick={() => setShowLeftUI(false)} className="ts-btn text-xs px-2 py-0">ß║¿n</button>
          </div>
          <button className="ts-btn mb-2 w-full text-sm" onClick={() => setShowHelp(true)}>
            <img src={`${UI}/Icons/Icon_01.png`} alt="" className="h-6 w-6" /> H╞░ß╗¢ng dß║½n &amp; luß║¡t thß║»ng
          </button>
          <div className="mb-2">
            <Label>─É╞ín vß╗ï qu├ón ─æß╗Öi</Label>
            <div className="grid grid-cols-3 gap-1">
              {[0, 1, 2, 3, 4].map((t) => (
                <button
                  key={t}
                  onClick={() => handleFocus(t)}
                  className={`ts-btn min-w-0 !min-h-[64px] !px-0.5 !py-0.5 flex-col !gap-0 ${focusType === t ? "outline outline-2 outline-[#fff6c8]" : ""}`}
                  style={{ borderWidth: 8, borderImageWidth: "8px" }}
                  title={`${UNIT_VI[t]} ΓÇö bß║Ñm ─æß╗â nhß║úy tß╗¢i cß╗Ñm qu├ón`}
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
            <img src={`${UI}/Icons/Icon_10.png`} alt="" className="h-6 w-6" /> Chuyß╗ân ─Éß║ío Qu├ón (Tab)
          </button>
          <button className="ts-btn red text-sm" disabled={!!loading || !mode} title="To├án qu├ón tß║Ñn c├┤ng thß║│ng v├áo Th├ánh ─æß╗ïch (bß╗Å c├íc cß╗⌐ ─æiß╗âm!)" onClick={() => dispatchCommand({ action: "charge", sides: [PLAYER] })}>
            <img src={`${UI}/Icons/Icon_05.png`} alt="" className="h-6 w-6" /> Xung trß║¡n
          </button>
          <button className="ts-btn text-sm" onClick={() => { const w = worldRef.current; if (w) dispatchCommand({ action: "hold", sel: Array.from(w.selected()) }); }}>
            <img src={`${UI}/Icons/Icon_06.png`} alt="" className="h-6 w-6" /> Giß╗» vß╗ï tr├¡
          </button>
          <button className="ts-btn text-sm" data-on={showClouds} onClick={() => setShowClouds(!showClouds)}>
            <img src={`${UI}/Icons/Icon_12.png`} alt="" className="h-6 w-6" /> M├óy trß╗¥i
          </button>
          <button className="ts-btn text-sm" onClick={() => { if (confirm("Bß║ín c├│ chß║»c muß╗æn tho├ít ra Menu?")) onExit(); }}>
            <img src={`${UI}/Icons/Icon_10.png`} alt="" className="h-6 w-6" /> Tho├ít trß║¡n
          </button>
          <button className="ts-btn text-sm red" onClick={() => { if (confirm("Bß║ín c├│ chß║»c muß╗æn ─Éß║ªU H├ÇNG?")) worldRef.current?.surrender(PLAYER); }}>
            <img src={`${UI}/Icons/Icon_24.png`} alt="" className="h-6 w-6" /> ─Éß║ºu h├áng
          </button>
          <div className="col-span-2 grid grid-cols-3 gap-1">
            {mode === "ai" && [0, 1, 3].map((v) => (
              <button key={v} aria-label={v === 0 ? "Tß║ím dß╗½ng" : `Tß╗æc ─æß╗Ö ${v}x`} className="ts-btn !min-h-[48px] min-w-0 text-xs" data-on={speed === v} onClick={() => setSpeed(v)}>{v === 0 ? "II" : `${v}x`}</button>
            ))}
          </div>
        </div>
          <div className="mt-2 text-[11px] leading-snug opacity-80">
            K├⌐o chuß╗Öt tr├íi: chß╗ìn qu├ón ┬╖ <b>Chuß╗Öt phß║úi: H├ánh qu├ón</b> (bß╗Å qua ─æß╗ïch, d├╣ng ─æß╗â r├║t) ┬╖ <b>F rß╗ôi chuß╗Öt phß║úi</b> (hoß║╖c Alt + chuß╗Öt phß║úi): Tß║Ñn c├┤ng ┬╖ <b>V</b>: B╞íi qua s├┤ng ┬╖ <b>B</b>: Bß║»c cß║ºu ┬╖ T: Ph├▓ng thß╗º/Truy k├¡ch ┬╖ G: Quay ─æß║ºu ┬╖ H: Giß╗» vß╗ï tr├¡ ┬╖ 1ΓÇô5: chß╗ìn binh chß╗ºng ┬╖ Q: cß║ú ─æß║ío qu├ón ┬╖ WASD / k├⌐o chuß╗Öt phß║úi: di chuyß╗ân camera
          </div>
        </div>
      )}

      {/* ---- right: legend + tile info */}
      {showRightUI && (
        <div className="ts-paper absolute right-2 top-2 w-[250px] text-[var(--ink)]">
          <div className="ts-title mb-1 text-base flex justify-between">
            <span>─Éß╗ïa h├¼nh</span>
            <button onClick={() => setShowRightUI(false)} className="ts-btn text-xs px-2 py-0">ß║¿n</button>
          </div>
          <Legend color="#a5be50" name="─Éß╗ông cß╗Å" note="1.0x" />
          <Legend color="#2c5c34" name="Rß╗½ng phß╗Ñc k├¡ch" note="1.0x ┬╖ t├áng h├¼nh" />
          <Legend color="#8ccdbe" name="B├úi cß║ín" note={`${SPEED_FORD}x`} />
          <Legend color="#a86e3c" name="Cß║ºu (3 cß║ºu)" note="1.0x ┬╖ n├║t thß║»t" />
          <Legend color="#47aba9" name="N╞░ß╗¢c s├óu" note={`b╞íi ${SPEED_SWIM}x (V)`} />
          <Legend color="#b87a48" name={`Cß║ºu tß╗▒ x├óy (tß╗æi ─æa ${MAX_BUILT_BRIDGES})`} note="B ┬╖ ph├í ─æ╞░ß╗úc" />
          <Legend color="#556e73" name="V├ích ─æ├í" note="chß║╖n" />
          <Legend color="#c8be6e" name="Dß╗æc l├¬n cao nguy├¬n" note="lß╗æi duy nhß║Ñt" />
          <Legend color="#96b946" name="Cao nguy├¬n 1ΓÇô3 tß║ºng" note="+2 tß║ºm cung" />
          <div className="mt-2 min-h-[64px] border-t border-[#3b2416]/30 pt-1.5">
          {hover ? (
            <>
              <div className="font-bold">├ö ({hover.x}, {hover.y})</div>
              <div>{hover.label}</div>
              <div className="opacity-75">Tß╗æc ─æß╗Ö: {hover.speed} ┬╖ ─Éß╗Ö cao: {hover.level}{hover.zone ? ` ┬╖ Rß╗½ng #${hover.zone}` : ""}</div>
            </>
          ) : (
            <div className="opacity-60">R├¬ chuß╗Öt l├¬n bß║ún ─æß╗ô ─æß╗â xem th├┤ng tin ├┤.</div>
          )}
        </div>
        <div className="mt-1 text-[11px] opacity-70">Thu ph├│ng: {zoomPct}%</div>
          <div className="mt-1 flex gap-1">
            <button className="ts-btn flex-1 !min-h-[40px] text-xs" onClick={() => zoomTo(0.02)}>To├án bß║ún ─æß╗ô</button>
            <button className="ts-btn flex-1 !min-h-[40px] text-xs" onClick={() => zoomTo(0.8)}>Cß║¡n cß║únh</button>
          </div>
        </div>
      )}

      {!showTopUI && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2">
          <button className="ts-btn text-xs px-2 py-1 bg-white opacity-50 hover:opacity-100" onClick={() => setShowTopUI(true)}>─Éiß╗âm sß╗æ</button>
        </div>
      )}
      {!showLeftUI && (
        <div className="absolute left-2 top-2">
          <button className="ts-btn text-xs px-2 py-1 bg-white opacity-50 hover:opacity-100" onClick={() => setShowLeftUI(true)}>Chß╗ë huy</button>
        </div>
      )}
      {!showRightUI && (
        <div className="absolute right-2 top-2">
          <button className="ts-btn text-xs px-2 py-1 bg-white opacity-50 hover:opacity-100" onClick={() => setShowRightUI(true)}>─Éß╗ïa h├¼nh</button>
        </div>
      )}

      {/* ---- bottom-right: bß║ún ─æß╗ô nhß╗Å (thao t├íc ngay tr├¬n bß║ún ─æß╗ô: ph├│ng to, ─æß╗òi cß╗í, ch├║ th├¡ch, ß║⌐n) */}
      {showMinimap ? (
        <div className="absolute bottom-2 right-2">
          <div className="ts-banner flex flex-col">
            <div className="mb-1 flex items-center gap-1 text-[11px] text-[var(--ink)]">
              <span className="ts-title mr-auto text-sm">Bß║ún ─æß╗ô</span>
              {clashCount > 0 && (
                <button className="ts-btn ts-sm red ts-pulse" title="Qu├ón ta ─æang giao chiß║┐n ΓÇö bß║Ñm ─æß╗â nhß║úy tß╗¢i" onClick={jumpToClash}>ΓÜö {clashCount}</button>
              )}
              <button className="ts-btn ts-sm" title="Thu nhß╗Å (l─ân chuß╗Öt tr├¬n bß║ún ─æß╗ô)" disabled={miniZoom === 0} onClick={() => setMiniZoom((z) => Math.max(0, z - 1))}>ΓêÆ</button>
              <span className="w-6 text-center tabular-nums">{MINI_ZOOMS[miniZoom]}x</span>
              <button className="ts-btn ts-sm" title="Ph├│ng to quanh camera" disabled={miniZoom === MINI_ZOOMS.length - 1} onClick={() => setMiniZoom((z) => Math.min(MINI_ZOOMS.length - 1, z + 1))}>+</button>
              <button className="ts-btn ts-sm" title="─Éß╗òi cß╗í khung bß║ún ─æß╗ô" onClick={() => setMiniSize((z) => (z + 1) % MINI_SIZES.length)}>Γñó</button>
              <button className="ts-btn ts-sm" data-on={showMiniLegend} title="Ch├║ th├¡ch k├╜ hiß╗çu" onClick={() => setShowMiniLegend(!showMiniLegend)}>?</button>
              <button className="ts-btn ts-sm" title="ß║¿n bß║ún ─æß╗ô" onClick={() => setShowMinimap(false)}>Γ£ò</button>
            </div>
            <div className="relative">
            {showMiniLegend && <MiniLegend colors={colors} onClose={() => setShowMiniLegend(false)} />}
            <canvas
              key={miniSize}
              ref={miniRef}
              width={MINI_SIZES[miniSize]}
              height={MINI_SIZES[miniSize]}
              style={{ width: `min(${MINI_SIZES[miniSize]}px, 70vw, 60vh)`, height: `min(${MINI_SIZES[miniSize]}px, 70vw, 60vh)` }}
              className="block cursor-crosshair [image-rendering:pixelated]"
              onPointerDown={miniNav}
              onPointerMove={miniNav}
              onContextMenu={(e) => e.preventDefault()}
            />
            </div>
            <div className="mt-0.5 text-[10px] leading-tight text-[var(--ink)] opacity-75">Tr├íi: dß╗¥i camera ┬╖ Phß║úi: ra lß╗çnh ┬╖ L─ân: ph├│ng to</div>
          </div>
        </div>
      ) : (
        <div className="absolute bottom-2 right-2">
          <button className="ts-btn text-xs px-2 py-1" onClick={() => setShowMinimap(true)}>
            Bß║ún ─æß╗ô{clashCount > 0 ? ` ┬╖ ΓÜö ${clashCount}` : ""}
          </button>
        </div>
      )}

      {/* ---- lß╗çnh ─æang chß╗¥ chuß╗Öt phß║úi & th├┤ng b├ío */}
      {(arm || notice) && (
        <div className="pointer-events-none absolute left-1/2 top-[248px] flex -translate-x-1/2 flex-col items-center gap-1">
          {arm && <div className="rounded bg-black/70 px-3 py-1 text-[12px] font-semibold text-[#ffd76a]">{ARM_HINT[arm]} ┬╖ Esc ─æß╗â huß╗╖</div>}
          {notice && <div className="rounded bg-[#3b2416]/90 px-3 py-1 text-[12px] font-semibold text-white">{notice.text}</div>}
        </div>
      )}

      {/* ---- bottom-center: selection */}
      {selTotal > 0 && stats && (
        <div className="ts-paper absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-3 text-[var(--ink)]">
          <div className="ts-title text-sm">─É├ú chß╗ìn<br /><span className="text-xl">{selTotal.toLocaleString("vi-VN")}</span></div>
          {stats.sel.map((n, t) => n > 0 && (
            <div key={t} className="flex flex-col items-center">
              <img src={`${UI}/Human%20Avatars/Avatars_0${AVATAR_TYPE[t]}.png`} alt="" className="ts-pixel h-12 w-12" />
              <span className="text-[11px] font-bold">{UNIT_VI[t]}</span>
              <span className="text-[11px]">{n.toLocaleString("vi-VN")}</span>
            </div>
          ))}
          <div className="flex flex-col gap-1 border-l border-[#3b2416]/30 pl-3">
            <div className="text-[11px]">
              T╞░ thß║┐: <b>{stats.stance[2] >= stats.stance[0] && stats.stance[2] >= stats.stance[1] ? "Giß╗» vß╗ï tr├¡" : stats.stance[1] > stats.stance[0] ? "Truy k├¡ch" : "Ph├▓ng thß╗º"}</b>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <button className="ts-btn red !min-h-[36px] text-[11px]" data-on={arm === "attack"} onClick={() => toggleArm("attack")}>{arm === "attack" ? "Chß╗ìn ─æ├¡chΓÇª" : "Tß║Ñn c├┤ng (F)"}</button>
              <button className="ts-btn !min-h-[36px] text-[11px]" onClick={() => {
                const w = worldRef.current; if (!w) return;
                const sel = Array.from(w.selected());
                dispatchCommand({ action: "stance", sel, stance: stats.stance[1] * 2 < sel.length ? STANCE_PURSUE : STANCE_DEFEND });
              }}>{stats.stance[1] * 2 < selTotal ? "Truy k├¡ch (T)" : "Ph├▓ng thß╗º (T)"}</button>
              <button className="ts-btn !min-h-[36px] text-[11px]" onClick={() => { const w = worldRef.current; if (w) dispatchCommand({ action: "rally", sel: Array.from(w.selected()) }); }}>Quay ─æß║ºu (G)</button>
              <button className="ts-btn !min-h-[36px] text-[11px]" onClick={() => { const w = worldRef.current; if (w) dispatchCommand({ action: "hold", sel: Array.from(w.selected()) }); }}>Giß╗» (H)</button>
              <button className="ts-btn !min-h-[36px] text-[11px]" data-on={arm === "swim"} title={`B╞íi thß║│ng qua n╞░ß╗¢c s├óu: ${SPEED_SWIM}x tß╗æc ─æß╗Ö, nhß║¡n +50% s├ít th╞░╞íng, kh├┤ng ─æ├ính ─æ╞░ß╗úc khi ─æang b╞íi`} onClick={() => toggleArm("swim")}>{arm === "swim" ? "Chß╗ìn bß╗¥ΓÇª" : "B╞íi qua s├┤ng (V)"}</button>
              <button className="ts-btn !min-h-[36px] text-[11px]" data-on={arm === "bridge"} title={`Bß║»c cß║ºu mß╗¢i qua s├┤ng (mß╗ùi phe tß╗æi ─æa ${MAX_BUILT_BRIDGES}). Cß║ºu phß╗Ñ kh├┤ng t├¡nh l├á ─æß║ºu cß║ºu.`} onClick={() => toggleArm("bridge")}>{arm === "bridge" ? "Chß╗ìn chß╗ùΓÇª" : "Bß║»c cß║ºu (B)"}</button>
            </div>
            <div className="text-[10px] opacity-70">{arm ? ARM_HINT[arm] : "Chuß╗Öt phß║úi = h├ánh qu├ón (bß╗Å qua ─æß╗ïch)"}</div>
          </div>
        </div>
      )}

      {/* ---- victory */}
      {stats && stats.winner >= 0 && !hideVictory && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="flex flex-col items-center">
            <div className={`ts-ribbon ts-ribbon-${colors[stats.winner].toLowerCase()} ts-title min-w-[480px] max-w-[92vw] px-4 text-center text-3xl text-white [text-shadow:0_3px_0_#000]`}>
              {mode === "ai" ? (stats.winner === PLAYER ? "Bß║ín chiß║┐n thß║»ng!" : "M├íy chiß║┐n thß║»ng!") : `Qu├ón ${stats.winner === 0 ? "T├óy" : "─É├┤ng"} chiß║┐n thß║»ng!`}
            </div>
            <div className="ts-paper mt-2 max-w-[520px] text-center text-[var(--ink)]">
              <div className="font-bold">{WIN_REASON_VI[stats.winReason ?? "castle"]}</div>
              <div className="text-[12px] opacity-80">
                Uy thß║┐ {Math.floor(stats.prestige[0])} ΓÇô {Math.floor(stats.prestige[1])} ┬╖ Qu├ón c├▓n {stats.alive[0].toLocaleString("vi-VN")} ΓÇô {stats.alive[1].toLocaleString("vi-VN")} ┬╖ Thß╗¥i gian {fmtTime(stats.time)}
              </div>
              <div className="mt-2 flex justify-center gap-2">
                <button className="ts-btn red text-sm" onClick={onExit}>Tho├ít ra Menu</button>
                <button className="ts-btn text-sm" onClick={() => setHideVictory(true)}>Xem chiß║┐n tr╞░ß╗¥ng</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showHelp && <HowToPlay onClose={() => setShowHelp(false)} />}
      
      {/* ---- m├án h├¼nh bß╗æ tr├¡ */}
      {isDeploying && <Deployment 
        socket={socket}
        roomId={roomId}
        players={players}
        onStart={handleStartDeployment} 
        onCancel={onExit} 
      />}

      {/* ---- loading */}
      {loading && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#1d3b44]">
          <div className="relative flex w-[520px] max-w-[92vw] flex-col items-center">
            <img src="/assets/UI%20Elements/UI%20Banners%20from%20the%20store%20page/Banner/Banner.png" alt="" className="ts-pixel w-full" />
            <div className="absolute inset-x-[14%] top-[30%] flex flex-col items-center gap-3 text-[var(--ink)]">
              <div className="ts-title text-center text-2xl">Tiny Swords<br />─Éß║íi chiß║┐n 9.600 qu├ón</div>
              <div className="ts-bar w-full"><span style={{ width: `${Math.round(loading.pct * 100)}%` }} /></div>
              <div className="text-sm">{loading.label}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Ch├║ th├¡ch k├╜ hiß╗çu tr├¬n bß║ún ─æß╗ô nhß╗Å
function Row({ icon, name }: { icon: React.ReactNode; name: string }) {
  return <div className="flex items-center gap-2 py-[1px]"><span className="inline-flex w-5 justify-center">{icon}</span><span>{name}</span></div>;
}

function MiniLegend({ colors, onClose }: { colors: [TeamColor, TeamColor]; onClose: () => void }) {
  const sq = (c: string, cls = "h-2 w-2") => <span className={`inline-block ${cls} border border-black/40`} style={{ background: c }} />;
  return (
    <div className="absolute inset-0 z-10 overflow-auto rounded bg-[#f3e9c6]/95 p-2 text-[10.5px] leading-tight text-[var(--ink)] shadow">
      <div className="ts-title mb-1 flex items-center justify-between text-sm"><span>Ch├║ th├¡ch</span><button className="ts-btn ts-sm" onClick={onClose}>Γ£ò</button></div>
      <Row icon={sq(COLOR_HEX[colors[0]], "h-1.5 w-1.5")} name="Qu├ón ta" />
      <Row icon={sq(COLOR_HEX[colors[1]], "h-1.5 w-1.5")} name="Qu├ón ─æß╗ïch (chß╗ë khi ─æang thß║Ñy)" />
      <Row icon={sq(COLOR_HEX[colors[0]], "h-2.5 w-3")} name="C├┤ng tr├¼nh (m├áu phe)" />
      <Row icon={<span style={{ color: "#f3e9c6", textShadow: "0 0 1px #000" }}>Γùå</span>} name="Cß╗⌐ ─æiß╗âm s├┤ng (m├áu phe giß╗»)" />
      <Row icon={<span style={{ color: "#f3e9c6", textShadow: "0 0 1px #000" }}>ΓÜæ</span>} name="Cß╗¥ nß╗Öi ─æß╗ïa" />
      <Row icon={<span className="font-bold text-[#ff3c28]">ΓÜö</span>} name="Qu├ón ta ─æang giao chiß║┐n" />
      <Row icon={<span className="font-bold text-[#ffaa28]">ΓÜö</span>} name="─Éß╗ïch giao chiß║┐n (trong tß║ºm nh├¼n)" />
      <Row icon={sq("#a86e3c", "h-1.5 w-3")} name="Cß║ºu gß╗ù / cß║ºu tß╗▒ x├óy" />
      <Row icon={<span className="inline-block h-1.5 w-3 border border-dashed border-[#e9c48f]" />} name="Cß║ºu ─æang x├óy" />
      <Row icon={sq("#47aba9")} name="N╞░ß╗¢c s├óu (b╞íi ─æ╞░ß╗úc, V)" />
      <Row icon={sq("#8ccdbe")} name="B├úi cß║ín" />
      <Row icon={sq("#2c5c34")} name="Rß╗½ng phß╗Ñc k├¡ch" />
      <Row icon={sq("#96b946")} name="Cao nguy├¬n" />
      <Row icon={<span className="inline-block h-2 w-3 border border-[#fff6c8] bg-black/30" />} name="V├╣ng camera ─æang nh├¼n" />
      <Row icon={<span className="inline-block h-2 w-3 bg-black/60" />} name="S╞░╞íng m├╣ (ch╞░a thß║Ñy)" />
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
  prestige: `─Éß║ít ${PRESTIGE_WIN} Uy thß║┐ nhß╗¥ cß║»m cß╗¥ tr├¬n ─æß║Ñt ─æß╗ïch (cß║ºn giß╗» ─æß║ºu cß║ºu) v├á ph├í c├┤ng tr├¼nh.`,
  castle: "Th├ánh ─æß╗ïch ─æ├ú bß╗ï ph├í (cß║ºn giß╗» Cß║ºu giß╗»a ─æß╗â g├óy ─æß╗º s├ít th╞░╞íng).",
  surrender: "Qu├ón ─æß╗ïch c├▓n d╞░ß╗¢i 15% qu├ón chiß║┐n ─æß║Ñu v├á ─æ├ú ─æß║ºu h├áng.",
  time: "Hß║┐t 20 ph├║t ΓÇö ph├ón ─æß╗ïnh bß║▒ng Uy thß║┐, rß╗ôi chß╗ù v╞░ß╗út s├┤ng, rß╗ôi tß╗òng HP.",
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
        <div className="ts-title [text-shadow:0_1px_0_#000,0_0_6px_rgba(0,0,0,.6)]" style={{ color: COLOR_HEX[color] }}>Qu├ón {side === 0 ? "T├óy" : "─É├┤ng"} ┬╖ {COLOR_VI[color]}</div>
        <div className="ts-title text-xl">{alive.toLocaleString("vi-VN")}</div>
        <div className="ts-sword w-[150px]" style={{ borderImageSource: `url(/ui/sword-${color.toLowerCase()}.png)`, width: `${40 + 110 * (alive / 4805)}px` }} />
        <div className={`mt-1 flex items-center gap-1 text-[11px] ${side === 1 ? "flex-row-reverse" : ""}`}>
          <span className="font-bold">Uy thß║┐</span>
          <div className="h-2.5 w-[110px] overflow-hidden rounded-sm border border-black/50 bg-black/40">
            <div className="h-full" style={{ width: `${Math.min(100, (prestige / PRESTIGE_WIN) * 100)}%`, background: COLOR_HEX[color], marginLeft: side === 1 ? "auto" : 0 }} />
          </div>
          <span className="tabular-nums">{Math.floor(prestige)}/{PRESTIGE_WIN}</span>
        </div>
        <div className={`mt-0.5 flex gap-2 text-[11px] ${side === 1 ? "justify-end" : ""}`}>
          <span title="Cß╗⌐ ─æiß╗âm s├┤ng ─æang giß╗»">Γùå S├┤ng {stats?.river[side] ?? 0}/5</span>
          <span title="Cß╗¥ ─æang cß║»m tr├¬n ─æß║Ñt ─æß╗ïch">ΓÜæ Cß╗¥ ─æß╗ïch {stats?.flags[side] ?? 0}</span>
          <span className="flex items-center gap-0.5"><img src={`${UI}/Icons/Icon_09.png`} alt="Hß║í gß╗Ñc" className="h-4 w-4" />{stats?.kills[side] ?? 0}</span>
        </div>
      </div>
    </div>
  );
}



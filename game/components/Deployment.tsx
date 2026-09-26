"use client";
import { useState, useEffect, useCallback } from "react";
import { myPlayerId } from "@/lib/game/playerId";
import { WARRIOR, ARCHER, LANCER, MONK, T } from "@game/shared";
import { DEPLOYMENT_BOUNDS } from "@game/shared";

interface Block {
  id: number;
  type: number;
  gx: number; // -1 means unassigned
  gy: number;
  ownerId: string | null; // socketId của người sở hữu, null = chung (Tướng quản lý)
}

interface DeploymentProps {
  socket?: any;
  roomId?: string;
  players?: any[];
  onStart: (layout: { type: number, px: number, py: number, ownerId: string | null }[]) => void;
  onCancel?: () => void;
}

export function Deployment({ socket, roomId, players, onStart, onCancel }: DeploymentProps) {
  const GRID_SIZE = 512;
  const COLS = 6;
  const ROWS = 24;
  
  // Xác định thông tin người chơi hiện tại và đồng minh
  const myPlayer = players?.find(p => p.playerId === myPlayerId);
  const mySide = myPlayer ? myPlayer.side : 0;
  const isGeneral = myPlayer ? myPlayer.role === "General" : true; // Nếu chơi offline AI thì mặc định là Tướng

  // Sắp xếp đồng minh: Tướng đầu tiên, sau đó xếp theo socketId
  const allies = (players?.filter(p => p.side === mySide) || []).sort((a, b) => {
    if (a.role === "General") return -1;
    if (b.role === "General") return 1;
    return a.socketId.localeCompare(b.socketId);
  });
  
  // Phân bổ khu vực (Fronts)
  const rowsPerPlayer = Math.floor(ROWS / Math.max(1, allies.length));
  const getPlayerZone = (playerId: string) => {
    const idx = allies.findIndex(a => a.playerId === playerId);
    if (idx === -1) return { start: 0, end: ROWS - 1 };
    return {
      start: idx * rowsPerPlayer,
      end: idx === allies.length - 1 ? ROWS - 1 : (idx + 1) * rowsPerPlayer - 1
    };
  };
  
  const myZone = getPlayerZone(myPlayerId);

  const [blocks, setBlocks] = useState<Block[]>(() => {
    const initial: Block[] = [];
    let id = 0;
    const blocksToPlace = [
      ...Array(18).fill(WARRIOR),
      ...Array(10).fill(LANCER),
      ...Array(15).fill(ARCHER),
      ...Array(5).fill(MONK),
    ];
    blocksToPlace.forEach((type) => {
      initial.push({
        id: id++,
        type,
        gx: -1,
        gy: -1,
        ownerId: allies.length > 0 ? allies[0].playerId : myPlayerId, // Mặc định Tướng cầm hết
      });
    });
    return initial;
  });

  // Đồng bộ qua Socket
  useEffect(() => {
    if (!socket || !roomId) return;
    const handleSync = (side: number, newState: Block[]) => {
      if (side === mySide) {
        setBlocks(newState);
      }
    };
    socket.on("deployment_sync", handleSync);
    return () => {
      socket.off("deployment_sync", handleSync);
    };
  }, [socket, roomId, mySide]);

  const updateBlocksAndSync = (newBlocks: Block[]) => {
    setBlocks(newBlocks);
    if (socket && roomId) {
      socket.emit("update_deployment", roomId, mySide, newBlocks);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: number) => {
    e.dataTransfer.setData("text/plain", id.toString());
  };

  const handleDrop = (e: React.DragEvent, gx: number, gy: number) => {
    e.preventDefault();
    const id = parseInt(e.dataTransfer.getData("text/plain"));
    
    // Kiểm tra quyền thả vào ô này
    if (gx !== -1 && gy !== -1) {
       if (gy < myZone.start || gy > myZone.end) {
         // Không được thả vào khu của người khác
         return; 
       }
    }

    const newBlocks = [...blocks];
    const draggedIdx = newBlocks.findIndex(b => b.id === id);
    if (draggedIdx === -1) return;
    
    const draggedBlock = newBlocks[draggedIdx];
    // Nếu block này không thuộc quyền sở hữu của mình thì không được kéo
    if (draggedBlock.ownerId !== myPlayerId) return;

    const targetIdx = newBlocks.findIndex(b => b.gx === gx && b.gy === gy && gx !== -1);
    
    const oldGx = draggedBlock.gx;
    const oldGy = draggedBlock.gy;
    
    draggedBlock.gx = gx;
    draggedBlock.gy = gy;
    
    if (targetIdx !== -1) {
      // Đổi chỗ
      newBlocks[targetIdx].gx = oldGx;
      newBlocks[targetIdx].gy = oldGy;
    }
    
    updateBlocksAndSync(newBlocks);
  };

  const handleAssignUnit = (targetSocketId: string, type: number, amount: number) => {
    if (!isGeneral) return;
    const newBlocks = [...blocks];
    
    if (amount > 0) {
      // Tìm 1 block của Tướng (gx = -1) và giao cho phó tướng
      const block = newBlocks.find(b => b.type === type && b.gx === -1 && b.ownerId === myPlayerId);
      if (block) {
        block.ownerId = targetSocketId;
        updateBlocksAndSync(newBlocks);
      }
    } else {
      // Lấy lại 1 block từ phó tướng (chưa thả lên bàn)
      const block = newBlocks.reverse().find(b => b.type === type && b.gx === -1 && b.ownerId === targetSocketId);
      if (block) {
        block.ownerId = myPlayerId;
        updateBlocksAndSync(newBlocks);
      }
    }
  };

  const handleRecallAll = () => {
    const newBlocks = blocks.map(b => {
      // Chỉ thu hồi quân của mình
      if (b.ownerId === myPlayerId) return { ...b, gx: -1, gy: -1 };
      return b;
    });
    updateBlocksAndSync(newBlocks);
  };

  const handleAutoDeploy = () => {
    const newBlocks = [...blocks];
    const availableCells: {gx: number, gy: number}[] = [];
    
    // Tìm các ô trống trong khu vực của mình
    for (let x = 0; x < COLS; x++) {
      for (let y = myZone.start; y <= myZone.end; y++) {
        if (!newBlocks.some(b => b.gx === x && b.gy === y)) {
          availableCells.push({gx: x, gy: y});
        }
      }
    }
    
    // Xáo trộn
    availableCells.sort(() => Math.random() - 0.5);
    
    let cellIdx = 0;
    // Xếp tự động các khối quân chưa được đưa lên bàn (gx === -1) của mình
    newBlocks.forEach(b => {
      if (b.ownerId === myPlayerId && b.gx === -1 && cellIdx < availableCells.length) {
        b.gx = availableCells[cellIdx].gx;
        b.gy = availableCells[cellIdx].gy;
        cellIdx++;
      }
    });
    
    updateBlocksAndSync(newBlocks);
  };

  const handleStart = () => {
    if (socket && roomId) {
      socket.emit("start_pvp_match", roomId);
      return;
    }
    const layout: { type: number, px: number, py: number, ownerId: string | null, side?: number, squadId?: number }[] = [];
    const { xMin, yMin } = DEPLOYMENT_BOUNDS.WEST; // Phe Đông sẽ tự lật ngược ở world.ts
    
    const GRID_SIZE_WORLD = 9 * T; // 576
    let squadCounter = 0;
    blocks.forEach(b => {
      if (b.gx === -1) return;
      const blockPx = (xMin * T) + (b.gx * GRID_SIZE_WORLD);
      const blockPy = (yMin * T) + (b.gy * GRID_SIZE_WORLD);
      
      const currentSquad = squadCounter++;
      
      for (let c = 0; c < 10; c++) {
        for (let r = 0; r < 10; r++) {
          layout.push({ type: b.type, px: blockPx + 144 + c * 32, py: blockPy + 144 + r * 32, ownerId: b.ownerId, squadId: currentSquad });
        }
      }
    });
    
    onStart(layout);
  };

  // Tính số lượng quân trong kho của từng người
  const getInventoryCount = (socketId: string, type: number) => {
    return blocks.filter(b => b.ownerId === socketId && b.gx === -1 && b.type === type).length;
  };

  const myUnassigned = blocks.filter(b => b.ownerId === myPlayerId && b.gx === -1);
  const assignedBlocks = blocks.filter(b => b.gx !== -1);
  const TYPES = [WARRIOR, LANCER, ARCHER, MONK];
  const TYPE_NAMES: Record<number, string> = { [WARRIOR]: "Kiếm", [ARCHER]: "Cung", [LANCER]: "Kỵ", [MONK]: "Tu sĩ" };
  const TYPE_COLORS: Record<number, string> = { [WARRIOR]: "#d8b284", [ARCHER]: "#7da061", [LANCER]: "#8b3d2b", [MONK]: "#a26ad0" };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#1d3b44] bg-opacity-90">
      <div className="flex h-[90vh] w-[95vw] max-w-[1200px] overflow-hidden rounded border border-black/50 bg-[#e3d5b2] shadow-2xl relative">
        {onCancel && (
          <button 
            className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center bg-black/40 text-white rounded hover:bg-black/60 z-10"
            onClick={onCancel}
          >
            ✕
          </button>
        )}
        
        {/* Panel Trái: Kho quân & Giao quân */}
        <div 
          className="flex w-[350px] flex-col border-r border-black/20 bg-[#d8c599] p-4 relative"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e, -1, -1)}
        >
          <h2 className="ts-title mb-4 text-xl text-[#8b3d2b]">Bố trí đội hình {mySide === 0 ? "(Tây)" : "(Đông)"}</h2>
          
          <div className="text-sm mb-4 bg-black/10 p-2 rounded">
            <strong>Vai trò của bạn:</strong> {isGeneral ? "Tướng quân 👑" : "Phó tướng ⚔️"}<br/>
            <strong>Khu vực quản lý:</strong> Hàng {myZone.start} đến {myZone.end}
          </div>

          <div className="flex-1 overflow-auto bg-[#c5b17a] p-2 rounded shadow-inner mb-4">
            <div className="text-sm ts-title mb-2 opacity-70">Quân của bạn ({myUnassigned.length})</div>
            <div className="flex flex-wrap gap-2 mb-4">
              {TYPES.map(t => {
                const count = getInventoryCount(myPlayerId, t);
                if (count === 0) return null;
                return (
                  <div key={t} className="relative">
                    <div
                      draggable
                      onDragStart={(e) => {
                        // Tìm block đầu tiên của loại này trong kho của mình
                        const b = blocks.find(blk => blk.ownerId === myPlayerId && blk.gx === -1 && blk.type === t);
                        if (b) handleDragStart(e, b.id);
                      }}
                      className="flex items-center justify-center cursor-move ts-pixel border-2 border-black/40 hover:border-white transition-colors"
                      style={{ width: 48, height: 48, backgroundColor: TYPE_COLORS[t], color: 'white', textShadow: '1px 1px 0 #000' }}
                      title="Kéo vào trận địa"
                    >
                      <div className="ts-title text-xs">{TYPE_NAMES[t]}</div>
                    </div>
                    <div className="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shadow">
                      {count}
                    </div>
                  </div>
                );
              })}
            </div>

            {isGeneral && allies.length > 1 && (
              <div className="mt-6 border-t border-black/20 pt-4">
                <div className="text-sm ts-title mb-2 text-[#8b3d2b]">Giao quân cho Phó Tướng</div>
                {allies.filter(a => a.playerId !== myPlayerId).map((ally, i) => (
                  <div key={ally.playerId} className="mb-4 bg-[#d8c599] p-2 rounded border border-black/20">
                    <div className="font-bold text-xs mb-1">
                      {ally.name} (Hàng {getPlayerZone(ally.socketId).start}-{getPlayerZone(ally.socketId).end})
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {TYPES.map(t => {
                        const myCount = getInventoryCount(myPlayerId, t);
                        const allyCount = getInventoryCount(ally.playerId, t);
                        return (
                          <div key={t} className="flex items-center justify-between text-[10px] bg-black/10 px-1 rounded">
                            <span style={{color: TYPE_COLORS[t], fontWeight: "bold"}}>{TYPE_NAMES[t]}: {allyCount}</span>
                            <div className="flex gap-1">
                              <button 
                                className="bg-red-500 text-white w-4 h-4 rounded hover:bg-red-400 disabled:opacity-30" 
                                disabled={allyCount === 0}
                                onClick={() => handleAssignUnit(ally.playerId, t, -1)}
                              >-</button>
                              <button 
                                className="bg-green-500 text-white w-4 h-4 rounded hover:bg-green-400 disabled:opacity-30" 
                                disabled={myCount === 0}
                                onClick={() => handleAssignUnit(ally.playerId, t, 1)}
                              >+</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <button className="ts-btn w-full mb-2 py-1 rounded text-sm bg-[#8b3d2b] text-white" onClick={handleRecallAll}>
            Thu hồi quân của tôi trên bàn
          </button>
          
          <button className="ts-btn w-full mb-2 py-1 rounded text-sm bg-[#5a8c43] text-white" onClick={handleAutoDeploy}>
            Tự động bố trí đội hình
          </button>

          {isGeneral && (
            <button 
              className="ts-btn w-full bg-[#5a8c43] text-white py-3 rounded ts-title text-lg disabled:opacity-50"
              disabled={blocks.some(b => b.gx === -1)} // Phải xếp hết quân mới cho bắt đầu
              onClick={handleStart}
            >
              Vào trận (Chỉ Tướng)
            </button>
          )}
          {!isGeneral && (
            <div className="w-full bg-black/20 text-center py-3 rounded text-sm font-bold opacity-70">
              Chờ Tướng quân Bắt đầu...
            </div>
          )}
        </div>
        
        {/* Panel Phải: Lưới trận địa */}
        <div className="flex-1 overflow-auto p-8 relative flex justify-center bg-[#a3b772]">
          <div 
            className="relative shadow-2xl"
            style={{ 
              width: COLS * 64, 
              height: ROWS * 64,
              backgroundColor: '#899d58',
              backgroundImage: 'linear-gradient(rgba(0,0,0,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.1) 1px, transparent 1px)',
              backgroundSize: '64px 64px'
            }}
          >
            {/* Vẽ đường ranh giới các khu vực */}
            {allies.map((ally, i) => {
              const zone = getPlayerZone(ally.playerId);
              const isMe = ally.playerId === myPlayerId;
              return (
                <div 
                  key={`zone-${ally.playerId}`}
                  className="absolute left-0 right-0 border-l-4 pointer-events-none z-10"
                  style={{
                    top: zone.start * 64,
                    height: (zone.end - zone.start + 1) * 64,
                    borderColor: isMe ? '#ffe400' : 'rgba(0,0,0,0.3)',
                    backgroundColor: isMe ? 'rgba(255, 228, 0, 0.05)' : 'transparent',
                    borderTop: i > 0 ? '2px dashed rgba(0,0,0,0.5)' : 'none'
                  }}
                >
                  <div className="absolute right-2 top-2 text-xs font-bold opacity-50 bg-black/20 px-2 rounded text-white">
                    Khu vực của {ally.name} {isMe ? "(Bạn)" : ""}
                  </div>
                </div>
              );
            })}

            {/* Vùng Drop */}
            {Array.from({ length: COLS * ROWS }).map((_, i) => {
              const gx = i % COLS;
              const gy = Math.floor(i / COLS);
              const inMyZone = gy >= myZone.start && gy <= myZone.end;
              
              return (
                <div
                  key={`cell-${i}`}
                  onDragOver={(e) => { if (inMyZone) e.preventDefault(); }}
                  onDrop={(e) => { if (inMyZone) handleDrop(e, gx, gy); }}
                  className={`absolute ${inMyZone ? 'hover:bg-white/20' : ''}`}
                  style={{ left: gx * 64, top: gy * 64, width: 64, height: 64 }}
                />
              )
            })}
            
            {/* Các blocks đã xếp */}
            {assignedBlocks.map(b => {
              const isMine = b.ownerId === myPlayerId;
              return (
                <div
                  key={b.id}
                  draggable={isMine}
                  onDragStart={(e) => { if (isMine) handleDragStart(e, b.id); }}
                  className={`absolute flex items-center justify-center ts-pixel border-2 transition-colors ${isMine ? 'cursor-move border-black/80 hover:border-white' : 'cursor-not-allowed border-black/30 opacity-80'}`}
                  style={{
                    left: b.gx * 64 + 4,
                    top: b.gy * 64 + 4,
                    width: 56,
                    height: 56,
                    backgroundColor: TYPE_COLORS[b.type],
                    color: 'white',
                    textShadow: '1px 1px 0 #000',
                    zIndex: 20
                  }}
                  title={isMine ? "Quân của bạn" : "Quân của đồng minh"}
                >
                  <div className="ts-title text-xs">{TYPE_NAMES[b.type]}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
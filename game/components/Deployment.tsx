"use client";
import { useState } from "react";
import { WARRIOR, ARCHER, LANCER, MONK, T } from "@game/shared";
import { DEPLOYMENT_BOUNDS } from "@game/shared";

interface Block {
  id: number;
  type: number;
  gx: number;
  gy: number;
}

interface DeploymentProps {
  onStart: (layout: { type: number, px: number, py: number }[]) => void;
}

export function Deployment({ onStart }: DeploymentProps) {
  // Lưới bố trí chia thành ô 8x8 bản đồ = 512x512 pixels
  const GRID_SIZE = 512;
  const COLS = 6;
  const ROWS = 24;
  
  const [blocks, setBlocks] = useState<Block[]>(() => {
    // Khởi tạo ngẫu nhiên khối theo mặc định
    const initial: Block[] = [];
    let id = 0;
    
    // Tạo danh sách các ô trống để nhét block vào
    const availableCells: {gx: number, gy: number}[] = [];
    for (let x = 0; x < COLS; x++) {
      for (let y = 0; y < ROWS; y++) {
        availableCells.push({gx: x, gy: y});
      }
    }
    
    // Xáo trộn
    availableCells.sort(() => Math.random() - 0.5);
    
    // ARMY: [WARRIOR, 1800], [LANCER, 1000], [ARCHER, 1500], [MONK, 500]
    // 1 block = 100 quân.
    const blocksToPlace = [
      ...Array(18).fill(WARRIOR),
      ...Array(10).fill(LANCER),
      ...Array(15).fill(ARCHER),
      ...Array(5).fill(MONK),
    ];
    
    blocksToPlace.forEach((type, index) => {
      const cell = availableCells[index];
      initial.push({
        id: id++,
        type,
        gx: cell.gx,
        gy: cell.gy,
      });
    });
    
    return initial;
  });

  const handleDragStart = (e: React.DragEvent, id: number) => {
    e.dataTransfer.setData("text/plain", id.toString());
  };

  const handleDrop = (e: React.DragEvent, gx: number, gy: number) => {
    const id = parseInt(e.dataTransfer.getData("text/plain"));
    setBlocks(prev => {
      const newBlocks = [...prev];
      const draggedIdx = newBlocks.findIndex(b => b.id === id);
      if (draggedIdx === -1) return prev;
      
      const targetIdx = newBlocks.findIndex(b => b.gx === gx && b.gy === gy);
      
      const draggedBlock = newBlocks[draggedIdx];
      const oldGx = draggedBlock.gx;
      const oldGy = draggedBlock.gy;
      
      draggedBlock.gx = gx;
      draggedBlock.gy = gy;
      
      if (targetIdx !== -1) {
        // Swap
        newBlocks[targetIdx].gx = oldGx;
        newBlocks[targetIdx].gy = oldGy;
      }
      
      return newBlocks;
    });
  };

  const handleStart = () => {
    // Chuyển block thành danh sách các quân
    const layout: { type: number, px: number, py: number }[] = [];
    // Khu vực bố trí (WEST)
    const { xMin, yMin } = DEPLOYMENT_BOUNDS.WEST;
    
    blocks.forEach(b => {
      const blockPx = (xMin * T) + (b.gx * GRID_SIZE);
      const blockPy = (yMin * T) + (b.gy * GRID_SIZE);
      
      // Mỗi khối 10x10 quân, xếp cách nhau 40px (10 * 40 = 400px), nằm gọn trong ô 512px.
      // Canh giữa vào ô 512px: (512 - 400) / 2 = 56px margin
      for (let c = 0; c < 10; c++) {
        for (let r = 0; r < 10; r++) {
          const px = blockPx + 56 + c * 40;
          const py = blockPy + 56 + r * 40;
          layout.push({ type: b.type, px, py });
        }
      }
    });
    
    onStart(layout);
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#1d3b44] bg-opacity-90">
      <div className="flex h-[90vh] w-[90vw] overflow-hidden rounded border border-black/50 bg-[#e3d5b2] shadow-2xl">
        <div className="flex w-64 flex-col border-r border-black/20 bg-[#d8c599] p-4">
          <h2 className="ts-title mb-4 text-xl text-[#8b3d2b]">Bố trí đội hình</h2>
          <p className="mb-4 text-sm opacity-80">
            Kéo thả các khối quân vào lưới. Quân lính đứng gần nhau (trong 8 ô) sẽ tự động tạo thành một đạo quân.
          </p>
          <button 
            className="ts-btn w-full mt-auto bg-[#5a8c43] text-white py-3 rounded ts-title text-lg"
            onClick={handleStart}
          >
            Vào trận
          </button>
        </div>
        
        <div className="flex-1 overflow-auto p-8 relative flex justify-center">
          {/* Lưới bố trí */}
          <div 
            className="relative"
            style={{ 
              width: COLS * 64, 
              height: ROWS * 64,
              backgroundColor: '#a3b772',
              backgroundImage: 'linear-gradient(rgba(0,0,0,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.1) 1px, transparent 1px)',
              backgroundSize: '64px 64px'
            }}
          >
            {/* Vùng Drop */}
            {Array.from({ length: COLS * ROWS }).map((_, i) => {
              const gx = i % COLS;
              const gy = Math.floor(i / COLS);
              return (
                <div
                  key={`cell-${i}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, gx, gy)}
                  className="absolute border border-dashed border-black/10"
                  style={{ left: gx * 64, top: gy * 64, width: 64, height: 64 }}
                />
              )
            })}
            
            {/* Các blocks */}
            {blocks.map(b => (
              <div
                key={b.id}
                draggable
                onDragStart={(e) => handleDragStart(e, b.id)}
                className="absolute flex items-center justify-center cursor-move ts-pixel border-2 border-black/40 hover:border-white transition-colors"
                style={{
                  left: b.gx * 64 + 4,
                  top: b.gy * 64 + 4,
                  width: 56,
                  height: 56,
                  backgroundColor: b.type === WARRIOR ? '#d8b284' : 
                                   b.type === ARCHER ? '#7da061' : 
                                   b.type === LANCER ? '#8b3d2b' : '#a26ad0',
                  color: 'white',
                  textShadow: '1px 1px 0 #000'
                }}
              >
                <div className="ts-title text-xs">
                  {b.type === WARRIOR ? "Kiếm" : 
                   b.type === ARCHER ? "Cung" : 
                   b.type === LANCER ? "Kỵ" : "Tu sĩ"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

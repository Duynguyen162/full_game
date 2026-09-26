import { useState, useEffect } from "react";
import { Socket } from "socket.io-client";
import { myPlayerId } from "@/lib/game/playerId";

interface PlayerInfo {
  socketId: string;
  playerId: string;
  name: string;
  side: number;
  role: "General" | "Lieutenant";
  ready: boolean;
}

interface Room {
  id: string;
  players: PlayerInfo[];
  host: string;
  state: "lobby" | "playing";
  seed: number;
}

export default function MainMenu({
  socket,
  onStartSinglePlayer,
  onStartMultiplayer,
}: {
  socket: Socket | null;
  onStartSinglePlayer: () => void;
  onStartMultiplayer: (roomId: string, seed: number, players: PlayerInfo[]) => void;
}) {
  const [name, setName] = useState("Player" + Math.floor(Math.random() * 1000));
  const [roomIdInput, setRoomIdInput] = useState("");
  const [room, setRoom] = useState<Room | null>(null);

  useEffect(() => {
    if (!socket) return;
    
    socket.on("room_update", (r: Room) => {
      setRoom(r);
    });

    socket.on("game_start", (data: { seed: number; players: PlayerInfo[] }) => {
      if (room) onStartMultiplayer(room.id, data.seed, data.players);
    });

    return () => {
      socket.off("room_update");
      socket.off("game_start");
    };
  }, [socket, room, onStartMultiplayer]);

  if (room) {
    const isHost = room.host === socket?.id;
    const me = room.players.find((p) => p.playerId === myPlayerId);

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#1d3b44]">
        <div className="flex w-[800px] flex-col rounded border border-black/50 bg-[#e3d5b2] p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between border-b border-black/20 pb-4">
            <h2 className="ts-title text-3xl text-[#8b3d2b]">Phòng chờ: {room.id}</h2>
            <div className="text-sm opacity-70">Người chơi: {room.players.length}/8</div>
          </div>

          <div className="flex gap-4">
            {/* Cột Tây */}
            <div className="flex-1 rounded border border-black/20 bg-[#d8c599] p-4">
              <h3 className="ts-title mb-2 text-xl text-[#2a4e6c]">Quân Tây</h3>
              {me?.side !== 0 && (
                <button className="mb-2 w-full rounded bg-[#2a4e6c] py-1 text-white hover:opacity-90" onClick={() => socket?.emit("change_side", room.id, 0)}>
                  Tham gia
                </button>
              )}
              {room.players.filter((p) => p.side === 0).map((p) => (
                <div key={p.playerId} className={`mb-1 flex items-center justify-between rounded bg-[#c5b17a] px-2 py-1 ${p.playerId === myPlayerId ? "border-2 border-black/50" : ""}`}>
                  <span className="font-bold">{p.name} {p.socketId === room.host ? "👑" : ""}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{p.role === "General" ? "Tướng" : "Phó tướng"}</span>
                    <span className={`h-2 w-2 rounded-full ${p.ready ? "bg-green-500" : "bg-red-500"}`}></span>
                  </div>
                </div>
              ))}
            </div>

            {/* Cột Đông */}
            <div className="flex-1 rounded border border-black/20 bg-[#d8c599] p-4">
              <h3 className="ts-title mb-2 text-xl text-[#8b3d2b]">Quân Đông</h3>
              {me?.side !== 1 && (
                <button className="mb-2 w-full rounded bg-[#8b3d2b] py-1 text-white hover:opacity-90" onClick={() => socket?.emit("change_side", room.id, 1)}>
                  Tham gia
                </button>
              )}
              {room.players.filter((p) => p.side === 1).map((p) => (
                <div key={p.playerId} className={`mb-1 flex items-center justify-between rounded bg-[#c5b17a] px-2 py-1 ${p.playerId === myPlayerId ? "border-2 border-black/50" : ""}`}>
                  <span className="font-bold">{p.name} {p.socketId === room.host ? "👑" : ""}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{p.role === "General" ? "Tướng" : "Phó tướng"}</span>
                    <span className={`h-2 w-2 rounded-full ${p.ready ? "bg-green-500" : "bg-red-500"}`}></span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2 rounded border border-black/20 bg-[#d8c599] p-4">
            <div className="flex justify-between items-center mb-2">
               <h3 className="ts-title text-xl">Tuỳ chọn của bạn</h3>
               <button 
                  className={`rounded px-4 py-1 text-white ${me?.ready ? "bg-green-600" : "bg-red-600"}`}
                  onClick={() => socket?.emit("toggle_ready", room.id)}
               >
                 {me?.ready ? "Đã sẵn sàng" : "Chưa sẵn sàng"}
               </button>
            </div>
            
            <div className="flex gap-2">
               Vai trò: 
               <button 
                 className={`px-2 py-0.5 rounded text-sm ${me?.role === "General" ? "bg-black/80 text-white" : "bg-black/20"}`} 
                 disabled={me?.role !== "General" && room.players.some(p => p.side === me?.side && p.role === "General")}
                 title={me?.role !== "General" && room.players.some(p => p.side === me?.side && p.role === "General") ? "Phe đã có Tướng" : ""}
                 onClick={() => socket?.emit("change_role", room.id, "General")}
               >
                 Tướng
               </button>
               <button className={`px-2 py-0.5 rounded text-sm ${me?.role === "Lieutenant" ? "bg-black/80 text-white" : "bg-black/20"}`} onClick={() => socket?.emit("change_role", room.id, "Lieutenant")}>Phó tướng</button>
            </div>
          </div>

          <div className="mt-6 flex gap-4">
            <button className="w-1/3 rounded bg-[#8b3d2b] py-2 text-white hover:opacity-90" onClick={() => { socket?.emit("leave_room", room.id); setRoom(null); }}>
              Rời phòng
            </button>
            {isHost ? (
              <button className="w-2/3 rounded bg-[#5a8c43] py-2 text-white hover:opacity-90 disabled:opacity-50" 
                      onClick={() => socket?.emit("start_game", room.id)}
                      disabled={!room.players.every(p => p.ready || p.socketId === room.host)}
              >
                Bắt đầu trận
              </button>
            ) : (
              <div className="flex w-2/3 items-center justify-center rounded bg-black/10 text-sm opacity-70">
                Chờ chủ phòng bắt đầu...
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#1d3b44]">
      <div className="flex w-[400px] flex-col rounded border border-black/50 bg-[#e3d5b2] p-8 shadow-2xl">
        <h1 className="ts-title mb-6 text-center text-4xl text-[#8b3d2b]">Đại chiến 9.600 quân</h1>

        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tên của bạn"
          className="mb-4 rounded border border-black/20 px-3 py-2 text-center"
        />

        <button className="ts-btn mb-2 bg-[#5a8c43] py-3 text-white" onClick={onStartSinglePlayer}>
          Chơi đơn (Đánh với máy)
        </button>

        <button
          className="ts-btn mb-6 bg-[#2a4e6c] py-3 text-white"
          onClick={() => {
            socket?.emit("create_room", name, myPlayerId, (id: string) => {
              console.log("Created room", id);
            });
          }}
        >
          Tạo phòng chơi (Co-op)
        </button>

        <div className="flex gap-2">
          <input
            type="text"
            value={roomIdInput}
            onChange={(e) => setRoomIdInput(e.target.value)}
            placeholder="Mã phòng"
            className="w-2/3 rounded border border-black/20 px-3 py-2 text-center uppercase"
          />
          <button
            className="ts-btn w-1/3 bg-[#8b3d2b] py-2 text-white"
            onClick={() => {
              if (roomIdInput) {
                socket?.emit("join_room", roomIdInput, name, myPlayerId, (res: any) => {
                  if (res.error) alert(res.error);
                });
              }
            }}
          >
            Vào
          </button>
        </div>
      </div>
    </div>
  );
}

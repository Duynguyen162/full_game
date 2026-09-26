import { Server } from "socket.io";
import { createServer } from "http";

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

export type Role = "General" | "Lieutenant";

export interface PlayerInfo {
  socketId: string;
  playerId: string;
  name: string;
  side: number; // 0: West, 1: East
  role: Role;
  ready: boolean;
}

export interface Room {
  id: string;
  players: PlayerInfo[];
  host: string;
  state: "lobby" | "playing";
  seed: number;
  deployment: Record<number, any>; // Lưu state xếp quân của mỗi phe
}

const rooms = new Map<string, Room>();

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("create_room", (name: string, playerId: string, callback) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const player: PlayerInfo = {
      socketId: socket.id,
      playerId,
      name,
      side: 0,
      role: "General",
      ready: true,
    };
    rooms.set(roomId, {
      id: roomId,
      players: [player],
      host: socket.id,
      state: "lobby",
      seed: Math.floor(Math.random() * 2147483647),
    });
    socket.join(roomId);
    callback(roomId);
    io.to(roomId).emit("room_update", rooms.get(roomId));
  });

  socket.on("join_room", (roomId: string, name: string, playerId: string, callback) => {
    const room = rooms.get(roomId);
    if (!room) return callback({ error: "Phòng không tồn tại" });

    const existing = room.players.find(p => p.playerId === playerId);
    if (existing) {
      existing.socketId = socket.id;
      existing.name = name;
      socket.join(roomId);
      io.to(roomId).emit("room_update", room);
      if (room.state === "playing") {
        socket.emit("match_started", room.deployment[0] || [], room.deployment[1] || []);
      }
      return callback({ success: true, room });
    }

    if (room.state !== "lobby") return callback({ error: "Phòng đang chơi" });
    if (room.players.length >= 8) return callback({ error: "Phòng đã đầy" });

    const side0 = room.players.filter(p => p.side === 0).length;
    const side1 = room.players.filter(p => p.side === 1).length;
    const side = side1 < side0 ? 1 : 0;
    
    const hasGeneral = room.players.some(p => p.side === side && p.role === "General");
    const role: Role = hasGeneral ? "Lieutenant" : "General";

    const player: PlayerInfo = {
      socketId: socket.id,
      playerId,
      name,
      side,
      role,
      ready: false,
    };
    room.players.push(player);
    socket.join(roomId);
    callback({ success: true });
    io.to(roomId).emit("room_update", room);
  });

  // Helper: Đảm bảo một phe luôn có Tướng nếu có người
  function ensureGeneral(room: Room, side: number) {
    const playersOnSide = room.players.filter(p => p.side === side);
    if (playersOnSide.length === 0) return;
    const hasGeneral = playersOnSide.some(p => p.role === "General");
    if (!hasGeneral) {
      playersOnSide[0].role = "General"; // Người đầu tiên trong list (vào sớm nhất) lên làm tướng
    }
  }

  socket.on("change_side", (roomId: string, side: number) => {
    const room = rooms.get(roomId);
    if (!room || room.state !== "lobby") return;
    const p = room.players.find(p => p.socketId === socket.id);
    if (p && p.side !== side) {
      const oldSide = p.side;
      p.side = side;
      // Vào phe mới: nếu đã có Tướng thì làm phó, nếu chưa thì làm Tướng
      const hasGeneral = room.players.some(other => other.socketId !== socket.id && other.side === side && other.role === "General");
      p.role = hasGeneral ? "Lieutenant" : "General";
      // Phe cũ: nếu ông này là Tướng phe cũ rời đi, đôn người khác lên
      ensureGeneral(room, oldSide);
      io.to(roomId).emit("room_update", room);
    }
  });

  socket.on("change_role", (roomId: string, role: Role) => {
    const room = rooms.get(roomId);
    if (!room || room.state !== "lobby") return;
    const p = room.players.find(p => p.socketId === socket.id);
    if (p) {
      if (role === "General") {
        // Chỉ được làm tướng nếu phe này chưa có ai làm tướng
        const hasGeneral = room.players.some(other => other.side === p.side && other.role === "General");
        if (hasGeneral) return; // Không cho cướp quyền
        p.role = role;
      } else {
        // Nhường quyền làm tướng (xuống phó)
        p.role = "Lieutenant";
        ensureGeneral(room, p.side); // Đôn người khác lên làm tướng
      }
      io.to(roomId).emit("room_update", room);
    }
  });

  socket.on("toggle_ready", (roomId: string) => {
    const room = rooms.get(roomId);
    if (!room || room.state !== "lobby") return;
    const p = room.players.find(p => p.socketId === socket.id);
    if (p) {
      p.ready = !p.ready;
      io.to(roomId).emit("room_update", room);
    }
  });

  socket.on("start_game", (roomId: string) => {
    const room = rooms.get(roomId);
    if (!room || room.host !== socket.id || room.state !== "lobby") return;
    const allReady = room.players.every(p => p.ready || p.socketId === room.host);
    if (!allReady) return;

    room.state = "playing";
    room.seed = Math.floor(Math.random() * 2147483647);
    room.deployment = {};
    io.to(roomId).emit("game_start", { seed: room.seed, players: room.players });

    // Per-room tick loop
    let tick = 0;
    const interval = setInterval(() => {
      if (!rooms.has(roomId) || rooms.get(roomId)?.state !== "playing") {
        clearInterval(interval);
        return;
      }
      tick++;
      io.to(roomId).emit("tick", tick);
    }, 100);
  });

  socket.on("command", (roomId: string, data: any) => {
    const room = rooms.get(roomId);
    if (room) {
      const player = room.players.find(p => p.socketId === socket.id);
      if (player) {
        data.senderId = player.playerId;
        io.to(roomId).emit("command", data);
      }
    }
  });

  socket.on("update_deployment", (roomId: string, side: number, state: any) => {
    const room = rooms.get(roomId);
    if (room) {
      room.deployment[side] = state;
    }
    socket.to(roomId).emit("deployment_sync", side, state);
  });

  socket.on("request_deployment", (roomId: string, side: number) => {
    const room = rooms.get(roomId);
    if (room && room.deployment[side]) {
      socket.emit("deployment_sync", side, room.deployment[side]);
    }
  });

  socket.on("start_pvp_match", (roomId: string) => {
    const room = rooms.get(roomId);
    if (!room) return;
    io.to(roomId).emit("match_started", room.deployment[0] || [], room.deployment[1] || []);
  });

  socket.on("leave_room", (roomId: string) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const idx = room.players.findIndex(p => p.socketId === socket.id);
    if (idx !== -1) {
      const oldSide = room.players[idx].side;
      room.players.splice(idx, 1);
      socket.leave(roomId);
      if (room.players.length === 0) {
        rooms.delete(roomId);
      } else {
        if (room.host === socket.id) room.host = room.players[0].socketId;
        ensureGeneral(room, oldSide);
        io.to(roomId).emit("room_update", room);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    for (const [roomId, room] of rooms.entries()) {
      const idx = room.players.findIndex(p => p.socketId === socket.id);
      if (idx !== -1) {
        if (room.state === "playing") {
          // Do not remove player from active match, let them rejoin
          continue;
        }
        const oldSide = room.players[idx].side;
        room.players.splice(idx, 1);
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          if (room.host === socket.id) room.host = room.players[0].socketId; // Keep host as socket.id for now since we haven't migrated host to playerId
          ensureGeneral(room, oldSide);
          io.to(roomId).emit("room_update", room);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Game Server running on port ${PORT}`);
});

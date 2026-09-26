"use client";
import { useState, useEffect } from "react";
import BattleMap from "@/components/BattleMap";
import MainMenu from "@/components/MainMenu";
import { io, Socket } from "socket.io-client";

export default function Home() {
  const [appState, setAppState] = useState<"menu" | "playing">("menu");
  const [socket, setSocket] = useState<Socket | null>(null);
  
  // Game config (from local AI or multiplayer)
  const [mode, setMode] = useState<"ai" | "pvp">("ai");
  const [seed, setSeed] = useState(12345);
  const [roomId, setRoomId] = useState("");
  const [players, setPlayers] = useState<any[]>([]);

  useEffect(() => {
    // Connect to server (fallback to localhost:4000 for dev)
    const s = io("http://localhost:4000");
    setSocket(s);
    return () => { s.disconnect(); };
  }, []);

  if (appState === "menu") {
    return (
      <MainMenu 
        socket={socket} 
        onStartSinglePlayer={() => {
          setMode("ai");
          setSeed(Math.floor(Math.random() * 2147483647));
          setAppState("playing");
        }}
        onStartMultiplayer={(room, s, plist) => {
          setMode("pvp");
          setRoomId(room);
          setSeed(s);
          setPlayers(plist);
          setAppState("playing");
        }}
      />
    );
  }

  return (
    <BattleMap 
      mode={mode}
      seed={seed}
      socket={socket}
      roomId={roomId}
      players={players}
      onExit={() => setAppState("menu")}
    />
  );
}

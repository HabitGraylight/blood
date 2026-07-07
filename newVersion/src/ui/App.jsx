import React, { useState, useCallback } from "react";
import { HomeScreen } from "./screens/HomeScreen.jsx";
import { SingleSetupScreen } from "./screens/SingleSetupScreen.jsx";
import { MultiLobbyScreen } from "./screens/MultiLobbyScreen.jsx";
import { RoomScreen } from "./screens/RoomScreen.jsx";
import { GameScreen } from "./screens/GameScreen.jsx";
import { SettingsModal } from "./components/SettingsModal.jsx";
import { LocalSession } from "../session/localSession.js";

/**
 * 顶层路由(简单状态机,无需 router):
 * home -> single-setup -> game
 * home -> multi-lobby -> room(大厅) -> game
 */
export function App() {
  const [screen, setScreen] = useState("home");
  const [session, setSession] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const goHome = useCallback(() => {
    if (session) session.leave();
    setSession(null);
    setScreen("home");
  }, [session]);

  const startSingle = useCallback((playerName, playerCount) => {
    const s = new LocalSession({ playerName, playerCount });
    setSession(s);
    setScreen("game");
  }, []);

  const enterRoom = useCallback((s) => {
    setSession(s);
    setScreen("room");
  }, []);

  return (
    <div className="app">
      {screen === "home" && (
        <HomeScreen
          onSingle={() => setScreen("single-setup")}
          onMulti={() => setScreen("multi-lobby")}
          onSettings={() => setShowSettings(true)}
        />
      )}
      {screen === "single-setup" && (
        <SingleSetupScreen onStart={startSingle} onBack={goHome} />
      )}
      {screen === "multi-lobby" && (
        <MultiLobbyScreen onEnterRoom={enterRoom} onBack={goHome} />
      )}
      {screen === "room" && session && (
        <RoomScreen
          session={session}
          onGameStart={() => setScreen("game")}
          onLeave={goHome}
        />
      )}
      {screen === "game" && session && (
        <GameScreen session={session} onLeave={goHome} />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

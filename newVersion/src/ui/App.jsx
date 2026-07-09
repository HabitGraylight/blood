import React, { useState, useCallback, useEffect } from "react";
import { AuthScreen } from "./screens/AuthScreen.jsx";
import { HomeScreen } from "./screens/HomeScreen.jsx";
import { ProfileScreen } from "./screens/ProfileScreen.jsx";
import { SingleSetupScreen } from "./screens/SingleSetupScreen.jsx";
import { MultiLobbyScreen } from "./screens/MultiLobbyScreen.jsx";
import { RoomScreen } from "./screens/RoomScreen.jsx";
import { GameScreen } from "./screens/GameScreen.jsx";
import { LocalSession } from "../session/localSession.js";
import { FirebaseHostSession } from "../session/firebaseSession.js";
import { watchAuth, logout } from "../session/firebase.js";

const VALID_SCREENS = new Set(["home", "profile", "single", "multi", "room", "game"]);

function screenFromHash() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  return VALID_SCREENS.has(raw) ? raw : "home";
}

function writeHash(screen) {
  const next = `#/${screen}`;
  if (window.location.hash !== next) window.history.replaceState(null, "", next);
}

async function restoreSessionForRoute(route) {
  if (route === "game") {
    const local = LocalSession.resume();
    if (local) return { session: local, screen: "game" };
  }

  if (route === "game" || route === "room") {
    try {
      const remote = await FirebaseHostSession.resumeSaved();
      if (remote) {
        return {
          session: remote,
          screen: remote.status === "playing" || route === "game" ? "game" : "room"
        };
      }
    } catch (error) {
      console.warn("恢复联机房间失败:", error);
    }
  }

  return null;
}

export function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [screen, setScreen] = useState("restoring");
  const [session, setSession] = useState(null);

  const navigate = useCallback((next) => {
    writeHash(next);
    setScreen(next);
  }, []);

  useEffect(() => {
    const unwatch = watchAuth((user) => {
      setAuthUser(user);
      setAuthReady(true);
      if (!user) {
        if (session) session.leave();
        setSession(null);
        setScreen("auth");
      }
    });
    return () => unwatch();
  }, []);

  useEffect(() => {
    if (!authReady || !authUser) return;
    let cancelled = false;

    const restore = async () => {
      const route = screenFromHash();
      const restored = await restoreSessionForRoute(route);
      if (cancelled) return;
      if (restored) {
        setSession(restored.session);
        setScreen(restored.screen);
        writeHash(restored.screen);
        return;
      }
      const fallback = route === "game" || route === "room" ? "home" : route;
      setScreen(fallback);
      writeHash(fallback);
    };

    restore();

    const onHashChange = async () => {
      const next = screenFromHash();
      if ((next === "game" || next === "room") && !session) {
        const restored = await restoreSessionForRoute(next);
        if (restored) {
          setSession(restored.session);
          setScreen(restored.screen);
          writeHash(restored.screen);
          return;
        }
        navigate("home");
        return;
      }
      setScreen(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [authReady, authUser, navigate]);

  const goHome = useCallback(() => {
    if (session) session.leave();
    setSession(null);
    navigate("home");
  }, [session, navigate]);

  const startSingle = useCallback((playerName, playerCount, scriptId, aiStoryteller = true, aiDebugLog = false) => {
    const s = new LocalSession({
      playerName, playerCount, scriptId, aiStoryteller, aiDebugLog,
      avatar: authUser?.photoURL || null
    });
    setSession(s);
    navigate("game");
  }, [navigate, authUser]);

  const enterRoom = useCallback((s) => {
    setSession(s);
    navigate("room");
  }, [navigate]);

  const handleLogout = useCallback(async () => {
    if (session) session.leave();
    setSession(null);
    await logout();
    writeHash("home");
    setScreen("auth");
  }, [session]);

  if (!authReady || screen === "restoring") {
    return (
      <div className="app app-shell route-restoring">
        <div className="route-loading panel">正在翻开上一次的魔典……</div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="app app-shell route-auth">
        <AuthScreen />
      </div>
    );
  }

  return (
    <div className={`app app-shell route-${screen}`}>
      {screen === "home" && (
        <HomeScreen
          user={authUser}
          onLogout={handleLogout}
          onProfile={() => navigate("profile")}
          onSingle={() => navigate("single")}
          onMulti={() => navigate("multi")}
        />
      )}
      {screen === "profile" && (
        <ProfileScreen user={authUser} onBack={goHome} />
      )}
      {screen === "single" && (
        <SingleSetupScreen onStart={startSingle} onBack={goHome} />
      )}
      {screen === "multi" && (
        <MultiLobbyScreen onEnterRoom={enterRoom} onBack={goHome} user={authUser} />
      )}
      {screen === "room" && session && (
        <RoomScreen
          session={session}
          onGameStart={() => navigate("game")}
          onLeave={goHome}
        />
      )}
      {screen === "game" && session && (
        <GameScreen session={session} onLeave={goHome} />
      )}
    </div>
  );
}



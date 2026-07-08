import React from "react";

const PATHS = {
  player: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  ai: "M7 8h10v8H7z M9 8V5m6 3V5 M9 12h.01M15 12h.01 M10 16l-2 3m6-3 2 3",
  dead: "M8 8l8 8M16 8l-8 8M6 20h12M9 20v-3m6 3v-3",
  ghostVote: "M12 3c3 3 5 6 5 10a5 5 0 0 1-10 0c0-4 2-7 5-10Zm0 10v7",
  hand: "M7 12V7a1 1 0 0 1 2 0v5M9 12V5a1 1 0 0 1 2 0v7M11 12V6a1 1 0 0 1 2 0v6M13 12V8a1 1 0 0 1 2 0v5l2-2a1 1 0 0 1 2 1l-3 6a6 6 0 0 1-11-3v-3",
  day: "M12 5v2m0 10v2M5 12h2m10 0h2M7 7l1.5 1.5M15.5 15.5L17 17M17 7l-1.5 1.5M8.5 15.5L7 17M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  night: "M18 15.5A7 7 0 0 1 8.5 6 7 7 0 1 0 18 15.5Z",
  end: "M6 4h10l-2 4 2 4H6v8",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v3m0 12v3M4.8 4.8l2.1 2.1m10.2 10.2 2.1 2.1M3 12h3m12 0h3M4.8 19.2l2.1-2.1M17.1 6.9l2.1-2.1",
  upload: "M12 16V4m0 0 4 4m-4-4-4 4M5 20h14",
  replay: "M4 7v5h5M5 12a7 7 0 1 0 2-5",
  chat: "M4 5h16v10H8l-4 4V5Z",
  whisper: "M6 11a6 6 0 0 1 12 0v2h1v7H5v-7h1v-2Zm3 2h6v-2a3 3 0 0 0-6 0v2Z",
  log: "M7 4h10v16H7z M9 8h6M9 12h6M9 16h4",
  nominate: "M5 19h14M8 17V7h8v10M10 7V5h4v2",
  slayer: "M4 20 20 4M14 4h6v6M6 14l4 4",
  dusk: "M4 17h16M6 14a6 6 0 0 1 12 0M12 8V5M7 10 5.5 8.5M17 10l1.5-1.5",
  voteNo: "M7 7l10 10M17 7 7 17",
  back: "M15 6 9 12l6 6",
  room: "M4 10l8-6 8 6v10H4zM9 20v-6h6v6",
  storyteller: "M5 4h14v12H8l-3 4V4ZM8 8h8M8 12h6"
};

export function Icon({ name, size = 18, title, className = "" }) {
  const path = PATHS[name] || PATHS.player;
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" role={title ? "img" : "presentation"} aria-label={title}>
      {title && <title>{title}</title>}
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


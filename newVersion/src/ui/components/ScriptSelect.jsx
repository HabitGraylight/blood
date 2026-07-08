import React, { useEffect, useRef, useState } from "react";

export function ScriptSelect({ scripts, value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = scripts.find((script) => script.id === value) || scripts[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      if (!rootRef.current || rootRef.current.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (scriptId) => {
    onChange(scriptId);
    setOpen(false);
  };

  return (
    <div className={`script-select ${open ? "open" : ""}`} ref={rootRef}>
      <button
        className="script-select-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        <span>
          <strong>{current.name}</strong>
          <small>{current.englishName}</small>
        </span>
        <i aria-hidden />
      </button>
      {open && (
        <div className="script-select-menu" role="listbox">
          {scripts.map((script) => (
            <button
              key={script.id}
              type="button"
              role="option"
              aria-selected={script.id === value}
              className={`script-option ${script.id === value ? "selected" : ""}`}
              onClick={() => choose(script.id)}
            >
              <span>
                <strong>{script.name}</strong>
                <small>{script.englishName}</small>
              </span>
              {script.id === value && <b>已选</b>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

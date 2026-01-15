import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logger } from "../../lib/logger-client";
import { eventBus } from "../../entities";

export const SearchBar = () => {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        hideSpotlight();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    // Clear query when window loses focus (spotlight closes) via eventBus
    const handleFocusChanged = ({ focused }: { focused: boolean }) => {
      if (!focused) {
        setQuery("");
      }
    };

    eventBus.on("window:focus-changed", handleFocusChanged);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      eventBus.off("window:focus-changed", handleFocusChanged);
    };
  }, []);

  const hideSpotlight = async () => {
    setQuery("");
    await invoke("hide_spotlight");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    logger.log("Search query:", query);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full px-4 py-4 bg-gradient-to-br from-surface-900 to-surface-800 text-white text-3xl font-light focus:outline-none rounded-xl border border-surface-700/50 shadow-2xl"
        autoFocus
        spellCheck={false}
      />
    </form>
  );
};

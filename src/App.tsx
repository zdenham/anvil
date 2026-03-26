import { useState, useEffect } from "react";
import { getCurrentWindow, LogicalSize } from "@/lib/browser-stubs";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { MainWindowLayout } from "./components/main-window/main-window-layout";
import { hydrateEntities, setupEntityListeners } from "./entities";
import { isOnboarded, completeOnboarding } from "./lib/hotkey-service";
import { initializeTriggers } from "./lib/triggers";
import { bootstrapAnvilDirectory } from "./lib/anvil-bootstrap";
import { initAgentMessageListener, cleanupAgentMessageListener } from "./lib/agent-service";
import { logger } from "./lib/logger-client";
import { AnvilAnimation } from "./components/ui/anvil-animation";

// Initialize trigger system for @ file mentions
initializeTriggers();

type AppState =
  | { status: "loading" }
  | { status: "onboarding" }
  | { status: "ready" };

function App() {
  const [appState, setAppState] = useState<AppState>({ status: "loading" });
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    async function checkInitialState() {
      const t0 = performance.now();

      const tOnboarded = performance.now();
      const onboarded = await isOnboarded();
      const isOnboardedMs = performance.now() - tOnboarded;

      if (!onboarded) {
        setAppState({ status: "onboarding" });
        logger.info(`[startup] checkInitialState: ${(performance.now() - t0).toFixed(0)}ms (→ onboarding)`, { isOnboardedMs: +isOnboardedMs.toFixed(0) });
        return;
      }

      setAppState({ status: "ready" });
      logger.info(`[startup] checkInitialState: ${(performance.now() - t0).toFixed(0)}ms (→ ready)`, { isOnboardedMs: +isOnboardedMs.toFixed(0) });
    }

    checkInitialState().catch((err) => logger.error("[startup] checkInitialState failed:", err));
  }, []);

  // IMPORTANT: Bootstrap only runs when status is 'ready'
  useEffect(() => {
    if (appState.status !== "ready") return;

    let cleanupEntityListeners: (() => void) | null = null;

    async function bootstrap() {
      const t0 = performance.now();

      const timings: Record<string, number> = {};

      let t = performance.now();
      const window = getCurrentWindow();
      await window.setSize(new LogicalSize(900, 600));
      timings.setSize = +(performance.now() - t).toFixed(0);

      t = performance.now();
      await bootstrapAnvilDirectory();
      timings.bootstrapAnvilDir = +(performance.now() - t).toFixed(0);

      t = performance.now();
      await hydrateEntities();
      timings.hydrateEntities = +(performance.now() - t).toFixed(0);

      t = performance.now();
      cleanupEntityListeners = setupEntityListeners();
      timings.setupListeners = +(performance.now() - t).toFixed(0);

      t = performance.now();
      await initAgentMessageListener();
      timings.initAgentListener = +(performance.now() - t).toFixed(0);

      setIsHydrated(true);
      timings.total = +(performance.now() - t0).toFixed(0);
      logger.info("[startup] Bootstrap complete", timings);
    }

    bootstrap();

    // Cleanup on unmount (handles StrictMode double-mount)
    return () => {
      cleanupAgentMessageListener();
      cleanupEntityListeners?.();
    };
  }, [appState.status]);

  const handleOnboardingComplete = async () => {
    await completeOnboarding();
    const window = getCurrentWindow();
    await window.setSize(new LogicalSize(900, 600));
    setAppState({ status: "ready" });
  };

  // Render based on state
  switch (appState.status) {
    case "loading":
      return <LoadingScreen />;

    case "onboarding":
      return <OnboardingFlow onComplete={handleOnboardingComplete} />;

    case "ready":
      return isHydrated ? <MainWindowLayout /> : <LoadingScreen />;
  }
}

function LoadingScreen() {
  return (
    <div className="h-full flex items-center justify-center bg-surface-900">
      <AnvilAnimation />
    </div>
  );
}

export default App;

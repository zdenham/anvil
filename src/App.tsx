import { useState, useEffect } from "react";
import { getCurrentWindow, LogicalSize } from "@/lib/browser-stubs";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { MainWindowLayout } from "./components/main-window/main-window-layout";
import { hydrateEntities, setupEntityListeners } from "./entities";
import { isOnboarded, completeOnboarding } from "./lib/hotkey-service";
import { initializeTriggers } from "./lib/triggers";
import { bootstrapAnvilDirectory } from "./lib/mort-bootstrap";
import { initAgentMessageListener, cleanupAgentMessageListener } from "./lib/agent-service";
import { logger } from "./lib/logger-client";

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
      logger.info(`[startup] isOnboarded: ${(performance.now() - tOnboarded).toFixed(0)}ms`);

      if (!onboarded) {
        setAppState({ status: "onboarding" });
        logger.info(`[startup] checkInitialState total: ${(performance.now() - t0).toFixed(0)}ms (→ onboarding)`);
        return;
      }

      setAppState({ status: "ready" });
      logger.info(`[startup] checkInitialState total: ${(performance.now() - t0).toFixed(0)}ms (→ ready)`);
    }

    checkInitialState().catch((err) => logger.error("[startup] checkInitialState failed:", err));
  }, []);

  // IMPORTANT: Bootstrap only runs when status is 'ready'
  useEffect(() => {
    if (appState.status !== "ready") return;

    let cleanupEntityListeners: (() => void) | null = null;

    async function bootstrap() {
      const t0 = performance.now();

      let t = performance.now();
      const window = getCurrentWindow();
      await window.setSize(new LogicalSize(900, 600));
      logger.info(`[startup] window.setSize: ${(performance.now() - t).toFixed(0)}ms`);

      t = performance.now();
      await bootstrapAnvilDirectory();
      logger.info(`[startup] bootstrapAnvilDirectory: ${(performance.now() - t).toFixed(0)}ms`);

      t = performance.now();
      await hydrateEntities();
      logger.info(`[startup] hydrateEntities: ${(performance.now() - t).toFixed(0)}ms`);

      t = performance.now();
      cleanupEntityListeners = setupEntityListeners();
      logger.info(`[startup] setupEntityListeners: ${(performance.now() - t).toFixed(0)}ms`);

      t = performance.now();
      await initAgentMessageListener();
      logger.info(`[startup] initAgentMessageListener: ${(performance.now() - t).toFixed(0)}ms`);

      setIsHydrated(true);
      logger.info(`[startup] === BOOTSTRAP COMPLETE === total: ${(performance.now() - t0).toFixed(0)}ms`);
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
      <div className="text-surface-500">Loading...</div>
    </div>
  );
}

export default App;

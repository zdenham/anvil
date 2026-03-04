import { useState, useEffect } from "react";
import { getCurrentWindow, LogicalSize } from "@/lib/browser-stubs";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { PermissionsPrompt } from "./components/PermissionsPrompt";
import { MainWindowLayout } from "./components/main-window/main-window-layout";
import { hydrateEntities, setupEntityListeners } from "./entities";
import { isOnboarded, completeOnboarding } from "./lib/hotkey-service";
import { spotlightShortcutCommands } from "./lib/tauri-commands";
import { initializeTriggers } from "./lib/triggers";
import { bootstrapMortDirectory } from "./lib/mort-bootstrap";
import { initAgentMessageListener, cleanupAgentMessageListener } from "./lib/agent-service";

// Initialize trigger system for @ file mentions
initializeTriggers();

type AppState =
  | { status: "loading" }
  | { status: "onboarding" }
  | { status: "permissions-prompt" }
  | { status: "ready" };

function App() {
  const [appState, setAppState] = useState<AppState>({ status: "loading" });
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    async function checkInitialState() {
      const onboarded = await isOnboarded();

      if (!onboarded) {
        setAppState({ status: "onboarding" });
        return;
      }

      // Check accessibility permission for onboarded users
      // Accessibility is needed for clipboard paste and keyboard automation
      const hasAccessibility = await spotlightShortcutCommands
        .checkAccessibilityPermission()
        .catch((err) => {
          console.error("[App] Accessibility check failed:", err);
          return false;
        });

      console.log("[App] Accessibility permission check result:", hasAccessibility);

      if (!hasAccessibility) {
        console.log("[App] Showing permissions prompt");
        setAppState({ status: "permissions-prompt" });
      } else {
        console.log("[App] Accessibility granted, proceeding to ready state");
        setAppState({ status: "ready" });
      }
    }

    checkInitialState().catch(console.error);
  }, []);

  // IMPORTANT: Bootstrap only runs when status is 'ready'
  // This ensures permissions prompt is shown BEFORE any bootstrap attempt
  // (no entity hydration, no listeners, no window resize until after permissions)
  useEffect(() => {
    if (appState.status !== "ready") return;

    async function bootstrap() {
      const window = getCurrentWindow();
      await window.setSize(new LogicalSize(900, 600));
      // Bootstrap .mort directory structure before hydrating entities
      await bootstrapMortDirectory();
      await hydrateEntities();
      setupEntityListeners();
      // Initialize agent message listener for socket IPC
      await initAgentMessageListener();
      setIsHydrated(true);
    }

    bootstrap();

    // Cleanup on unmount
    return () => {
      cleanupAgentMessageListener();
    };
  }, [appState.status]);

  const handleOnboardingComplete = async () => {
    await completeOnboarding();
    const window = getCurrentWindow();
    await window.setSize(new LogicalSize(900, 600));
    setAppState({ status: "ready" });
  };

  const handlePermissionsComplete = () => {
    setAppState({ status: "ready" });
  };

  // Render based on state
  switch (appState.status) {
    case "loading":
      return <LoadingScreen />;

    case "onboarding":
      return <OnboardingFlow onComplete={handleOnboardingComplete} />;

    case "permissions-prompt":
      return <PermissionsPrompt onComplete={handlePermissionsComplete} />;

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

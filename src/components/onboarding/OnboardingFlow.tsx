import { useState, useEffect, useCallback } from "react";
import { Button } from "../reusable/Button";
import { saveHotkey } from "../../lib/hotkey-service";
import { repoService } from "../../entities/repositories";
import { bootstrapMortDirectory } from "../../lib/mort-bootstrap";
import { logger } from "../../lib/logger-client";
import { WelcomeStep } from "./steps/WelcomeStep";
import { SpotlightStep } from "./steps/SpotlightStep";
import { RepositoryStep } from "./steps/RepositoryStep";
import { PermissionsStep } from "./steps/PermissionsStep";
import { HotkeyRecorder } from "./HotkeyRecorder";

type OnboardingStepName = 'welcome' | 'permissions' | 'spotlight' | 'repository';

interface OnboardingFlowProps {
  onComplete: () => void;
}

export const OnboardingFlow = ({ onComplete }: OnboardingFlowProps) => {
  const [currentStep, setCurrentStep] = useState<OnboardingStepName>('welcome');
  const [hotkey, setHotkey] = useState("Command+Space"); // Default to Command+Space
  const [selectedRepository, setSelectedRepository] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [existingRepoName, setExistingRepoName] = useState<string | null>(null);
  const [isEditingHotkey, setIsEditingHotkey] = useState(false);
  const [pendingHotkey, setPendingHotkey] = useState("");

  // Handler for when accessibility access is granted
  const handleAccessibilityGranted = useCallback(() => {
    setAccessibilityGranted(true);
  }, []);

  // Check for existing repositories on mount
  useEffect(() => {
    async function checkExistingRepo() {
      try {
        // Bootstrap .mort directory and hydrate repos
        await bootstrapMortDirectory();
        await repoService.hydrate();

        const repos = repoService.getAll();
        if (repos.length > 0 && repos[0].sourcePath) {
          // Pre-select the first existing repository
          setSelectedRepository(repos[0].sourcePath);
          setExistingRepoName(repos[0].name);
        }
      } catch (err) {
        console.error("[OnboardingFlow] Failed to check existing repos:", err);
      }
    }

    checkExistingRepo();
  }, []);

  // Shared setup completion logic used by both Enter key and Next button
  const completeSetup = useCallback(async () => {
    setIsRegistering(true);
    setError(null);
    try {
      logger.debug("[OnboardingFlow] Completing setup...");
      await saveHotkey(hotkey);
      // Create the repository with worktrees before marking onboarding complete
      // Skip if using an existing repository (already set up)
      if (selectedRepository && !existingRepoName) {
        await repoService.createFromFolder(selectedRepository);
      }
      onComplete();
    } catch (err) {
      logger.error("[OnboardingFlow] Failed to complete setup:", err);
      setError(
        err instanceof Error ? err.message : "Failed to complete setup"
      );
    } finally {
      setIsRegistering(false);
    }
  }, [hotkey, selectedRepository, existingRepoName, onComplete]);

  // Handle Enter key to advance
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle Enter if editing hotkey
      if (isEditingHotkey) return;

      if (e.key === 'Enter') {
        // Check if we can proceed based on current step
        const canProceedNow = (() => {
          switch (currentStep) {
            case 'welcome':
              return true;
            case 'permissions':
              return accessibilityGranted;
            case 'spotlight':
              return true;
            case 'repository':
              return !!selectedRepository;
            default:
              return false;
          }
        })();

        if (canProceedNow && !isRegistering) {
          // Call handleNext logic directly to avoid dependency issues
          const nextStep = (() => {
            if (currentStep === 'welcome') return 'permissions';
            if (currentStep === 'permissions') return 'spotlight';
            if (currentStep === 'spotlight') return 'repository';
            return null; // Final step
          })();

          if (nextStep) {
            setCurrentStep(nextStep);
          } else {
            completeSetup();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, selectedRepository, isRegistering, isEditingHotkey, accessibilityGranted, completeSetup]);

  const getNextStep = (): OnboardingStepName | null => {
    if (currentStep === 'welcome') return 'permissions';
    if (currentStep === 'permissions') return 'spotlight';
    if (currentStep === 'spotlight') return 'repository';
    return null; // Final step
  };

  const getPreviousStep = (): OnboardingStepName | null => {
    if (currentStep === 'repository') return 'spotlight';
    if (currentStep === 'spotlight') return 'permissions';
    if (currentStep === 'permissions') return 'welcome';
    return null; // First step
  };

  const handleNext = async () => {
    const nextStep = getNextStep();

    if (nextStep) {
      // If on spotlight step proceeding with "It's disabled", ensure hotkey is Command+Space
      if (currentStep === 'spotlight') {
        setHotkey("Command+Space");
      }
      setCurrentStep(nextStep);
      return;
    }

    // Final step: save the hotkey and repository, then complete onboarding
    await completeSetup();
  };

  const handleBack = () => {
    const prevStep = getPreviousStep();
    if (prevStep) {
      setCurrentStep(prevStep);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 'welcome':
        return true;
      case 'permissions':
        return accessibilityGranted;
      case 'spotlight':
        return true;
      case 'repository':
        return !!selectedRepository;
      default:
        return false;
    }
  };

  const getStepProgress = () => {
    const totalSteps = 4;
    let currentStepNumber = 1;

    switch (currentStep) {
      case 'welcome':
        currentStepNumber = 1;
        break;
      case 'permissions':
        currentStepNumber = 2;
        break;
      case 'spotlight':
        currentStepNumber = 3;
        break;
      case 'repository':
        currentStepNumber = 4;
        break;
    }

    return { current: currentStepNumber, total: totalSteps };
  };

  const handleStartHotkeyEdit = () => {
    setPendingHotkey(hotkey);
    setIsEditingHotkey(true);
  };

  const handleSaveHotkey = () => {
    if (pendingHotkey) {
      setHotkey(pendingHotkey);
    }
    setIsEditingHotkey(false);
    setCurrentStep('repository');
  };

  const handleCancelHotkeyEdit = () => {
    setPendingHotkey("");
    setIsEditingHotkey(false);
  };


  const renderStepContent = () => {
    switch (currentStep) {
      case 'welcome':
        return <WelcomeStep />;
      case 'permissions':
        return (
          <PermissionsStep
            onAccessibilityGranted={handleAccessibilityGranted}
            accessibilityGranted={accessibilityGranted}
            onSkip={() => setCurrentStep('spotlight')}
          />
        );
      case 'spotlight':
        return (
          <SpotlightStep
            onChangeHotkey={handleStartHotkeyEdit}
          />
        );
      case 'repository':
        return (
          <RepositoryStep
            selectedRepository={selectedRepository}
            onRepositorySelected={setSelectedRepository}
            existingRepoName={existingRepoName}
            onClear={() => {
              setSelectedRepository(null);
              setExistingRepoName(null);
            }}
          />
        );
    }
  };

  const getButtonText = () => {
    if (isRegistering) return "Completing Setup...";
    if (currentStep === 'repository') return "Complete Setup ↵";
    if (currentStep === 'welcome') return "Begin ↵";
    if (currentStep === 'permissions') return "Continue ↵";
    if (currentStep === 'spotlight') {
      return hotkey === "Command+Space" ? "It's disabled ↵" : "Continue ↵";
    }
    return "Continue ↵";
  };

  const progress = getStepProgress();
  const isFirstStep = currentStep === 'welcome';

  const handleKeepDefaultFromEditor = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setHotkey("Command+Space");
    setPendingHotkey("");
    setIsEditingHotkey(false);
  };

  // Hotkey change view replaces the main content but keeps header
  const renderContent = () => {
    if (isEditingHotkey) {
      return (
        <div className="pb-24">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-surface-100 font-mono">
              Change Mort Hotkey
            </h2>
            <p className="text-surface-300">
              Choose a keyboard shortcut to access Mort from anywhere.
            </p>
          </div>

          <div className="mt-6">
            <HotkeyRecorder
              defaultHotkey={pendingHotkey}
              onHotkeyChanged={setPendingHotkey}
              autoFocus={true}
            />
          </div>

          {/* Keep default link */}
          <div className="flex justify-center mt-4">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleKeepDefaultFromEditor}
              className="text-xs text-surface-500 hover:text-surface-400 underline decoration-dotted underline-offset-4 transition-colors"
            >
              Keep Default ⌘ + Space (Recommended)
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="pb-24">
        {renderStepContent()}
        {error && (
          <div className="mt-4 p-3 bg-red-900/20 border border-red-700 rounded-md">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen w-full bg-surface-900 p-6">
      {/* Header with progress */}
      <div className="flex justify-between items-center mb-8">
        <div className="text-sm text-surface-400">
          Step {progress.current} of {progress.total}
        </div>
        <div className="flex gap-2">
          {Array.from({ length: progress.total }, (_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full ${
                i < progress.current
                  ? 'bg-accent-500'
                  : 'bg-surface-600'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Main content area */}
      {renderContent()}

      {/* Fixed bottom buttons */}
      <div className="fixed bottom-6 left-6 z-10">
        {isEditingHotkey ? (
          <Button variant="ghost" onClick={handleCancelHotkeyEdit}>
            ← Back
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={isFirstStep}
            className={isFirstStep ? "invisible" : ""}
          >
            ← Back
          </Button>
        )}
      </div>

      <div className="fixed bottom-6 right-6 z-10">
        {isEditingHotkey ? (
          <Button variant="light" onClick={handleSaveHotkey} disabled={!pendingHotkey}>
            Save Hotkey ↵
          </Button>
        ) : (
          <Button
            variant="light"
            onClick={handleNext}
            disabled={!canProceed() || isRegistering}
          >
            {getButtonText()}
          </Button>
        )}
      </div>
    </div>
  );
};

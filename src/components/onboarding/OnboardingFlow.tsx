import { useState, useEffect, useCallback } from "react";
import { Button } from "../reusable/Button";
import { saveHotkey } from "../../lib/hotkey-service";
import { repoService } from "../../entities/repositories";
import { bootstrapMortDirectory } from "../../lib/mort-bootstrap";
import { logger } from "../../lib/logger-client";
import { WelcomeStep } from "./steps/WelcomeStep";
import { HotkeyStep } from "./steps/HotkeyStep";
import { SpotlightStep } from "./steps/SpotlightStep";
import { RepositoryStep } from "./steps/RepositoryStep";
import { PermissionsStep } from "./steps/PermissionsStep";

type OnboardingStepName = 'welcome' | 'permissions' | 'hotkey' | 'spotlight' | 'repository';

interface OnboardingFlowProps {
  onComplete: () => void;
}

export const OnboardingFlow = ({ onComplete }: OnboardingFlowProps) => {
  const [currentStep, setCurrentStep] = useState<OnboardingStepName>('welcome');
  const [hotkey, setHotkey] = useState("Command+Space"); // Pre-select Command+Space
  const [selectedRepository, setSelectedRepository] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [existingRepoName, setExistingRepoName] = useState<string | null>(null);

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

  // Handle Enter key to advance
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        // Check if we can proceed based on current step
        const canProceedNow = (() => {
          switch (currentStep) {
            case 'welcome':
              return true;
            case 'permissions':
              return accessibilityGranted;
            case 'hotkey':
              return !!hotkey;
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
            if (currentStep === 'permissions') return 'hotkey';
            if (currentStep === 'hotkey') {
              return hotkey === "Command+Space" ? 'spotlight' : 'repository';
            }
            if (currentStep === 'spotlight') return 'repository';
            return null; // Final step
          })();

          if (nextStep) {
            setCurrentStep(nextStep);
          } else {
            // Final step: save the hotkey and repository, then complete onboarding
            setIsRegistering(true);
            setError(null);
            (async () => {
              try {
                logger.debug("[OnboardingFlow] Starting setup completion via Enter key");
                logger.debug(`[OnboardingFlow] Saving hotkey: ${hotkey}`);
                await saveHotkey(hotkey);
                logger.debug("[OnboardingFlow] Hotkey saved successfully");
                // Create the repository with worktrees before marking onboarding complete
                // Skip if using an existing repository (already set up)
                if (selectedRepository && !existingRepoName) {
                  logger.debug(`[OnboardingFlow] Creating repository from folder: ${selectedRepository}`);
                  await repoService.createFromFolder(selectedRepository);
                  logger.debug("[OnboardingFlow] Repository created successfully");
                } else {
                  logger.debug(`[OnboardingFlow] Skipping repo creation (existing: ${existingRepoName})`);
                }
                logger.debug("[OnboardingFlow] Calling onComplete");
                onComplete();
              } catch (err) {
                logger.error("[OnboardingFlow] Failed to complete setup:", err);
                if (err instanceof Error) {
                  logger.error("[OnboardingFlow] Error name:", err.name);
                  logger.error("[OnboardingFlow] Error message:", err.message);
                  logger.error("[OnboardingFlow] Error stack:", err.stack);
                }
                setError(
                  err instanceof Error ? err.message : "Failed to complete setup"
                );
              } finally {
                setIsRegistering(false);
              }
            })();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, hotkey, selectedRepository, existingRepoName, isRegistering, onComplete]);

  // Determine if Spotlight step should be shown
  const shouldShowSpotlightStep = hotkey === "Command+Space";

  const getNextStep = (): OnboardingStepName | null => {
    if (currentStep === 'welcome') return 'permissions';
    if (currentStep === 'permissions') return 'hotkey';
    if (currentStep === 'hotkey') {
      return shouldShowSpotlightStep ? 'spotlight' : 'repository';
    }
    if (currentStep === 'spotlight') return 'repository';
    return null; // Final step
  };

  const getPreviousStep = (): OnboardingStepName | null => {
    if (currentStep === 'repository') {
      return shouldShowSpotlightStep ? 'spotlight' : 'hotkey';
    }
    if (currentStep === 'spotlight') return 'hotkey';
    if (currentStep === 'hotkey') return 'permissions';
    if (currentStep === 'permissions') return 'welcome';
    return null; // First step
  };

  const handleNext = async () => {
    const nextStep = getNextStep();

    if (nextStep) {
      setCurrentStep(nextStep);
      return;
    }

    // Final step: save the hotkey and repository, then complete onboarding
    setIsRegistering(true);
    setError(null);

    try {
      logger.debug("[OnboardingFlow] Starting setup completion via handleNext");
      logger.debug(`[OnboardingFlow] Saving hotkey: ${hotkey}`);
      await saveHotkey(hotkey);
      logger.debug("[OnboardingFlow] Hotkey saved successfully");
      // Create the repository with worktrees before marking onboarding complete
      // Skip if using an existing repository (already set up)
      if (selectedRepository && !existingRepoName) {
        logger.debug(`[OnboardingFlow] Creating repository from folder: ${selectedRepository}`);
        await repoService.createFromFolder(selectedRepository);
        logger.debug("[OnboardingFlow] Repository created successfully");
      } else {
        logger.debug(`[OnboardingFlow] Skipping repo creation (existing: ${existingRepoName})`);
      }
      logger.debug("[OnboardingFlow] Calling onComplete");
      onComplete();
    } catch (err) {
      logger.error("[OnboardingFlow] Failed to complete setup:", err);
      if (err instanceof Error) {
        logger.error("[OnboardingFlow] Error name:", err.name);
        logger.error("[OnboardingFlow] Error message:", err.message);
        logger.error("[OnboardingFlow] Error stack:", err.stack);
      }
      setError(
        err instanceof Error ? err.message : "Failed to complete setup"
      );
    } finally {
      setIsRegistering(false);
    }
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
      case 'hotkey':
        return !!hotkey;
      case 'spotlight':
        return true;
      case 'repository':
        return !!selectedRepository;
      default:
        return false;
    }
  };

  const getStepProgress = () => {
    const totalSteps = shouldShowSpotlightStep ? 5 : 4;
    let currentStepNumber = 1;

    switch (currentStep) {
      case 'welcome':
        currentStepNumber = 1;
        break;
      case 'permissions':
        currentStepNumber = 2;
        break;
      case 'hotkey':
        currentStepNumber = 3;
        break;
      case 'spotlight':
        currentStepNumber = 4;
        break;
      case 'repository':
        currentStepNumber = shouldShowSpotlightStep ? 5 : 4;
        break;
    }

    return { current: currentStepNumber, total: totalSteps };
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
            onSkip={() => setCurrentStep('hotkey')}
          />
        );
      case 'hotkey':
        return <HotkeyStep hotkey={hotkey} onHotkeyChanged={setHotkey} />;
      case 'spotlight':
        return <SpotlightStep />;
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
    if (currentStep === 'hotkey') {
      return hotkey === "Command+Space" ? "Keep Default ↵" : "Change Hotkey ↵";
    }
    if (currentStep === 'spotlight') return "It's disabled ↵";
    return "Continue ↵";
  };

  const progress = getStepProgress();
  const isFirstStep = currentStep === 'welcome';

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
      <div className="pb-24">
        {renderStepContent()}
        {error && (
          <div className="mt-4 p-3 bg-red-900/20 border border-red-700 rounded-md">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}
      </div>

      {/* Fixed bottom buttons */}
      <div className="fixed bottom-6 left-6 z-10">
        <Button
          variant="ghost"
          onClick={handleBack}
          disabled={isFirstStep}
          className={isFirstStep ? "invisible" : ""}
        >
          ← Back
        </Button>
      </div>

      <div className="fixed bottom-6 right-6 z-10">
        <Button
          variant="light"
          onClick={handleNext}
          disabled={!canProceed() || isRegistering}
        >
          {getButtonText()}
        </Button>
      </div>
    </div>
  );
};

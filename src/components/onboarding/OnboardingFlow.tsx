import { useState, useEffect, useCallback } from "react";
import { Button } from "../reusable/Button";
import { saveHotkey } from "../../lib/hotkey-service";
import { repoService } from "../../entities/repositories";
import { bootstrapMortDirectory } from "../../lib/mort-bootstrap";
import { logger } from "../../lib/logger-client";
import { WelcomeStep } from "./steps/WelcomeStep";
import { RepositoryStep } from "./steps/RepositoryStep";

type OnboardingStepName = 'welcome' | 'repository';

interface OnboardingFlowProps {
  onComplete: () => void;
}

export const OnboardingFlow = ({ onComplete }: OnboardingFlowProps) => {
  const [currentStep, setCurrentStep] = useState<OnboardingStepName>('welcome');
  const [hotkey] = useState("Command+Space");
  const [selectedRepository, setSelectedRepository] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingRepoName, setExistingRepoName] = useState<string | null>(null);

  // Check for existing repositories on mount
  useEffect(() => {
    async function checkExistingRepo() {
      try {
        await bootstrapMortDirectory();
        await repoService.hydrate();

        const repos = repoService.getAll();
        if (repos.length > 0 && repos[0].sourcePath) {
          setSelectedRepository(repos[0].sourcePath);
          setExistingRepoName(repos[0].name);
        }
      } catch (err) {
        console.error("[OnboardingFlow] Failed to check existing repos:", err);
      }
    }

    checkExistingRepo();
  }, []);

  const completeSetup = useCallback(async () => {
    setIsRegistering(true);
    setError(null);
    try {
      logger.debug("[OnboardingFlow] Completing setup...");
      await saveHotkey(hotkey);
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
      if (e.key === 'Enter') {
        const canProceedNow = (() => {
          switch (currentStep) {
            case 'welcome':
              return true;
            case 'repository':
              return !!selectedRepository;
            default:
              return false;
          }
        })();

        if (canProceedNow && !isRegistering) {
          if (currentStep === 'welcome') {
            setCurrentStep('repository');
          } else {
            completeSetup();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, selectedRepository, isRegistering, completeSetup]);

  const handleNext = async () => {
    if (currentStep === 'welcome') {
      setCurrentStep('repository');
      return;
    }

    // Final step: save the hotkey and repository, then complete onboarding
    await completeSetup();
  };

  const handleBack = () => {
    if (currentStep === 'repository') {
      setCurrentStep('welcome');
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 'welcome':
        return true;
      case 'repository':
        return !!selectedRepository;
      default:
        return false;
    }
  };

  const getStepProgress = () => {
    const totalSteps = 2;
    const currentStepNumber = currentStep === 'welcome' ? 1 : 2;
    return { current: currentStepNumber, total: totalSteps };
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 'welcome':
        return <WelcomeStep />;
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
    return "Continue ↵";
  };

  const progress = getStepProgress();
  const isFirstStep = currentStep === 'welcome';

  return (
    <div data-testid="onboarding-flow" className="min-h-screen w-full bg-surface-900 p-6">
      {/* Draggable title bar region for window movement */}
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 right-0 h-8 z-20"
      />

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
          data-testid="onboarding-next-button"
        >
          {getButtonText()}
        </Button>
      </div>
    </div>
  );
};

import { MortLogo } from "../../ui/mort-logo";

interface WelcomeStepProps {}

export const WelcomeStep = ({}: WelcomeStepProps) => {
  return (
    <div data-testid="onboarding-step-welcome" className="space-y-6">
      <div className="inline-block">
        <MortLogo size={14} className="text-surface-100" />
      </div>
      <h2 className="text-2xl font-bold text-surface-100 font-mono">Mortician</h2>
      <p className="text-lg text-surface-300">Orchestrate an army of Claude Codes from macOS Spotlight, and more...</p>
      <p className="text-lg text-surface-200 font-medium">Ready?</p>
    </div>
  );
};
import { AnvilLogo } from "../../ui/anvil-logo";

interface WelcomeStepProps {}

export const WelcomeStep = ({}: WelcomeStepProps) => {
  return (
    <div data-testid="onboarding-step-welcome" className="space-y-6">
      <div className="inline-block">
        <AnvilLogo size={48} className="text-surface-100" />
      </div>
      <h2 className="text-2xl font-bold text-surface-100 font-mono">Anvil</h2>
      <p className="text-lg text-surface-300">The open source IDE for parallel agent work.</p>
      <p className="text-lg text-surface-200 font-medium">Ready?</p>
    </div>
  );
};
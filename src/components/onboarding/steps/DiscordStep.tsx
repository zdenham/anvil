import { useState } from "react";
import { MessageCircle, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

export const DiscordStep = () => {
  const [hasClicked, setHasClicked] = useState(false);

  const handleJoinDiscord = async () => {
    await openUrl("https://discord.gg/tbkAetedSd");
    setHasClicked(true);
  };

  return (
    <div data-testid="onboarding-step-discord" className="space-y-6">
      <div className="space-y-2">
        <MessageCircle size={40} className="text-surface-300" />
        <h2 className="text-2xl font-bold text-surface-100 font-mono">
          Join the Community
        </h2>
        <p className="text-lg text-surface-300">
          Get help, share what you're building, and help shape where Anvil goes next.
        </p>
      </div>

      <button
        onClick={handleJoinDiscord}
        className="inline-flex items-center gap-3 px-5 py-3 text-base font-medium text-white bg-[#5865F2] hover:bg-[#4752C4] rounded-lg transition-colors"
      >
        <ExternalLink size={18} />
        Join the Anvil Discord
      </button>

      {hasClicked && (
        <p className="text-sm text-surface-400">
          See you in there! You can always find the link in Settings too.
        </p>
      )}
    </div>
  );
};

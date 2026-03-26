import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

function DiscordLogo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 127.14 96.36"
      fill="currentColor"
      className={className}
    >
      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
    </svg>
  );
}

export const DiscordStep = () => {
  const [hasClicked, setHasClicked] = useState(false);

  const handleJoinDiscord = async () => {
    await openUrl("https://discord.gg/tbkAetedSd");
    setHasClicked(true);
  };

  return (
    <div data-testid="onboarding-step-discord" className="space-y-6">
      <div className="space-y-2">
        <DiscordLogo size={40} className="text-[#5865F2]" />
        <h2 className="text-2xl font-bold text-surface-100 font-mono">
          Join Full Metal Devs
        </h2>
        <p className="text-lg text-surface-300">
          Discord is the best place to get alpha on how to best use Anvil. A community of intellectually honest engineers navigating the AI frontier.
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

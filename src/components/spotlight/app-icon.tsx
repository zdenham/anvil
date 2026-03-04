import { convertFileSrc } from "@/lib/browser-stubs";

interface AppIconProps {
  iconPath: string | null;
  appName: string;
  size?: number;
}

/**
 * Renders an app icon from a cached PNG file path.
 * Falls back to a placeholder when no icon is available.
 */
export const AppIcon = ({ iconPath, appName, size = 32 }: AppIconProps) => {
  if (!iconPath) {
    return <AppIconPlaceholder appName={appName} size={size} />;
  }

  const iconUrl = convertFileSrc(iconPath);

  return (
    <img
      src={iconUrl}
      alt={`${appName} icon`}
      width={size}
      height={size}
      className="rounded-lg object-contain"
      onError={(e) => {
        // Hide broken image and show placeholder
        e.currentTarget.style.display = "none";
        e.currentTarget.nextElementSibling?.classList.remove("hidden");
      }}
    />
  );
};

interface PlaceholderProps {
  appName: string;
  size: number;
}

const AppIconPlaceholder = ({ appName, size }: PlaceholderProps) => {
  // Use first letter of app name as placeholder
  const initial = appName.charAt(0).toUpperCase();

  return (
    <div
      className="flex items-center justify-center rounded-lg bg-surface-700/50 text-surface-400 font-medium"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {initial}
    </div>
  );
};

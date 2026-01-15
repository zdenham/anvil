import { Terminal, CheckCircle, XCircle } from "lucide-react";
import { SettingsSection } from "../settings-section";

export function ApiKeySettings() {
  // The app uses Claude CLI authentication rather than storing API keys directly
  // This shows Claude CLI auth status
  const isAuthenticated = true; // TODO: Check actual Claude CLI auth status

  return (
    <SettingsSection
      title="Claude Authentication"
      description="Authentication via Claude CLI"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-surface-300">
          <Terminal size={16} />
          <span className="text-sm">Claude CLI</span>
          {isAuthenticated ? (
            <span className="flex items-center gap-1 text-green-400 text-sm">
              <CheckCircle size={14} />
              Connected
            </span>
          ) : (
            <span className="flex items-center gap-1 text-red-400 text-sm">
              <XCircle size={14} />
              Not authenticated
            </span>
          )}
        </div>
        <a
          href="https://docs.anthropic.com/en/docs/claude-code"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-accent-400 hover:text-accent-300"
        >
          Documentation
        </a>
      </div>
    </SettingsSection>
  );
}

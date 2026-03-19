import { useEffect, useState } from "react";
import { useSettingsStore } from "@/entities/settings/store";
import { settingsService } from "@/entities/settings";
import { detectClaudeLogin, type ClaudeLoginStatus } from "@/lib/claude-login-detector";
import { SettingsSection } from "../settings-section";
import { ApiKeyInput } from "./api-key-settings";

type AuthMethod = "default" | "claude-login" | "api-key";

export function AuthSettings() {
  const authMethod = useSettingsStore((s) => s.workspace.authMethod ?? "default") as AuthMethod;
  const [loginStatus, setLoginStatus] = useState<ClaudeLoginStatus | null>(null);

  useEffect(() => {
    detectClaudeLogin().then(setLoginStatus);
  }, []);

  const handleChange = async (method: AuthMethod) => {
    await settingsService.set("authMethod", method === "default" ? undefined : method);
  };

  return (
    <SettingsSection title="Authentication" description="How Mort authenticates with Claude">
      <div className="space-y-3">
        {/* Default */}
        <label className="flex items-center gap-2 text-sm text-surface-200 cursor-pointer">
          <input
            type="radio"
            name="auth-method"
            checked={authMethod === "default"}
            onChange={() => handleChange("default")}
            className="accent-surface-300"
          />
          <span>Default (Mort built-in key)</span>
        </label>

        {/* Claude Login */}
        <label className="flex items-center gap-2 text-sm text-surface-200 cursor-pointer">
          <input
            type="radio"
            name="auth-method"
            checked={authMethod === "claude-login"}
            onChange={() => handleChange("claude-login")}
            className="accent-surface-300"
          />
          <span>Claude Login</span>
          {loginStatus?.detected ? (
            <span className="text-xs text-green-400">Detected</span>
          ) : loginStatus !== null ? (
            <span className="text-xs text-surface-500">Not detected</span>
          ) : null}
        </label>
        {authMethod === "claude-login" && !loginStatus?.detected && (
          <p className="text-xs text-surface-500 ml-6">
            Run <code className="text-surface-400">claude login</code> in your terminal
          </p>
        )}

        {/* API Key — expands to show BYOK input */}
        <label className="flex items-center gap-2 text-sm text-surface-200 cursor-pointer">
          <input
            type="radio"
            name="auth-method"
            checked={authMethod === "api-key"}
            onChange={() => handleChange("api-key")}
            className="accent-surface-300"
          />
          <span>Custom API Key</span>
        </label>
        {authMethod === "api-key" && (
          <div className="ml-6">
            <ApiKeyInput />
          </div>
        )}
      </div>
    </SettingsSection>
  );
}

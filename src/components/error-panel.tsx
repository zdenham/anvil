import { useState, useEffect } from "react";
import { invoke } from "@/lib/invoke";
import { z } from "zod";
import { GlobalErrorView } from "./global-error-view";
import { logger } from "../lib/logger-client";
import { eventBus, type ShowErrorPayload } from "../entities";

/** Schema for error data from IPC */
const ErrorPayloadSchema = z.object({
  message: z.string(),
  stack: z.string().optional(),
});
type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

export function ErrorPanel() {
  const [error, setError] = useState<ErrorPayload | null>(null);

  useEffect(() => {
    // Pull Model: Get pending error from Rust on mount (survives HMR reloads)
    invoke<unknown>("get_pending_error").then((raw) => {
      if (raw) {
        const pendingError = ErrorPayloadSchema.parse(raw);
        setError(pendingError);
      }
    }).catch((err) => {
      logger.error("[ErrorPanel] Error fetching pending error:", err);
    });

    // Listen for show-error events via eventBus
    const handleShowError = (payload: ShowErrorPayload) => {
      setError(payload);
    };

    // Listen for panel-hidden to clear state
    const handlePanelHidden = () => {
      setError(null);
    };

    eventBus.on("show-error", handleShowError);
    eventBus.on("panel-hidden", handlePanelHidden);

    return () => {
      eventBus.off("show-error", handleShowError);
      eventBus.off("panel-hidden", handlePanelHidden);
    };
  }, []);

  if (!error) {
    return null;
  }

  return (
    <div data-testid="error-panel">
      <GlobalErrorView
        message={error.message}
        stack={error.stack}
        onDismiss={() => {
          invoke("hide_error_panel");
        }}
      />
    </div>
  );
}

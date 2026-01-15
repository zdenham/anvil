import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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

logger.log("[ErrorPanel] Module loaded");

export function ErrorPanel() {
  logger.log("[ErrorPanel] Component rendering");
  const [error, setError] = useState<ErrorPayload | null>(null);

  useEffect(() => {
    logger.log("[ErrorPanel] useEffect running - setting up listeners");

    // Pull Model: Get pending error from Rust on mount (survives HMR reloads)
    invoke<unknown>("get_pending_error").then((raw) => {
      logger.log("[ErrorPanel] get_pending_error returned:", raw);
      if (raw) {
        const pendingError = ErrorPayloadSchema.parse(raw);
        logger.log("[ErrorPanel] Setting error state:", pendingError.message);
        setError(pendingError);
      }
    }).catch((err) => {
      logger.error("[ErrorPanel] Error fetching pending error:", err);
    });

    // Listen for show-error events via eventBus
    const handleShowError = (payload: ShowErrorPayload) => {
      logger.log("[ErrorPanel] Received show-error event:", payload);
      setError(payload);
    };

    // Listen for panel-hidden to clear state
    const handlePanelHidden = () => {
      logger.log("[ErrorPanel] Received panel-hidden event");
      setError(null);
    };

    eventBus.on("show-error", handleShowError);
    eventBus.on("panel-hidden", handlePanelHidden);

    logger.log("[ErrorPanel] Listeners set up");

    return () => {
      logger.log("[ErrorPanel] Cleaning up listeners");
      eventBus.off("show-error", handleShowError);
      eventBus.off("panel-hidden", handlePanelHidden);
    };
  }, []);

  logger.log("[ErrorPanel] Current error state:", error);

  if (!error) {
    logger.log("[ErrorPanel] No error, rendering null");
    return null;
  }

  logger.log("[ErrorPanel] Rendering GlobalErrorView with message:", error.message);
  return (
    <GlobalErrorView
      message={error.message}
      stack={error.stack}
      onDismiss={() => {
        logger.log("[ErrorPanel] Dismiss clicked");
        invoke("hide_error_panel");
      }}
    />
  );
}

import { useState, useCallback, useEffect, useRef } from "react";
import { CheckCircle, XCircle } from "lucide-react";
import type { PermissionRequest, PermissionStatus } from "@core/types/permissions.js";
import { permissionService } from "@/entities/permissions/service";
import { OptionItem } from "./option-item";

interface InlinePermissionApprovalProps {
  request: PermissionRequest & { status: PermissionStatus };
  name: string;
}

const OPTIONS = [
  { label: "Allow", description: "approve this action" },
  { label: "Deny", description: "reject this action" },
];

export function InlinePermissionApproval({
  request,
  name,
}: InlinePermissionApprovalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [resolved, setResolved] = useState<"approved" | "denied" | null>(null);

  const handleApprove = useCallback(() => {
    if (resolved) return;
    setResolved("approved");
    permissionService.respond(request, "approve");
  }, [request, resolved]);

  const handleDeny = useCallback(() => {
    if (resolved) return;
    setResolved("denied");
    permissionService.respond(request, "deny");
  }, [request, resolved]);

  const handleActivate = useCallback(
    (index: number) => {
      if (index === 0) handleApprove();
      else handleDeny();
    },
    [handleApprove, handleDeny],
  );

  useEffect(() => {
    if (resolved) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowDown":
        case "j":
          e.preventDefault();
          setFocusedIndex((i) => Math.min(i + 1, OPTIONS.length - 1));
          return;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          setFocusedIndex((i) => Math.max(i - 1, 0));
          return;
        case " ":
        case "Enter":
          e.preventDefault();
          handleActivate(focusedIndex);
          return;
        case "y":
        case "Y":
          e.preventDefault();
          handleApprove();
          return;
        case "n":
        case "N":
          e.preventDefault();
          handleDeny();
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [resolved, focusedIndex, handleActivate, handleApprove, handleDeny]);

  useEffect(() => {
    containerRef.current?.focus();
    containerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [request.requestId]);

  if (resolved) {
    const isApproved = resolved === "approved";
    return (
      <div className="flex items-center gap-1.5 font-mono text-sm py-1">
        {isApproved ? (
          <CheckCircle className="h-3.5 w-3.5 text-green-400 shrink-0" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
        )}
        <span className={isApproved ? "text-green-400" : "text-red-400"}>
          {isApproved ? "Allowed" : "Denied"}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="outline-none pt-3 pb-1"
      role="group"
      aria-label={`Permission: Allow ${name}?`}
    >
      <p className="font-mono text-sm mb-1 text-accent-400">
        Allow {name}?
      </p>

      <div className="space-y-0" role="listbox" aria-label="Permission options">
        {OPTIONS.map((option, index) => (
          <OptionItem
            key={option.label}
            index={index}
            label={option.label}
            description={option.description}
            isSelected={false}
            isFocused={focusedIndex === index}
            variant="radio"
            onActivate={() => handleActivate(index)}
          />
        ))}
      </div>
    </div>
  );
}

import { useState } from "react";
import { ChevronRight, ChevronDown, AlertCircle } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { cn } from "@/lib/utils";
import { skillsService, useSkillsStore } from "@/entities/skills";
import { SOURCE_ICONS } from "@core/skills";

interface SkillChipProps {
  slug: string;
  args: string;
}

/**
 * Dynamically render a Lucide icon by name.
 * Falls back to Zap icon if the icon name is not found.
 */
function SourceIcon({ name, className }: { name: string; className?: string }) {
  // Convert kebab-case to PascalCase for Lucide component lookup
  const pascalName = name
    .split("-")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const IconComponent = (LucideIcons as any)[pascalName] || LucideIcons.Zap;

  return <IconComponent className={className} />;
}

export function SkillChip({ slug, args }: SkillChipProps) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [loading, setLoading] = useState(false);

  const skill = useSkillsStore(state => state.getBySlug(slug));
  const source = skill?.source;
  // Use Lucide icon name from shared constants
  const iconName = source ? SOURCE_ICONS[source] : "zap";

  const handleExpand = async () => {
    if (!expanded && content === null && !isStale) {
      setLoading(true);
      try {
        const skillContent = await skillsService.readContent(slug);
        if (skillContent) {
          setContent(skillContent.content);
        } else {
          setIsStale(true);
        }
      } catch {
        setIsStale(true);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  return (
    <div className={cn(
      "skill-chip rounded-md border mb-2",
      isStale && "border-yellow-500/50 bg-yellow-500/5"
    )}>
      <button
        onClick={handleExpand}
        className="flex items-center gap-2 px-3 py-1.5 w-full text-left hover:bg-muted/50 rounded-md transition-colors"
      >
        <SourceIcon name={iconName} className="w-4 h-4" />
        <span className="font-mono text-sm font-medium">/{slug}</span>
        {args && (
          <span className="text-muted-foreground text-sm truncate max-w-[200px]">
            {args}
          </span>
        )}
        {isStale && (
          <span className="flex items-center gap-1 text-yellow-600 text-xs ml-auto">
            <AlertCircle className="w-3 h-3" />
            stale
          </span>
        )}
        <span className="ml-auto">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t">
          {loading ? (
            <div className="text-muted-foreground text-sm">Loading...</div>
          ) : isStale ? (
            <div className="text-yellow-600 text-sm">
              This skill is no longer available. The file may have been moved or deleted.
            </div>
          ) : (
            <pre className="text-sm whitespace-pre-wrap font-mono bg-muted/30 p-2 rounded overflow-x-auto">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

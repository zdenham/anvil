import { getFileSearchService } from "../file-search-service";
import type {
  TriggerHandler,
  TriggerConfig,
  TriggerContext,
  TriggerResult,
} from "../types";

export class FileTriggerHandler implements TriggerHandler {
  readonly config: TriggerConfig = {
    char: "@",
    name: "File",
    placeholder: "Search files...",
    minQueryLength: 0,
  };

  async search(
    query: string,
    context: TriggerContext,
    _signal?: AbortSignal
  ): Promise<TriggerResult[]> {
    if (!context.rootPath) {
      return [];
    }

    const fileService = getFileSearchService();
    const results = await fileService.search(context.rootPath, query);

    return results.map((file) => ({
      id: file.path,
      label: file.filename,
      description: file.path,
      icon: file.extension,
      insertText: `@${file.path}`,
    }));
  }
}

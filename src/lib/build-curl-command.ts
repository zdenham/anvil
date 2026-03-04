import type { NetworkRequest } from "@/stores/network-debugger/types";

/**
 * Builds a cURL command string from a NetworkRequest.
 * Pure function with no side effects.
 */
export function buildCurlCommand(request: NetworkRequest): string {
  const parts: string[] = ["curl"];

  if (request.method !== "GET") {
    parts.push(`-X ${request.method}`);
  }

  parts.push(`'${request.url}'`);

  for (const [key, value] of Object.entries(request.requestHeaders)) {
    parts.push(`-H '${key}: ${value}'`);
  }

  if (request.requestBody) {
    const escaped = request.requestBody.replace(/'/g, "'\\''");
    parts.push(`-d '${escaped}'`);
  }

  return parts.join(" \\\n  ");
}

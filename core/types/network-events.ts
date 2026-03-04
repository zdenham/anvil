/**
 * Discriminated union for network events emitted by the NetworkInterceptor.
 * Consumed by both the agent interceptor and the frontend store.
 *
 * These events flow through the hub socket (trusted internal IPC),
 * so no Zod schema is needed.
 */
export type NetworkEvent =
  | {
      type: "request-start";
      requestId: string;
      url: string;
      method: string;
      headers: Record<string, string>;
      body: string | null;
      bodySize: number;
      timestamp: number;
    }
  | {
      type: "response-headers";
      requestId: string;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      duration: number;
    }
  | {
      type: "response-chunk";
      requestId: string;
      content: string;
      chunkSize: number;
      totalSize: number;
    }
  | {
      type: "response-end";
      requestId: string;
      bodySize: number;
    }
  | {
      type: "request-error";
      requestId: string;
      error: string;
      duration: number;
    };

import { create } from "zustand";

export interface QuestionRequest {
  requestId: string;
  threadId: string;
  toolUseId: string;
  toolInput: Record<string, unknown>;
  timestamp: number;
  status: "pending" | "answered" | "cancelled";
  answers?: Record<string, string>;
}

interface QuestionStoreState {
  requests: Record<string, QuestionRequest>;
}

interface QuestionStoreActions {
  addRequest: (req: QuestionRequest) => void;
  markAnswered: (requestId: string, answers: Record<string, string>) => void;
  markCancelled: (requestId: string) => void;
  getPendingForThread: (threadId: string) => QuestionRequest[];
  getRequestByToolUseId: (toolUseId: string) => QuestionRequest | undefined;
  _applyClearThread: (threadId: string) => void;
}

export const useQuestionStore = create<QuestionStoreState & QuestionStoreActions>(
  (set, get) => ({
    requests: {},

    addRequest: (req) => {
      set((state) => ({
        requests: { ...state.requests, [req.requestId]: req },
      }));
    },

    markAnswered: (requestId, answers) => {
      const request = get().requests[requestId];
      if (!request) return;
      set((state) => ({
        requests: {
          ...state.requests,
          [requestId]: { ...request, status: "answered" as const, answers },
        },
      }));
    },

    markCancelled: (requestId) => {
      const request = get().requests[requestId];
      if (!request) return;
      set((state) => ({
        requests: {
          ...state.requests,
          [requestId]: { ...request, status: "cancelled" as const },
        },
      }));
    },

    getPendingForThread: (threadId) =>
      Object.values(get().requests).filter(
        (r) => r.threadId === threadId && r.status === "pending",
      ),

    getRequestByToolUseId: (toolUseId) =>
      Object.values(get().requests).find((r) => r.toolUseId === toolUseId),

    _applyClearThread: (threadId) => {
      set((state) => {
        const remaining: typeof state.requests = {};
        for (const [id, req] of Object.entries(state.requests)) {
          if (req.threadId !== threadId) {
            remaining[id] = req;
          }
        }
        return { requests: remaining };
      });
    },
  }),
);

import { useThreadStore } from "@/entities/threads/store";
import { useTerminalSessionStore } from "@/entities/terminal-sessions/store";
import { getAllOutputBuffers } from "@/entities/terminal-sessions/output-buffer";
import { useStreamingStore } from "@/stores/streaming-store";
import { useLogStore } from "@/entities/logs/store";
import { useHeartbeatStore } from "@/stores/heartbeat-store";
import { invoke } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger-client";

// ============================================================================
// Types
// ============================================================================

interface JsHeapInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface ThreadStateStats {
  messageCount: number;
  fileChangeCount: number;
  toolStateCount: number;
  estimatedBytes: number;
}

export interface MemorySnapshot {
  timestamp: string;
  jsHeap: JsHeapInfo | null;
  nativeRss: number | null;
  stores: {
    threads: {
      metadataCount: number;
      cachedStateCount: number;
      cachedStateThreadIds: string[];
      perState: Record<string, ThreadStateStats>;
      totalEstimatedBytes: number;
    };
    terminalSessions: {
      sessionCount: number;
      bufferCount: number;
      totalBufferBytes: number;
      perBuffer: Record<string, number>;
    };
    streaming: {
      activeStreamCount: number;
      totalBlockContentBytes: number;
    };
    logs: { entryCount: number };
    heartbeat: { heartbeatCount: number; gapRecordCount: number };
  };
}

// ============================================================================
// Helpers
// ============================================================================

function getJsHeap(): JsHeapInfo | null {
  const perf = performance as { memory?: JsHeapInfo };
  if (!perf.memory) return null;
  return {
    usedJSHeapSize: perf.memory.usedJSHeapSize,
    totalJSHeapSize: perf.memory.totalJSHeapSize,
    jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
  };
}

function measureThreadStores() {
  const { threads, threadStates } = useThreadStore.getState();
  const metadataCount = Object.keys(threads).length;
  const cachedStateThreadIds = Object.keys(threadStates);
  const perState: Record<string, ThreadStateStats> = {};
  let totalEstimatedBytes = 0;

  for (const threadId of cachedStateThreadIds) {
    const state = threadStates[threadId];
    const estimatedBytes = JSON.stringify(state).length;
    perState[threadId] = {
      messageCount: state.messages?.length ?? 0,
      fileChangeCount: state.fileChanges?.length ?? 0,
      toolStateCount: state.toolStates ? Object.keys(state.toolStates).length : 0,
      estimatedBytes,
    };
    totalEstimatedBytes += estimatedBytes;
  }

  return {
    metadataCount,
    cachedStateCount: cachedStateThreadIds.length,
    cachedStateThreadIds,
    perState,
    totalEstimatedBytes,
  };
}

function measureTerminalSessions() {
  const { sessions } = useTerminalSessionStore.getState();
  const outputBuffers = getAllOutputBuffers();
  const perBuffer: Record<string, number> = {};
  let totalBufferBytes = 0;

  for (const [id, buffer] of outputBuffers) {
    const bytes = buffer.length;
    perBuffer[id] = bytes;
    totalBufferBytes += bytes;
  }

  return {
    sessionCount: Object.keys(sessions).length,
    bufferCount: outputBuffers.size,
    totalBufferBytes,
    perBuffer,
  };
}

function measureStreaming() {
  const { activeStreams } = useStreamingStore.getState();
  let totalBlockContentBytes = 0;

  for (const stream of Object.values(activeStreams)) {
    for (const block of stream.blocks) {
      totalBlockContentBytes += block.content.length;
    }
  }

  return {
    activeStreamCount: Object.keys(activeStreams).length,
    totalBlockContentBytes,
  };
}

async function fetchNativeRss(): Promise<number | null> {
  try {
    return await invoke<number>("get_process_memory");
  } catch {
    logger.warn("[memory-snapshot] get_process_memory not available");
    return null;
  }
}

// ============================================================================
// Public API
// ============================================================================

/** Capture a full memory snapshot of all major Zustand stores. */
export async function captureMemorySnapshot(): Promise<MemorySnapshot> {
  const [nativeRss] = await Promise.all([fetchNativeRss()]);

  const logState = useLogStore.getState();
  const heartbeatState = useHeartbeatStore.getState();

  return {
    timestamp: new Date().toISOString(),
    jsHeap: getJsHeap(),
    nativeRss,
    stores: {
      threads: measureThreadStores(),
      terminalSessions: measureTerminalSessions(),
      streaming: measureStreaming(),
      logs: { entryCount: logState.logs.length },
      heartbeat: {
        heartbeatCount: Object.keys(heartbeatState.heartbeats).length,
        gapRecordCount: heartbeatState.gapRecords.length,
      },
    },
  };
}

/** Quick summary for the diagnostic panel (no serialization, lightweight). */
export function getMemorySummary() {
  const { threads, threadStates } = useThreadStore.getState();
  const outputBuffers = getAllOutputBuffers();
  const { activeStreams } = useStreamingStore.getState();

  let totalBufferBytes = 0;
  for (const buffer of outputBuffers.values()) {
    totalBufferBytes += buffer.length;
  }

  // Estimate thread state bytes by counting keys + rough multiplier
  // This avoids JSON.stringify on every poll
  let cachedStateEstimateBytes = 0;
  for (const state of Object.values(threadStates)) {
    const msgCount = state.messages?.length ?? 0;
    const toolCount = state.toolStates ? Object.keys(state.toolStates).length : 0;
    // Rough estimate: ~2KB per message, ~1KB per tool state
    cachedStateEstimateBytes += msgCount * 2048 + toolCount * 1024;
  }

  return {
    jsHeap: getJsHeap(),
    threadMetadataCount: Object.keys(threads).length,
    cachedStateCount: Object.keys(threadStates).length,
    cachedStateEstimateBytes,
    terminalBufferCount: outputBuffers.size,
    terminalBufferBytes: totalBufferBytes,
    activeStreamCount: Object.keys(activeStreams).length,
  };
}

/// <reference types="vite/client" />

declare const __PROJECT_ROOT__: string;
declare const __MORT_WS_PORT__: number;

interface ImportMetaEnv {
  readonly VITE_ANTHROPIC_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

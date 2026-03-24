/// <reference types="vite/client" />

declare const __PROJECT_ROOT__: string;
declare const __ANVIL_WS_PORT__: number;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/// <reference types="vite/client" />

declare const __PROJECT_ROOT__: string;

interface ImportMetaEnv {
  readonly VITE_ANTHROPIC_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

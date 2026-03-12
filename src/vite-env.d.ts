/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CRYPTOPANIC_API_KEY?: string;
  readonly VITE_NEWSAPI_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_USE_STUBS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

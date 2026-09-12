/// <reference types="vite/client" />

declare module '*.sql?raw' {
  const content: string
  export default content
}

interface ImportMetaEnv {
  /** Where the packaged builds look for the outreach. See .env. */
  readonly VITE_CLOUD_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

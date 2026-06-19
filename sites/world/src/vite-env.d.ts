/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OW_SUPABASE_URL: string;
  readonly VITE_OW_SUPABASE_ANON_KEY: string;
  readonly VITE_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

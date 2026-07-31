import { createClient } from "@supabase/supabase-js";

// Server-only Supabase client using the service role key — required for
// writes to the (public-read) watcon-documents bucket. Never import this
// from a Client Component.
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase server credentials are not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export const DOCUMENTS_BUCKET = "watcon-documents";

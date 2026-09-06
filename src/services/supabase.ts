import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Supabase configuration — loaded from environment variables.
//
// Used only for file storage (profile photos). Auth and the database stay on
// Firebase. The anon key is safe to embed in the client bundle; the
// service_role key must NEVER be used here.
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if ((!supabaseUrl || !supabaseAnonKey) && __DEV__) {
  console.warn(
    "[Supabase] Missing environment variables: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Check your .env file."
  );
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl || "",
  supabaseAnonKey || ""
);

// ---------------------------------------------------------------------------
// Session — lazy anonymous sign-in so uploads carry an authenticated session
// (required by the storage RLS policies) without migrating auth off Firebase.
// ---------------------------------------------------------------------------

let sessionPromise: Promise<void> | null = null;

export async function ensureSupabaseSession(): Promise<void> {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to your .env file."
    );
  }

  const { data } = await supabase.auth.getSession();
  if (data.session) {
    return;
  }

  // Share a single in-flight anonymous sign-in across concurrent callers.
  if (!sessionPromise) {
    sessionPromise = supabase.auth
      .signInAnonymously()
      .then(({ error }) => {
        if (error) {
          if (
            error.message.toLowerCase().includes("anonymous") ||
            error.message.toLowerCase().includes("provider") ||
            error.status === 422
          ) {
            throw new Error(
              "Supabase anonymous sign-in is not enabled. Enable it in Authentication > Providers, then try again."
            );
          }
          throw new Error(
            "Could not connect to Supabase. Check your project URL and anon key."
          );
        }
      })
      .finally(() => {
        sessionPromise = null;
      });
  }

  await sessionPromise;
}
import { createContext, createElement, type ReactNode, useContext, useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.");
}

const SupabaseContext = createContext<SupabaseClient | null>(null);
let latestGetToken: ReturnType<typeof useAuth>["getToken"] | null = null;
let supabaseSingleton: SupabaseClient | null = null;

function getSupabaseSingleton() {
  if (!supabaseSingleton) {
    supabaseSingleton = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "uniflow-clerk-supabase",
      },
      global: {
        fetch: async (url, options = {}) => {
          const token = latestGetToken
            ? await latestGetToken({ template: "supabase" })
            : null;
          const headers = new Headers(options.headers);
          if (token) headers.set("Authorization", `Bearer ${token}`);
          return fetch(url, { ...options, headers });
        },
      },
    });
  }

  return supabaseSingleton;
}

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();

  useEffect(() => {
    latestGetToken = getToken;
  }, [getToken]);

  return createElement(SupabaseContext.Provider, { value: getSupabaseSingleton() }, children);
}

export function useSupabase() {
  const supabase = useContext(SupabaseContext);
  if (!supabase) {
    throw new Error("useSupabase must be used inside SupabaseProvider.");
  }
  return supabase;
}

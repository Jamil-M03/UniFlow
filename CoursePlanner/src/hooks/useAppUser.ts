import { createContext, createElement, type ReactNode, useContext, useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { useSupabase } from "./useSupabase";
import { isAllowedUniFlowEmail } from "../utils/authDomains";

type AppUserState = {
  appUserId: string | null;
  clerkUserId: string | null;
  email: string | null;
  loading: boolean;
};

type UserRow = {
  id: string;
};

function isUuid(value: string | null) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}

function setUuidAppUserId(
  id: string | null,
  setAppUserId: (id: string | null) => void,
  context: string,
) {
  if (!id) {
    setAppUserId(null);
    return false;
  }

  if (!isUuid(id)) {
    console.error(
      `${context}: expected public.users.id to be a UUID, but got ${id}. Fix the users table mapping before saving user-owned data.`,
    );
    setAppUserId(null);
    return false;
  }

  setAppUserId(id);
  return true;
}

function getPrimaryEmail(user: ReturnType<typeof useUser>["user"]) {
  return user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null;
}

const AppUserContext = createContext<AppUserState | null>(null);

export function AppUserProvider({ children }: { children: ReactNode }) {
  const supabase = useSupabase();
  const { isLoaded, user } = useUser();
  const clerkUserId = user?.id ?? null;
  const email = getPrimaryEmail(user);
  const [appUserId, setAppUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function syncUser() {
      if (!isLoaded) return;

      if (!clerkUserId || !email) {
        setAppUserId(null);
        setLoading(false);
        return;
      }

      if (!isAllowedUniFlowEmail(email)) {
        setAppUserId(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      const { data: existing, error: selectError } = await supabase
        .from("users")
        .select("id")
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle<UserRow>();

      if (cancelled) return;

      if (existing?.id) {
        setUuidAppUserId(existing.id, setAppUserId, "Clerk user lookup");
        setLoading(false);
        if (!selectError) {
          void supabase
            .from("users")
            .update({ email })
            .eq("id", existing.id);
        }
        return;
      }

      if (selectError) {
        console.error("Could not look up Supabase user for Clerk user:", selectError);
        setAppUserId(null);
        setLoading(false);
        return;
      }

      const { data: existingByEmail, error: emailSelectError } = await supabase
        .from("users")
        .select("id")
        .eq("email", email)
        .maybeSingle<UserRow>();

      if (cancelled) return;

      if (existingByEmail?.id) {
        const { error: updateError } = await supabase
          .from("users")
          .update({ clerk_user_id: clerkUserId })
          .eq("id", existingByEmail.id);

        if (cancelled) return;

        if (updateError) {
          console.error("Could not attach Clerk user to existing Supabase user:", updateError);
          setAppUserId(null);
        } else {
          setUuidAppUserId(existingByEmail.id, setAppUserId, "Email user lookup");
        }
        setLoading(false);
        return;
      }

      if (emailSelectError) {
        console.error("Could not look up Supabase user by email:", emailSelectError);
        setAppUserId(null);
        setLoading(false);
        return;
      }

      const { data: created, error: insertError } = await supabase
        .from("users")
        .upsert(
          {
            clerk_user_id: clerkUserId,
            email,
          },
          {
            onConflict: "clerk_user_id",
            ignoreDuplicates: true,
          },
        )
        .select("id")
        .maybeSingle<UserRow>();

      if (cancelled) return;

      if (created?.id) {
        setUuidAppUserId(created.id, setAppUserId, "Created user lookup");
      } else {
        const { data: rowAfterConflict } = await supabase
          .from("users")
          .select("id")
          .eq("clerk_user_id", clerkUserId)
          .maybeSingle<UserRow>();

        if (rowAfterConflict?.id) {
          setUuidAppUserId(rowAfterConflict.id, setAppUserId, "Conflict user lookup");
        } else {
          const { data: emailRowAfterConflict } = await supabase
            .from("users")
            .select("id")
            .eq("email", email)
            .maybeSingle<UserRow>();

          if (emailRowAfterConflict?.id) {
            await supabase
              .from("users")
              .update({ clerk_user_id: clerkUserId })
              .eq("id", emailRowAfterConflict.id);
            setUuidAppUserId(emailRowAfterConflict.id, setAppUserId, "Conflict email lookup");
          } else {
            console.error("Could not create Supabase user for Clerk user:", insertError);
            setAppUserId(null);
          }
        }
      }
      setLoading(false);
    }

    syncUser();

    return () => {
      cancelled = true;
    };
  }, [supabase, isLoaded, clerkUserId, email]);

  const value = {
    appUserId,
    clerkUserId,
    email,
    loading,
  };

  return createElement(AppUserContext.Provider, { value }, children);
}

export function useAppUser(): AppUserState {
  const appUser = useContext(AppUserContext);
  if (!appUser) {
    throw new Error("useAppUser must be used inside AppUserProvider.");
  }
  return appUser;
}

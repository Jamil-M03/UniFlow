import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { useSupabase } from "../hooks/useSupabase.ts";
import { useAppUser } from "../hooks/useAppUser.ts";

type AdminRow = {
  is_admin: boolean | null;
};

type ClerkMetadata = {
  role?: unknown;
  is_admin?: unknown;
  admin?: unknown;
};

const ADMIN_EMAILS = new Set(
  (import.meta.env.VITE_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email: string) => email.trim().toLowerCase())
    .filter(Boolean),
);

const ADMIN_CLERK_IDS = new Set(
  (import.meta.env.VITE_ADMIN_CLERK_IDS ?? "")
    .split(",")
    .map((id: string) => id.trim())
    .filter(Boolean),
);

function hasAdminMetadata(metadata: ClerkMetadata | undefined) {
  if (!metadata) return false;
  return metadata.role === "admin" || metadata.is_admin === true || metadata.admin === true;
}

export default function AdminRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const supabase = useSupabase();
  const { user } = useUser();
  const { appUserId, clerkUserId, email, loading } = useAppUser();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!appUserId) {
      navigate("/login");
      return;
    }

    async function checkAdmin() {
      try {
        const normalizedEmail = email?.toLowerCase() ?? "";
        const clerkAllowsAdmin =
          Boolean(normalizedEmail && ADMIN_EMAILS.has(normalizedEmail)) ||
          Boolean(clerkUserId && ADMIN_CLERK_IDS.has(clerkUserId)) ||
          hasAdminMetadata(user?.publicMetadata as ClerkMetadata | undefined);

        if (clerkAllowsAdmin) {
          setAllowed(true);
          return;
        }

        const { data: userRow } = await supabase
          .from("users")
          .select("is_admin")
          .eq("id", appUserId)
          .maybeSingle<AdminRow>();

        if (userRow?.is_admin) setAllowed(true);
        else navigate("/");
      } catch {
        navigate("/login");
      } finally {
        setChecking(false);
      }
    }

    checkAdmin();
  }, [appUserId, clerkUserId, email, loading, navigate, supabase, user?.publicMetadata]);

  if (checking) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
          color: "var(--muted)",
          fontSize: 14,
        }}
      >
        Checking access…
      </div>
    );
  }

  return allowed ? <>{children}</> : null;
}

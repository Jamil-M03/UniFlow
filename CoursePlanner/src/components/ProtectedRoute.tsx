import { type ReactNode } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { Navigate } from "react-router-dom";
import { isAllowedUniFlowEmail } from "../utils/authDomains";

type ProtectedRouteProps = {
  children: ReactNode;
};

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null;

  if (!isLoaded) return <div>Loading...</div>;

  if (!isSignedIn) return <Navigate to="/login" replace />;

  if (!isAllowedUniFlowEmail(email)) {
    return <Navigate to="/login?unauthorized=domain" replace />;
  }

  return children;
}

const ALLOWED_EMAIL_DOMAINS = new Set(["mail.aub.edu", "aub.edu.lb"]);

export function getEmailDomain(email: string | null | undefined) {
  const parts = String(email ?? "").trim().toLowerCase().split("@");
  return parts.length === 2 ? parts[1] : "";
}

export function isAllowedUniFlowEmail(email: string | null | undefined) {
  return ALLOWED_EMAIL_DOMAINS.has(getEmailDomain(email));
}

export const allowedUniFlowEmailText = "@mail.aub.edu or @aub.edu.lb";

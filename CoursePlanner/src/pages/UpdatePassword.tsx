import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function UpdatePassword() {
  const navigate = useNavigate();

  useEffect(() => {
    const timeout = window.setTimeout(() => navigate("/login"), 1500);
    return () => window.clearTimeout(timeout);
  }, [navigate]);

  return (
    <>
      <style>{css}</style>
      <div className="uf-page">
        <div className="uf-card">
          <div className="uf-logo">
            <div className="uf-logo-mark">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M8 3l5 5-5 5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="uf-logo-name">UniFlow</span>
          </div>
          <div className="uf-banner uf-banner--info">
            Password resets are now handled by Clerk. Redirecting you to sign in.
          </div>
          <button className="uf-btn" onClick={() => navigate("/login")}>Go to sign in</button>
        </div>
      </div>
    </>
  );
}

const css = `
  .uf-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f5f5f4;
    padding: 40px 20px;
    font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
  }
  .uf-card {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    padding: 36px;
    width: 100%;
    max-width: 420px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04);
  }
  .uf-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
  .uf-logo-mark {
    width: 32px; height: 32px; border-radius: 8px; background: #2563eb;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .uf-logo-name { font-size: 17px; font-weight: 700; color: #111827; }
  .uf-banner { padding: 11px 14px; border-radius: 8px; font-size: 13px; line-height: 1.5; margin-bottom: 16px; }
  .uf-banner--info { background: #eff6ff; border: 1px solid #bfdbfe; color: #2563eb; }
  .uf-btn {
    width: 100%; padding: 11px; background: #2563eb; border: none; border-radius: 8px;
    color: #fff; font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
  }
`;

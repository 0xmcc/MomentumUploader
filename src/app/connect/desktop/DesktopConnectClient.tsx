"use client";

import { useState } from "react";

type ConnectState = {
  code: string;
  codeExpiresAt: string;
  tokenExpiresAt: string;
} | null;

export default function DesktopConnectClient() {
  const [state, setState] = useState<ConnectState>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateCode() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/connect/desktop/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Desktop app" }),
      });
      const payload = (await response.json()) as {
        code?: unknown;
        codeExpiresAt?: unknown;
        tokenExpiresAt?: unknown;
        error?: unknown;
      };

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "failed"
        );
      }

      setState({
        code: String(payload.code ?? ""),
        codeExpiresAt: String(payload.codeExpiresAt ?? ""),
        tokenExpiresAt: String(payload.tokenExpiresAt ?? ""),
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Connect Momentum Desktop</h1>
      <p className="text-sm text-white/70">
        Generate a one-time code, then paste it into the macOS app to finish
        connecting this account.
      </p>

      <button
        type="button"
        className="rounded border border-white/30 px-4 py-2 text-sm"
        disabled={loading}
        onClick={() => void generateCode()}
      >
        {loading ? "Generating..." : "Generate one-time code"}
      </button>

      {error ? <p role="alert">Error: {error}</p> : null}

      {state ? (
        <section
          className="space-y-2 rounded border border-white/20 p-4"
          data-testid="desktop-connect-code"
        >
          <p className="text-xs text-white/60">
            Enter this code in Momentum:
          </p>
          <p className="text-3xl font-mono tracking-widest">{state.code}</p>
          <p className="text-xs text-white/60">
            Code expires: {new Date(state.codeExpiresAt).toLocaleString()}
          </p>
          <p className="text-xs text-white/60">
            Token expires: {new Date(state.tokenExpiresAt).toLocaleString()}
          </p>
        </section>
      ) : null}
    </main>
  );
}

"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import type { AuthChannel } from "@/lib/env";
import { isUndeliverableAddress } from "@/lib/otp/test-address";

interface DevMessage {
  at: number;
  kind: string;
  to: string;
  code?: string;
  magicLink?: string;
}

const CHANNEL_LABEL: Record<string, string> = {
  sms: "Text message",
  whatsapp: "WhatsApp",
};

export function LoginForm({
  channels,
  isDev,
  stubEmail,
}: {
  channels: AuthChannel[];
  isDev: boolean;
  stubEmail: boolean;
}) {
  const emailEnabled = channels.includes("email");
  const phoneChannels = channels.filter((c): c is "sms" | "whatsapp" => c !== "email");
  const [showLinkOnScreen, setShowLinkOnScreen] = useState(stubEmail);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<"sms" | "whatsapp">(phoneChannels[0] ?? "sms");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"start" | "email-sent" | "otp-sent">("start");
  const [showPhone, setShowPhone] = useState(!emailEnabled && phoneChannels.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dev, setDev] = useState<DevMessage | null>(null);

  const pollDev = useCallback(async () => {
    if (!isDev) return;
    const to = stage === "otp-sent" ? phone.trim() : email.trim();
    if (!to) return;
    try {
      const r = await fetch(`/api/dev/inbox?to=${encodeURIComponent(to)}`, {
        cache: "no-store",
      });
      const j = (await r.json()) as { messages: DevMessage[] };
      setDev(j.messages[0] ?? null);
    } catch {
      /* ignore */
    }
  }, [isDev, stage, email, phone]);

  useEffect(() => {
    if (!isDev || stage === "start") return;
    const first = setTimeout(pollDev, 0);
    const t = setInterval(pollDev, 400);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [isDev, stage, pollDev]);

  async function sendEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setDev(null);
    setShowLinkOnScreen(stubEmail || isUndeliverableAddress(email));
    const res = await signIn("email", {
      email: email.trim(),
      redirect: false,
      callbackUrl: "/campaigns",
    });
    setBusy(false);
    if (res?.error) setError("Couldn't send the link. Check the address and try again.");
    else setStage("email-sent");
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination: phone.trim(), channel }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ? `Couldn't send code: ${j.error}` : "Couldn't send the code.");
      return;
    }
    setStage("otp-sent");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await signIn("otp", {
      destination: phone.trim(),
      channel,
      code: code.trim(),
      redirect: false,
      callbackUrl: "/campaigns",
    });
    setBusy(false);
    if (res?.error) setError("That code is invalid or expired.");
    else if (res?.url) window.location.href = res.url;
    else window.location.href = "/campaigns";
  }

  return (
    <div className="login-card">
      <div className="login-brand">
        <Image src="/brand/lockup-stridevote.svg" alt="StrideVote" width={168} height={35} priority />
      </div>

      {stage === "email-sent" ? (
        <>
          <h1 className="login-title">
            {isDev && showLinkOnScreen ? "Test mode" : "Check your email"}
          </h1>
          <p className="login-sub">
            {isDev && showLinkOnScreen ? (
              <>
                <b>{email}</b> can&apos;t receive mail here, so nothing was sent.
                Use the sign-in link below.
              </>
            ) : (
              <>
                We sent a sign-in link to <b>{email}</b>. Open it on this device to continue.
              </>
            )}
          </p>
          <button className="btn btn-outline btn-block" onClick={() => setStage("start")}>
            Use a different method
          </button>
        </>
      ) : stage === "otp-sent" ? (
        <form onSubmit={verifyCode}>
          <h1 className="login-title">Enter your code</h1>
          <p className="login-sub">
            We sent a 6-digit code via {CHANNEL_LABEL[channel]} to <b>{phone}</b>.
          </p>
          <label className="field-label" htmlFor="code">
            Verification code
          </label>
          <input
            id="code"
            className="field"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          <div className="spacer-12" />
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Verifying…" : "Verify & sign in"}
          </button>
          <div className="form-error">{error}</div>
          <button type="button" className="btn btn-outline btn-block" onClick={() => setStage("start")}>
            Back
          </button>
        </form>
      ) : (
        <>
          <h1 className="login-title">Sign in to StrideVote</h1>
          <p className="login-sub">
            No password needed. We&apos;ll send you a secure sign-in link or code.
          </p>

          {emailEnabled && !showPhone ? (
            <form onSubmit={sendEmail}>
              <label className="field-label" htmlFor="email">
                Email address
              </label>
              <input
                id="email"
                className="field"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
              <div className="spacer-12" />
              <button className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Sending…" : "Email me a sign-in link"}
              </button>
              <div className="form-error">{error}</div>
            </form>
          ) : null}

          {showPhone && phoneChannels.length > 0 ? (
            <form onSubmit={requestCode}>
              <label className="field-label" htmlFor="phone">
                Phone number
              </label>
              <input
                id="phone"
                className="field"
                type="tel"
                autoComplete="tel"
                placeholder="(206) 555-0134"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoFocus
                required
              />
              {phoneChannels.length > 1 ? (
                <>
                  <div className="spacer-12" />
                  <div className="segmented">
                    {phoneChannels.map((c) => (
                      <button
                        type="button"
                        key={c}
                        className={channel === c ? "active" : ""}
                        onClick={() => setChannel(c)}
                      >
                        {CHANNEL_LABEL[c]}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              <div className="spacer-12" />
              <button className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Sending…" : `Send code via ${CHANNEL_LABEL[channel]}`}
              </button>
              <div className="form-error">{error}</div>
            </form>
          ) : null}

          {emailEnabled && phoneChannels.length > 0 ? (
            <>
              <div className="login-alt">or</div>
              <button
                className="btn btn-outline btn-block"
                onClick={() => {
                  setShowPhone((v) => !v);
                  setError("");
                }}
              >
                {showPhone ? "Use email instead" : "Use a phone number instead"}
              </button>
            </>
          ) : null}
        </>
      )}

      {isDev && stage === "email-sent" && (showLinkOnScreen || dev?.magicLink) ? (
        <div className="dev-box">
          <div className="eyebrow">
            {showLinkOnScreen ? "Test sign-in link" : "Email delivery failed — use this link"}
          </div>
          {dev?.magicLink ? (
            <a className="btn btn-primary btn-block" href={dev.magicLink}>
              Sign in as {email}
            </a>
          ) : (
            <p className="login-note" style={{ marginTop: 8 }}>
              Waiting for the test sign-in link…
            </p>
          )}
        </div>
      ) : null}

      {isDev && stage === "otp-sent" ? (
        <div className="dev-box">
          <div className="eyebrow">Test mode — no provider configured</div>
          {dev?.code ? (
            <div className="dev-code">{dev.code}</div>
          ) : (
            <p className="login-note" style={{ marginTop: 8 }}>
              Waiting for the test code…
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

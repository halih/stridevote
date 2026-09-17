import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { emailChannel } from "@/lib/otp/adapters/email";
import { LoginForm } from "@/components/login/LoginForm";

// Auth.js redirects failed sign-ins here with ?error=<type>.
const AUTH_ERRORS: Record<string, string> = {
  Verification:
    "That sign-in link has already been used or has expired. Request a new one below.",
  AccessDenied: "That account isn't allowed to sign in.",
  Configuration:
    "Sign-in isn't configured correctly. Ask an organizer to check the server logs.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/canvass");

  const { error } = await searchParams;
  const notice = error
    ? (AUTH_ERRORS[error] ?? "Sign-in failed. Try again.")
    : null;

  return (
    <div className="login-wrap">
      <LoginForm
        channels={env.authChannels}
        isDev={env.isDev}
        stubEmail={!emailChannel.live}
        notice={notice}
      />
    </div>
  );
}

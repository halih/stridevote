import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { LoginForm } from "@/components/login/LoginForm";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/campaigns");

  return (
    <div className="login-wrap">
      <LoginForm channels={env.authChannels} isDev={env.isDev} />
    </div>
  );
}

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { ToastProvider } from "@/components/Toast";
import { TabBar } from "@/components/TabBar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <ToastProvider>
      <div id="app">
        {children}
        <TabBar />
      </div>
    </ToastProvider>
  );
}

import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";
import { AccountButton } from "@/components/AccountButton";
import { BrandMark } from "@/components/BrandMark";
import { ToastProvider } from "@/components/Toast";
import { canManageAnything, isPlatformAdmin } from "@/lib/authz";
import { getManageableCampaigns } from "@/lib/admin-data";
import { getSessionUser, initialsFor } from "@/lib/session";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!(await canManageAnything(user))) redirect("/canvass");

  const initials = user.initials || initialsFor(user.name);
  const campaigns = await getManageableCampaigns(user);

  return (
    <ToastProvider>
      <div id="admin-app">
        <aside className="admin-sidebar">
          <Link href="/admin" className="admin-brand">
            <BrandMark size={24} />
            <span>
              Stride<b>Vote</b>
              <small>Admin</small>
            </span>
          </Link>

          <Suspense>
            <AdminNav
              canCreate={isPlatformAdmin(user)}
              campaigns={campaigns.map(({ slug, name }) => ({ slug, name }))}
            />
          </Suspense>

          <div className="admin-account">
            <AccountButton
              variant="admin"
              initials={initials}
              name={user.name}
              detail={user.email || user.phone}
            />
          </div>
        </aside>
        <main className="admin-main">{children}</main>
      </div>
    </ToastProvider>
  );
}

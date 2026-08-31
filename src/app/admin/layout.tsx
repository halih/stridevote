import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";
import { Icon } from "@/components/Icon";
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
  if (!(await canManageAnything(user))) redirect("/campaigns");

  const initials = user.initials || initialsFor(user.name);
  const campaigns = await getManageableCampaigns(user);

  return (
    <ToastProvider>
      <div id="admin-app">
        <aside className="admin-sidebar">
          <Link href="/admin" className="admin-brand">
            <span className="brand-mark" />
            <span>
              Stride<b>Vote</b>
              <small>Admin</small>
            </span>
          </Link>

          <AdminNav
            canCreate={isPlatformAdmin(user)}
            campaigns={campaigns.map(({ slug, name }) => ({ slug, name }))}
          />

          <div className="admin-account">
            <div className="avatar" aria-hidden="true">
              {initials}
            </div>
            <div className="admin-account-copy">
              <b>{user.name || "Administrator"}</b>
              <span>{user.email || user.phone}</span>
            </div>
            <Link href="/campaigns" className="admin-switch" title="Switch to canvasser view">
              <Icon name="logout" size={18} />
              <span>App view</span>
            </Link>
          </div>
        </aside>
        <main className="admin-main">{children}</main>
      </div>
    </ToastProvider>
  );
}

"use client";

import { createContext, useContext } from "react";

const AdminAccessContext = createContext(false);

export function AdminAccessProvider({
  canManage,
  children,
}: {
  canManage: boolean;
  children: React.ReactNode;
}) {
  return (
    <AdminAccessContext.Provider value={canManage}>
      {children}
    </AdminAccessContext.Provider>
  );
}

export function useAdminAccess(): boolean {
  return useContext(AdminAccessContext);
}

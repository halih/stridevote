// Single source of truth for campaign roles and the permissions they grant.
// Membership roles are cumulative (a member can hold several), and every gated
// capability in the app maps to a Permission. Add new roles here — no schema
// change or migration is needed, since CampaignMembership.roles is a string[].

export type Permission =
  | "members:approve"
  | "members:add"
  | "members:assign_roles"
  | "lists:manage"
  | "campaign:edit"
  | "canvass:checkout"
  | "campaign:create";

export type RoleName = "canvasser" | "admin";

export interface RoleDef {
  label: string;
  description: string;
  permissions: Permission[];
}

export const ROLES: Record<RoleName, RoleDef> = {
  canvasser: {
    label: "Canvasser",
    description: "Can check out and work this campaign's lists.",
    permissions: ["canvass:checkout"],
  },
  admin: {
    label: "Admin",
    description: "Full control: members, lists, roles, and campaign profile.",
    permissions: [
      "members:approve",
      "members:add",
      "members:assign_roles",
      "lists:manage",
      "campaign:edit",
      "canvass:checkout",
    ],
  },
};

export const ALL_ROLES = Object.keys(ROLES) as RoleName[];

// Roles a campaign admin may grant to members (confirmed: includes "admin").
export const ASSIGNABLE_ROLES: RoleName[] = ["admin", "canvasser"];

export const DEFAULT_ROLES: RoleName[] = ["canvasser"];

// Holding any of these permissions lets a user see the Manage area.
export const MANAGE_PERMISSIONS: Permission[] = [
  "members:approve",
  "members:add",
  "members:assign_roles",
  "lists:manage",
  "campaign:edit",
];

export function isRoleName(value: string): value is RoleName {
  return value === "canvasser" || value === "admin";
}

/** Drop unknown roles; fall back to the default if nothing valid remains. */
export function normalizeRoles(roles: string[]): RoleName[] {
  const valid = Array.from(new Set(roles.filter(isRoleName)));
  return valid.length ? valid : [...DEFAULT_ROLES];
}

export function permissionsForRoles(roles: string[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const r of roles) {
    if (isRoleName(r)) for (const p of ROLES[r].permissions) set.add(p);
  }
  return set;
}

export function rolesGrantManage(roles: string[]): boolean {
  const perms = permissionsForRoles(roles);
  return MANAGE_PERMISSIONS.some((p) => perms.has(p));
}

export function roleLabel(role: string): string {
  return isRoleName(role) ? ROLES[role].label : role;
}

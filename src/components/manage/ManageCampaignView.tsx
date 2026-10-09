"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AdminListRow, CampaignAdminView, MemberRow } from "@/lib/admin-data";
import {
  ASSIGNABLE_ROLES,
  ROLES,
  expandRoles,
  roleLabel,
  type RoleName,
} from "@/lib/roles";
import { Icon } from "@/components/Icon";
import { BottomSheet } from "@/components/BottomSheet";
import { useToast } from "@/components/Toast";
import { CampaignForm, type CampaignFormValues } from "@/components/manage/CampaignForm";
import { CampaignTurfManager } from "@/components/manage/CampaignTurfManager";
import { ProgramManager } from "@/components/manage/ProgramManager";
import { DeleteCampaignButton } from "@/components/manage/DeleteCampaignButton";
import {
  addMember,
  approveMembership,
  createList,
  deleteList,
  denyMembership,
  enqueueMinivanListImport,
  enqueueMinivanPull,
  enqueueMinivanPush,
  pullCivibyteList,
  pushCivibyteList,
  removeMembership,
  setMemberRoles,
} from "@/lib/admin-actions";

type Tab = "members" | "turfs" | "lists" | "waves" | "settings";

type ListStatusFilter =
  | "all"
  | "available"
  | "private"
  | "assigned"
  | "checked_out"
  | "completed";

const LIST_FILTERS: Array<{ id: ListStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" },
  { id: "private", label: "Private" },
  { id: "assigned", label: "Assigned" },
  { id: "checked_out", label: "Checked out" },
  { id: "completed", label: "Completed" },
];

const LIST_STATUS_LABELS: Record<Exclude<ListStatusFilter, "all">, string> = {
  available: "Open",
  private: "Private",
  assigned: "Assigned",
  checked_out: "Checked out",
  completed: "Completed",
};

function listStatusBucket(list: AdminListRow): Exclude<ListStatusFilter, "all"> {
  if (list.checkedOutBy) return "checked_out";
  if (list.completed) return "completed";
  if (list.visibility === "draft") return "private";
  if (list.visibility === "assigned") return "assigned";
  return "available";
}

function RoleToggle({
  selected,
  onChange,
}: {
  selected: RoleName[];
  onChange: (roles: RoleName[]) => void;
}) {
  const current = expandRoles(selected);
  const adminOn = current.includes("admin");

  function toggle(role: RoleName) {
    if (current.includes(role)) {
      if (role === "canvasser" && adminOn) return;
      onChange(expandRoles(current.filter((r) => r !== role)));
      return;
    }
    onChange(expandRoles([...current, role]));
  }

  return (
    <div className="role-toggle">
      {ASSIGNABLE_ROLES.map((role) => {
        const on = current.includes(role);
        const implied = role === "canvasser" && adminOn;
        return (
          <button
            type="button"
            key={role}
            className={`role-option${on ? " on" : ""}`}
            aria-pressed={on}
            title={implied ? "Included with Admin" : undefined}
            onClick={() => toggle(role)}
          >
            <b>{ROLES[role].label}</b>
            <span>{implied ? "Included with Admin." : ROLES[role].description}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ManageCampaignView({ view }: { view: CampaignAdminView }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const requested = searchParams.get("section");
  const normalized =
    requested === "programs" ? "waves" : requested;
  const tab: Tab =
    normalized === "members" ||
    normalized === "turfs" ||
    normalized === "lists" ||
    normalized === "waves" ||
    normalized === "settings"
      ? normalized
      : view.perms.approve || view.perms.add || view.perms.assignRoles
        ? "members"
        : "lists";

  const [editMember, setEditMember] = useState<MemberRow | null>(null);
  const [editRoles, setEditRoles] = useState<RoleName[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addContact, setAddContact] = useState("");
  const [addRoles, setAddRoles] = useState<RoleName[]>(["canvasser"]);
  const [listOpen, setListOpen] = useState(false);
  const [listFilter, setListFilter] = useState<ListStatusFilter>("all");

  function run(action: () => Promise<{ ok: boolean; message: string }>, after?: () => void) {
    startTransition(async () => {
      const res = await action();
      toast(res.message);
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });
  }

  function openEditRoles(m: MemberRow) {
    setEditMember(m);
    setEditRoles(expandRoles(m.roles));
  }

  function submitAddMember() {
    const contact = addContact.trim();
    const payload = contact.includes("@")
      ? { email: contact, roles: addRoles }
      : { phone: contact, roles: addRoles };
    run(() => addMember(view.id, payload), () => {
      setAddOpen(false);
      setAddContact("");
      setAddRoles(["canvasser"]);
    });
  }

  const listCounts = useMemo(() => {
    const counts: Record<ListStatusFilter, number> = {
      all: view.lists.length,
      available: 0,
      private: 0,
      assigned: 0,
      checked_out: 0,
      completed: 0,
    };
    for (const list of view.lists) {
      counts[listStatusBucket(list)] += 1;
    }
    return counts;
  }, [view.lists]);

  const visibleLists = useMemo(
    () =>
      listFilter === "all"
        ? view.lists
        : view.lists.filter((list) => listStatusBucket(list) === listFilter),
    [view.lists, listFilter],
  );

  function removeMember(member: MemberRow) {
    const self = member.userId === view.viewerUserId;
    const warning = self
      ? `Remove yourself from ${view.name}? Your account stays, and you will lose access to this campaign. Canvass history is kept.`
      : `Remove ${member.name} from ${view.name}? Their account stays, and their canvass history is kept. Lists they have checked out will be released.`;
    if (!window.confirm(warning)) return;
    run(() => removeMembership(view.id, member.userId), () => {
      if (self) router.push("/admin");
    });
  }

  function removeList(list: { id: string; name: string; checkedOutBy: string | null }) {
    const warning = list.checkedOutBy
      ? `This list is checked out by ${list.checkedOutBy}. Archiving it will release that checkout. Door results and volunteer stats are kept. Continue?`
      : `Archive ${list.name}? Door results and volunteer stats are kept.`;
    if (!window.confirm(warning)) return;
    run(() => deleteList(list.id));
  }

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    {
      id: "members",
      label: "Members",
      show: view.perms.approve || view.perms.add || view.perms.assignRoles,
    },
    { id: "turfs", label: "Turfs", show: view.perms.manageLists },
    { id: "lists", label: "Lists", show: view.perms.manageLists },
    { id: "waves", label: "Waves", show: view.perms.manageLists },
    { id: "settings", label: "Settings", show: view.perms.editProfile },
  ];
  const visibleTabs = tabs.filter((t) => t.show);
  const activeTab = visibleTabs.some((item) => item.id === tab)
    ? tab
    : visibleTabs[0]?.id;

  return (
    <>
      {activeTab === "members" ? (
        <>
          {view.perms.approve && view.pending.length ? (
            <section className="section">
              <div className="section-head">
                <span className="eyebrow">Pending requests</span>
              </div>
              <div className="card">
                {view.pending.map((m) => (
                  <div key={m.userId} className="member-row">
                    <div className="member-info">
                      <p className="member-name">{m.name}</p>
                      <p className="member-contact">
                        {m.contact}
                        {m.requestedAt ? ` · requested ${m.requestedAt}` : ""}
                      </p>
                    </div>
                    <div className="member-actions">
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={pending}
                        onClick={() => run(() => approveMembership(view.id, m.userId))}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-outline btn-sm"
                        disabled={pending}
                        onClick={() => run(() => denyMembership(view.id, m.userId))}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="section">
            <div className="section-head">
              <span className="eyebrow">Members</span>
              {view.perms.add ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setAddOpen(true)}>
                  <Icon name="plus" size={14} /> Add
                </button>
              ) : null}
            </div>
            <div className="card">
              {view.members.length ? (
                view.members.map((m) => (
                  <div key={m.userId} className="member-row">
                    <div className="member-info">
                      <p className="member-name">{m.name}</p>
                      <p className="member-contact">{m.contact}</p>
                      <div className="role-chips">
                        {expandRoles(m.roles).map((r) => (
                          <span key={r} className="role-chip">
                            {roleLabel(r)}
                          </span>
                        ))}
                      </div>
                    </div>
                    {view.perms.assignRoles || view.perms.add ? (
                      <div className="member-actions">
                        {view.perms.assignRoles ? (
                          <button className="btn btn-outline btn-sm" onClick={() => openEditRoles(m)}>
                            <Icon name="pencil" size={13} /> Roles
                          </button>
                        ) : null}
                        {view.perms.add ? (
                          <button
                            className="btn btn-outline btn-sm"
                            style={{ color: "var(--critical)" }}
                            disabled={pending}
                            onClick={() => removeMember(m)}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="empty-state">No active members yet.</div>
              )}
            </div>
          </section>
        </>
      ) : null}

      {activeTab === "turfs" && view.perms.manageLists ? (
        <CampaignTurfManager
          campaignId={view.id}
          campaignName={view.name}
          districtBoundary={view.boundary}
          campaignColor={view.color}
          turfs={view.lists}
          volunteers={view.members}
          savedFilters={view.savedFilters}
          waves={view.programs.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
          }))}
        />
      ) : null}

      {activeTab === "lists" ? (
        <section className="section">
          <div className="section-head">
            <span className="eyebrow">Lists</span>
            {view.perms.manageLists &&
            (view.minivanEnabled || view.civibyteEnabled) ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setListOpen(true)}>
                <Icon name="plus" size={14} /> New list
              </button>
            ) : null}
          </div>
          {view.lists.length ? (
            <div
              className="stats-scope-scroll list-status-filters"
              role="tablist"
              aria-label="Filter lists"
            >
              {LIST_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  role="tab"
                  aria-selected={listFilter === filter.id}
                  className={`stats-scope-pill${listFilter === filter.id ? " active" : ""}`}
                  onClick={() => setListFilter(filter.id)}
                >
                  {filter.label}
                  <span className="list-filter-count">{listCounts[filter.id]}</span>
                </button>
              ))}
            </div>
          ) : null}
          {visibleLists.length ? (
            <div className="list-grid">
              {visibleLists.map((l) => (
                <div key={`${l.programId}:${l.id}`} className="card list-card">
                  <div className="list-top">
                    <div>
                      <Link
                        href={`/admin/${view.slug}/lists/${l.id}`}
                        className="list-card-link"
                      >
                        <p className="list-name">{l.name}</p>
                      </Link>
                    </div>
                    <div className="list-top-actions">
                      <span className={`turf-status ${listStatusBucket(l)}`}>
                        {LIST_STATUS_LABELS[listStatusBucket(l)]}
                      </span>
                      {l.source === "minivan" ? (
                        <span className="source-chip source-chip-minivan">MiniVAN</span>
                      ) : l.source === "civibyte" ? (
                        <span className="source-chip source-chip-civibyte">Civibyte</span>
                      ) : null}
                      {view.perms.manageLists ? (
                        <button
                          type="button"
                          className="icon-btn"
                          style={{ color: "var(--critical)" }}
                          aria-label={`Archive ${l.name}`}
                          disabled={pending}
                          onClick={() => removeList(l)}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="camp-meta" style={{ marginTop: 10, paddingTop: 10 }}>
                    <span className="meta-stat">
                      <b>{l.doorsCanvassed}</b> of {l.doorsCount} canvassed
                    </span>
                    {l.checkedOutBy ? (
                      <span className="meta-stat">
                        Checked out by <b>{l.checkedOutBy}</b>
                      </span>
                    ) : l.visibility === "draft" ? (
                      <span className="meta-stat">Private draft</span>
                    ) : l.assignedUserName ? (
                      <span className="meta-stat">
                        Assigned to <b>{l.assignedUserName}</b>
                      </span>
                    ) : l.completed ? null : (
                      <span className="meta-stat">Available</span>
                    )}
                  </div>
                  {view.minivanEnabled && l.source === "minivan" && view.perms.manageLists ? (
                    <div className="member-actions" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={pending}
                        title="Pull from MiniVAN — door ResultIDs only (not survey answers)"
                        onClick={() => run(() => enqueueMinivanPull(l.id))}
                      >
                        Pull
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={pending}
                        title="Push StrideVote results to MiniVAN"
                        onClick={() => run(() => enqueueMinivanPush(l.id))}
                      >
                        Push
                      </button>
                    </div>
                  ) : null}
                  {view.civibyteEnabled &&
                  l.source === "civibyte" &&
                  view.perms.manageLists ? (
                    <div className="member-actions" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={pending}
                        title="Pull from Civibyte — imports new door dispositions and survey answers"
                        onClick={() => run(() => pullCivibyteList(l.id))}
                      >
                        Pull
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={pending}
                        title="Push new StrideVote results to CiviByte"
                        onClick={() => run(() => pushCivibyteList(l.id))}
                      >
                        Push
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              {view.lists.length
                ? "No lists match this filter."
                : "No lists yet. Create one to get canvassers started."}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "waves" && view.perms.manageLists ? (
        <ProgramManager
          campaignId={view.id}
          campaignSlug={view.slug}
          programs={view.programs}
        />
      ) : null}

      {activeTab === "settings" && view.perms.editProfile ? (
        <section className="section">
          <div className="section-head">
            <span className="eyebrow">Campaign profile</span>
          </div>
          <div className="card">
            <CampaignForm
              mode="edit"
              campaignId={view.id}
              initial={campaignToForm(view)}
              initialBoundary={view.boundary}
              integrations={
                view.perms.isPlatformAdmin
                  ? {
                      minivanEnabled: view.minivanEnabled,
                      minivanAdapterKey: view.minivanAdapterKey,
                      minivanAdapters: view.minivanAdapters,
                      civibyteEnabled: view.civibyteEnabled,
                    }
                  : undefined
              }
            />
          </div>
          {view.perms.deleteCampaign ? (
            <div className="danger-zone">
              <div>
                <b>Archive or delete campaign</b>
                <p>Archive to preserve campaign history. Permanent deletion remains available.</p>
              </div>
              <DeleteCampaignButton
                campaignId={view.id}
                campaignName={view.name}
                activeCheckouts={view.lists.reduce((n, l) => n + l.activeCheckouts, 0)}
              />
            </div>
          ) : null}
        </section>
      ) : null}
      {/* Edit roles sheet */}
      <BottomSheet open={!!editMember} onClose={() => setEditMember(null)}>
        {editMember ? (
          <>
            <h2>Roles for {editMember.name}</h2>
            <p className="sheet-sub">
              Roles are cumulative. Admin includes canvassing, so Canvasser stays on with Admin.
            </p>
            <RoleToggle selected={editRoles} onChange={setEditRoles} />
            <div className="form-actions">
              <button className="btn btn-outline" onClick={() => setEditMember(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={pending || !editRoles.length}
                onClick={() =>
                  run(() => setMemberRoles(view.id, editMember.userId, editRoles), () =>
                    setEditMember(null),
                  )
                }
              >
                Save roles
              </button>
            </div>
          </>
        ) : null}
      </BottomSheet>

      {/* Add member sheet */}
      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)}>
        <h2>Add member</h2>
        <p className="sheet-sub">
          Invite by email or phone. They&apos;ll be linked when they first sign in.
        </p>
        <div className="form-field">
          <label className="field-label">Email or phone</label>
          <input
            className="field"
            value={addContact}
            placeholder="name@email.org or +1 555 123 4567"
            onChange={(e) => setAddContact(e.target.value)}
          />
        </div>
        {view.perms.assignRoles ? (
          <>
            <label className="field-label" style={{ marginTop: 12 }}>
              Roles
            </label>
            <RoleToggle selected={addRoles} onChange={setAddRoles} />
          </>
        ) : null}
        <div className="form-actions">
          <button className="btn btn-outline" onClick={() => setAddOpen(false)}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={pending || !addContact.trim()}
            onClick={submitAddMember}
          >
            Add member
          </button>
        </div>
      </BottomSheet>

      {/* New list sheet */}
      {view.minivanEnabled || view.civibyteEnabled ? (
        <BottomSheet open={listOpen} onClose={() => setListOpen(false)}>
          <NewListForm
            pending={pending}
            minivanEnabled={view.minivanEnabled}
            civibyteEnabled={view.civibyteEnabled}
            onCancel={() => setListOpen(false)}
            onSubmit={(input) => {
              if (input.source === "minivan") {
                run(
                  () =>
                    enqueueMinivanListImport(view.id, {
                      name: input.name,
                      printedListNumber: input.sourceRef,
                    }),
                  () => setListOpen(false),
                );
                return;
              }
              run(() => createList(view.id, input), () => setListOpen(false));
            }}
          />
        </BottomSheet>
      ) : null}
    </>
  );
}

function campaignToForm(view: CampaignAdminView): Partial<CampaignFormValues> {
  return {
    name: view.name,
    office: view.office,
    district: view.district,
    website: view.website ?? "",
    iconUrl: view.iconUrl ?? "",
    color: view.color,
    tags: view.tags.join(", "),
    regionType: (view.regionType as CampaignFormValues["regionType"]) || "state",
    regionName: view.regionName ?? "",
    regionState: view.regionState ?? "WA",
    centroidLat: view.centroidLat != null ? String(view.centroidLat) : "",
    centroidLng: view.centroidLng != null ? String(view.centroidLng) : "",
    pickupType: (view.pickupType as CampaignFormValues["pickupType"]) ?? "",
    pickupLabel: view.pickupLabel ?? "",
    pickupAddress: view.pickupAddress ?? "",
    pickupDetail: view.pickupDetail ?? "",
    contactName: view.contact?.name ?? "",
    contactRole: view.contact?.role ?? "",
    contactPhone: view.contact?.phone ?? "",
    contactEmail: view.contact?.email ?? "",
  };
}

function NewListForm({
  pending,
  minivanEnabled,
  civibyteEnabled,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  minivanEnabled: boolean;
  civibyteEnabled: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    source: "minivan" | "civibyte";
    sourceRef: string;
    doorsCount: number;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<"minivan" | "civibyte">(
    minivanEnabled ? "minivan" : "civibyte",
  );
  const [sourceRef, setSourceRef] = useState("");

  return (
    <>
      <h2>New list</h2>
      <p className="sheet-sub">
        Add turf from an enabled campaign integration.
      </p>
      <div className="form">
        <div className="form-field">
          <label className="field-label">List name</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-two">
          <div className="form-field">
            <label className="field-label">Source</label>
            <select
              className="field"
              value={source}
              onChange={(e) => setSource(e.target.value as typeof source)}
            >
              {minivanEnabled ? <option value="minivan">MiniVAN</option> : null}
              {civibyteEnabled ? <option value="civibyte">CiviByte</option> : null}
            </select>
          </div>
          {source === "civibyte" ? (
            <div className="form-field">
              <label className="field-label">Import</label>
              <p className="sheet-sub" style={{ margin: 0 }}>
                Pulls doors and voters now
              </p>
            </div>
          ) : (
            <div className="form-field">
              <label className="field-label">Import</label>
              <p className="sheet-sub" style={{ margin: 0 }}>
                Queues emulator download
              </p>
            </div>
          )}
        </div>
        <div className="form-field">
          <label className="field-label">
            {source === "minivan"
              ? "Printed list number"
              : "List URL"}
          </label>
          <input
            className="field"
            value={sourceRef}
            placeholder={source === "minivan" ? "57429198-80406" : undefined}
            onChange={(e) => setSourceRef(e.target.value)}
          />
        </div>
        <div className="form-actions">
          <button className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={
              pending ||
              !name.trim() ||
              (source === "minivan" && !/^\d+-\d+$/.test(sourceRef.trim())) ||
              (source === "civibyte" &&
                !/^https:\/\/(?:www\.)?civibyte\.com\/(?:c|canvassing-session)\/[^/]+\/?$/i.test(
                  sourceRef.trim(),
                ))
            }
            onClick={() =>
              onSubmit({
                name: name.trim(),
                source,
                sourceRef: sourceRef.trim(),
                doorsCount: 0,
              })
            }
          >
            {source === "minivan" ? "Queue MiniVAN import" : "Import Civibyte list"}
          </button>
        </div>
      </div>
    </>
  );
}

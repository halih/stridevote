"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CampaignAdminView, MemberRow } from "@/lib/admin-data";
import { ASSIGNABLE_ROLES, ROLES, roleLabel, type RoleName } from "@/lib/roles";
import { Icon } from "@/components/Icon";
import { BottomSheet } from "@/components/BottomSheet";
import { useToast } from "@/components/Toast";
import { CampaignForm, type CampaignFormValues } from "@/components/manage/CampaignForm";
import { CampaignTurfManager } from "@/components/manage/CampaignTurfManager";
import { DeleteCampaignButton } from "@/components/manage/DeleteCampaignButton";
import {
  addMember,
  approveMembership,
  createList,
  deleteList,
  denyMembership,
  setMemberRoles,
} from "@/lib/admin-actions";
import { sourceLabel } from "@/lib/format";

type Tab = "members" | "turfs" | "lists" | "settings";

function RoleToggle({
  selected,
  onChange,
}: {
  selected: RoleName[];
  onChange: (roles: RoleName[]) => void;
}) {
  function toggle(role: RoleName) {
    onChange(selected.includes(role) ? selected.filter((r) => r !== role) : [...selected, role]);
  }
  return (
    <div className="role-toggle">
      {ASSIGNABLE_ROLES.map((role) => (
        <button
          type="button"
          key={role}
          className={`role-option${selected.includes(role) ? " on" : ""}`}
          onClick={() => toggle(role)}
        >
          <b>{ROLES[role].label}</b>
          <span>{ROLES[role].description}</span>
        </button>
      ))}
    </div>
  );
}

export function ManageCampaignView({ view }: { view: CampaignAdminView }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const requested = searchParams.get("section");
  const tab: Tab =
    requested === "members" ||
    requested === "turfs" ||
    requested === "lists" ||
    requested === "settings"
      ? requested
      : view.perms.approve || view.perms.add || view.perms.assignRoles
        ? "members"
        : "lists";

  const [editMember, setEditMember] = useState<MemberRow | null>(null);
  const [editRoles, setEditRoles] = useState<RoleName[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addContact, setAddContact] = useState("");
  const [addRoles, setAddRoles] = useState<RoleName[]>(["canvasser"]);
  const [listOpen, setListOpen] = useState(false);

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
    setEditRoles(m.roles.filter((r): r is RoleName => (ASSIGNABLE_ROLES as string[]).includes(r)));
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

  function removeList(list: { id: string; name: string; checkedOutBy: string | null }) {
    const warning = list.checkedOutBy
      ? `This list is checked out by ${list.checkedOutBy}. Deleting it will cancel that checkout. Continue?`
      : `Delete ${list.name}? This cannot be undone.`;
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
                        {m.roles.map((r) => (
                          <span key={r} className="role-chip">
                            {roleLabel(r)}
                          </span>
                        ))}
                      </div>
                    </div>
                    {view.perms.assignRoles ? (
                      <div className="member-actions">
                        <button className="btn btn-outline btn-sm" onClick={() => openEditRoles(m)}>
                          <Icon name="pencil" size={13} /> Roles
                        </button>
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
        />
      ) : null}

      {activeTab === "lists" ? (
        <section className="section">
          <div className="section-head">
            <span className="eyebrow">Lists</span>
            {view.perms.manageLists ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setListOpen(true)}>
                <Icon name="plus" size={14} /> New list
              </button>
            ) : null}
          </div>
          {view.lists.length ? (
            <div className="list-grid">
              {view.lists.map((l) => (
                <div key={l.id} className="card list-card">
                  <div className="list-top">
                    <div>
                      <Link href={`/admin/lists/${l.id}`} className="list-card-link">
                        <p className="list-name">{l.name}</p>
                      </Link>
                    </div>
                    <div className="list-top-actions">
                      <span className="source-chip">{sourceLabel(l.source)}</span>
                      {view.perms.manageLists ? (
                        <button
                          type="button"
                          className="icon-btn"
                          style={{ color: "var(--critical)" }}
                          aria-label={`Delete ${l.name}`}
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
                    ) : l.assignedUserName ? (
                      <span className="meta-stat">
                        Assigned to <b>{l.assignedUserName}</b>
                      </span>
                    ) : (
                      <span className="meta-stat">Available</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No lists yet. Create one to get canvassers started.</div>
          )}
        </section>
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
            />
          </div>
          {view.perms.deleteCampaign ? (
            <div className="danger-zone">
              <div>
                <b>Delete campaign</b>
                <p>Permanently remove this campaign and its private data.</p>
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
            <p className="sheet-sub">Roles are cumulative. Choose everything this member can do.</p>
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
      <BottomSheet open={listOpen} onClose={() => setListOpen(false)}>
        <NewListForm
          pending={pending}
          onCancel={() => setListOpen(false)}
          onSubmit={(input) => run(() => createList(view.id, input), () => setListOpen(false))}
        />
      </BottomSheet>
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
    volunteers: String(view.volunteers),
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
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    name: string;
    source: "minivan" | "civibyte" | "stridevote";
    sourceRef: string;
    doorsCount: number;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<"minivan" | "civibyte" | "stridevote">(
    "stridevote",
  );
  const [sourceRef, setSourceRef] = useState("");
  const [doors, setDoors] = useState("0");

  return (
    <>
      <h2>New list</h2>
      <p className="sheet-sub">Turf sourced from MiniVAN, Civibyte, or StrideVote.</p>
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
              <option value="stridevote">StrideVote</option>
              <option value="minivan">Minivan</option>
              <option value="civibyte">Civibyte</option>
            </select>
          </div>
          <div className="form-field">
            <label className="field-label">Doors</label>
            <input
              className="field"
              type="number"
              min={0}
              value={doors}
              onChange={(e) => setDoors(e.target.value)}
            />
          </div>
        </div>
        <div className="form-field">
          <label className="field-label">
            {source === "minivan" ? "List number" : source === "civibyte" ? "List URL" : "Reference"}
          </label>
          <input
            className="field"
            value={sourceRef}
            onChange={(e) => setSourceRef(e.target.value)}
          />
        </div>
        <div className="form-actions">
          <button className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={pending || !name.trim()}
            onClick={() =>
              onSubmit({
                name: name.trim(),
                source,
                sourceRef: sourceRef.trim(),
                doorsCount: Number(doors) || 0,
              })
            }
          >
            Create list
          </button>
        </div>
      </div>
    </>
  );
}

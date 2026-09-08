"use client";

import { useMemo, useState } from "react";
import { BottomSheet } from "@/components/BottomSheet";
import { ProgressiveScoreControl } from "@/components/canvass/ProgressiveScoreControl";
import type { FieldPacketDoor } from "@/lib/canvass/packet";
import {
  DOOR_NOTES_MAX,
  DOOR_OUTCOMES,
  DOOR_OUTCOME_LABELS,
  type DoorOutcome,
  type ProgramQuestion,
} from "@/lib/canvass/outcomes";
import type { SyncAttemptInput } from "@/lib/canvass/sync";
import {
  displayProgressiveScore,
  isProgressiveScore,
  progressiveScoreLabel,
  type ProgressiveScore,
} from "@/lib/canvass/progressive-score";

type GroupType = "talked" | "moved";

type ConversationGroup = {
  id: string;
  type: GroupType;
  voterIds: string[];
  support: number | null;
  talkScore: ProgressiveScore | null;
  talkScoreTouched: boolean;
  answers: Record<string, unknown>;
};

function newGroup(type: GroupType, voterIds: string[] = []): ConversationGroup {
  return {
    id: crypto.randomUUID(),
    type,
    voterIds,
    support: null,
    talkScore: null,
    talkScoreTouched: false,
    answers: {},
  };
}

export function DoorSheet({
  door,
  script,
  questions,
  onClose,
  onSave,
}: {
  door: FieldPacketDoor;
  script: string | null;
  questions: ProgramQuestion[];
  onClose: () => void;
  onSave: (payload: {
    outcome: DoorOutcome;
    notes: string | null;
    supersedesClientId: string | null;
    observedScore?: ProgressiveScore | null;
    clearObservedScore?: boolean;
    people: SyncAttemptInput["people"];
  }) => void;
}) {
  const [outcome, setOutcome] = useState<DoorOutcome | null>(
    (door.current?.outcome as DoorOutcome) ?? null,
  );
  const [notes, setNotes] = useState("");
  const [observedScore, setObservedScore] = useState<ProgressiveScore | null>(
    () => {
      const raw = door.current?.observedScore ?? door.field?.observedScore;
      return isProgressiveScore(raw) ? raw : null;
    },
  );
  const [observedTouched, setObservedTouched] = useState(false);
  const [groups, setGroups] = useState<ConversationGroup[]>(() => {
    if (door.voters.length === 1) {
      return [newGroup("talked", [door.voters[0].voterId])];
    }
    return [newGroup("talked")];
  });

  const isContact = outcome === "contact";
  const isRefused = outcome === "refused";

  const assignedIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      for (const id of g.voterIds) set.add(id);
    }
    return set;
  }, [groups]);

  const canSave = useMemo(() => {
    if (!outcome) return false;
    if (isRefused) return true;
    if (!isContact) return true;
    const talked = groups.filter((g) => g.type === "talked" && g.voterIds.length);
    const moved = groups.filter((g) => g.type === "moved" && g.voterIds.length);
    if (!talked.length && !moved.length) return false;
    return talked.every((g) => g.voterIds.length > 0);
  }, [outcome, isRefused, isContact, groups]);

  function setGroup(id: string, patch: Partial<ConversationGroup>) {
    setGroups((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  function toggleVoter(groupId: string, voterId: string) {
    setGroups((rows) =>
      rows.map((row) => {
        if (row.id !== groupId) {
          return {
            ...row,
            voterIds: row.voterIds.filter((id) => id !== voterId),
          };
        }
        const has = row.voterIds.includes(voterId);
        return {
          ...row,
          voterIds: has
            ? row.voterIds.filter((id) => id !== voterId)
            : [...row.voterIds, voterId],
        };
      }),
    );
  }

  function buildPeople(): SyncAttemptInput["people"] {
    if (isRefused) {
      return door.voters.map((v) => ({
        voterId: v.voterId,
        outcome: "refused" as const,
        support: null,
        talkScore: null,
        answers: {},
        notes: null,
      }));
    }
    if (!isContact) return [];

    const byVoter = new Map<
      string,
      NonNullable<SyncAttemptInput["people"]>[number]
    >();

    for (const v of door.voters) {
      byVoter.set(v.voterId, {
        voterId: v.voterId,
        outcome: "not_home",
        support: null,
        talkScore: null,
        answers: {},
        notes: null,
      });
    }

    for (const g of groups) {
      if (!g.voterIds.length) continue;
      for (const voterId of g.voterIds) {
        if (g.type === "moved") {
          byVoter.set(voterId, {
            voterId,
            outcome: "moved",
            support: null,
            talkScore: null,
            answers: {},
            notes: null,
          });
        } else {
          byVoter.set(voterId, {
            voterId,
            outcome: "talked",
            support: g.support,
            talkScore: g.talkScoreTouched ? g.talkScore : undefined,
            clearTalkScore:
              g.talkScoreTouched && g.talkScore == null ? true : undefined,
            answers: g.answers,
            notes: null,
          });
        }
      }
    }

    return Array.from(byVoter.values());
  }

  const priorBits: string[] = [];
  const accessStatus = door.field?.accessStatus ?? "ok";
  const observedPrior = door.field?.observedScore ?? null;
  const observedPriorAt = door.field?.observedScoreAt ?? null;
  if (accessStatus === "inaccessible") {
    priorBits.push("Confirmed inaccessible");
  } else if (accessStatus === "unsafe") {
    priorBits.push("Confirmed unsafe");
  }
  if (observedPrior != null) {
    priorBits.push(`Observed: ${progressiveScoreLabel(observedPrior)}`);
  }
  for (const v of door.voters) {
    if (v.residenceStatus === "moved") {
      priorBits.push(`${v.firstName} marked moved`);
    }
    const disp = displayProgressiveScore({
      talkScore: v.talkScore ?? null,
      scoreUpdatedAt: v.scoreUpdatedAt ?? null,
      observedScore: observedPrior,
      observedScoreAt: observedPriorAt,
    });
    if (disp.source === "talk" && disp.score != null) {
      priorBits.push(
        `${v.firstName}: ${progressiveScoreLabel(disp.score)} (talk)`,
      );
    }
  }

  return (
    <BottomSheet open onClose={onClose}>
      <h2>{door.address}</h2>
      <p className="sheet-sub">
        {door.voters.length} voter{door.voters.length === 1 ? "" : "s"}
        {door.current ? ` · Current: ${door.current.outcomeLabel}` : ""}
      </p>

      {priorBits.length ? (
        <div className="walk-history" style={{ marginBottom: 10 }}>
          {priorBits.map((bit) => (
            <span key={bit} className="pill pill-neutral">
              {bit}
            </span>
          ))}
        </div>
      ) : null}

      {door.history.length ? (
        <div className="walk-history" style={{ marginBottom: 10 }}>
          {door.history.map((h) => (
            <span key={`${h.programName}-${h.capturedAt}`} className="pill pill-neutral">
              {h.programName}: {h.outcomeLabel}
              {h.support != null ? ` · support ${h.support}` : ""}
            </span>
          ))}
        </div>
      ) : null}

      {script ? (
        <>
          <div className="eyebrow">Script</div>
          <p className="walk-script">{script}</p>
        </>
      ) : null}

      <div className="eyebrow">Door outcome</div>
      <div className="outcome-grid">
        {DOOR_OUTCOMES.map((key) => (
          <button
            key={key}
            type="button"
            className={`outcome-btn ${outcome === key ? "active" : ""}`}
            onClick={() => setOutcome(key)}
          >
            {DOOR_OUTCOME_LABELS[key]}
          </button>
        ))}
      </div>

      {isRefused ? (
        <p className="sheet-sub" style={{ marginTop: 12 }}>
          All voters at this door will be marked refused.
        </p>
      ) : null}

      {isContact ? (
        <div className="stack" style={{ marginTop: 14 }}>
          <div className="eyebrow">People at this door</div>
          {groups.map((group, index) => (
            <div key={group.id} className="card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <b>
                  {group.type === "talked"
                    ? `Conversation ${index + 1}`
                    : `Moved ${index + 1}`}
                </b>
                {groups.length > 1 ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() =>
                      setGroups((rows) => rows.filter((r) => r.id !== group.id))
                    }
                  >
                    Remove
                  </button>
                ) : null}
              </div>

              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                {(["talked", "moved"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`btn btn-sm ${group.type === t ? "btn-primary" : "btn-outline"}`}
                    onClick={() => setGroup(group.id, { type: t })}
                  >
                    {t === "talked" ? "Talked" : "Moved"}
                  </button>
                ))}
              </div>

              {door.voters.length > 1 ? (
                <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                  <span className="field-label">Who</span>
                  {door.voters.map((voter) => {
                    const checked = group.voterIds.includes(voter.voterId);
                    const elsewhere =
                      !checked && assignedIds.has(voter.voterId);
                    return (
                      <label
                        key={voter.voterId}
                        className="row"
                        style={{ gap: 8, opacity: elsewhere ? 0.45 : 1 }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={elsewhere}
                          onChange={() => toggleVoter(group.id, voter.voterId)}
                        />
                        {voter.firstName} {voter.lastName}
                      </label>
                    );
                  })}
                </div>
              ) : null}

              {group.type === "talked" && group.voterIds.length ? (
                <>
                  <div className="eyebrow" style={{ marginTop: 10 }}>
                    Support (1–5)
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`icon-btn ${group.support === n ? "active" : ""}`}
                        onClick={() => setGroup(group.id, { support: n })}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <ProgressiveScoreControl
                    label="Progressive score (from talk)"
                    value={group.talkScore}
                    onChange={(v) =>
                      setGroup(group.id, {
                        talkScore: v,
                        talkScoreTouched: true,
                      })
                    }
                  />
                  {questions.map((q) => (
                    <QuestionField
                      key={q.id}
                      question={q}
                      value={group.answers[q.id]}
                      onChange={(value) =>
                        setGroup(group.id, {
                          answers: { ...group.answers, [q.id]: value },
                        })
                      }
                    />
                  ))}
                </>
              ) : null}
            </div>
          ))}

          <button
            type="button"
            className="btn btn-outline btn-block"
            onClick={() => setGroups((rows) => [...rows, newGroup("talked")])}
          >
            Add another group
          </button>
          <p className="sheet-sub">
            Anyone not in a group is marked not home.
          </p>
        </div>
      ) : null}

      {outcome ? (
        <ProgressiveScoreControl
          label="Observed progressive score (signs)"
          value={observedScore}
          onChange={(v) => {
            setObservedScore(v);
            setObservedTouched(true);
          }}
        />
      ) : null}

      <div className="form-field" style={{ marginTop: 12 }}>
        <label className="field-label">Notes (admins only)</label>
        <textarea
          className="field field-textarea"
          value={notes}
          maxLength={DOOR_NOTES_MAX}
          onChange={(e) => setNotes(e.target.value.slice(0, DOOR_NOTES_MAX))}
          rows={3}
          placeholder="Optional"
        />
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 14 }}
        disabled={!canSave}
        onClick={() => {
          if (!outcome) return;
          onSave({
            outcome,
            notes: notes.trim() || null,
            supersedesClientId: door.current?.clientAttemptId ?? null,
            observedScore: observedTouched ? observedScore : undefined,
            clearObservedScore:
              observedTouched && observedScore == null ? true : undefined,
            people: buildPeople(),
          });
        }}
      >
        {door.current ? "Replace result" : "Save result"}
      </button>
    </BottomSheet>
  );
}

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: ProgramQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  return (
    <div className="form-field" style={{ marginTop: 10 }}>
      <span className="field-label">{question.label}</span>
      {question.type === "yes_no" ? (
        <div className="row" style={{ gap: 6 }}>
          {["Yes", "No"].map((opt) => (
            <button
              key={opt}
              type="button"
              className={`btn btn-sm ${value === opt ? "btn-primary" : "btn-outline"}`}
              onClick={() => onChange(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : null}
      {question.type === "single" ? (
        <select
          className="field"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {(question.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : null}
      {question.type === "multi" ? (
        <div className="stack" style={{ gap: 6 }}>
          {(question.options ?? []).map((opt) => {
            const selected = Array.isArray(value) ? value.includes(opt) : false;
            return (
              <label key={opt} className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => {
                    const prev = Array.isArray(value) ? [...value] : [];
                    onChange(
                      e.target.checked
                        ? [...prev, opt]
                        : prev.filter((v) => v !== opt),
                    );
                  }}
                />
                {opt}
              </label>
            );
          })}
        </div>
      ) : null}
      {question.type === "support" ? (
        <div className="row" style={{ gap: 6 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={`icon-btn ${value === n ? "active" : ""}`}
              onClick={() => onChange(n)}
            >
              {n}
            </button>
          ))}
        </div>
      ) : null}
      {question.type === "text" ? (
        <input
          className="field"
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { BottomSheet } from "@/components/BottomSheet";
import type { FieldPacketDoor } from "@/lib/canvass/packet";
import {
  DOOR_OUTCOMES,
  DOOR_OUTCOME_LABELS,
  PERSON_OUTCOMES,
  PERSON_OUTCOME_LABELS,
  type DoorOutcome,
  type PersonOutcome,
  type ProgramQuestion,
} from "@/lib/canvass/outcomes";
import type { SyncAttemptInput } from "@/lib/canvass/sync";

type PersonState = {
  voterId: string;
  outcome: PersonOutcome;
  support: number | null;
  answers: Record<string, unknown>;
  notes: string;
};

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
    people: SyncAttemptInput["people"];
  }) => void;
}) {
  const [outcome, setOutcome] = useState<DoorOutcome | null>(
    (door.current?.outcome as DoorOutcome) ?? null,
  );
  const [notes, setNotes] = useState("");
  const [people, setPeople] = useState<PersonState[]>(() =>
    door.voters.map((v) => ({
      voterId: v.voterId,
      outcome: "not_home" as PersonOutcome,
      support: null,
      answers: {},
      notes: "",
    })),
  );

  const needsPeople = outcome === "contact" || outcome === "refused";

  const canSave = useMemo(() => {
    if (!outcome) return false;
    if (!needsPeople) return true;
    return people.some((p) => p.outcome === "talked" || p.outcome === "refused");
  }, [outcome, needsPeople, people]);

  function updatePerson(voterId: string, patch: Partial<PersonState>) {
    setPeople((rows) =>
      rows.map((row) => (row.voterId === voterId ? { ...row, ...patch } : row)),
    );
  }

  function setAnswer(voterId: string, questionId: string, value: unknown) {
    setPeople((rows) =>
      rows.map((row) =>
        row.voterId === voterId
          ? { ...row, answers: { ...row.answers, [questionId]: value } }
          : row,
      ),
    );
  }

  return (
    <BottomSheet open onClose={onClose}>
      <h2>{door.address}</h2>
      <p className="sheet-sub">
        {door.voters.length} voter{door.voters.length === 1 ? "" : "s"}
        {door.current ? ` · Current: ${door.current.outcomeLabel}` : ""}
      </p>

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

      {needsPeople ? (
        <div className="stack" style={{ marginTop: 14 }}>
          <div className="eyebrow">People at this door</div>
          {door.voters.map((voter) => {
            const state = people.find((p) => p.voterId === voter.voterId)!;
            return (
              <div key={voter.voterId} className="card" style={{ padding: 12 }}>
                <b>
                  {voter.firstName} {voter.lastName}
                </b>
                <div className="outcome-grid" style={{ marginTop: 8 }}>
                  {PERSON_OUTCOMES.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`outcome-btn ${state.outcome === key ? "active" : ""}`}
                      onClick={() => updatePerson(voter.voterId, { outcome: key })}
                    >
                      {PERSON_OUTCOME_LABELS[key]}
                    </button>
                  ))}
                </div>
                {state.outcome === "talked" ? (
                  <>
                    <div className="eyebrow" style={{ marginTop: 10 }}>
                      Support (1–5)
                    </div>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`icon-btn ${state.support === n ? "active" : ""}`}
                          onClick={() => updatePerson(voter.voterId, { support: n })}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    {questions.map((q) => (
                      <QuestionField
                        key={q.id}
                        question={q}
                        value={state.answers[q.id]}
                        onChange={(value) => setAnswer(voter.voterId, q.id, value)}
                      />
                    ))}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="form-field" style={{ marginTop: 12 }}>
        <label className="field-label">Notes (admins only)</label>
        <textarea
          className="field field-textarea"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
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
            people: needsPeople
              ? people.map((p) => ({
                  voterId: p.voterId,
                  outcome: p.outcome,
                  support: p.support,
                  answers: p.answers,
                  notes: p.notes.trim() || null,
                }))
              : [],
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

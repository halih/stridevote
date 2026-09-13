"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { Icon } from "@/components/Icon";
import { BottomSheet } from "@/components/BottomSheet";
import { createProgram, updateProgram } from "@/lib/admin-actions";
import type { ProgramQuestion } from "@/lib/canvass/outcomes";

export function ProgramManager({
  campaignId,
  campaignSlug,
  programs,
}: {
  campaignId: string;
  campaignSlug: string;
  programs: Array<{
    id: string;
    name: string;
    status: string;
    electionType: string;
    electionDate: string | null;
    script: string | null;
    questions: ProgramQuestion[];
    listCount: number;
    attemptCount: number;
  }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"draft" | "active" | "closed">("draft");
  const [electionType, setElectionType] = useState<"primary" | "general">("general");
  const [electionDate, setElectionDate] = useState("");
  const [script, setScript] = useState("");
  const [questions, setQuestions] = useState<ProgramQuestion[]>([]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setStatus("draft");
    setElectionType("general");
    setElectionDate("");
    setScript("");
    setQuestions([]);
  }

  const closeSheet = useCallback(() => {
    setOpen(false);
    resetForm();
  }, []);

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(program: (typeof programs)[number]) {
    setEditingId(program.id);
    setName(program.name);
    setStatus(program.status as "draft" | "active" | "closed");
    setElectionType(program.electionType as "primary" | "general");
    setElectionDate(program.electionDate ?? "");
    setScript(program.script ?? "");
    setQuestions(program.questions ?? []);
    setOpen(true);
  }

  function addQuestion() {
    setQuestions((q) => [
      ...q,
      {
        id: crypto.randomUUID(),
        type: "yes_no",
        label: "New question",
      },
    ]);
  }

  function submit() {
    startTransition(async () => {
      const payload = {
        name,
        status,
        electionType,
        electionDate: electionDate || null,
        script: script.trim() || null,
        questions,
      };
      const res = editingId
        ? await updateProgram(editingId, payload)
        : await createProgram(campaignId, payload);
      toast(res.message);
      if (res.ok) {
        setOpen(false);
        resetForm();
        router.refresh();
      }
    });
  }

  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">Canvass waves</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={openCreate}>
          <Icon name="plus" size={14} /> New wave
        </button>
      </div>
      <p className="section-sub" style={{ marginBottom: 10 }}>
        Separate passes like Primary vs General. Each keeps its own checkout and results.
        Choose a wave in Turfs before cutting lists into it.
      </p>
      <div className="stack">
        {programs.length ? (
          programs.map((p) => (
            <div key={p.id} className="card program-card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <b>{p.name}</b>
                  <p className="program-meta">
                    {p.status} · {p.electionType === "primary" ? "Primary" : "General"}
                    {p.electionDate ? ` ${p.electionDate}` : ""} · {p.listCount} lists ·{" "}
                    {p.attemptCount} attempts
                  </p>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <a
                    className="btn btn-outline btn-sm"
                    href={`/admin/${campaignSlug}/programs/${p.id}`}
                  >
                    Results
                  </a>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => openEdit(p)}
                  >
                    Edit
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-state">No waves yet — create Primary or General to start.</div>
        )}
      </div>

      <BottomSheet open={open} onClose={closeSheet}>
        <h2>{editingId ? "Edit wave" : "New wave"}</h2>
        <div className="form" style={{ marginTop: 12 }}>
          <div className="form-field">
            <label className="field-label" htmlFor="program-name">
              Name
            </label>
            <input
              id="program-name"
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="2026 Primary"
            />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="program-status">
              Status
            </label>
            <select
              id="program-status"
              className="field"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="program-election-type">
              Election type
            </label>
            <select
              id="program-election-type"
              className="field"
              value={electionType}
              onChange={(e) => setElectionType(e.target.value as typeof electionType)}
            >
              <option value="primary">Primary</option>
              <option value="general">General</option>
            </select>
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="program-election-date">
              Election date
            </label>
            <input
              id="program-election-date"
              className="field"
              type="date"
              value={electionDate}
              onChange={(e) => setElectionDate(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="program-script">
              Script
            </label>
            <textarea
              id="program-script"
              className="field field-textarea"
              rows={3}
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="What canvassers should say at the door"
            />
          </div>
        </div>
        <div className="section-head" style={{ marginTop: 12 }}>
          <span className="eyebrow">Questions</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addQuestion}>
            Add
          </button>
        </div>
        <div className="stack">
          {questions.map((q, idx) => (
            <div key={q.id} className="card" style={{ padding: 10 }}>
              <div className="form-field">
                <label className="field-label">Question</label>
                <input
                  className="field"
                  value={q.label}
                  onChange={(e) =>
                    setQuestions((rows) =>
                      rows.map((row, i) =>
                        i === idx ? { ...row, label: e.target.value } : row,
                      ),
                    )
                  }
                  placeholder="Question label"
                />
              </div>
              <div className="form-field" style={{ marginTop: 8 }}>
                <label className="field-label">Type</label>
                <select
                  className="field"
                  value={q.type}
                  onChange={(e) =>
                    setQuestions((rows) =>
                      rows.map((row, i) =>
                        i === idx
                          ? {
                              ...row,
                              type: e.target.value as ProgramQuestion["type"],
                            }
                          : row,
                      ),
                    )
                  }
                >
                  <option value="yes_no">Yes / No</option>
                  <option value="single">Single choice</option>
                  <option value="multi">Multi-select</option>
                  <option value="support">Support 1–5</option>
                  <option value="text">Short text</option>
                </select>
              </div>
              {(q.type === "single" || q.type === "multi") && (
                <div className="form-field" style={{ marginTop: 8 }}>
                  <label className="field-label">Options</label>
                  <input
                    className="field"
                    value={(q.options ?? []).join(", ")}
                    onChange={(e) =>
                      setQuestions((rows) =>
                        rows.map((row, i) =>
                          i === idx
                            ? {
                                ...row,
                                // Keep raw tokens while typing (incl. trailing spaces/commas).
                                options: e.target.value.split(",").map((s) => s.trimStart()),
                              }
                            : row,
                        ),
                      )
                    }
                    onBlur={(e) =>
                      setQuestions((rows) =>
                        rows.map((row, i) =>
                          i === idx
                            ? {
                                ...row,
                                options: e.target.value
                                  .split(",")
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              }
                            : row,
                        ),
                      )
                    }
                    placeholder="Options, comma-separated"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-primary btn-block"
          style={{ marginTop: 14 }}
          disabled={pending || !name.trim() || !electionDate}
          onClick={submit}
        >
          {editingId ? "Save wave" : "Create wave"}
        </button>
      </BottomSheet>
    </section>
  );
}

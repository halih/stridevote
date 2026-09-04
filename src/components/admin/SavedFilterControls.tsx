"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { deleteVoterFilter, saveVoterFilter } from "@/lib/admin-actions";
import {
  filtersToSearchParams,
  type PersistableVoterFilters,
} from "@/lib/voter-filters";
import { useToast } from "@/components/Toast";

type SavedFilter = {
  id: string;
  name: string;
  filters: PersistableVoterFilters;
};

export function SavedFilterControls({
  campaignId,
  slug,
  currentFilters,
  savedFilters,
}: {
  campaignId: string;
  slug: string;
  currentFilters: PersistableVoterFilters;
  savedFilters: SavedFilter[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [loadOpen, setLoadOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [overwriteId, setOverwriteId] = useState<string | null>(null);
  const activeFilterCount = useMemo(
    () => Object.keys(currentFilters).length,
    [currentFilters],
  );

  function loadFilter(saved: SavedFilter) {
    const params = filtersToSearchParams(saved.filters);
    setLoadOpen(false);
    router.push(`/admin/${slug}/voters?${params}`);
  }

  function openSave() {
    if (!activeFilterCount) {
      toast("Apply some filter criteria before saving.");
      return;
    }
    setOverwriteId(null);
    setSaveName("");
    setSaveOpen(true);
  }

  function saveAsNew() {
    if (!saveName.trim()) {
      toast("Name the new filter.");
      return;
    }
    startTransition(async () => {
      const result = await saveVoterFilter(campaignId, {
        name: saveName.trim(),
        filters: currentFilters,
      });
      toast(result.message);
      if (result.ok) {
        setSaveOpen(false);
        setSaveName("");
        router.refresh();
      }
    });
  }

  function overwriteExisting(saved: SavedFilter) {
    startTransition(async () => {
      const result = await saveVoterFilter(campaignId, {
        name: saved.name,
        filters: currentFilters,
      });
      toast(result.message);
      if (result.ok) {
        setSaveOpen(false);
        setOverwriteId(null);
        router.refresh();
      }
    });
  }

  function removeFilter(saved: SavedFilter) {
    startTransition(async () => {
      const result = await deleteVoterFilter(campaignId, saved.id);
      toast(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        disabled={pending}
        onClick={() => setLoadOpen(true)}
      >
        Load
      </button>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        disabled={pending || !activeFilterCount}
        onClick={openSave}
      >
        Save
      </button>

      {loadOpen ? (
        <FilterDialog
          title="Load saved filter"
          subtitle="Choose a campaign filter. Criteria re-run against current voters."
          onClose={() => setLoadOpen(false)}
        >
          {savedFilters.length ? (
            <ul className="voter-filter-dialog-list">
              {savedFilters.map((saved) => (
                <li key={saved.id}>
                  <button
                    type="button"
                    className="voter-filter-dialog-item"
                    disabled={pending}
                    onClick={() => loadFilter(saved)}
                  >
                    <b>{saved.name}</b>
                    <span>{summarizeFilters(saved.filters)}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={pending}
                    onClick={() => removeFilter(saved)}
                    aria-label={`Delete ${saved.name}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="field-hint">No saved filters yet. Apply criteria and use Save.</p>
          )}
        </FilterDialog>
      ) : null}

      {saveOpen ? (
        <FilterDialog
          title="Save current filters"
          subtitle="Overwrite an existing filter or create a new named preset."
          onClose={() => setSaveOpen(false)}
          initialFocus="input"
        >
          <div className="form-field">
            <label className="field-label" htmlFor="new-filter-name">
              New filter name
            </label>
            <div className="voter-filter-dialog-save-new">
              <input
                id="new-filter-name"
                className="field"
                value={saveName}
                placeholder="Likely primary · Shoreline"
                onChange={(event) => {
                  setOverwriteId(null);
                  setSaveName(event.target.value);
                }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={pending || !saveName.trim()}
                onClick={saveAsNew}
              >
                Create
              </button>
            </div>
          </div>

          {savedFilters.length ? (
            <>
              <p className="voter-filter-dialog-section-label">Or overwrite existing</p>
              <ul className="voter-filter-dialog-list">
                {savedFilters.map((saved) => (
                  <li key={saved.id}>
                    <button
                      type="button"
                      className={`voter-filter-dialog-item${overwriteId === saved.id ? " selected" : ""}`}
                      disabled={pending}
                      onClick={() => {
                        setSaveName("");
                        setOverwriteId(saved.id);
                      }}
                    >
                      <b>{saved.name}</b>
                      <span>{summarizeFilters(saved.filters)}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      disabled={pending || overwriteId !== saved.id}
                      onClick={() => overwriteExisting(saved)}
                    >
                      Overwrite
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </FilterDialog>
      ) : null}
    </>
  );
}

function summarizeFilters(filters: PersistableVoterFilters): string {
  const parts: string[] = [];
  if (filters.query) parts.push(`“${filters.query}”`);
  if (filters.precinct) parts.push(`precinct ${filters.precinct}`);
  if (filters.gender) parts.push(filters.gender);
  if (filters.election) parts.push(`voted ${filters.election}`);
  if (filters.minAge || filters.maxAge) {
    parts.push(`age ${filters.minAge || "…"}–${filters.maxAge || "…"}`);
  }
  if (filters.likelyPrimary === "1") parts.push("likely primary");
  if (filters.likelyGeneral === "1") parts.push("likely general");
  if (filters.newVoter === "1") parts.push("new voter");
  if (filters.canvassed === "1") parts.push("canvassed");
  if (filters.noApartments === "1") parts.push("no apartments");
  if (filters.excludeCanvassed === "1") parts.push("exclude canvassed");
  if (filters.excludeInaccessible === "1") parts.push("exclude inaccessible");
  return parts.length ? parts.join(" · ") : "No criteria";
}

function FilterDialog({
  title,
  subtitle,
  onClose,
  children,
  initialFocus = "panel",
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
  initialFocus?: "panel" | "input";
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (initialFocus === "input") {
      panel?.querySelector<HTMLInputElement>("input.field")?.focus();
    } else {
      panel?.focus();
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [initialFocus]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onClick={() => onCloseRef.current()}
    >
      <div
        ref={panelRef}
        className="card confirm-dialog voter-filter-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        <p>{subtitle}</p>
        {children}
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onCloseRef.current()}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

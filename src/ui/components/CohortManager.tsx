import { useState } from "react";
import type { AccountCohortView } from "../api.js";

interface CohortManagerProps {
  cohorts: AccountCohortView[];
  selectedCount: number;
  onSave(name: string): void;
  onLoad(cohort: AccountCohortView): void;
  onDelete(id: string): void;
}

export function CohortManager({ cohorts, selectedCount, onSave, onLoad, onDelete }: CohortManagerProps) {
  const [name, setName] = useState("");

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
  };

  return (
    <section className="cohort-manager">
      <div className="cohort-save-row">
        <input
          type="text"
          value={name}
          placeholder="Save selection as cohort"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") save(); }}
        />
        <button className="tertiary-button" onClick={save} disabled={selectedCount === 0 || !name.trim()}>
          Save
        </button>
      </div>
      {cohorts.length > 0 ? (
        <div className="cohort-list">
          {cohorts.map((cohort) => (
            <div key={cohort.id} className="cohort-item">
              <button className="cohort-load" onClick={() => onLoad(cohort)}>
                <strong>{cohort.name}</strong>
                <small>{cohort.accountIds.length} account{cohort.accountIds.length === 1 ? "" : "s"}</small>
              </button>
              <button className="tertiary-button compact" onClick={() => onDelete(cohort.id)}>Delete</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="configure-hint">No saved cohorts yet.</p>
      )}
    </section>
  );
}

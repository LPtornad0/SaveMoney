import { useEffect, useRef, type FormEvent } from "react";

export interface GoalAmountFormProps {
  goalId: number;
  goalLabel: string;
  draft: string;
  error: string | null;
  saveError: string | null;
  saving: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

// Edits the current amount of one goal. The field has a visible label and the error is linked to it.
export function GoalAmountForm({
  goalId,
  goalLabel,
  draft,
  error,
  saveError,
  saving,
  onChange,
  onSubmit,
  onCancel,
}: GoalAmountFormProps) {
  const inputId = `goal-${goalId}-amount`;
  const errorId = `${inputId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  // A rejected submit moves focus to the field
  useEffect(() => {
    if (error) inputRef.current?.focus();
  }, [error]);

  // A failed save keeps the form open: focus returns to the submit button, which was disabled while saving
  useEffect(() => {
    if (saveError) submitRef.current?.focus();
  }, [saveError]);

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={`Modifier le montant courant de ${goalLabel}`}
      style={{ marginTop: "var(--spacing-2)", display: "grid", gap: "var(--spacing-2)" }}
    >
      <div className="form-field">
        <label htmlFor={inputId}>Montant courant (€)</label>
        <input
          id={inputId}
          ref={inputRef}
          className="form-input"
          type="number"
          step="0.01"
          min="0"
          value={draft}
          disabled={saving}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {error && <p id={errorId} className="field-error">{error}</p>}
      </div>
      <div className="ops-edit-actions">
        {saveError && <p role="alert" className="field-error">{saveError}</p>}
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={saving}>
          Annuler
        </button>
        <button ref={submitRef} type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}

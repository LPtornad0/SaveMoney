import { useEffect, useRef, type FormEvent } from "react";
import type { EditDraft, EditErrors, EditKind } from "../utils/inlineEdit";

export interface CategoryOption {
  id: number;
  name: string;
}

export interface OperationEditFormProps {
  idPrefix: string;
  kind: EditKind;
  draft: EditDraft;
  errors: EditErrors;
  saveError: string | null;
  saving: boolean;
  categories: CategoryOption[];
  onChange: (field: keyof EditDraft, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

// Replaces the content of one operation row while it is edited. Values come from the parent's state,
// so they survive the reload that the parent shows during a save.
export function OperationEditForm({
  idPrefix,
  kind,
  draft,
  errors,
  saveError,
  saving,
  categories,
  onChange,
  onSubmit,
  onCancel,
}: OperationEditFormProps) {
  const labelId = `${idPrefix}-label`;
  const amountId = `${idPrefix}-amount`;
  const categoryId = `${idPrefix}-category`;
  const dayId = `${idPrefix}-day`;

  const labelRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  // A rejected submit moves focus to the first field in error
  useEffect(() => {
    if (errors.label) labelRef.current?.focus();
    else if (errors.amount) amountRef.current?.focus();
    else if (errors.day) dayRef.current?.focus();
  }, [errors]);

  // A failed save keeps the form open: focus returns to the submit button, which was disabled while saving
  useEffect(() => {
    if (saveError) submitRef.current?.focus();
  }, [saveError]);

  return (
    <form className="ops-edit-form" onSubmit={onSubmit} noValidate aria-label="Modifier l'opération">
      <div className="form-field">
        <label htmlFor={labelId}>Libellé</label>
        <input
          id={labelId}
          ref={labelRef}
          className="form-input"
          value={draft.label}
          disabled={saving}
          autoFocus
          onChange={(e) => onChange("label", e.target.value)}
          aria-invalid={errors.label ? true : undefined}
          aria-describedby={errors.label ? `${labelId}-error` : undefined}
        />
        {errors.label && <p id={`${labelId}-error`} className="field-error">{errors.label}</p>}
      </div>
      <div className="form-field">
        <label htmlFor={amountId}>Montant (€)</label>
        <input
          id={amountId}
          ref={amountRef}
          className="form-input"
          type="number"
          step="0.01"
          min="0"
          value={draft.amount}
          disabled={saving}
          onChange={(e) => onChange("amount", e.target.value)}
          aria-invalid={errors.amount ? true : undefined}
          aria-describedby={errors.amount ? `${amountId}-error` : undefined}
        />
        {errors.amount && <p id={`${amountId}-error`} className="field-error">{errors.amount}</p>}
      </div>
      <div className="form-field">
        <label htmlFor={categoryId}>Catégorie</label>
        <select
          id={categoryId}
          className="form-input"
          value={draft.categoryId}
          disabled={saving}
          onChange={(e) => onChange("categoryId", e.target.value)}
        >
          <option value="">Aucune catégorie</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>
      {kind === "recurring" && (
        <div className="form-field">
          <label htmlFor={dayId}>Jour du mois (1 à 31)</label>
          <input
            id={dayId}
            ref={dayRef}
            className="form-input"
            type="number"
            inputMode="numeric"
            min="1"
            max="31"
            step="1"
            value={draft.day}
            disabled={saving}
            onChange={(e) => onChange("day", e.target.value)}
            aria-invalid={errors.day ? true : undefined}
            aria-describedby={errors.day ? `${dayId}-error` : undefined}
          />
          {errors.day && <p id={`${dayId}-error`} className="field-error">{errors.day}</p>}
        </div>
      )}
      <div className="ops-edit-actions">
        {saveError && <p role="alert" className="field-error">{saveError}</p>}
        {/* Deletion is not possible while the row is edited: shown disabled, with the reason */}
        <button
          type="button"
          className="ops-delete"
          disabled
          aria-label="Suppression indisponible pendant la modification"
          title="Terminez ou annulez la modification pour supprimer cette opération"
        >
          ×
        </button>
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

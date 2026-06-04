import { useState } from "react";
import type {
  ProviderSecretFieldInput,
  ProviderSecretFieldStatus,
} from "../../types/providerConfig";
import "./ProviderSecretFieldCard.css";

type ProviderSecretFieldCardProps = {
  title: string;
  summary: ProviderSecretFieldStatus;
  inputType?: "text" | "password";
  multiline?: boolean;
  placeholder: string;
  helperText?: string;
  submitLabel: string;
  isSaving: boolean;
  onSave: (nextValue: ProviderSecretFieldInput) => Promise<void>;
};

function formatUpdatedAt(updatedAt: number | null) {
  if (updatedAt === null) {
    return "nog niet opgeslagen";
  }

  return new Date(updatedAt).toLocaleString("nl-NL");
}

export function ProviderSecretFieldCard({
  title,
  summary,
  inputType = "text",
  multiline = false,
  placeholder,
  helperText,
  submitLabel,
  isSaving,
  onSave,
}: ProviderSecretFieldCardProps) {
  const [name, setName] = useState(summary.label);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    try {
      await onSave({
        label: name,
        value,
      });

      setValue("");
      setMessage("Opgeslagen.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Opslaan mislukt.",
      );
    }
  }

  return (
    <form onSubmit={handleSubmit} className="provider-secret-card">
      <div className="provider-secret-card__header">
        <h4 className="provider-secret-card__heading">{title}</h4>
        <span className="provider-secret-card__status">
          {summary.hasValue ? "waarde ingesteld" : "nog geen waarde"}
        </span>
      </div>

      <div className="provider-secret-card__summary">
        <div>
          Label: <strong>{summary.label}</strong>
        </div>
        <div className="provider-secret-card__meta">
          Laatst bijgewerkt: {formatUpdatedAt(summary.updatedAt)}
        </div>
      </div>

      <label className="provider-secret-card__field">
        Name
        <input
          className="provider-secret-card__field-control"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Alleen voor jezelf"
        />
      </label>

      <label className="provider-secret-card__field">
        Value
        {multiline ? (
          <textarea
            className="provider-secret-card__field-control"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            rows={5}
          />
        ) : (
          <input
            className="provider-secret-card__field-control"
            type={inputType}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
          />
        )}
      </label>

      <p className="provider-secret-card__helper">
        Value wordt nooit teruggestuurd naar de browser. Laat Value leeg om de
        huidige opgeslagen waarde te behouden.
      </p>

      {helperText ? (
        <p className="provider-secret-card__helper">{helperText}</p>
      ) : null}

      {message ? <p className="provider-secret-card__message">{message}</p> : null}
      {error ? (
        <p className="provider-secret-card__message provider-secret-card__message--error">
          {error}
        </p>
      ) : null}

      <div className="provider-secret-card__actions">
        <button type="submit" disabled={isSaving}>
          {isSaving ? "Opslaan..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

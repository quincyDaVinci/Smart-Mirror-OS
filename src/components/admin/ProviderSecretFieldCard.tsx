import { useState } from "react";
import type {
  ProviderSecretFieldInput,
  ProviderSecretFieldStatus,
} from "../../types/providerConfig";

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
    <form
      onSubmit={handleSubmit}
      style={{
        padding: 16,
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
        display: "grid",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <h4 style={{ margin: 0 }}>{title}</h4>
        <span style={{ opacity: 0.72, fontSize: 14 }}>
          {summary.hasValue ? "waarde ingesteld" : "nog geen waarde"}
        </span>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <div>
          Label: <strong>{summary.label}</strong>
        </div>
        <div style={{ opacity: 0.72, fontSize: 14 }}>
          Laatst bijgewerkt: {formatUpdatedAt(summary.updatedAt)}
        </div>
      </div>

      <label>
        Name
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Alleen voor jezelf"
          style={{ display: "block", width: "100%", marginTop: 6 }}
        />
      </label>

      <label>
        Value
        {multiline ? (
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            rows={5}
            style={{ display: "block", width: "100%", marginTop: 6 }}
          />
        ) : (
          <input
            type={inputType}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            style={{ display: "block", width: "100%", marginTop: 6 }}
          />
        )}
      </label>

      <p style={{ margin: 0, opacity: 0.72, fontSize: 14 }}>
        Value wordt nooit teruggestuurd naar de browser. Laat Value leeg om de
        huidige opgeslagen waarde te behouden.
      </p>

      {helperText ? (
        <p style={{ margin: 0, opacity: 0.72, fontSize: 14 }}>{helperText}</p>
      ) : null}

      {message ? <p style={{ color: "#b8ffb8", margin: 0 }}>{message}</p> : null}
      {error ? <p style={{ color: "#ffb3b3", margin: 0 }}>{error}</p> : null}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="submit" disabled={isSaving}>
          {isSaving ? "Opslaan..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
import { useState } from "react";
import type {
  ProviderSecretFieldInput,
  ProviderSecretFieldStatus,
  ProviderConfigStatus,
  ProviderSecretsInput,
} from "../../types/providerConfig";
import "./ProviderSecretsPanel.css";

type ProviderSecretsPanelProps = {
  configStatus: ProviderConfigStatus;
  apiBaseUrl: string;
  onRefreshStatus: () => Promise<void>;
  onSaveSecrets: (nextSecrets: ProviderSecretsInput) => Promise<void>;
};

type FixedProviderId = "jellyfin" | "spotify" | "weather";

type FixedProviderFieldMeta = {
  title: string;
  placeholder: string;
  inputType?: "text" | "password";
  helperText?: string;
};

type EditorState =
  | {
      mode: "fixed-add";
      provider: FixedProviderId;
      fieldKey: string;
      label: string;
      value: string;
    }
  | {
      mode: "fixed-edit";
      provider: FixedProviderId;
      fieldKey: string;
      label: string;
      value: string;
    }
  | {
      mode: "calendar-add";
      label: string;
      value: string;
    }
  | {
      mode: "calendar-edit";
      entryId: string;
      label: string;
      value: string;
    };

const FIXED_PROVIDER_DEFINITIONS: Record<
  FixedProviderId,
  {
    title: string;
    fields: Record<string, FixedProviderFieldMeta>;
  }
> = {
  jellyfin: {
    title: "Jellyfin",
    fields: {
      baseUrl: {
        title: "Base URL",
        placeholder: "http://192.168.x.x:8096/",
      },
      apiKey: {
        title: "API key",
        placeholder: "Laat leeg om huidige waarde te behouden",
        inputType: "password",
      },
      userName: {
        title: "User filter",
        placeholder: "Exacte Jellyfin username, bijvoorbeeld admin",
        helperText:
          "Privacyfilter voor gedeelde servers. Alleen activiteit van deze exacte Jellyfin user verschijnt dan op de mirror.",
      },
      deviceName: {
        title: "Device filter",
        placeholder: "Exacte Jellyfin device name, bijvoorbeeld LG_C9_Quincy",
        helperText:
          "Optioneel extra filter bovenop de user filter. Alleen sessies van dit exacte device worden dan meegenomen.",
      },
    },
  },
  spotify: {
    title: "Spotify",
    fields: {
      clientId: {
        title: "Client ID",
        placeholder: "Spotify app client ID",
      },
      clientSecret: {
        title: "Client secret",
        placeholder: "Laat leeg om huidige waarde te behouden",
        inputType: "password",
      },
      refreshToken: {
        title: "Refresh token",
        placeholder: "Normaal via Koppel Spotify, handmatig alleen indien nodig",
        inputType: "password",
        helperText:
          "De refresh token wordt normaal automatisch gezet via Koppel Spotify.",
      },
      redirectUri: {
        title: "Redirect URI",
        placeholder: "http://127.0.0.1:8787/auth/spotify/callback",
        helperText:
          "Gebruik lokaal meestal http://127.0.0.1:8787/auth/spotify/callback.",
      },
    },
  },
  weather: {
    title: "Weather",
    fields: {
      apiKey: {
        title: "WeatherAPI key",
        placeholder: "Plak je WeatherAPI key",
        inputType: "password",
        helperText:
          "We gebruiken WeatherAPI voor nauwkeurige voorspellingen en provider-icons.",
      },
      locationQuery: {
        title: "Location query",
        placeholder: "Bijvoorbeeld Den Haag",
      },
      countryCode: {
        title: "Country code",
        placeholder: "Bijvoorbeeld NL",
      },
    },
  },
};

function requestCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocatie wordt niet ondersteund door deze browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000,
    });
  });
}

type ReverseLocationResult = {
  displayName: string;
  countryCode?: string;
};

async function reverseGeocodePosition(
  latitude: number,
  longitude: number,
): Promise<ReverseLocationResult> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("zoom", "10");
  url.searchParams.set("accept-language", "nl");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return { displayName: "Huidige locatie" };
  }

  const payload: unknown = await response.json();

  if (!payload || typeof payload !== "object") {
    return { displayName: "Huidige locatie" };
  }

  const candidate = payload as {
    address?: {
      city?: string;
      town?: string;
      village?: string;
      municipality?: string;
      state?: string;
      country_code?: string;
    };
    display_name?: string;
  };

  const locality =
    candidate.address?.city ||
    candidate.address?.town ||
    candidate.address?.village ||
    candidate.address?.municipality ||
    candidate.address?.state ||
    (typeof candidate.display_name === "string"
      ? candidate.display_name.split(",")[0]?.trim()
      : "");

  return {
    displayName: locality && locality.length > 0 ? locality : "Huidige locatie",
    countryCode:
      typeof candidate.address?.country_code === "string"
        ? candidate.address.country_code.toUpperCase()
        : undefined,
  };
}

function formatUpdatedAt(updatedAt: number | null) {
  if (updatedAt === null) {
    return "nog niet opgeslagen";
  }

  return new Date(updatedAt).toLocaleString("nl-NL");
}

function getFixedProviderStatusMap(configStatus: ProviderConfigStatus) {
  return {
    jellyfin: configStatus.jellyfin,
    spotify: configStatus.spotify,
    weather: configStatus.weather,
  } as const;
}

function getFixedFieldSummary(
  configStatus: ProviderConfigStatus,
  provider: FixedProviderId,
  fieldKey: string,
) {
  const providerMap = getFixedProviderStatusMap(configStatus)[provider] as Record<
    string,
    ProviderSecretFieldStatus
  >;

  return providerMap[fieldKey] ?? null;
}

function buildFixedPayload(
  provider: FixedProviderId,
  fieldKey: string,
  input: ProviderSecretFieldInput,
): ProviderSecretsInput {
  if (provider === "jellyfin") {
    return { jellyfin: { [fieldKey]: input } };
  }

  if (provider === "spotify") {
    return { spotify: { [fieldKey]: input } };
  }

  return { weather: { [fieldKey]: input } };
}

function isClearableFixedField(provider: FixedProviderId, fieldKey: string) {
  return (
    provider === "jellyfin" &&
    (fieldKey === "userName" || fieldKey === "deviceName")
  );
}

export function ProviderSecretsPanel({
  configStatus,
  apiBaseUrl,
  onRefreshStatus,
  onSaveSecrets,
}: ProviderSecretsPanelProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingCalendarId, setDeletingCalendarId] = useState<string | null>(
    null,
  );
  const [panelMessage, setPanelMessage] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<EditorState | null>(null);

  const canStartSpotifyLink =
    configStatus.spotify.clientId.hasValue &&
    configStatus.spotify.clientSecret.hasValue;

  async function handleRefresh() {
    setIsRefreshing(true);

    try {
      await onRefreshStatus();
    } finally {
      setIsRefreshing(false);
    }
  }

  function openFixedAdd(provider: FixedProviderId) {
    const providerStatusMap = getFixedProviderStatusMap(configStatus)[provider] as Record<
      string,
      ProviderSecretFieldStatus
    >;

    const missingKeys = Object.entries(providerStatusMap)
      .filter(([, summary]) => !summary.hasValue)
      .map(([fieldKey]) => fieldKey);

    if (missingKeys.length === 0) {
      return;
    }

    const firstKey = missingKeys[0];
    const fieldSummary = providerStatusMap[firstKey];

    setPanelError(null);
    setPanelMessage(null);
    setEditorState({
      mode: "fixed-add",
      provider,
      fieldKey: firstKey,
      label: fieldSummary.label,
      value: "",
    });
  }

  function openFixedEdit(provider: FixedProviderId, fieldKey: string) {
    const summary = getFixedFieldSummary(configStatus, provider, fieldKey);

    if (!summary) {
      return;
    }

    setPanelError(null);
    setPanelMessage(null);
    setEditorState({
      mode: "fixed-edit",
      provider,
      fieldKey,
      label: summary.label,
      value: "",
    });
  }

  function openCalendarAdd() {
    setPanelError(null);
    setPanelMessage(null);
    setEditorState({
      mode: "calendar-add",
      label: "",
      value: "",
    });
  }

  function openCalendarEdit(entryId: string, label: string) {
    setPanelError(null);
    setPanelMessage(null);
    setEditorState({
      mode: "calendar-edit",
      entryId,
      label,
      value: "",
    });
  }

  async function handleCalendarDelete(entryId: string) {
    setDeletingCalendarId(entryId);
    setPanelError(null);
    setPanelMessage(null);

    try {
      await onSaveSecrets({
        calendar: {
          removeEntryId: entryId,
        },
      });

      setPanelMessage("Calendar entry verwijderd.");
    } catch (saveError) {
      setPanelError(
        saveError instanceof Error ? saveError.message : "Verwijderen mislukt.",
      );
    } finally {
      setDeletingCalendarId(null);
    }
  }

  async function handleFixedFieldClear(
    provider: FixedProviderId,
    fieldKey: string,
  ) {
    const summary = getFixedFieldSummary(configStatus, provider, fieldKey);

    if (!summary || !isClearableFixedField(provider, fieldKey)) {
      return;
    }

    setIsSaving(true);
    setPanelError(null);
    setPanelMessage(null);

    try {
      await onSaveSecrets(
        buildFixedPayload(provider, fieldKey, {
          clear: true,
        }),
      );

      const fieldTitle =
        FIXED_PROVIDER_DEFINITIONS[provider].fields[fieldKey]?.title ?? fieldKey;
      setPanelMessage(`${fieldTitle} verwijderd.`);
    } catch (saveError) {
      setPanelError(
        saveError instanceof Error ? saveError.message : "Verwijderen mislukt.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleEditorSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editorState) {
      return;
    }

    setIsSaving(true);
    setPanelError(null);
    setPanelMessage(null);

    try {
      if (editorState.mode === "fixed-add") {
        const selectedSummary = getFixedFieldSummary(
          configStatus,
          editorState.provider,
          editorState.fieldKey,
        );

        if (!selectedSummary) {
          throw new Error("Geselecteerd field bestaat niet meer.");
        }

        const nextValue = editorState.value.trim();

        if (nextValue.length === 0) {
          throw new Error("Secret waarde is verplicht bij toevoegen.");
        }

        const nextLabel =
          editorState.label.trim().length > 0
            ? editorState.label.trim()
            : selectedSummary.label;

        await onSaveSecrets(
          buildFixedPayload(editorState.provider, editorState.fieldKey, {
            label: nextLabel,
            value: nextValue,
          }),
        );

        setPanelMessage("Provider secret toegevoegd.");
        setEditorState(null);
      }

      if (editorState.mode === "fixed-edit") {
        const selectedSummary = getFixedFieldSummary(
          configStatus,
          editorState.provider,
          editorState.fieldKey,
        );

        if (!selectedSummary) {
          throw new Error("Geselecteerd field bestaat niet meer.");
        }

        const nextLabel =
          editorState.label.trim().length > 0
            ? editorState.label.trim()
            : selectedSummary.label;

        const nextValue = editorState.value.trim();

        await onSaveSecrets(
          buildFixedPayload(editorState.provider, editorState.fieldKey, {
            label: nextLabel,
            value: nextValue.length > 0 ? nextValue : undefined,
          }),
        );

        setPanelMessage("Provider secret bijgewerkt.");
        setEditorState(null);
      }

      if (editorState.mode === "calendar-add") {
        const nextValue = editorState.value.trim();

        if (nextValue.length === 0) {
          throw new Error("ICS URL is verplicht bij toevoegen.");
        }

        await onSaveSecrets({
          calendar: {
            addEntry: {
              label:
                editorState.label.trim().length > 0
                  ? editorState.label.trim()
                  : undefined,
              value: nextValue,
            },
          },
        });

        setPanelMessage("Calendar entry toegevoegd.");
        setEditorState(null);
      }

      if (editorState.mode === "calendar-edit") {
        const nextValue = editorState.value.trim();

        await onSaveSecrets({
          calendar: {
            updateEntry: {
              id: editorState.entryId,
              label:
                editorState.label.trim().length > 0
                  ? editorState.label.trim()
                  : undefined,
              value: nextValue.length > 0 ? nextValue : undefined,
            },
          },
        });

        setPanelMessage("Calendar entry bijgewerkt.");
        setEditorState(null);
      }
    } catch (saveError) {
      setPanelError(
        saveError instanceof Error ? saveError.message : "Opslaan mislukt.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUseCurrentWeatherLocation() {
    setIsSaving(true);
    setPanelError(null);
    setPanelMessage(null);

    try {
      const position = await requestCurrentPosition();
      const latitude = position.coords.latitude.toFixed(5);
      const longitude = position.coords.longitude.toFixed(5);
      const reverseLocation = await reverseGeocodePosition(
        position.coords.latitude,
        position.coords.longitude,
      );

      await onSaveSecrets({
        weather: {
          locationQuery: {
            label: "Weather Location Query",
            value: reverseLocation.displayName,
          },
          countryCode: {
            label: "Weather Country Code",
            value: reverseLocation.countryCode,
          },
          latitude: {
            label: "Weather Latitude",
            value: latitude,
          },
          longitude: {
            label: "Weather Longitude",
            value: longitude,
          },
        },
      });

      setPanelMessage(
        `Huidige locatie opgeslagen voor Weather (${reverseLocation.displayName}).`,
      );
    } catch (locationError) {
      setPanelError(
        locationError instanceof Error
          ? locationError.message
          : "Huidige locatie ophalen mislukt.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="provider-secrets">
      <div className="provider-secrets__header">
        <h2 className="provider-secrets__header-title">Provider secrets</h2>

        <button type="button" onClick={handleRefresh} disabled={isRefreshing}>
          {isRefreshing ? "Verversen..." : "Ververs status"}
        </button>
      </div>

      <p className="provider-secrets__description">
        Alle provider values zijn redacted. Je kunt labels wel terugzien, maar
        de echte values nooit.
      </p>

      {panelMessage ? (
        <p className="provider-secrets__message">{panelMessage}</p>
      ) : null}
      {panelError ? (
        <p className="provider-secrets__message provider-secrets__message--error">
          {panelError}
        </p>
      ) : null}

      <div className="provider-secrets__groups">
        {(Object.entries(FIXED_PROVIDER_DEFINITIONS) as Array<
          [FixedProviderId, (typeof FIXED_PROVIDER_DEFINITIONS)[FixedProviderId]]
        >).map(([providerId, providerDefinition]) => {
          const providerStatus = getFixedProviderStatusMap(configStatus)[
            providerId
          ] as Record<string, ProviderSecretFieldStatus>;

          const fields = Object.entries(providerDefinition.fields)
            .map(([fieldKey, fieldMeta]) => ({
              fieldKey,
              fieldMeta,
              summary: providerStatus[fieldKey],
            }))
            .filter((item) => Boolean(item.summary));

          const missingFields = fields.filter((item) => !item.summary.hasValue);

          return (
            <details key={providerId} open className="provider-secrets__group">
              <summary className="provider-secrets__summary">
                {providerDefinition.title}
              </summary>

              <div className="provider-secrets__group-header">
                <h3 className="provider-secrets__group-title">
                  {providerDefinition.title}
                </h3>

                <div className="provider-secrets__group-actions">
                  {providerId === "spotify" ? (
                    <a
                      href={
                        canStartSpotifyLink
                          ? `${apiBaseUrl}/auth/spotify/login`
                          : "#"
                      }
                      target={canStartSpotifyLink ? "_blank" : undefined}
                      rel={canStartSpotifyLink ? "noreferrer" : undefined}
                      className={`provider-secrets__link ${
                        canStartSpotifyLink
                          ? ""
                          : "provider-secrets__link--disabled"
                      }`.trim()}
                      aria-disabled={!canStartSpotifyLink}
                    >
                      Koppel Spotify
                    </a>
                  ) : null}

                  {providerId === "weather" ? (
                    <button
                      type="button"
                      onClick={handleUseCurrentWeatherLocation}
                      disabled={isSaving}
                    >
                      Gebruik huidige locatie
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => openFixedAdd(providerId)}
                    disabled={missingFields.length === 0 || isSaving}
                  >
                    + Secret
                  </button>
                </div>
              </div>

              {missingFields.length === 0 ? (
                <p className="provider-secrets__empty">
                  Alle beschikbare fields voor {providerDefinition.title} hebben
                  al een waarde.
                </p>
              ) : null}

              {providerId === "weather" ? (
                <p className="provider-secrets__muted">
                  Weather gebruikt WeatherAPI met provider-icons en uitgebreide
                  condities voor nauwkeurige weergave over de dag.
                </p>
              ) : null}

              {providerId === "jellyfin" ? (
                <p className="provider-secrets__muted">
                  Gebruik vooral de user filter als privacy-instelling op een
                  gedeelde Jellyfin server. Alleen activiteit van die exacte
                  username komt dan op de mirror terecht.
                </p>
              ) : null}

              {fields.map(({ fieldKey, fieldMeta, summary }) => (
                <div key={`${providerId}-${fieldKey}`} className="provider-secrets__card">
                  <div className="provider-secrets__card-header">
                    <strong>{fieldMeta.title}</strong>
                    <span className="provider-secrets__inline-status">
                      {summary.hasValue ? "waarde ingesteld" : "nog geen waarde"}
                    </span>
                  </div>

                  <div className="provider-secrets__status">
                    Label: {summary.label}
                  </div>
                  <div className="provider-secrets__meta">
                    Laatst bijgewerkt: {formatUpdatedAt(summary.updatedAt)}
                  </div>

                  <div className="provider-secrets__actions">
                    <button
                      type="button"
                      onClick={() => openFixedEdit(providerId, fieldKey)}
                      disabled={isSaving}
                    >
                      Edit
                    </button>
                    {isClearableFixedField(providerId, fieldKey) ? (
                      <button
                        type="button"
                        onClick={() => handleFixedFieldClear(providerId, fieldKey)}
                        disabled={isSaving || !summary.hasValue}
                      >
                        Verwijder filter
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </details>
          );
        })}

        <details open className="provider-secrets__group">
          <summary className="provider-secrets__summary">
            Calendar
          </summary>

          <div className="provider-secrets__group-header">
            <h3 className="provider-secrets__group-title">Calendar</h3>

            <button type="button" onClick={openCalendarAdd} disabled={isSaving}>
              + ICS feed
            </button>
          </div>

          <p className="provider-secrets__muted">
            Voeg onbeperkt feeds toe. Elke feed krijgt een eigen label voor jouw
            overzicht. Waarden blijven altijd verborgen.
          </p>

          {configStatus.calendar.entries.length === 0 ? (
            <p className="provider-secrets__empty">
              Nog geen calendar feeds toegevoegd.
            </p>
          ) : null}

          {configStatus.calendar.entries.map((entry) => (
            <div key={entry.id} className="provider-secrets__card">
              <div className="provider-secrets__card-header">
                <strong>{entry.label}</strong>
                <span className="provider-secrets__inline-status">
                  {entry.hasValue ? "waarde ingesteld" : "nog geen waarde"}
                </span>
              </div>

              <div className="provider-secrets__meta">
                Laatst bijgewerkt: {formatUpdatedAt(entry.updatedAt)}
              </div>

              <div className="provider-secrets__actions provider-secrets__actions--split">
                <button
                  type="button"
                  onClick={() => openCalendarEdit(entry.id, entry.label)}
                  disabled={isSaving || deletingCalendarId === entry.id}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleCalendarDelete(entry.id)}
                  disabled={isSaving || deletingCalendarId === entry.id}
                >
                  {deletingCalendarId === entry.id ? "Verwijderen..." : "Verwijder"}
                </button>
              </div>
            </div>
          ))}
        </details>

        {editorState ? (
          <section className="provider-secrets__editor">
            <h3 className="provider-secrets__editor-title">
              {editorState.mode === "fixed-add" && "Nieuw provider secret"}
              {editorState.mode === "fixed-edit" && "Bewerk provider secret"}
              {editorState.mode === "calendar-add" && "Nieuwe calendar feed"}
              {editorState.mode === "calendar-edit" && "Bewerk calendar feed"}
            </h3>

            <form onSubmit={handleEditorSubmit} className="provider-secrets__form">
              {editorState.mode === "fixed-add" ? (
                <label>
                  Secret veld
                  <select
                    className="provider-secrets__field-control"
                    value={editorState.fieldKey}
                    onChange={(event) => {
                      const nextFieldKey = event.target.value;
                      const nextSummary = getFixedFieldSummary(
                        configStatus,
                        editorState.provider,
                        nextFieldKey,
                      );

                      setEditorState(
                        nextSummary
                          ? {
                              ...editorState,
                              fieldKey: nextFieldKey,
                              label: nextSummary.label,
                            }
                          : editorState,
                      );
                    }}
                  >
                    {Object.entries(
                      FIXED_PROVIDER_DEFINITIONS[editorState.provider].fields,
                    )
                      .filter(([fieldKey]) => {
                        const summary = getFixedFieldSummary(
                          configStatus,
                          editorState.provider,
                          fieldKey,
                        );
                        return summary ? !summary.hasValue : false;
                      })
                      .map(([fieldKey, fieldMeta]) => (
                        <option key={fieldKey} value={fieldKey}>
                          {fieldMeta.title}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}

              {editorState.mode === "fixed-edit" ? (
                <p className="provider-secrets__status">
                  Veld: {FIXED_PROVIDER_DEFINITIONS[editorState.provider].fields[editorState.fieldKey]?.title ?? editorState.fieldKey}
                </p>
              ) : null}

              <label>
                Label
                <input
                  className="provider-secrets__field-control"
                  type="text"
                  value={editorState.label}
                  onChange={(event) =>
                    setEditorState({ ...editorState, label: event.target.value })
                  }
                  placeholder="Alleen voor jezelf"
                />
              </label>

              {(editorState.mode === "fixed-add" ||
                editorState.mode === "fixed-edit") &&
              FIXED_PROVIDER_DEFINITIONS[editorState.provider].fields[
                editorState.fieldKey
              ]?.helperText ? (
                <p className="provider-secrets__field-note">
                  {
                    FIXED_PROVIDER_DEFINITIONS[editorState.provider].fields[
                      editorState.fieldKey
                    ]?.helperText
                  }
                </p>
              ) : null}

              <label>
                {editorState.mode === "calendar-add" ||
                editorState.mode === "calendar-edit"
                  ? "ICS URL"
                  : "Secret value"}
                <input
                  className="provider-secrets__field-control"
                  type={
                    editorState.mode === "fixed-add" ||
                    editorState.mode === "fixed-edit"
                      ? FIXED_PROVIDER_DEFINITIONS[editorState.provider].fields[
                          editorState.fieldKey
                        ]?.inputType ?? "text"
                      : "text"
                  }
                  value={editorState.value}
                  onChange={(event) =>
                    setEditorState({ ...editorState, value: event.target.value })
                  }
                  placeholder={
                    editorState.mode === "fixed-add" ||
                    editorState.mode === "fixed-edit"
                      ? FIXED_PROVIDER_DEFINITIONS[editorState.provider].fields[
                          editorState.fieldKey
                        ]?.placeholder ?? ""
                      : "https://example.com/calendar.ics"
                  }
                />
              </label>

              <p className="provider-secrets__field-note">
                Value wordt nooit teruggestuurd naar de browser. Laat de value
                leeg bij edit als je alleen het label wilt aanpassen.
              </p>

              {editorState.mode === "fixed-edit" &&
              isClearableFixedField(
                editorState.provider,
                editorState.fieldKey,
              ) ? (
                <p className="provider-secrets__field-note">
                  Gebruik "Verwijder filter" op de kaart om deze Jellyfin
                  filter echt leeg te maken.
                </p>
              ) : null}

              <div className="provider-secrets__actions provider-secrets__actions--split">
                <button
                  type="button"
                  onClick={() => setEditorState(null)}
                  disabled={isSaving}
                >
                  Annuleer
                </button>
                <button type="submit" disabled={isSaving}>
                  {isSaving ? "Opslaan..." : "Opslaan"}
                </button>
              </div>
            </form>
          </section>
        ) : null}
      </div>
    </div>
  );
}

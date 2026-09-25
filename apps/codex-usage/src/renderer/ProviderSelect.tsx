import { USAGE_PROVIDERS, type UsageProvider } from "../shared/types.ts";
import { PROVIDER_LABELS } from "../shared/providers.ts";

export function ProviderSelect({
  value,
  onChange,
}: {
  readonly value: UsageProvider;
  readonly onChange: (provider: UsageProvider) => void;
}) {
  return (
    <select
      className="provider-select"
      aria-label="Usage provider"
      value={value}
      onChange={(event) => onChange(event.target.value as UsageProvider)}
    >
      {USAGE_PROVIDERS.map((provider) => (
        <option key={provider} value={provider}>
          {PROVIDER_LABELS[provider]}
        </option>
      ))}
    </select>
  );
}

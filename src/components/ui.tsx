import { useEffect, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Checkbox, Switch, ToggleGroup, Tooltip } from "radix-ui";
import type { AppearancePreference } from "../types";

type SwitchControlProps = {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

export function SwitchControl({ checked, label, onCheckedChange }: SwitchControlProps) {
  return (
    <div className="switch-row">
      <span>{label}</span>
      <Switch.Root
        aria-label={label}
        checked={checked}
        className="ui-switch"
        onCheckedChange={onCheckedChange}
      >
        <Switch.Thumb className="ui-switch-thumb" />
      </Switch.Root>
    </div>
  );
}

type NumberPreset = {
  label: string;
  value: number;
};

type SegmentedNumberControlProps = {
  label: string;
  max: number;
  min: number;
  onValueChange: (value: number) => void;
  presets: NumberPreset[];
  step: number;
  suffix: string;
  value: number;
};

export function SegmentedNumberControl({
  label,
  max,
  min,
  onValueChange,
  presets,
  step,
  suffix,
  value,
}: SegmentedNumberControlProps) {
  const [customValue, setCustomValue] = useState(String(value));
  const selectedPreset = presets.find((preset) => preset.value === value)?.value.toString() ?? "";

  useEffect(() => {
    setCustomValue(String(value));
  }, [value]);

  function commitCustomValue() {
    const parsed = Number(customValue);
    if (!Number.isFinite(parsed)) {
      setCustomValue(String(value));
      return;
    }

    const nextValue = Math.round(Math.min(Math.max(parsed, min), max));
    setCustomValue(String(nextValue));
    if (nextValue !== value) {
      onValueChange(nextValue);
    }
  }

  return (
    <div className="segmented-number-control">
      <span>{label}</span>
      <strong>
        {value} {suffix}
      </strong>
      <ToggleGroup.Root
        aria-label={label}
        className="number-preset-toggle"
        type="single"
        value={selectedPreset}
        onValueChange={(nextValue) => {
          const parsed = Number(nextValue);
          if (Number.isFinite(parsed)) {
            onValueChange(parsed);
          }
        }}
      >
        {presets.map((preset) => (
          <ToggleGroup.Item
            className="number-preset-item"
            key={preset.value}
            value={preset.value.toString()}
          >
            {preset.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
      <label className="custom-number-control">
        <span>Custom</span>
        <input
          aria-label={`${label} custom value`}
          inputMode="numeric"
          max={max}
          min={min}
          step={step}
          type="number"
          value={customValue}
          onBlur={commitCustomValue}
          onChange={(event) => setCustomValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setCustomValue(String(value));
              event.currentTarget.blur();
            }
          }}
        />
        <em>{suffix}</em>
      </label>
    </div>
  );
}

type AppearanceToggleProps = {
  onValueChange: (value: AppearancePreference) => void;
  value: AppearancePreference;
};

const APPEARANCE_OPTIONS: { label: string; value: AppearancePreference }[] = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "Auto", value: "system" },
];

export function AppearanceToggle({ onValueChange, value }: AppearanceToggleProps) {
  return (
    <div className="appearance-control">
      <span>Appearance</span>
      <ToggleGroup.Root
        aria-label="Appearance"
        className="appearance-toggle"
        type="single"
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue === "light" || nextValue === "dark" || nextValue === "system") {
            onValueChange(nextValue);
          }
        }}
      >
        {APPEARANCE_OPTIONS.map((option) => (
          <ToggleGroup.Item
            className="appearance-toggle-item"
            key={option.value}
            value={option.value}
          >
            {option.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
    </div>
  );
}

type MetricCheckboxProps = {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

export function MetricCheckbox({ checked, label, onCheckedChange }: MetricCheckboxProps) {
  return (
    <Checkbox.Root
      aria-label={label}
      checked={checked}
      className="metric-check"
      onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
    >
      <Checkbox.Indicator className="metric-check-indicator">
        <Check size={14} strokeWidth={2.4} />
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}

type TooltipButtonProps = {
  children: ReactNode;
  className: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  pressed?: boolean;
};

export function TooltipButton({
  children,
  className,
  disabled = false,
  label,
  onClick,
  pressed = false,
}: TooltipButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          aria-label={label}
          aria-pressed={pressed}
          className={className}
          disabled={disabled}
          title={label}
          type="button"
          onClick={onClick}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip-content" sideOffset={6}>
          {label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export const TooltipProvider = Tooltip.Provider;

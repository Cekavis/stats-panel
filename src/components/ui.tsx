import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Checkbox, Slider, Switch, ToggleGroup, Tooltip } from "radix-ui";
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

type RangeControlProps = {
  label: string;
  max: number;
  min: number;
  onValueChange: (value: number) => void;
  step: number;
  suffix: string;
  value: number;
};

export function RangeControl({
  label,
  max,
  min,
  onValueChange,
  step,
  suffix,
  value,
}: RangeControlProps) {
  return (
    <div className="range-control">
      <span>{label}</span>
      <strong>
        {value} {suffix}
      </strong>
      <Slider.Root
        aria-label={label}
        className="ui-slider"
        max={max}
        min={min}
        step={step}
        value={[value]}
        onValueChange={(nextValue) => {
          const [next] = nextValue;
          if (typeof next === "number") {
            onValueChange(next);
          }
        }}
      >
        <Slider.Track className="ui-slider-track">
          <Slider.Range className="ui-slider-range" />
        </Slider.Track>
        <Slider.Thumb className="ui-slider-thumb" />
      </Slider.Root>
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

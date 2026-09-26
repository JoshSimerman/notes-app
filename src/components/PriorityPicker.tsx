import { useState } from "react";
import type { Note } from "../../shared/notes";

const choices = [
  { value: "low", label: "Low", short: "Low" },
  { value: "medium", label: "Medium", short: "Med" },
  { value: "high", label: "High", short: "High" },
  { value: "critical", label: "Critical", short: "Crit" },
] as const;

export function PriorityPicker({
  value = "medium",
  onChange,
  compact = false,
}: {
  value?: Note["priority"];
  onChange: (value: Note["priority"]) => void;
  compact?: boolean;
}) {
  // Compact pickers draw a signal meter: bars up to the level are filled in
  // that level's color, and hovering a bar previews its level.
  const [preview, setPreview] = useState<number | null>(null);
  const selected = choices.findIndex((c) => c.value === value);
  const shown = preview ?? selected;
  return (
    <div
      className={`priority-picker ${compact ? "signal" : ""}`}
      data-level={choices[shown]?.value}
      role="group"
      aria-label="Priority"
      onPointerLeave={() => setPreview(null)}
    >
      {choices.map(({ value: priority, label, short }, index) => (
        <button
          type="button"
          key={priority}
          className={`priority-choice ${priority} ${
            compact && index <= shown ? "filled" : ""
          }`}
          title={`${label} priority`}
          aria-label={`${label} priority`}
          aria-pressed={value === priority}
          onClick={() => onChange(priority)}
          onPointerEnter={
            compact
              ? (e) => e.pointerType === "mouse" && setPreview(index)
              : undefined
          }
        >
          {compact ? <span className="bar" aria-hidden="true" /> : short}
        </button>
      ))}
      {compact && (
        <span className="signal-label" aria-hidden="true">
          {choices[shown]?.label}
        </span>
      )}
    </div>
  );
}

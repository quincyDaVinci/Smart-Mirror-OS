import { useEffect, useRef } from "react";
import "./CommitRange.css";

type CommitRangeProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  disabled?: boolean;
  onCommit: (value: number) => void;
};

export function CommitRange({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  disabled = false,
  onCommit,
}: CommitRangeProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const labelValueRef = useRef<HTMLSpanElement | null>(null);
  const latestValueRef = useRef(value);

  useEffect(() => {
    latestValueRef.current = value;

    if (inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.value = String(value);
    }

    if (labelValueRef.current) {
      labelValueRef.current.textContent = `${value}${suffix}`;
    }
  }, [value, suffix]);

  function updateLabel(nextValue: number) {
    if (labelValueRef.current) {
      labelValueRef.current.textContent = `${nextValue}${suffix}`;
    }
  }

  function commitValue() {
    const nextValue = Number(inputRef.current?.value ?? value);

    updateLabel(nextValue);

    if (nextValue !== latestValueRef.current) {
      onCommit(nextValue);
    }
  }

  return (
    <label className="commit-range">
      {label} (<span ref={labelValueRef}>{value}{suffix}</span>)
      <input
        className="commit-range__input"
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        onInput={(event) => {
          updateLabel(Number(event.currentTarget.value));
        }}
        onPointerUp={commitValue}
        onTouchEnd={commitValue}
        onKeyUp={commitValue}
        onBlur={commitValue}
        disabled={disabled}
      />
    </label>
  );
}

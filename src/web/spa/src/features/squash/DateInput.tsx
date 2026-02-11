import React, { useRef } from "react";
import { CalendarDaysIcon } from "@heroicons/react/24/outline";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
  if (!YYYY_MM_DD.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

interface DateInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
  className?: string;
  inputClassName?: string;
}

const DateInput: React.FC<DateInputProps> = ({
  id,
  value,
  onChange,
  label,
  required,
  className = "",
  inputClassName = ""
}) => {
  const dateRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLInputElement>(null);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const filtered = raw.replace(/[^\d-]/g, "");
    onChange(filtered);
  };

  const handleTextBlur = () => {
    const v = value.trim();
    if (v && !isValidDate(v)) {
      onChange("");
    }
  };

  const handleDatePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v) onChange(v);
  };

  const openCalendar = () => {
    const dateEl = dateRef.current;
    if (dateEl) {
      dateEl.focus();
      if (typeof (dateEl as HTMLInputElement & { showPicker?: () => void }).showPicker === "function") {
        (dateEl as HTMLInputElement & { showPicker: () => void }).showPicker();
      }
    }
  };

  const baseInputClass =
    "rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-brand-orange focus:outline-none";
  const validValue = value && isValidDate(value);

  return (
    <div className={className}>
      <label htmlFor={`${id}-text`} className="block text-xs font-semibold text-slate-400 mb-1">
        {label}
        <span className="block font-normal text-slate-500 mt-0.5">yyyy-MM-DD or use calendar</span>
      </label>
      <div className="flex gap-1">
        <input
          ref={textRef}
          type="text"
          id={`${id}-text`}
          value={value}
          onChange={handleTextChange}
          onBlur={handleTextBlur}
          placeholder="yyyy-MM-DD"
          required={required}
          pattern={required ? "[0-9]{4}-[0-9]{2}-[0-9]{2}" : undefined}
          title={required ? "Enter date as yyyy-MM-DD" : undefined}
          className={`${baseInputClass} flex-1 min-w-0 ${inputClassName}`}
          inputMode="numeric"
          autoComplete="off"
        />
        <input
          ref={dateRef}
          type="date"
          id={id}
          value={validValue ? value : ""}
          onChange={handleDatePickerChange}
          required={required}
          className="sr-only"
          aria-hidden
        />
        <button
          type="button"
          onClick={openCalendar}
          title="Open calendar"
          aria-label="Open calendar"
          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 focus:border-brand-orange focus:outline-none shrink-0"
        >
          <CalendarDaysIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

export default DateInput;

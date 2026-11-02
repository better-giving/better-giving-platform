import type { GroupProps } from "./types";

export function FlatFilter<T>({ classes = "", ...props }: GroupProps<T>) {
  function toggle(value: T) {
    const selected = props.selectedValues.includes(value)
      ? props.selectedValues.filter((v) => v !== value)
      : [...props.selectedValues, value];
    props.onChange(selected);
  }

  return (
    <fieldset className={`grid px-2 py-4 ${classes}`}>
      <legend className="text-sm font-semibold text-gray-11">
        {props.label}
      </legend>
      <div className="flex flex-wrap gap-x-1 gap-y-2">
        {props.options.map((option) => {
          const selected = props.selectedValues.includes(option.value);
          return (
            <button
              type="button"
              aria-pressed={selected}
              key={option.key}
              onClick={() => toggle(option.value)}
              className={`${
                selected
                  ? "border-primary text-gray-12 bg-secondary-active"
                  : "border-gray-7 hover:border-gray-8 hover:bg-gray-4"
              } border select-none rounded-full capitalize text-xs pt-1 pb-1 px-4`}
            >
              {option.displayText}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

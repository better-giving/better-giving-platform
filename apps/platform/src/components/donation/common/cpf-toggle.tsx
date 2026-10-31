import { Switch } from "@ark-ui/react/switch";

interface Props {
  classes?: string;
  checked: boolean;
  checked_changed: (checked: boolean) => void;
}

export function CpfToggle({ classes = "", checked, checked_changed }: Props) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={(e) => checked_changed(e.checked)}
      className={`group ${classes} gap-x-1 flex items-center text-sm justify-self-start`}
    >
      <Switch.Control className="group relative text-xs flex items-center h-lh w-8 rounded-full bg-gray-3 inset-ring inset-ring-gray-9 p-1 transition-colors data-[state=checked]:bg-form-primary data-[state=checked]:inset-ring-form-primary data-focus-visible:outline-2 data-focus-visible:outline-ring data-focus-visible:outline-offset-2 data-disabled:opacity-50">
        <Switch.Thumb
          aria-hidden="true"
          className="pointer-events-none inline-block h-[0.8lh] aspect-square -translate-x-0.5 rounded-full bg-surface transition-transform group-data-[state=checked]:translate-x-3.5"
        />
      </Switch.Control>
      <Switch.Label className="whitespace-nowrap font-medium">
        Cover 3rd party processing fees
      </Switch.Label>
      <Switch.HiddenInput />
    </Switch.Root>
  );
}

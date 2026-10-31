import { RadioGroup } from "@ark-ui/react/radio-group";
import { Switch } from "@ark-ui/react/switch";
import { ExtLink } from "@better-giving/ui";
import { PencilIcon } from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { use_donation } from "../context";
import type { TTipFormat } from "../types";
import { ThumbWiggle } from "./thumb-wiggle";

// delay after the amount settles before the nudge fires, ms
const NUDGE_DELAY = 500;

interface Props {
  classes?: string;
  checked: boolean;
  checked_changed: (checked: boolean) => void;
  tip_format: TTipFormat;
  tip_format_changed: (format: TTipFormat) => void;
  custom_tip: ReactElement | undefined;
  // donor has settled the amount (+currency); arms the one-time thumb nudge
  nudge: boolean;
}

export function TipField({ classes = "", ...p }: Props) {
  // fire the nudge once per mount, on the first empty→settled transition while
  // the tip is still off; prefilled amounts (restored/config) don't trip it.
  // `play` drives both the thumb hop and the track tint, and is reset once the
  // hop ends so toggling off later never remounts ThumbWiggle and replays it;
  // `fired` guards against re-arming.
  const [play, set_play] = useState(false);
  const end_nudge = useCallback(() => set_play(false), []);
  const fired = useRef(false);
  const prev_nudge = useRef(p.nudge);
  useEffect(() => {
    if (!fired.current && p.nudge && !prev_nudge.current && !p.checked) {
      fired.current = true;
      // small beat after the amount settles so the nudge reads as a reaction
      const t = setTimeout(() => set_play(true), NUDGE_DELAY);
      return () => clearTimeout(t);
    }
    prev_nudge.current = p.nudge;
  }, [p.nudge, p.checked]);

  // turning the tip on cancels any pending/running hop (and marks it spent),
  // so a later off-toggle doesn't fire the nudge again
  useEffect(() => {
    if (p.checked) {
      fired.current = true;
      set_play(false);
    }
  }, [p.checked]);

  return (
    <div
      className={`${classes} flex has-[input:not([type=radio]):focus-within]:border-b-form-primary items-center py-1 border-y justify-between flex-wrap gap-x-3 gap-y-1`}
    >
      <Switch.Root
        checked={p.checked}
        onCheckedChange={(e) => p.checked_changed(e.checked)}
        className="group gap-x-1 flex items-center text-sm justify-self-start"
      >
        {/* affordance nudge — hops the thumb toward on and back once, tinting
            the track secondary while hopping, after the donor settles the amount */}
        <Switch.Control
          className={`group text-xs flex items-center h-lh w-8 rounded-full inset-ring inset-ring-gray-9 p-1 transition-colors data-[state=checked]:bg-form-primary data-[state=checked]:inset-ring-form-primary data-focus-visible:outline-2 data-focus-visible:outline-ring data-focus-visible:outline-offset-2 data-disabled:opacity-50 ${play && !p.checked ? "bg-form-secondary" : "bg-gray-3"}`}
        >
          <ThumbWiggle play={play && !p.checked} on_done={end_nudge}>
            <Switch.Thumb
              aria-hidden="true"
              className="pointer-events-none inline-block h-[0.8lh] aspect-square -translate-x-0.5 rounded-full bg-surface transition-transform group-data-[state=checked]:translate-x-3.5"
            />
          </ThumbWiggle>
        </Switch.Control>
        <Switch.Label
          className={`whitespace-nowrap font-medium ${p.checked ? "" : "text-gray-11"}`}
        >
          Support free fundraising tools
        </Switch.Label>
        <Switch.HiddenInput />
      </Switch.Root>
      <RadioGroup.Root
        className="flex gap-x-1"
        value={p.tip_format}
        onValueChange={(e) => p.tip_format_changed(e.value as TTipFormat)}
        aria-label="Contribution amount"
      >
        <RadioGroup.Item
          className="text-xs outline outline-form-secondary hover:not-data-[state=checked]:bg-form-secondary data-focus-visible:outline-2 data-focus-visible:outline-ring data-focus-visible:outline-offset-2 data-[state=checked]:bg-form-secondary data-[state=checked]:text-form-primary data-[state=checked]:pointer-events-none select-none px-2 py-1 rounded"
          value={"10" satisfies TTipFormat}
        >
          <RadioGroup.ItemText>10%</RadioGroup.ItemText>
          <RadioGroup.ItemHiddenInput />
        </RadioGroup.Item>
        <RadioGroup.Item
          className="text-xs outline outline-form-secondary hover:not-data-[state=checked]:bg-form-secondary data-focus-visible:outline-2 data-focus-visible:outline-ring data-focus-visible:outline-offset-2 data-[state=checked]:bg-form-secondary data-[state=checked]:text-form-primary data-[state=checked]:pointer-events-none select-none px-2 py-1 rounded"
          value={"15" satisfies TTipFormat}
        >
          <RadioGroup.ItemText>15%</RadioGroup.ItemText>
          <RadioGroup.ItemHiddenInput />
        </RadioGroup.Item>
        <RadioGroup.Item
          className="text-xs outline outline-form-secondary hover:not-data-[state=checked]:bg-form-secondary data-focus-visible:outline-2 data-focus-visible:outline-ring data-focus-visible:outline-offset-2 data-[state=checked]:bg-form-secondary data-[state=checked]:text-form-primary data-[state=checked]:pointer-events-none select-none px-2 py-1 rounded"
          value={"20" satisfies TTipFormat}
        >
          <RadioGroup.ItemText>20%</RadioGroup.ItemText>
          <RadioGroup.ItemHiddenInput />
        </RadioGroup.Item>
        <RadioGroup.Item
          className="text-xs outline outline-form-secondary hover:not-data-[state=checked]:bg-form-secondary data-focus-visible:outline-2 data-focus-visible:outline-ring data-focus-visible:outline-offset-2 data-[state=checked]:bg-form-secondary data-[state=checked]:text-form-primary data-[state=checked]:pointer-events-none select-none px-2 py-1 rounded flex-center"
          value={"custom" satisfies TTipFormat}
        >
          {/* the item renders a <label>; zag names the hidden radio from ItemText */}
          <RadioGroup.ItemText>
            <PencilIcon aria-hidden className="inline-block icon-xs " />
            <span className="sr-only">Custom amount</span>
          </RadioGroup.ItemText>
          <RadioGroup.ItemHiddenInput />
        </RadioGroup.Item>
      </RadioGroup.Root>
      {p.tip_format === "none" && (
        <p className="text-gray-11 text-sm w-full">
          <BgTxtLogoLink /> is a nonprofit and charges no platform fees. A small
          optional contribution, separate from any payment processing fee, helps
          keep this free for every nonprofit.
        </p>
      )}
      {p.tip_format !== "none" && (
        <p className="text-sm w-full">
          Your contribution to <BgTxtLogoLink /> is separate from payment
          processing fees and goes directly to keeping this platform free for
          nonprofits. Thank you.
        </p>
      )}
      {p.custom_tip}
    </div>
  );
}

function BgTxtLogoLink() {
  // the embed's own origin, carried as config — the form is served into a host
  // page and must not read the app's build-time env.
  const { don } = use_donation();
  return (
    <ExtLink href={don.base_url}>
      <span className="font-bold text-primary">Better.</span>
      <span className="font-bold text-primary">Giving</span>{" "}
      <span className="text-primary text-xs">501(c)(3)</span>
    </ExtLink>
  );
}

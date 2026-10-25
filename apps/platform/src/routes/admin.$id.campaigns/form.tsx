import { Field as BaseField } from "@ark-ui/react/field";
import {
  Combo,
  DateField,
  Form as F,
  Field,
  Increments,
  Modal,
  Select,
} from "@better-giving/ui";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { DollarSign } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type FieldPath,
  useController,
  useFieldArray,
  useForm,
} from "react-hook-form";
import { Link, useFetcher } from "react-router";
import { DonateFrequencies } from "#/components/donate-frequencies";
import { DonateMethods, fill } from "#/components/donate-methods";
import {
  GoalSelector,
  to_form_target,
  to_target,
} from "#/components/goal-selector";
import { ImgEditor } from "#/components/img-editor";
import { RichText, to_content } from "#/components/rich-text";
import { img_spec } from "#/pages/funds/common";
import { Videos } from "#/pages/funds/common/videos";
import { CAMPAIGN_TYPES } from "@/campaign";
import { to_freq_bools, to_freqs } from "@/helpers/donation";
import type { DonateMethodId, TFrequency } from "@/schemas";
import { increment_label_max_chars } from "@/schemas";
import { publish_lock_body } from "./copy";
import { type FV, form_schema } from "./form-schema";
import { link_from_name } from "./link";
import { LinkField } from "./link-field";

const TYPE_LABEL: Record<(typeof CAMPAIGN_TYPES)[number], string> = {
  year_end: "Year-end",
  emergency: "Emergency",
  building: "Building",
  event: "Event",
  tribute: "Tribute",
  monthly: "Monthly",
  program: "Program",
  other: "Other",
};

const TYPE_OPTIONS = ["", ...CAMPAIGN_TYPES] as const;
type TypeOpt = (typeof TYPE_OPTIONS)[number];

type Ask = "delete" | "end" | "publish" | null;

const ASK = {
  delete: {
    title: "Delete this campaign?",
    body: "The page and its links and QR code stop working.",
    confirm: "Delete",
  },
  end: {
    title: "End this campaign?",
    body: "Donations stop for good.",
    confirm: "End",
  },
  publish: {
    title: "Publish this campaign?",
    confirm: "Publish",
  },
} as const;

const SERVER_FIELD: Partial<Record<string, FieldPath<FV>>> = {
  name: "name",
  slug: "slug",
  description_pt: "description.value",
  campaign_type: "campaign_type",
  banner: "banner",
  logo: "logo",
  ends_at: "ends_at",
  program_id: "program_id",
  donate_methods: "donate_methods",
  donate_frequencies: "freqs",
  hide_bg_tip: "hide_bg_tip",
  videos: "videos",
  increments: "increments",
  target: "target",
};

function leaf(source: unknown, path: string): unknown {
  let cur = source;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function error_message(source: unknown, path: string): string | undefined {
  const node = leaf(source, path);
  if (!node || typeof node !== "object" || !("message" in node))
    return undefined;
  const message = (node as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}

export interface IProgramOpt {
  id: string;
  title: string;
}

export interface ICampaignFormInit {
  name: string;
  slug: string;
  campaign_type: string;
  description_pt: string;
  banner: string;
  logo: string;
  videos: string[];
  ends_at: string | null;
  target: string | undefined;
  increments: { label: string; value: string }[];
  donate_methods: DonateMethodId[] | null;
  donate_frequencies: TFrequency[] | null;
  hide_bg_tip: boolean;
  program_id: string | null;
}

interface Props {
  init: ICampaignFormInit;
  programs: IProgramOpt[];
  locked: boolean;
  status: "draft" | "live" | "ended" | null;
  gift_count: number;
  /** true when this campaign was folded from a legacy fund; it carries historic
   * legacy revenue and so cannot be deleted */
  folded?: boolean;
  fallback_methods: DonateMethodId[] | null | undefined;
  fallback_frequencies: TFrequency[] | null | undefined;
  settings_donation_to: string;
  /** `https://host/org/<org-slug>/`, or null while the org has no slug */
  link_base: string | null;
}

export function CampaignForm({
  init,
  programs,
  locked,
  status,
  gift_count,
  folded = false,
  fallback_methods,
  fallback_frequencies,
  settings_donation_to,
  link_base,
}: Props) {
  const fetcher = useFetcher<{ error?: string; field?: string }>();
  const op = useRef<"save" | "publish" | "end" | "delete">("save");
  const ended = status === "ended";
  const live = status === "live";
  const [ask, set_ask] = useState<Ask>(null);
  const cancel_ref = useRef<HTMLButtonElement>(null);
  const summary_ref = useRef<HTMLDivElement>(null);

  const {
    register,
    control,
    handleSubmit,
    watch,
    trigger,
    resetField,
    getValues,
    setError,
    clearErrors,
    setFocus,
    setValue,
    formState: { errors, isSubmitted },
  } = useForm<FV>({
    resolver: valibotResolver(form_schema),
    defaultValues: {
      name: init.name,
      slug: init.slug,
      campaign_type: (init.campaign_type || "") as FV["campaign_type"],
      description: to_content(init.description_pt),
      banner: init.banner,
      logo: init.logo,
      videos: init.videos.map((url) => ({ url })),
      ends_at: init.ends_at ? init.ends_at.slice(0, 10) : "",
      target: to_form_target(init.target),
      increments: init.increments,
      donate_methods: fill(
        init.donate_methods ?? fallback_methods ?? undefined
      ),
      freqs: to_freq_bools(
        init.donate_frequencies ?? fallback_frequencies ?? undefined
      ),
      hide_bg_tip: init.hide_bg_tip,
      program_id: init.program_id ?? "",
    },
  });

  // a new campaign's link follows its name until the link itself is typed in
  const link_typed = useRef(status !== null);
  const name_reg = register("name", {
    onChange: (e) => {
      if (link_typed.current) return;
      setValue("slug", link_from_name(e.target.value), {
        shouldValidate: isSubmitted,
      });
    },
  });
  const slug_reg = register("slug", {
    onChange: () => {
      link_typed.current = true;
    },
  });

  const submitted = useRef<Partial<Record<string, string>>>({});
  const values = watch();

  const remember = () => {
    const next: Partial<Record<string, string>> = {};
    for (const [field, path] of Object.entries(SERVER_FIELD)) {
      if (!path) continue;
      next[field] = JSON.stringify(getValues(path));
    }
    submitted.current = next;
  };

  const refusal_holds = (field: string) => {
    const path = SERVER_FIELD[field];
    if (!path) return false;
    const snap = submitted.current[field];
    if (snap === undefined) return true;
    return JSON.stringify(leaf(values, path)) === snap;
  };

  const server_error = (field: string) => {
    if (fetcher.state !== "idle") return undefined;
    if (fetcher.data?.field !== field || !fetcher.data.error) return undefined;
    return refusal_holds(field) ? fetcher.data.error : undefined;
  };

  let summary: string | undefined;
  if (fetcher.state === "idle" && fetcher.data?.error) {
    const field = fetcher.data.field;
    if (!field || !SERVER_FIELD[field] || refusal_holds(field)) {
      summary = fetcher.data.error;
    }
  }

  useEffect(() => {
    if (fetcher.state !== "idle") return;
    const message = fetcher.data?.error;
    if (!message) return;
    const field = fetcher.data?.field;
    const path = field ? SERVER_FIELD[field] : undefined;
    if (!field || !path) {
      summary_ref.current?.focus();
      return;
    }
    const snap = submitted.current[field];
    if (snap !== undefined && JSON.stringify(getValues(path)) !== snap) return;
    setError(path, { message });
    setFocus(path);
  }, [fetcher.state, fetcher.data, setError, setFocus, getValues]);

  useEffect(() => {
    if (fetcher.state !== "idle") return;
    const message = fetcher.data?.error;
    const field = fetcher.data?.field;
    const path = field ? SERVER_FIELD[field] : undefined;
    if (!field || !path || !message) return;
    const snap = submitted.current[field];
    if (snap === undefined || JSON.stringify(leaf(values, path)) === snap)
      return;
    if (error_message(errors, path) === message) clearErrors(path);
  }, [values, errors, fetcher.state, fetcher.data, clearErrors]);

  const { field: banner } = useController({ control, name: "banner" });
  const { field: logo } = useController({ control, name: "logo" });
  const { field: desc } = useController({ control, name: "description" });
  const { field: target_type } = useController({
    control,
    name: "target.type",
  });
  const { field: methods } = useController({ control, name: "donate_methods" });
  const { field: freqs } = useController({ control, name: "freqs" });
  const { field: ends } = useController({ control, name: "ends_at" });
  const { field: campaign_type } = useController({
    control,
    name: "campaign_type",
  });
  const { field: program } = useController({ control, name: "program_id" });
  const videos = useFieldArray({ control, name: "videos" });
  const increments = useFieldArray({ control, name: "increments" });
  const incs = values.increments;
  const uploading = banner.value === "loading" || logo.value === "loading";
  const busy = uploading || fetcher.state !== "idle";

  const submit = handleSubmit((fv) => {
    remember();
    const ends_at = fv.ends_at
      ? new Date(`${fv.ends_at}T23:59:59.999Z`).toISOString()
      : "";
    fetcher.submit(
      {
        name: fv.name,
        slug: fv.slug,
        ...(fv.campaign_type ? { campaign_type: fv.campaign_type } : {}),
        description_pt: fv.description.value,
        banner: fv.banner ?? "",
        logo: fv.logo ?? "",
        videos: fv.videos.map((v) => v.url),
        ends_at,
        target: to_target(fv.target),
        increments: fv.increments,
        donate_methods: fv.donate_methods.map((m) => m.id),
        donate_frequencies: to_freqs(fv.freqs),
        hide_bg_tip: init.hide_bg_tip,
        program_id: fv.program_id ?? "",
        op: op.current,
      },
      { method: "POST", encType: "application/json" }
    );
  });

  const block = (e: { preventDefault: () => void }) => {
    if (busy) e.preventDefault();
  };
  const confirm = (next: Exclude<Ask, null>) => {
    set_ask(null);
    if (next === "end" || next === "delete") {
      op.current = next;
      fetcher.submit(
        { op: next },
        { method: "POST", encType: "application/json" }
      );
      return;
    }
    op.current = "publish";
    void submit();
  };

  const tip_settings = (
    <Link to={settings_donation_to} className="link">
      Settings › Donation
    </Link>
  );
  const program_options = ["", ...programs.map((p) => p.id)];
  const type_value = (campaign_type.value || "") as TypeOpt;

  return (
    <F
      onSubmit={submit}
      className="card grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
    >
      <div ref={summary_ref} role="alert" tabIndex={-1}>
        {summary ? (
          <p className="text-sm text-destructive-subtle-fg">{summary}</p>
        ) : null}
      </div>
      {ask && (
        <Modal
          open
          onClose={() => set_ask(null)}
          initialFocusEl={() => cancel_ref.current}
          classes="bg-panel"
        >
          <div className="p-6 grid gap-4">
            <h2 className="text-lg font-bold">{ASK[ask].title}</h2>
            <p>
              {ask === "publish"
                ? publish_lock_body(`${link_base ?? ""}${values.slug.trim()}`)
                : ASK[ask].body}
            </p>
            <div className="flex justify-end gap-3">
              <button
                ref={cancel_ref}
                type="button"
                className="btn btn-secondary"
                onClick={() => set_ask(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={
                  ask === "publish" ? "btn btn-primary" : "btn btn-destructive"
                }
                onClick={() => confirm(ask)}
              >
                {ASK[ask].confirm}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <Field
        {...name_reg}
        label="Name"
        required
        error={errors.name?.message || server_error("name")}
      />
      <LinkField
        reg={slug_reg}
        value={values.slug}
        base={link_base}
        locked={locked}
        error={errors.slug?.message || server_error("slug")}
      />
      <Select
        ref={campaign_type.ref}
        label="Type"
        value={type_value}
        onChange={(next) => campaign_type.onChange(next)}
        options={[...TYPE_OPTIONS]}
        option_disp={(opt) => (opt ? TYPE_LABEL[opt] : "No type")}
        error={errors.campaign_type?.message || server_error("campaign_type")}
      />
      <div>
        <p className="label mb-1" data-required>
          Story
        </p>
        <RichText
          ref={desc.ref}
          content={desc.value}
          onChange={desc.onChange}
          placeHolder="The story of this campaign"
          charLimit={8000}
          classes={{
            container: "min-w-0",
            field:
              "rich-text-toolbar border text-sm grid min-w-0 grid-rows-[auto_1fr] rounded bg-surface p-3 min-h-60",
            counter: "text-gray-11",
            error: "text-right",
          }}
          error={
            errors.description?.value?.message ||
            errors.description?.length?.message ||
            server_error("description_pt")
          }
        />
      </div>
      <Videos {...(videos as any)} />
      <div>
        <p className="label mb-2">Hero</p>
        <ImgEditor
          id="campaign-banner"
          ref={banner.ref}
          value={banner.value}
          spec={img_spec([4, 1])}
          on_change={(v) => {
            banner.onChange(v);
            trigger("banner");
          }}
          on_undo={(e) => {
            e.stopPropagation();
            resetField("banner");
          }}
          classes={{ container: "mb-2", dropzone: "aspect-4/1" }}
          error={errors.banner?.message}
        />
        <p className="text-sm text-gray-11">
          Leave this empty to use the nonprofit image.
        </p>
      </div>
      <div>
        <p className="label mb-2">Logo</p>
        <ImgEditor
          id="campaign-logo"
          ref={logo.ref}
          value={logo.value}
          spec={img_spec([1, 1])}
          on_change={(v) => {
            logo.onChange(v);
            trigger("logo");
          }}
          on_undo={(e) => {
            e.stopPropagation();
            resetField("logo");
          }}
          classes={{ container: "mb-2", dropzone: "aspect-square w-60" }}
          error={errors.logo?.message}
        />
        <p className="text-sm text-gray-11">
          Leave this empty to use the nonprofit logo.
        </p>
      </div>
      <div>
        <p className="label mb-2">Goal</p>
        <GoalSelector
          value={target_type.value}
          onChange={target_type.onChange}
        />
        {target_type.value === "fixed" && (
          <Field
            {...register("target.value", { shouldUnregister: true })}
            label="Amount to raise"
            classes="mt-2"
            placeholder="$"
            error={errors.target?.value?.message}
          />
        )}
      </div>
      <DateField
        value={ends.value ?? ""}
        onChange={ends.onChange}
        name="ends_at"
        label="End date"
        error={errors.ends_at?.message}
        minToday={status !== "ended"}
      />
      <DonateMethods
        values={methods.value}
        on_change={methods.onChange}
        error={errors.donate_methods?.message}
        ref={methods.ref}
      />
      <DonateFrequencies
        value={freqs.value}
        on_change={freqs.onChange}
        error={errors.freqs?.message}
        ref={freqs.ref}
      />
      <Increments
        fields={increments.fields}
        onAdd={(val) => {
          if (increments.fields.length >= 4) return;
          increments.append({ value: val, label: "" });
        }}
        onRemove={(idx) => increments.remove(idx)}
        countError={errors.increments?.root?.message}
        field={(idx) => (
          <>
            <BaseField.Root className="grid grid-rows-subgrid row-span-2">
              <div className="relative w-full">
                <DollarSign className="text-gray-11 absolute top-1/2 left-2 -translate-y-1/2 icon-md" />
                <input
                  type="number"
                  {...register(`increments.${idx}.value`)}
                  className="w-full h-full outline-ring rounded text-sm font-medium bg-surface pl-8 pr-4 py-3.5 border"
                />
              </div>
              <p className="mt-1 empty:hidden text-left text-xs text-destructive-subtle-fg">
                {errors.increments?.[idx]?.value?.message}
              </p>
            </BaseField.Root>
            <BaseField.Root className="grid grid-rows-subgrid row-span-2">
              <textarea
                {...register(`increments.${idx}.label`)}
                rows={2}
                className="w-full outline-ring rounded text-sm font-medium bg-surface px-4 py-3.5 border"
              />
              <p className="mt-1 text-left text-xs text-gray-11">
                {incs[idx]?.label.length ?? 0}/{increment_label_max_chars}
              </p>
            </BaseField.Root>
          </>
        )}
      />
      <div className="grid gap-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={init.hide_bg_tip}
            disabled
            aria-describedby="hide-bg-tip"
          />
          Hide the Better Giving tip
        </label>
        <p id="hide-bg-tip" className="text-xs text-gray-11">
          This follows the organization's payment settings in {tip_settings}.
        </p>
      </div>
      <Combo
        ref={program.ref}
        label="Program"
        value={program.value ?? ""}
        on_change={(next) => program.onChange(next ?? "")}
        options={program_options}
        item_text={(id) =>
          id ? (programs.find((p) => p.id === id)?.title ?? id) : "No program"
        }
        limit={program_options.length}
        error={errors.program_id?.message || server_error("program_id")}
      />
      <div className="flex flex-wrap gap-3 justify-end">
        {gift_count === 0 && !folded && status && (
          <button
            type="button"
            className="text-sm font-medium text-destructive-subtle-fg"
            aria-disabled={busy || undefined}
            onClick={(e) => {
              block(e);
              if (busy) return;
              set_ask("delete");
            }}
          >
            Delete
          </button>
        )}
        {live && (
          <button
            type="button"
            className="text-sm font-medium text-destructive-subtle-fg"
            aria-disabled={busy || undefined}
            onClick={(e) => {
              block(e);
              if (busy) return;
              set_ask("end");
            }}
          >
            End
          </button>
        )}
        {!ended && !live && (
          <button
            type="submit"
            className="btn btn-secondary"
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            onClick={(e) => {
              block(e);
              if (busy) return;
              op.current = "save";
            }}
          >
            Save
          </button>
        )}
        {!ended && !live && (
          <button
            type="button"
            className="btn btn-primary"
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            onClick={(e) => {
              block(e);
              if (busy) return;
              if (!getValues("slug").trim()) {
                void trigger("slug");
                setFocus("slug");
                return;
              }
              set_ask("publish");
            }}
          >
            Publish
          </button>
        )}
        {live && (
          <button
            type="submit"
            className="btn btn-primary"
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            onClick={(e) => {
              block(e);
              if (busy) return;
              op.current = "save";
            }}
          >
            Save changes
          </button>
        )}
      </div>
    </F>
  );
}

export const blank_init = (
  methods: DonateMethodId[] | null | undefined,
  frequencies: TFrequency[] | null | undefined,
  hide_bg_tip: boolean
): ICampaignFormInit => ({
  name: "",
  slug: "",
  campaign_type: "",
  description_pt: "",
  banner: "",
  logo: "",
  videos: [],
  ends_at: null,
  target: undefined,
  increments: [],
  donate_methods: methods ?? null,
  donate_frequencies: frequencies ?? null,
  hide_bg_tip,
  program_id: null,
});

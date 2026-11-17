import {
  FileDropzone,
  type FileOutput,
  Form,
  Label,
  Select,
  use_ask_prompt,
} from "@better-giving/ui";
import { fileOutput } from "@better-giving/ui/helpers";
import { ErrorMessage } from "@hookform/error-message";
import {
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Controller, get, useController, useForm } from "react-hook-form";
import { safeParse } from "valibot";
import { report_error } from "#/errors/report";
import { error_prompt } from "#/helpers/error-prompt";
import { upload_document } from "#/helpers/upload-file";
import type {
  CreateRecipientRequest,
  Group,
  V1RecipientAccount,
  ValidationContent,
} from "#/types/bank-details";
import { doc_href } from "@/docs";
import type { IFormButtons, OnSubmit } from "../types";
import { use_requirements } from "./use-requirements";

type Props = {
  fields: Group[];
  currency: string;
  amount: number;
  type: string;
  quoteId: string;
  disabled?: boolean;
  FormButtons: IFormButtons;
  onSubmit: OnSubmit;
  verified?: boolean;
};

interface FV extends Record<string, any> {
  bankStatement: FileOutput;
}

/**
 * one prompt slot: every raise replaces the one on screen rather than stacking
 * over it.
 */
const PROMPT_SLOT = "recipient-validation";

/** Wise's `example` is `""` on fields that have none */
const suggest = (example: string) =>
  example ? `invalid, e.g. ${example}` : undefined;

export function RecipientDetailsForm({
  fields,
  currency,
  type,
  quoteId,
  amount,
  disabled,
  onSubmit,
  FormButtons,
  verified,
}: Props) {
  const ask_prompt = use_ask_prompt();
  const {
    control,
    register,
    handleSubmit,
    getValues,
    setError,
    formState: { errors, isSubmitting },
    getFieldState,
  } = useForm<FV>({
    disabled,
    shouldUnregister: true,
    // rhf focuses while the fieldset is still disabled, then retries in a
    // timeout that lands after `Fieldset` has handed focus back to the button
    shouldFocusError: false,
  });

  const form = useRef<HTMLFormElement>(null);
  // a 422's messages that no rendered field can carry
  const [unplaced, set_unplaced] = useState<string[]>([]);
  const uid = useId();
  const input_id = (key: string) => `${uid}-${key}`;
  const err_id = (key: string) => `${input_id(key)}-err`;
  // only while `ErrorMessage` renders the element it names
  const described_by = (key: string) =>
    get(errors, key)?.message ? err_id(key) : undefined;

  const first_invalid = useRef<string | null>(null);
  // rhf's `setFocus` defers its `.focus()` to a timeout, which lands after
  // `Fieldset` has already handed focus back to the submit button
  function focus_now(path: string) {
    const f = get(control._fields, path)?._f;
    (f?.refs?.[0] ?? f?.ref)?.focus?.();
  }

  /** keys with a control on screen, top to bottom — a key rhf holds no field for renders none */
  function on_screen(): string[] {
    const keys = fields.map((f) => f.key);
    if (verified) keys.push("bankStatement");
    return keys.filter((k) => get(control._fields, k)?._f);
  }

  const { update_requirements } = use_requirements(
    !amount ? null : { amount, currency }
  );

  const { field: bankStatement } = useController({
    control,
    name: "bankStatement",
    rules: {
      validate(value?: string) {
        const val = safeParse(fileOutput({ required: true }), value);
        return verified ? (val.issues?.[0].message ?? true) : true;
      },
    },
  });

  async function refresh() {
    const { accountHolderName, bankStatement: _, ...details } = getValues();
    // the following is expected to throw for example when the country code
    // is not yet set (all initial values are empty strings); the error is
    // logged in the browser console, but we can ignore it.
    await update_requirements({
      quoteId,
      amount,
      currency,
      request: {
        accountHolderName,
        currency,
        ownedByCustomer: false,
        profile: "{{profileId}}",
        type,
        details,
      },
    });
  }

  const submit = handleSubmit(
    async (fv) => {
      try {
        const { accountHolderName, bankStatement, ...details } = fv;

        const payload: CreateRecipientRequest = {
          accountHolderName,
          currency,
          ownedByCustomer: false,
          profile: "{{profileId}}",
          type,
          details,
        };

        const res = await fetch("/api/wise/v1/accounts", {
          method: "POST",
          body: JSON.stringify(payload),
          headers: { "content-type": "application/json" },
        });

        if (res.ok) {
          const data: V1RecipientAccount = await res.json();
          return await onSubmit(data, bankStatement);
        }

        //error handling
        if (res.status !== 422) throw res;

        //only handle 422
        const content: ValidationContent = await res.json();

        //filter "NOT_VALID"
        const _errs = content.errors;
        // a refusal with nothing to show the user is ours to report
        if (!_errs?.length) throw new Error("wise 422 carried no errors");
        const validations = _errs.filter((err) => err.code === "NOT_VALID");
        const others = _errs.filter((err) => err.code !== "NOT_VALID");

        const rejected = new Map(validations.map((v) => [v.path, v.message]));
        const shown = on_screen().filter((k) => rejected.has(k));

        // an error set on a key with no field is never cleared by the next
        // submit's validation, so it would refuse every submit after it
        for (const k of shown) setError(k, { message: rejected.get(k) });
        const unrendered = [...rejected]
          .filter(([path]) => !shown.includes(path))
          .map(([, message]) => message);
        set_unplaced([
          ...new Set([...unrendered, ...others.map((e) => e.message)]),
        ]);

        // fieldset is still disabled here; focused once the submit settles
        first_invalid.current = shown[0] ?? null;
      } catch (err) {
        ask_prompt(error_prompt(err, { context: "validating" }), {
          key: PROMPT_SLOT,
        });
      }
    },
    (errs) => {
      first_invalid.current = on_screen().find((k) => get(errs, k)) ?? null;
    }
  );

  return (
    <Form
      ref={form}
      disabled={isSubmitting}
      onSubmit={(e) => {
        set_unplaced([]);
        return submit(e);
      }}
      className="grid gap-5"
    >
      <FocusFirstInvalid
        submitting={isSubmitting}
        path={first_invalid}
        form={form}
        focus={focus_now}
      />
      {fields.map((f) => {
        const labelRequired = f.required ? true : undefined;
        if (f.type === "select") {
          return (
            <div key={f.key}>
              <Controller
                control={control}
                defaultValue=""
                name={f.key}
                rules={{
                  required: f.required ? "required" : false,
                }}
                render={({ field: { name, value, onChange, ref } }) => (
                  <Select
                    label={f.name}
                    required={labelRequired}
                    error={get(errors, name)?.message}
                    onChange={(value) => {
                      onChange(value);
                      if (f.refreshRequirementsOnChange) refresh();
                    }}
                    options={f.valuesAllowed?.map((x) => x.key) ?? []}
                    option_disp={(v) =>
                      f.valuesAllowed?.find((x) => x.key === v)?.name
                    }
                    ref={ref}
                    value={value}
                    classes={{ options: "text-sm" }}
                  />
                )}
              />
            </div>
          );
        }

        if (f.type === "radio") {
          const label_id = `${input_id(f.key)}-label`;
          const invalid = !!getFieldState(f.key).error;
          return (
            <div
              key={f.key}
              role="radiogroup"
              aria-labelledby={label_id}
              aria-required={labelRequired}
              aria-invalid={invalid}
              className="grid gap-2"
            >
              <div className="flex gap-3 items-center">
                <Label id={label_id} required={labelRequired}>
                  {f.name}
                </Label>
                <ErrorMessage
                  errors={errors}
                  name={f.key}
                  as="p"
                  id={err_id(f.key)}
                  className="field-err empty:hidden"
                />
              </div>
              <div className="flex items-center gap-2">
                {f.valuesAllowed?.map((v) => (
                  <div
                    key={v.key}
                    className={`relative border ${
                      invalid ? "border-destructive" : ""
                    } rounded px-4 py-3.5 text-sm has-checked:border-primary has-disabled:bg-gray-3 w-32 focus-within:outline-2 focus-within:outline-ring`}
                  >
                    <input
                      className="appearance-none w-0 h-0"
                      id={`${input_id(f.key)}-${v.key}`}
                      // on each radio, not the group: focus lands on a radio,
                      // and screen readers don't reliably read a group's description then
                      aria-describedby={described_by(f.key)}
                      type="radio"
                      value={v.key}
                      {...register(f.key, {
                        required: f.required ? "required" : false,
                        onChange: f.refreshRequirementsOnChange
                          ? refresh
                          : undefined,
                      })}
                    />
                    <label
                      htmlFor={`${input_id(f.key)}-${v.key}`}
                      className="absolute inset-0 w-full grid place-items-center"
                    >
                      {v.name}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        if (f.type === "text") {
          return (
            <div key={f.key} className="">
              <Label
                required={labelRequired}
                htmlFor={input_id(f.key)}
                className="mb-2"
              >
                {f.name}
              </Label>
              <input
                id={input_id(f.key)}
                className="field-input"
                aria-invalid={!!getFieldState(f.key).error}
                aria-describedby={described_by(f.key)}
                aria-required={labelRequired}
                type="text"
                placeholder={f.example}
                {...register(f.key, {
                  required: f.required ? "required" : false,
                  maxLength: f.maxLength
                    ? {
                        value: f.maxLength,
                        message: `max ${f.maxLength} chars`,
                      }
                    : undefined,
                  minLength: f.minLength
                    ? {
                        value: f.minLength,
                        message: `min ${f.minLength} chars`,
                      }
                    : undefined,
                  pattern: f.validationRegexp
                    ? {
                        value: new RegExp(f.validationRegexp),
                        message: suggest(f.example) ?? "invalid format",
                      }
                    : undefined,

                  validate: f.validationAsync
                    ? async (v: string) => {
                        try {
                          const { params, url } = f.validationAsync!;
                          const path = new URL(url).pathname;
                          const res = await fetch(
                            `/api/wise/${path.slice(1)}?${params[0].key}=${v}`
                          );

                          return res.ok || (suggest(f.example) ?? "invalid");
                        } catch (err) {
                          report_error(err);
                          return "Validation of banking details failed unexpectedly";
                        }
                      }
                    : undefined,
                  //onBlur only as text input changes rapidly
                  onBlur: f.refreshRequirementsOnChange ? refresh : undefined,
                })}
              />
              <ErrorMessage
                as="p"
                id={err_id(f.key)}
                className="field-err mt-1 empty:hidden"
                errors={errors}
                name={f.key}
              />
            </div>
          );
        }

        if (f.type === "date") {
          return (
            <div key={f.key} className="">
              <Label
                required={labelRequired}
                htmlFor={input_id(f.key)}
                className="mb-2"
              >
                {f.name}
              </Label>
              <input
                id={input_id(f.key)}
                className="field-input"
                aria-invalid={!!getFieldState(f.key).error}
                aria-describedby={described_by(f.key)}
                aria-required={labelRequired}
                type="text"
                placeholder={f.example}
                {...register(f.key, {
                  required: f.required ? "required" : false,
                  pattern: f.validationRegexp
                    ? {
                        value: new RegExp(f.validationRegexp),
                        message: suggest(f.example) ?? "invalid format",
                      }
                    : undefined,
                  onBlur: f.refreshRequirementsOnChange ? refresh : undefined,
                })}
              />
              <ErrorMessage
                as="p"
                id={err_id(f.key)}
                className="field-err mt-1 empty:hidden"
                errors={errors}
                name={f.key}
              />
            </div>
          );
        }

        return (
          <div className="bg-destructive" key={f.key}>
            {f.name}
          </div>
        );
      })}

      {verified && (
        <FileDropzone
          dropzone_name="Bank statement"
          label={
            <Label required className="mb-2">
              Bank statement
            </Label>
          }
          specs={{ mbLimit: 4, mimeTypes: ["application/pdf"] }}
          disabled={disabled}
          ref={bankStatement.ref}
          value={bankStatement.value}
          onChange={bankStatement.onChange}
          error={errors.bankStatement?.message?.toString()}
          upload={upload_document}
          view_href={doc_href}
          report_error={report_error}
        />
      )}

      {/* one grid cell with the buttons: an empty region in the form's own
          grid would still open a gap above them */}
      <div>
        {/* rendered while empty, so its first message is announced as a change */}
        <div role="alert" className="field-err not-empty:mb-5">
          {unplaced.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
        <FormButtons
          disabled={disabled || bankStatement.value === "loading"}
          is_submitting={isSubmitting}
        />
      </div>
    </Form>
  );
}

interface IFocusFirstInvalid {
  submitting: boolean;
  /** written by the submit handler, consumed by the first settled commit */
  path: RefObject<string | null>;
  form: RefObject<HTMLFormElement | null>;
  focus: (path: string) => void;
}

/**
 * mounted inside the form's fieldset: a descendant's layout effect runs after
 * the fieldset re-enables but before `Fieldset`'s own, which would otherwise
 * hand focus back to the submit button first.
 *
 * like `Fieldset`, it leaves focus alone if the user put it outside the form
 * during the request.
 */
function FocusFirstInvalid({
  submitting,
  path,
  form,
  focus,
}: IFocusFirstInvalid) {
  // no deps: `path` is a ref, so no render reports its write; every commit checks it
  useLayoutEffect(() => {
    const target = path.current;
    if (submitting || !target) return;
    path.current = null;
    const active = document.activeElement;
    const unclaimed =
      !active || active === document.body || form.current?.contains(active);
    if (unclaimed) focus(target);
  });
  return null;
}

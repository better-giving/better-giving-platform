import {
  Confirmed,
  Copier,
  ExtLink,
  Form as F,
  Field,
  Fieldset,
  Group,
  Info,
  type IPrompt,
  Modal,
  MultiCombo,
  Prompt,
  Select,
  Toggle,
  UrlInput,
} from "@better-giving/ui";
import { SquareArrowOutUpRight } from "lucide-react";
import { useId, useRef, useState } from "react";
import { href, Outlet } from "react-router";
import { CountryCombo } from "#/components/country-combo";
import { ImgEditor } from "#/components/img-editor";
import { RichText } from "#/components/rich-text";
import { SLUG_HELP } from "#/routes/admin.$id.campaigns/copy";
import { PublicLinkField } from "#/routes/admin.$id.campaigns/link-field";
import { emails } from "@/constants/common";
import { country_names } from "@/constants/countries";
import { sans_https } from "@/helpers/https";
import type { EndowDesignation } from "@/npo";
import type { OrgDesignation } from "@/schemas";
import type { IVideos } from "./api";
import type { FV, ProfileFV } from "./schema";
import { bannerSpec, logoSpec, MAX_CHARS, suggest_slug } from "./schema";
import {
  use_organization_form,
  use_page,
  use_publish,
  use_social_media,
} from "./use-form";
import { VideosGroup } from "./videos";

const endow_designations: EndowDesignation[] = [
  "Charity",
  "Religious Organization",
  "University",
  "Hospital",
  "Other",
];

const set_once_note =
  "Can't change once set, so links you've shared keep working.";

type SetPrompt = (p: IPrompt) => void;

interface ISaveable {
  is_dirty: boolean;
  save: () => void;
}

interface ISaveButton {
  group: ISaveable;
  label: string;
  blocked?: boolean;
  onClick?: () => void;
}

/** several "Save" buttons on one page: the group rides in the accessible
 * name so each still announces what it saves */
function SaveButton({ group, label, blocked = false, onClick }: ISaveButton) {
  return (
    <button
      type="button"
      disabled={!group.is_dirty || blocked}
      onClick={onClick ?? group.save}
      aria-label={label}
      className="btn btn-primary justify-self-end"
    >
      Save
    </button>
  );
}

interface ICopyLink {
  /** absolute */
  url: string;
  label: string;
}

/** a link shown as text, with a copy button beside it */
function CopyLink({ url, label }: ICopyLink) {
  return (
    <span className="flex items-center gap-1 min-w-0">
      <ExtLink href={url} className="link break-all">
        {sans_https(url)}
      </ExtLink>
      <Copier text={url} label={label} classes="shrink-0" />
    </span>
  );
}

interface IProps {
  init: FV;
  profile: ProfileFV;
  id: number;
  base_url: string;
  videos: IVideos;
}

export function Form({ init, profile, id, base_url, videos }: IProps) {
  const [prompt, set_prompt] = useState<IPrompt>();
  const page = use_page(profile, set_prompt);
  const social_media = use_social_media(profile, set_prompt);
  const {
    published,
    publish,
    busy: publishing,
  } = use_publish(profile, set_prompt);
  const page_uploading = page.banner.value === "loading";
  const org = init.slug || String(id);
  const profile_url = href("/org/:org", { org });
  const donate_url = `${base_url}${href("/donate/:id", { id: org })}`;
  const page_title_id = useId();
  const donate_title_id = useId();

  return (
    <F
      // saves go through each group's button; an untyped nested button or an
      // enter keypress must not fire a native GET submission
      onSubmit={(e) => e.preventDefault()}
      className="px-6 py-4 md:px-10 md:py-8 w-full max-w-[1112px] grid grid-cols-1 content-start gap-6"
    >
      {prompt && <Prompt {...prompt} onClose={() => set_prompt(undefined)} />}
      <h1 className="sr-only">Organization</h1>
      {/* a slug that lands in the loader remounts this group without its link
          field; the groups below keep their unsaved edits */}
      <OrgGroup
        key={init.slug}
        init={init}
        id={id}
        base_url={base_url}
        set_prompt={set_prompt}
      />

      <Fieldset disabled={social_media.busy} className="contents">
        <Group title="Social Media">
          <UrlInput
            {...social_media.register("social_media_urls.facebook")}
            label="Facebook"
            placeholder="facebook.com/"
            error={social_media.errors.social_media_urls?.facebook?.message}
          />
          <UrlInput
            {...social_media.register("social_media_urls.linkedin")}
            label="LinkedIn"
            placeholder="linkedin.com/"
            error={social_media.errors.social_media_urls?.linkedin?.message}
          />
          <UrlInput
            {...social_media.register("social_media_urls.twitter")}
            label="X (fka Twitter)"
            placeholder="x.com/"
            error={social_media.errors.social_media_urls?.twitter?.message}
          />
          <UrlInput
            {...social_media.register("social_media_urls.instagram")}
            label="Instagram"
            placeholder="instagram.com/"
            error={social_media.errors.social_media_urls?.instagram?.message}
          />
          <UrlInput
            {...social_media.register("social_media_urls.youtube")}
            label="YouTube"
            placeholder="youtube.com/"
            error={social_media.errors.social_media_urls?.youtube?.message}
          />
          <UrlInput
            {...social_media.register("social_media_urls.tiktok")}
            label="Tiktok"
            placeholder="tiktok.com/"
            error={social_media.errors.social_media_urls?.tiktok?.message}
          />
          <UrlInput
            {...social_media.register("social_media_urls.discord")}
            label="Discord"
            placeholder="discord.com/"
            error={social_media.errors.social_media_urls?.discord?.message}
          />
          <SaveButton group={social_media} label="Save social media" />
        </Group>
      </Fieldset>

      <section
        id="page"
        aria-labelledby={page_title_id}
        // scroll-mt clears the sticky app header on a #page landing
        className="card grid grid-cols-1 w-full gap-6 scroll-mt-20"
      >
        <h2 id={page_title_id} className="text-2xl">
          <ExtLink
            href={profile_url}
            className="link inline-flex items-center gap-2"
          >
            Your Better Giving Page
            <SquareArrowOutUpRight aria-hidden className="icon-md" />
          </ExtLink>
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-sm">
          <div className="grid gap-0.5 min-w-0">
            <CopyLink
              url={`${base_url}${profile_url}`}
              label="Copy page link"
            />
            {init.slug && (
              <p className="text-xs text-gray-11">{set_once_note}</p>
            )}
          </div>
          <div className="flex items-center justify-between gap-4 max-sm:w-full">
            {published ? (
              <Confirmed>Visible in the marketplace</Confirmed>
            ) : (
              <Info classes="text-warning-subtle-fg">
                Hidden from the marketplace
              </Info>
            )}
            <Toggle
              value={published}
              onChange={publish}
              disabled={publishing}
              classes={{ container: "text-sm" }}
            >
              Published
            </Toggle>
          </div>
        </div>
        <Fieldset disabled={page.busy} className="contents">
          <Field
            {...page.register("tagline")}
            name="tagline"
            label="Tagline"
            required
            error={page.errors.tagline?.message}
          />
          <label htmlFor="npo-banner" className="label -mb-4">
            Banner
          </label>
          <ImgEditor
            id="npo-banner"
            ref={page.banner.ref}
            value={page.banner.value}
            on_change={(val) => {
              page.banner.onChange(val);
              // trigger validation - this opts for onChange validation instead of onSubmit
              page.trigger("image");
            }}
            on_undo={(e) => {
              e.stopPropagation();
              page.resetField("image");
            }}
            spec={bannerSpec}
            classes={{ container: "mb-4", dropzone: "w-full aspect-4/1" }}
            error={page.errors.image?.message}
          />
          <p className="label -mb-4">Content</p>
          <RichText
            ref={page.overview.ref}
            content={page.overview.value}
            onChange={page.overview.onChange}
            placeHolder="A short overview of your organization"
            charLimit={MAX_CHARS}
            classes={{
              field:
                "rich-text-toolbar border text-sm grid grid-rows-[auto_1fr] rounded bg-surface p-3 min-h-60",
              counter: "text-gray-11",
              error: "text-right",
            }}
            error={
              page.errors.overview?.value?.message ||
              page.errors.overview?.length?.message
            }
          />
          <p className="static field-error -mt-4 empty:hidden">
            {page.errors.overview?.message}
          </p>
        </Fieldset>
        <VideosGroup npo_id={id} videos={videos} />
        <Fieldset disabled={page.busy} className="contents">
          <SaveButton
            group={page}
            label="Save Better Giving Page"
            blocked={page_uploading}
          />
        </Fieldset>
      </section>

      <section
        aria-labelledby={donate_title_id}
        className="card flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
      >
        <h2 id={donate_title_id} className="font-semibold">
          Donate link
        </h2>
        <CopyLink url={donate_url} label="Copy donate link" />
      </section>

      {/** success prompts */}
      <Outlet />
    </F>
  );
}

interface IOrgGroup {
  init: FV;
  id: number;
  base_url: string;
  set_prompt: SetPrompt;
}

function OrgGroup({ init, id, base_url, set_prompt }: IOrgGroup) {
  const [lock_open, set_lock_open] = useState(false);
  const cancel_ref = useRef<HTMLButtonElement>(null);
  const form = use_organization_form(init, id, set_prompt);
  const uploading = form.logo.value === "loading";
  const profile_base = `${base_url}/org/`;
  const id_url = `${base_url}${href("/org/:org", { org: String(id) })}`;
  const campaigns_note = `Your campaign links start with it too (…${href("/org/:org", { org: form.slug.trim() || "your-link" })}/…).`;
  const setting_slug = !form.locked && form.slug !== "";

  return (
    <>
      <Modal
        open={lock_open}
        size="panel"
        onClose={() => set_lock_open(false)}
        classes="grid gap-4 bg-panel p-6"
        initialFocusEl={() => cancel_ref.current}
      >
        <h2 className="text-xl font-bold">Lock your profile link?</h2>
        <p>Your profile link can't be changed later.</p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancel_ref}
            type="button"
            className="btn btn-secondary"
            onClick={() => set_lock_open(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              set_lock_open(false);
              void form.save();
            }}
          >
            Save
          </button>
        </div>
      </Modal>
      <Fieldset disabled={form.busy} className="contents">
        <Group title="Organization">
          <label htmlFor="npo-logo" className="label -mb-4" data-required>
            Logo of your organization
          </label>
          <ImgEditor
            id="npo-logo"
            ref={form.logo.ref}
            value={form.logo.value}
            on_change={(val) => {
              form.logo.onChange(val);
              form.trigger("logo");
            }}
            on_undo={(e) => {
              e.stopPropagation();
              form.resetField("logo");
            }}
            spec={logoSpec}
            classes={{
              container: "mb-4",
              dropzone: "w-28 sm:w-48 aspect-square",
            }}
            error={form.errors.logo?.message}
          />
          <div className="grid gap-1">
            <p className="label">Name of your organization</p>
            <p>{form.name}</p>
            <p className="text-sm text-gray-11">
              Your legal name from your application. To change it, email{" "}
              <a href={`mailto:${emails.hi}`} className="link">
                {emails.hi}
              </a>{" "}
              with your name-change or D.B.A. records.
            </p>
          </div>
          <Field
            {...form.register("registration_number")}
            name="registration_number"
            label="EIN / Registration#"
            error={form.errors.registration_number?.message}
            required
          />
          <Select<OrgDesignation>
            required
            label="Organization Designation"
            value={form.designation.value}
            onChange={form.designation.onChange}
            classes={{ options: "text-sm" }}
            options={endow_designations}
            error={form.errors.endow_designation?.message}
            ref={form.designation.ref}
            option_disp={(v) => v}
          />
          <CountryCombo
            required
            clearable
            flags={false}
            label="Headquarters"
            value={form.hq_country.value || undefined}
            on_change={(c) => form.hq_country.onChange(c ?? "")}
            error={form.errors.hq_country?.message}
            ref={form.hq_country.ref}
          />
          {/* once set, the link is read-only text atop the Better Giving
              Page section */}
          {!form.locked && (
            <PublicLinkField
              reg={form.register("slug")}
              value={form.slug}
              base={profile_base}
              locked={false}
              label="Profile link"
              help={`${campaigns_note} ${SLUG_HELP}.`}
              subject="your profile"
              placeholder={suggest_slug(form.name)}
              empty_url={id_url}
              empty_suffix=" until you set a link"
              error={form.errors.slug?.message}
            />
          )}
          <UrlInput
            {...form.register("url")}
            label="Website of your organization"
            placeholder="website.org"
            error={form.errors.url?.message}
          />
          <Field
            {...form.register("street_address")}
            label="Address"
            error={form.errors.street_address?.message}
          />
          <MultiCombo
            label="Active countries"
            values={form.active_in_countries.value}
            on_change={form.active_in_countries.onChange}
            ref={form.active_in_countries.ref}
            on_reset={() => form.resetField("active_in_countries")}
            options={country_names}
            classes={{
              container: "bg-surface",
              options: "text-sm",
            }}
          />
          <SaveButton
            group={form}
            label="Save organization"
            blocked={uploading}
            onClick={async () => {
              if (!setting_slug) {
                void form.save();
                return;
              }
              // only a group that would save asks to lock the link
              if (await form.validate()) set_lock_open(true);
            }}
          />
        </Group>
      </Fieldset>
    </>
  );
}

import { QrCode as Ark } from "@ark-ui/react/qr-code";
import { Group, Tab, TabList, TabPanel, Tabs } from "@better-giving/ui";
import { ArrowDownToLineIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import org_building from "#/assets/icons/org-building.svg";

type QRCodeType = "profile" | "donation" | "campaign";

/** a break opportunity after each `/`, so a long address wraps between its parts */
const url_wrapped = (url: string) =>
  url.split("/").map((part, i, parts) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <>
          /<wbr />
        </>
      )}
    </Fragment>
  ));

interface Props {
  classes?: string;
  logo?: string;
  profile_url: string;
  donate_url: string;
  campaign_url?: string;
  /** published pages open the address. drafts, and the assets page, keep text. */
  link_url?: boolean;
  /** assets page only. the campaign page leaves this unset and keeps its heading. */
  grouped?: boolean;
}

export function QrCode({
  classes = "",
  logo,
  profile_url,
  donate_url,
  campaign_url,
  link_url = false,
  grouped = false,
}: Props) {
  const tabs: { id: QRCodeType; name: string }[] = campaign_url
    ? [{ id: "campaign", name: "Campaign" }]
    : [
        { id: "profile", name: "Profile" },
        { id: "donation", name: "Donation Page" },
      ];
  const [color, set_color] = useState("#000000");
  const [show_logo, set_show_logo] = useState(true);
  const [selected_tab, set_selected_tab] = useState<QRCodeType>(tabs[0].id);
  // the logo that failed, not a flag: a new logo gets its own attempt
  const [failed_logo, set_failed_logo] = useState<string>();
  const logo_src = logo && logo !== failed_logo ? logo : org_building;
  const logo_ref = useRef<HTMLImageElement>(null);

  // a logo that fails before hydration fires its error event before react
  // attaches onError; a loaded image with no intrinsic width is that failure
  useEffect(() => {
    const img = logo_ref.current;
    if (logo && img?.complete && img.naturalWidth === 0) set_failed_logo(logo);
  }, [logo]);

  const urls: Record<QRCodeType, string> = {
    profile: profile_url,
    donation: donate_url,
    campaign: campaign_url ?? donate_url,
  };

  const handle_download = () => {
    const svg = document.querySelector("#qr-code-svg");
    if (!svg) return;

    const svg_data = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const qr_img = new Image();

    const qr_size = 512;
    const padding = 48;
    const total_size = qr_size + padding * 2;

    qr_img.onload = () => {
      canvas.width = total_size;
      canvas.height = total_size;

      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, total_size, total_size);
        ctx.drawImage(qr_img, padding, padding, qr_size, qr_size);

        if (show_logo) {
          const logo_img = new Image();
          logo_img.crossOrigin = "anonymous";
          logo_img.onload = () => {
            const logo_size = 96;
            const logo_x = (total_size - logo_size) / 2;
            const logo_y = (total_size - logo_size) / 2;

            ctx.fillStyle = "#ffffff";
            ctx.fillRect(logo_x - 4, logo_y - 4, logo_size + 8, logo_size + 8);
            ctx.drawImage(logo_img, logo_x, logo_y, logo_size, logo_size);

            const png_file = canvas.toDataURL("image/png");
            const download_link = document.createElement("a");
            download_link.download = `qr-code-${selected_tab}.png`;
            download_link.href = png_file;
            download_link.click();
          };
          logo_img.onerror = () => {
            const png_file = canvas.toDataURL("image/png");
            const download_link = document.createElement("a");
            download_link.download = `qr-code-${selected_tab}.png`;
            download_link.href = png_file;
            download_link.click();
          };
          logo_img.src = logo_src;
        } else {
          const png_file = canvas.toDataURL("image/png");
          const download_link = document.createElement("a");
          download_link.download = `qr-code-${selected_tab}.png`;
          download_link.href = png_file;
          download_link.click();
        }
      }
    };

    qr_img.src = `data:image/svg+xml;base64,${btoa(svg_data)}`;
  };

  const panel = (tab: (typeof tabs)[number]) => (
    <>
      <Ark.Root
        value={urls[tab.id]}
        pixelSize={256}
        encoding={{ ecc: "H" }}
        ids={{ frame: "qr-code-svg" }}
        className="relative bg-white w-fit"
        style={{ color }}
      >
        <Ark.Frame className="w-64 h-64 fill-current">
          <Ark.Pattern />
        </Ark.Frame>
        {show_logo && (
          <Ark.Overlay className="bg-white p-1">
            <img
              ref={logo_ref}
              src={logo_src}
              alt=""
              width={48}
              height={48}
              onError={() => set_failed_logo(logo)}
            />
          </Ark.Overlay>
        )}
      </Ark.Root>
      <p className="text-sm text-gray-11 mt-1">
        {tab.name}:{" "}
        {link_url ? (
          <a
            href={urls[tab.id]}
            target="_blank"
            rel="noopener noreferrer"
            className="link font-mono text-xs break-words"
          >
            {url_wrapped(urls[tab.id])}
          </a>
        ) : (
          <span className="font-mono text-xs break-words">
            {url_wrapped(urls[tab.id])}
          </span>
        )}
      </p>
    </>
  );

  const controls = (
    <>
      <div className="mt-4 flex gap-x-2 items-center justify-items-center">
        <label htmlFor="qr-color" className="label">
          Color
        </label>
        <input
          id="qr-color"
          type="color"
          value={color}
          onChange={(e) => set_color(e.target.value)}
          className="h-(--field-size) w-(--field-size) cursor-pointer rounded border border-input hover:border-input-hover bg-surface p-1"
        />

        <div className="flex items-center gap-x-1">
          <input
            id="show-logo"
            type="checkbox"
            checked={show_logo}
            onChange={(e) => set_show_logo(e.target.checked)}
            className="checkbox"
          />
          <label htmlFor="show-logo" className="label">
            Show logo in center
          </label>
        </div>
      </div>

      <button
        className="flex items-center mt-4 btn btn-primary gap-x-2"
        type="button"
        onClick={handle_download}
      >
        <ArrowDownToLineIcon className="icon-sm" />
        Download
      </button>
    </>
  );

  const body =
    tabs.length > 1 ? (
      <Tabs
        classes="w-full max-w-96"
        defaultValue={tabs[0].id}
        onValueChange={(e) => set_selected_tab(e.value as QRCodeType)}
      >
        <TabList aria-label="QR code">
          {tabs.map((tab) => (
            <Tab key={tab.id} value={tab.id}>
              {tab.name}
            </Tab>
          ))}
        </TabList>
        {tabs.map((tab) => (
          <TabPanel key={tab.id} value={tab.id} classes="mt-6">
            {panel(tab)}
          </TabPanel>
        ))}
        {controls}
      </Tabs>
    ) : (
      <div className="w-full max-w-96">
        {panel(tabs[0])}
        {controls}
      </div>
    );

  if (grouped) {
    return (
      <Group title="QR code" classes={classes}>
        {body}
      </Group>
    );
  }

  return (
    <div className={classes}>
      <h2 className="text-2xl font-bold mb-2">QR code</h2>
      {body}
    </div>
  );
}

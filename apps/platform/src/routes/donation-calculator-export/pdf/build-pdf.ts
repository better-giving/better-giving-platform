import text_bold_b64 from "@better-giving/ui/fonts/RedHatRoundText-Bold.woff2?bin";
import text_light_b64 from "@better-giving/ui/fonts/RedHatRoundText-Light.woff2?bin";
import text_medium_b64 from "@better-giving/ui/fonts/RedHatRoundText-Medium.woff2?bin";
import text_regular_b64 from "@better-giving/ui/fonts/RedHatRoundText-Regular.woff2?bin";
import text_semibold_b64 from "@better-giving/ui/fonts/RedHatRoundText-SemiBold.woff2?bin";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import type { View } from "#/routes/_app.donation-calculator/types";
import fb_b64 from "../icons/facebook.png?bin";
import ig_b64 from "../icons/instagram.png?bin";
import li_b64 from "../icons/linkedin.png?bin";
import x_b64 from "../icons/x.png?bin";
import yt_b64 from "../icons/youtube.png?bin";
import footer_b64 from "./images/footer.jpg?bin";
import intercom_b64 from "./images/intercom.png?bin";
import laira_laptop_b64 from "./images/laira-laptop.png?bin";
import laira_pointing_b64 from "./images/laira-pointing.png?bin";
import laira_yellow_b64 from "./images/laira-yellow.png?bin";
import logo_white_b64 from "./images/logo-white.png?bin";
import { draw_page1 } from "./page1";
import { draw_page2 } from "./page2";
import { draw_page3 } from "./page3";
import { draw_page4 } from "./page4";
import type { Fonts, Images } from "./types";
import { PAGE_H, PAGE_W } from "./types";

// the faces ship as woff2. pdf-lib writes the bytes it is given straight into
// the document unless it subsets, and a pdf font stream has to be an sfnt, so
// an unsubset woff2 renders as a fallback face or not at all in a viewer even
// though measuring text with it works. subsetting re-encodes to truetype.
const SUBSET = { subset: true } as const;

const decode = (b64: string): Uint8Array => Buffer.from(b64, "base64");

export async function build_pdf(view: View): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle("better-giving-report");

  const fonts: Fonts = {
    light: await doc.embedFont(decode(text_light_b64), SUBSET),
    regular: await doc.embedFont(decode(text_regular_b64), SUBSET),
    medium: await doc.embedFont(decode(text_medium_b64), SUBSET),
    semibold: await doc.embedFont(decode(text_semibold_b64), SUBSET),
    bold: await doc.embedFont(decode(text_bold_b64), SUBSET),
  };

  const images: Images = {
    logo: await doc.embedPng(decode(logo_white_b64)),
    footer_jpg: await doc.embedJpg(decode(footer_b64)),
    laira_laptop: await doc.embedPng(decode(laira_laptop_b64)),
    laira_pointing: await doc.embedPng(decode(laira_pointing_b64)),
    laira_yellow: await doc.embedPng(decode(laira_yellow_b64)),
    icon_facebook: await doc.embedPng(decode(fb_b64)),
    icon_instagram: await doc.embedPng(decode(ig_b64)),
    icon_intercom: await doc.embedPng(decode(intercom_b64)),
    icon_linkedin: await doc.embedPng(decode(li_b64)),
    icon_x: await doc.embedPng(decode(x_b64)),
    icon_youtube: await doc.embedPng(decode(yt_b64)),
  };

  const p1 = doc.addPage([PAGE_W, PAGE_H]);
  const p2 = doc.addPage([PAGE_W, PAGE_H]);
  const p3 = doc.addPage([PAGE_W, PAGE_H]);
  const p4 = doc.addPage([PAGE_W, PAGE_H]);

  draw_page1(doc, p1, view, fonts, images);
  draw_page2(doc, p2, view, fonts, images);
  draw_page3(doc, p3, fonts, images);
  draw_page4(doc, p4, fonts, images);

  return doc.save();
}

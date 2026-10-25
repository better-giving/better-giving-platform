import type { IOrgShape } from "@/org-shape";
import type { INpoPublic } from "$/pg/queries/npo";
import type { IOrgDetails } from "../footer";
import type {
  IDonorMessage,
  IGiveItem,
  IProgramItem,
  IVideoItem,
} from "../items";

/** what every layout (Poster, Letter, Hub, Feature, Card) renders from; the route maps loader data into it */
export interface IOrgLayout {
  npo: INpoPublic;
  shape: IOrgShape;
  donate_to: string;
  /** the header's share target */
  share: { recipientName: string; url: string };
  /** epoch ms the page was rendered at; cards count "Ends in N days" from it */
  now: number;
  /** campaigns, then open supporter campaigns */
  give: IGiveItem[];
  programs: IProgramItem[];
  videos: IVideoItem[];
  /** a list that failed to load; its section shows the failure line instead */
  failed: { give: boolean; programs: boolean; videos: boolean };
  messages: IDonorMessage[];
  /** loads the next page of messages into `messages`; absent once there is none */
  on_more_messages?: () => void;
  footer: IOrgDetails;
  /** the org's registration, shown in the first-load view; null when unknown */
  credential: { label: "EIN" | "Registration no."; value: string } | null;
}

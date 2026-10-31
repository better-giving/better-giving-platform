/** the assistants the consent screen can name. the allow URL carries the id as
 *  `?client=`; it is a label only and grants nothing, so an unknown or absent
 *  value just falls back to the neutral tile. */
export const CLIENT_IDS = ["chatgpt", "claude"] as const;
export type ClientId = (typeof CLIENT_IDS)[number];

export interface IClient {
  name: string;
  /** the vendor's own file under public/, served unmodified */
  logo: string;
  /** the tile the logo sits in: fill and inset */
  tile: string;
}

export const clients: Record<ClientId, IClient> = {
  chatgpt: {
    name: "ChatGPT",
    logo: "/icons/clients/openai-white-monoblossom.svg",
    tile: "bg-black p-2.5",
  },
  claude: {
    name: "Claude",
    // the square icon carries its own fill and margin
    logo: "/icons/clients/claude-icon-square.svg",
    tile: "",
  },
};

export const parse_client = (raw: string | null): ClientId | null =>
  CLIENT_IDS.find((id) => id === raw) ?? null;

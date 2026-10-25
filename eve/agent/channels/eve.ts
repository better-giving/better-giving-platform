import { httpBasic, localDev, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

// Chat and API access. Callers use the Basic credentials from env, or a Vercel
// OIDC token from this project. localDev() only admits `eve dev` traffic.
const user = process.env.EVE_BASIC_AUTH_USER;
const password = process.env.EVE_BASIC_AUTH_PASSWORD;

export default eveChannel({
  auth: [
    ...(user && password
      ? [httpBasic({ username: user, password }, { realm: "bgp-lead" })]
      : []),
    vercelOidc(),
    localDev(),
  ],
});

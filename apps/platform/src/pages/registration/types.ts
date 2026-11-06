import type { AuthUser } from "#/types/auth";
import type { IReg } from "@/reg";

export type Reg$IdData = {
  reg: IReg;
  user: AuthUser;
  /** the `STRIPE_CONNECT_ROUTING` switch, for the `Progress` the chrome draws */
  connect_routing: boolean;
};

import type { AuthUser } from "#/types/auth";
import type { IReg } from "@/reg";

export type Reg$IdData = {
  reg: IReg;
  user: AuthUser;
  /** the `STRIPE_CONNECT_ROUTING` switch, for the `Progress` the chrome draws */
  connect_routing: boolean;
};

/** a step save refused over one of its fields: the step shows each message
 * in that field's error slot */
export interface IStepFieldErrors {
  field_errors: Partial<Record<"o_slug", string>>;
}

import kru from "kru-eve";

import { KRU_PROTECT } from "../lib/protect";

// Kru's test-writer, builder, ui-builder, and reviewer seats, mounted as
// kru__<seat>, each builder with its own hard-work. The model defaults already
// match this agent's model map, so none are overridden: overriding only `model`
// would drop a seat's default reasoning setting.
export default kru({ protect: KRU_PROTECT });

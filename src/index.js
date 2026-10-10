import { handleRequest } from "./router.js";
import { handleScheduled } from "./scheduled.js";
import { protectPublicRequest } from "./public-protection.js";

// Legacy Worker entry point, retained only for rollback after Cloud Run cutover.
export default {
  fetch(request, env, ctx) {
    return protectPublicRequest(request, env, ctx, () => handleRequest(request, env));
  },
  scheduled(_event, env, ctx) {
    return handleScheduled(env, ctx);
  }
};

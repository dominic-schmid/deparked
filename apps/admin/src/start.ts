import { createStart } from "@tanstack/react-start";
import { adminGuard } from "./server/guard";

export const startInstance = createStart(() => ({
  requestMiddleware: [adminGuard],
}));

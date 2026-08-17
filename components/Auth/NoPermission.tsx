import { EmptyState } from "../Table/Table";
import { moduleLabel } from "../../modules/auth/permissions";

// Ported from the prototype's guard(): the same wording, shown in place of the
// page body when the signed-in user lacks view rights on that module.
export function NoPermission({ module }: { module: string }) {
  return <EmptyState>You do not have permission to view {moduleLabel(module)}.</EmptyState>;
}

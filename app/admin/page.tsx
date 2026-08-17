import { notFound } from "next/navigation";
import { AdminClient } from "../../components/Admin/AdminClient";
import { getCurrentUser } from "../../lib/auth";
import { listUsers } from "../../services/userService";

export const dynamic = "force-dynamic";

// Admin panel. Non-admins get a 404 rather than a "forbidden" page, so the
// route's existence isn't advertised to accounts that cannot use it. The
// /api/users routes enforce the same rule independently.
export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") notFound();
  const users = await listUsers();
  return <AdminClient users={users} currentUserId={user.id} />;
}

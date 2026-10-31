import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AdminPanel from "@/components/AdminPanel";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return (
    <>
      <TopBar name={user.name} isAdmin page="admin" />
      <AdminPanel meId={user.id} />
    </>
  );
}

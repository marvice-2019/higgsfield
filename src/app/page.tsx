import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { publicModels } from "@/lib/models";
import { listGenerations, usageToday } from "@/lib/views";
import Studio from "@/components/Studio";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const e = env();
  const [items, used] = await Promise.all([listGenerations({ userId: user.id, limit: 24 }), usageToday(user.id)]);
  return (
    <>
      <TopBar name={user.name} isAdmin={user.role === "admin"} page="studio" />
      <Studio
        models={publicModels()}
        initialItems={items}
        me={{ id: user.id, isAdmin: user.role === "admin" }}
        quota={{ used, limit: user.role === "admin" ? e.ADMIN_DAILY_LIMIT : e.DAILY_LIMIT }}
      />
    </>
  );
}

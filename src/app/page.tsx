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
  const models = publicModels();
  if (models.length === 0) {
    return (
      <>
        <TopBar name={user.name} isAdmin={user.role === "admin"} page="studio" />
        <main className="admin">
          <h1>No models yet</h1>
          <p className="muted">
            {user.role === "admin"
              ? "Add the Higgsfield API keys, or the RunPod settings for the self-hosted LTX model, in Coolify's environment variables, then redeploy."
              : "An admin still needs to connect a model provider. Check back soon."}
          </p>
        </main>
      </>
    );
  }
  return (
    <>
      <TopBar name={user.name} isAdmin={user.role === "admin"} page="studio" />
      <Studio
        models={models}
        initialItems={items}
        me={{ id: user.id, isAdmin: user.role === "admin" }}
        quota={{ used, limit: user.role === "admin" ? e.ADMIN_DAILY_LIMIT : e.DAILY_LIMIT }}
      />
    </>
  );
}

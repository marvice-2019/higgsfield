import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <main className="login-wrap">
      <section className="login-art" aria-hidden="true">
        <h1>
          Make the <em>frame</em>
          <br />
          before the shoot.
        </h1>
      </section>
      <section className="login-form">
        <LoginForm />
      </section>
    </main>
  );
}

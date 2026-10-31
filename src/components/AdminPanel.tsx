"use client";

import { useCallback, useEffect, useState } from "react";

type U = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  active: boolean;
  created_at: string;
  today: number;
  last30: number;
  total: number;
};

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export default function AdminPanel({ meId }: { meId: string }) {
  const [users, setUsers] = useState<U[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api("/api/admin/users");
      setUsers(d.users);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not load users" });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ name: fd.get("name"), email: fd.get("email"), password: fd.get("password"), role: fd.get("role") }),
      });
      form.reset();
      setMsg({ ok: true, text: `Added ${fd.get("email")}. Share the password with them privately.` });
      load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not add user" });
    } finally {
      setBusy(false);
    }
  }

  async function patch(u: U, body: Record<string, unknown>, done: string) {
    setMsg(null);
    try {
      await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setMsg({ ok: true, text: done });
      load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Update failed" });
    }
  }

  function resetPassword(u: U) {
    const pw = prompt(`New password for ${u.email} (min 10 characters):`);
    if (!pw) return;
    patch(u, { password: pw }, `Password reset for ${u.email}. They've been signed out.`);
  }

  const totalToday = users.reduce((a, u) => a + u.today, 0);
  const total30 = users.reduce((a, u) => a + u.last30, 0);

  return (
    <main className="admin">
      <div>
        <h1>Team</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          {users.length} people · {totalToday} runs today · {total30} finished in the last 30 days
        </p>
      </div>

      {msg && <div className={`alert ${msg.ok ? "alert-ok" : "alert-bad"}`} role="status">{msg.text}</div>}

      <section className="panel">
        <h2>Add a person</h2>
        <form className="form-row" onSubmit={create}>
          <div>
            <label className="label" htmlFor="n-email">Email</label>
            <input className="input" id="n-email" name="email" type="email" required autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="n-name">Name</label>
            <input className="input" id="n-name" name="name" required maxLength={80} autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="n-pw">Temporary password</label>
            <input className="input" id="n-pw" name="password" type="text" minLength={10} required autoComplete="new-password" />
          </div>
          <div>
            <label className="label" htmlFor="n-role">Role</label>
            <select className="input" id="n-role" name="role" defaultValue="member">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Add"}</button>
        </form>
      </section>

      <section className="panel">
        <h2>People</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th className="num">Today</th>
                <th className="num">30 days</th>
                <th className="num">All time</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}{u.id === meId && <span className="muted"> (you)</span>}</td>
                  <td className="muted">{u.email}</td>
                  <td>
                    <span className={`badge ${u.role === "admin" ? "badge-admin" : ""}`}>{u.role}</span>{" "}
                    {!u.active && <span className="badge badge-off">off</span>}
                  </td>
                  <td className="num">{u.today}</td>
                  <td className="num">{u.last30}</td>
                  <td className="num">{u.total}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-sm" type="button" onClick={() => resetPassword(u)}>Reset password</button>
                      {u.id !== meId && (
                        <>
                          <button
                            className="btn btn-sm"
                            type="button"
                            onClick={() => patch(u, { role: u.role === "admin" ? "member" : "admin" }, `${u.email} is now ${u.role === "admin" ? "a member" : "an admin"}.`)}
                          >
                            {u.role === "admin" ? "Make member" : "Make admin"}
                          </button>
                          <button
                            className={`btn btn-sm ${u.active ? "btn-danger" : ""}`}
                            type="button"
                            onClick={() => patch(u, { active: !u.active }, `${u.email} ${u.active ? "deactivated and signed out" : "reactivated"}.`)}
                          >
                            {u.active ? "Deactivate" : "Reactivate"}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

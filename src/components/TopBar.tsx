"use client";

import Link from "next/link";

export default function TopBar({ name, isAdmin, page }: { name: string; isAdmin: boolean; page: "studio" | "admin" }) {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="brand-mark">
          Studio<em>.</em>
        </span>
        <span className="brand-tag">Marvice · Higgsfield</span>
      </Link>
      <div className="topbar-spacer" />
      <span className="topbar-meta">{name}</span>
      {isAdmin && (
        <Link className="topbar-link" href={page === "admin" ? "/" : "/admin"}>
          {page === "admin" ? "Studio" : "Team"}
        </Link>
      )}
      <button className="topbar-link" type="button" onClick={logout}>
        Sign out
      </button>
    </header>
  );
}

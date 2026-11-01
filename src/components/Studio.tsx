"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FieldSpec, PublicModel } from "@/lib/models";
import type { GenerationView } from "@/lib/views";

type Props = {
  models: PublicModel[];
  initialItems: GenerationView[];
  me: { id: string; isAdmin: boolean };
  quota: { used: number; limit: number };
};
type Source = { genId: string; file: string; url: string };

const PENDING = new Set(["submitting", "queued", "in_progress"]);
const STATUS_LABEL: Record<string, string> = {
  submitting: "Sending",
  queued: "In queue",
  in_progress: "Rendering",
  completed: "Done",
  failed: "Failed",
  nsfw: "Blocked",
  canceled: "Canceled",
};

function defaults(m: PublicModel): Record<string, string | number | boolean> {
  return Object.fromEntries(m.fields.map((f) => [f.name, f.default]));
}
function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function Studio({ models, initialItems, me, quota: initialQuota }: Props) {
  // The page only renders Studio when at least one model is configured; prefer an image model first.
  const firstModel = models.find((m) => m.kind === "image") ?? models[0];
  const [kind, setKind] = useState<"image" | "video">(firstModel.kind);
  const [modelId, setModelId] = useState(firstModel.id);
  const hasKind = (k: "image" | "video") => models.some((m) => m.kind === k);
  const animateTarget = models.find((m) => m.kind === "video" && m.needsImage);
  const model = useMemo(() => models.find((m) => m.id === modelId)!, [models, modelId]);
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => defaults(model));
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState(initialQuota);

  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialItems.length >= 24);
  const [loadingList, setLoadingList] = useState(false);
  const [open, setOpen] = useState<{ id: string; index: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const pickModel = useCallback(
    (id: string) => {
      const m = models.find((x) => x.id === id)!;
      setModelId(id);
      setKind(m.kind);
      setValues(defaults(m));
      setError(null);
    },
    [models],
  );

  function pickKind(k: "image" | "video") {
    const first = models.find((m) => m.kind === k);
    if (k === kind || !first) return;
    pickModel(first.id);
  }

  function setImageFile(f: File | null) {
    if (filePreview) URL.revokeObjectURL(filePreview);
    setSource(null);
    if (!f) {
      setFile(null);
      setFilePreview(null);
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) return setError("Use a JPG, PNG or WebP image");
    if (f.size > 10 * 1024 * 1024) return setError("Image must be under 10 MB");
    setError(null);
    setFile(f);
    setFilePreview(URL.createObjectURL(f));
  }

  // --- Poll running jobs ---
  const pendingIds = items.filter((i) => PENDING.has(i.status)).map((i) => i.id);
  const pendingKey = pendingIds.join(",");
  useEffect(() => {
    if (!pendingKey) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/generations?ids=${pendingKey}`, { cache: "no-store" });
        if (!res.ok) return;
        const { items: fresh } = (await res.json()) as { items: GenerationView[] };
        if (stop) return;
        const byId = new Map(fresh.map((f) => [f.id, f]));
        setItems((prev) => prev.map((p) => byId.get(p.id) ?? p));
      } catch {
        /* network blip; next tick retries */
      }
    };
    const t = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [pendingKey]);

  async function loadList(nextScope: "mine" | "team", before?: string) {
    setLoadingList(true);
    try {
      const qs = new URLSearchParams({ scope: nextScope, ...(before ? { before } : {}) });
      const res = await fetch(`/api/generations?${qs}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load");
      setItems((prev) => (before ? [...prev, ...data.items] : data.items));
      setHasMore(data.items.length >= 24);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    } finally {
      setLoadingList(false);
    }
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (prompt.trim().length < 3) return setError("Write a prompt first");
    if (model.needsImage && !file && !source) return setError("This model needs a starting image");
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("model", model.id);
    fd.set("prompt", prompt.trim());
    for (const [k, v] of Object.entries(values)) fd.set(k, String(v));
    if (model.needsImage) {
      if (file) fd.set("image", file);
      else if (source) fd.set("source", `${source.genId}/${source.file}`);
    }
    try {
      const res = await fetch("/api/generations", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Generation failed to start");
      setItems((prev) => [data.item, ...prev]);
      setQuota((q) => ({ ...q, used: q.used + 1 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed to start");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: GenerationView) {
    if (!confirm("Delete this for everyone? This can't be undone.")) return;
    const res = await fetch(`/api/generations/${item.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return alert(data.error ?? "Could not delete");
    setItems((prev) => prev.filter((p) => p.id !== item.id));
    setOpen(null);
  }

  function reuse(item: GenerationView) {
    const m = models.find((x) => x.id === item.model);
    if (m) {
      setModelId(m.id);
      setKind(m.kind);
      setValues({ ...defaults(m), ...(item.params as Record<string, string | number | boolean>) });
    }
    setPrompt(item.prompt);
    setOpen(null);
    promptRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function animate(item: GenerationView, index: number) {
    const out = item.outputs[index];
    const fileName = out.url.split("/").pop()!;
    const target = animateTarget;
    if (!target) return;
    setModelId(target.id);
    setKind("video");
    setValues(defaults(target));
    setImageFile(null);
    setSource({ genId: item.id, file: fileName, url: out.url });
    setPrompt("");
    setOpen(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => promptRef.current?.focus(), 300);
  }

  const openItem = open ? items.find((i) => i.id === open.id) : undefined;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const visibleModels = models.filter((m) => m.kind === kind);
  const quotaLeft = Math.max(0, quota.limit - quota.used);
  const preview = filePreview ?? source?.url ?? null;

  return (
    <main className="studio">
      <form className="composer" onSubmit={generate} aria-label="Create">
        <div className="kind-switch" role="group" aria-label="Output type">
          <button type="button" aria-pressed={kind === "image"} disabled={!hasKind("image")} title={hasKind("image") ? undefined : "No image model is configured"} onClick={() => pickKind("image")}>Image</button>
          <button type="button" aria-pressed={kind === "video"} disabled={!hasKind("video")} title={hasKind("video") ? undefined : "No video model is configured"} onClick={() => pickKind("video")}>Video</button>
        </div>

        <div>
          <span className="label">Model</span>
          <div className="model-list">
            {visibleModels.map((m) => (
              <button key={m.id} type="button" className="model-card" aria-pressed={m.id === modelId} onClick={() => pickModel(m.id)}>
                <strong>{m.label}</strong>
                <span>{m.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        {model.needsImage && (
          <div>
            <span className="label">Starting image</span>
            <button
              type="button"
              className="drop"
              data-over={dragOver}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                setImageFile(e.dataTransfer.files?.[0] ?? null);
              }}
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Starting frame" />
              ) : (
                <span>Drop a JPG/PNG/WebP here or click to choose. Max 10 MB.</span>
              )}
            </button>
            {preview && (
              <button type="button" className="drop-clear" onClick={() => setImageFile(null)}>
                Remove image
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                setImageFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>
        )}

        <div>
          <label className="label" htmlFor="prompt">{model.needsImage ? "Describe the motion" : "Prompt"}</label>
          <textarea
            ref={promptRef}
            id="prompt"
            className="prompt"
            value={prompt}
            maxLength={2000}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }}
            placeholder={
              model.needsImage
                ? "Slow dolly in, hair moving in the breeze, warm evening light"
                : kind === "image"
                  ? "Editorial portrait of a woman in a saree on a Chennai rooftop at golden hour, 85mm, soft grain"
                  : "Aerial shot gliding over a Kerala backwater at sunrise, mist on the water"
            }
          />
          <div className="counter">{prompt.length}/2000 · Ctrl+Enter to run</div>
        </div>

        <div className="fields">
          {model.fields.map((f) => (
            <Field key={f.name} spec={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
          ))}
        </div>

        {error && <div className="alert alert-bad" role="alert">{error}</div>}

        <div>
          <button className="btn btn-primary btn-big" type="submit" disabled={busy || quotaLeft === 0}>
            {busy ? "Starting…" : quotaLeft === 0 ? "Daily limit reached" : `Generate ${kind}`}
          </button>
          <div style={{ marginTop: 10 }}>
            <div className="quota">
              <span>Today</span>
              <span>{quota.used} / {quota.limit}</span>
            </div>
            <div className="quota-bar"><i style={{ width: `${Math.min(100, (quota.used / Math.max(1, quota.limit)) * 100)}%` }} /></div>
          </div>
        </div>
      </form>

      <section aria-label="Gallery">
        <div className="gallery-head">
          <h1 className="gallery-title">{scope === "mine" ? <>Your <em>reel</em></> : <>Team <em>reel</em></>}</h1>
          <div className="tabs" role="group" aria-label="Show">
            {(["mine", "team"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                onClick={() => {
                  if (s === scope) return;
                  setScope(s);
                  loadList(s);
                }}
              >
                {s === "mine" ? "Mine" : "Team"}
              </button>
            ))}
          </div>
        </div>

        {items.length === 0 && !loadingList ? (
          <div className="empty">
            <h3>Nothing here yet</h3>
            <p>Write a prompt on the left and hit Generate. Images take about a minute; videos take a few minutes.</p>
          </div>
        ) : (
          <div className="grid">
            {items.map((item) => (
              <Card key={item.id} item={item} label={models.find((m) => m.id === item.model)?.label ?? item.model} showOwner={scope === "team"} onOpen={() => setOpen({ id: item.id, index: 0 })} />
            ))}
          </div>
        )}
        {hasMore && items.length > 0 && (
          <div className="more">
            <button className="btn" type="button" disabled={loadingList} onClick={() => loadList(scope, items[items.length - 1].createdAt)}>
              {loadingList ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </section>

      {openItem && open && (
        <Lightbox
          item={openItem}
          index={open.index}
          label={models.find((m) => m.id === openItem.model)?.label ?? openItem.model}
          canDelete={openItem.owner.id === me.id || me.isAdmin}
          canAnimate={Boolean(animateTarget)}
          onIndex={(i) => setOpen({ id: openItem.id, index: i })}
          onClose={() => setOpen(null)}
          onReuse={() => reuse(openItem)}
          onAnimate={(i) => animate(openItem, i)}
          onDelete={() => remove(openItem)}
        />
      )}
    </main>
  );
}

function Field({ spec, value, onChange }: { spec: FieldSpec; value: string | number | boolean; onChange: (v: string | number | boolean) => void }) {
  if (spec.type === "select") {
    return (
      <div className={spec.options.length > 4 ? "field-wide" : undefined}>
        <span className="label">{spec.label}</span>
        <div className="chips" role="group" aria-label={spec.label}>
          {spec.options.map((o) => (
            <button key={String(o)} type="button" className="chip" aria-pressed={value === o} onClick={() => onChange(o)}>
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (spec.type === "range") {
    return (
      <div className="field-wide">
        <label className="label" htmlFor={spec.name}>{spec.label} · {Number(value).toFixed(2)}</label>
        <input id={spec.name} type="range" min={spec.min} max={spec.max} step={spec.step} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
    );
  }
  if (spec.type === "toggle") {
    return (
      <label className="toggle field-wide">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {spec.label}
      </label>
    );
  }
  return (
    <div className="field-wide">
      <label className="label" htmlFor={spec.name}>{spec.label}</label>
      <input id={spec.name} className="input" value={String(value)} placeholder={spec.placeholder} maxLength={500} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Card({ item, label, showOwner, onOpen }: { item: GenerationView; label: string; showOwner: boolean; onOpen: () => void }) {
  const first = item.outputs[0];
  const pending = PENDING.has(item.status);
  return (
    <article className="card">
      {item.status === "completed" && first ? (
        <button type="button" className="card-media" onClick={onOpen} aria-label={`Open: ${item.prompt.slice(0, 60)}`}>
          {first.type === "video" ? (
            <video src={first.url} muted loop playsInline preload="metadata" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={first.url} alt={item.prompt.slice(0, 120)} loading="lazy" />
          )}
          {item.outputs.length > 1 && <span className="count">{item.outputs.length}</span>}
          {first.type === "video" && <span className="play">▶ video</span>}
        </button>
      ) : (
        <div className="card-media" style={{ cursor: "default" }}>
          {pending ? (
            <div className="pending" role="status">
              <span className="dot" />
              {STATUS_LABEL[item.status]}
            </div>
          ) : (
            <div className="failed-box">
              <strong>{STATUS_LABEL[item.status]}</strong>
              <div>{item.error ?? "No output"}</div>
            </div>
          )}
        </div>
      )}
      <div className="card-body">
        <p className="card-prompt">{item.prompt}</p>
        <div className="card-meta">
          <span>{label}{showOwner ? ` · ${item.owner.name}` : ""}</span>
          <span>{ago(item.createdAt)}</span>
        </div>
      </div>
    </article>
  );
}

function Lightbox(props: {
  item: GenerationView;
  index: number;
  label: string;
  canDelete: boolean;
  canAnimate: boolean;
  onIndex: (i: number) => void;
  onClose: () => void;
  onReuse: () => void;
  onAnimate: (i: number) => void;
  onDelete: () => void;
}) {
  const { item, index, label } = props;
  const out = item.outputs[index] ?? item.outputs[0];
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Preview" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="lightbox-stage" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
        {out.type === "video" ? (
          <video key={out.url} src={out.url} controls autoPlay loop playsInline />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={out.url} alt={item.prompt.slice(0, 120)} />
        )}
        {item.outputs.length > 1 && (
          <div className="thumbs">
            {item.outputs.map((o, i) => (
              <button key={o.url} type="button" aria-pressed={i === index} onClick={() => props.onIndex(i)} aria-label={`Output ${i + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={o.url} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>
      <aside className="lightbox-side">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="label" style={{ margin: 0 }}>{label}</span>
          <button className="btn btn-ghost btn-sm" type="button" onClick={props.onClose}>Close ✕</button>
        </div>
        <p>{item.prompt}</p>
        <dl className="kv">
          <dt>By</dt><dd>{item.owner.name}</dd>
          <dt>When</dt><dd>{new Date(item.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</dd>
          {Object.entries(item.params).map(([k, v]) => (
            <Fragment key={k}><dt>{k.replace(/_/g, " ")}</dt><dd>{String(v) || "—"}</dd></Fragment>
          ))}
          {item.hasInputImage && (<><dt>Input</dt><dd>from image</dd></>)}
        </dl>
        <div className="side-actions">
          <a className="btn btn-primary" href={`${out.url}?download=1`}>Download</a>
          <button className="btn" type="button" onClick={props.onReuse}>Reuse prompt</button>
          {out.type === "image" && props.canAnimate && (
            <button className="btn" type="button" onClick={() => props.onAnimate(index)}>Animate this</button>
          )}
          {props.canDelete && (
            <button className="btn btn-ghost btn-danger" type="button" onClick={props.onDelete}>Delete</button>
          )}
        </div>
      </aside>
    </div>
  );
}

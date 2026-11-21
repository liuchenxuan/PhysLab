import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_REPO, cmpVersion, loadMarket, loadPluginCode, type MarketResult } from "../plugins/market";
import { checkManifest, evaluatePlugin, pluginManager } from "../plugins/manager";
import type { InstalledPlugin, MarketItem, PluginCategory, PluginKind, PluginManifest } from "../plugins/types";
import "./market.css";

const KIND_LABEL: Record<PluginKind, string> = {
  module: "模块", chart: "图表", variable: "变量与公式", result: "结果", ai: "AI",
};
const CAT_LABEL: Record<PluginCategory, string> = { official: "Official", users: "Users" };

type Tab = "all" | PluginCategory | "installed";
interface Row { m: PluginManifest; item?: MarketItem; inst?: InstalledPlugin }

export default function Market() {
  useSyncExternalStore(pluginManager.subscribe, pluginManager.getSnapshot);
  const [repo, setRepo] = useState(pluginManager.getRepo() || DEFAULT_REPO);
  const [data, setData] = useState<MarketResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [kind, setKind] = useState<PluginKind | "">("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showSet, setShowSet] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (r: string) => {
    setLoading(true);
    try { setData(await loadMarket(r)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(repo); /* eslint-disable-next-line */ }, []);

  const flash = (ok: boolean, text: string) => setMsg({ ok, text });

  const rows: Row[] = useMemo(() => {
    const map = new Map<string, Row>();
    (data?.items || []).forEach((it) => map.set(it.id, { m: it, item: it }));
    pluginManager.list().forEach((p) => {
      const r = map.get(p.manifest.id);
      if (r) r.inst = p; else map.set(p.manifest.id, { m: p.manifest, inst: p });
    });
    return [...map.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pluginManager.getSnapshot()]);

  const shown = rows.filter((r) => {
    if (tab === "installed" && !r.inst) return false;
    if ((tab === "official" || tab === "users") && r.m.category !== tab) return false;
    if (kind && !r.m.kinds.includes(kind)) return false;
    const s = q.trim().toLowerCase();
    return !s || [r.m.name, r.m.id, r.m.description, r.m.author, ...(r.m.tags || [])].join(" ").toLowerCase().includes(s);
  });

  const count = (t: Tab) => rows.filter((r) => t === "all" ? true : t === "installed" ? !!r.inst : r.m.category === t).length;

  async function install(r: Row) {
    if (!r.item) return;
    setBusy(r.m.id);
    try {
      const code = await loadPluginCode(r.item, repo);
      const { origin: _o, bundledVersion: _b, ...manifest } = r.item;
      pluginManager.install(manifest, code, r.item.origin === "remote" ? "online" : "bundled");
      flash(true, `已安装「${r.m.name}」 v${r.m.version}。重新加载后生效。`);
    } catch (e: any) { flash(false, `安装失败：${e.message || e}`); }
    setBusy(null);
  }

  function importCode(code: string, bundle?: Partial<PluginManifest>, source: "local" | "url" = "local") {
    const def = evaluatePlugin(code, "import");
    const manifest = checkManifest({ ...(def as Partial<PluginManifest>), ...(bundle || {}), category: "users" });
    pluginManager.install(manifest, code, source);
    flash(true, `已导入用户插件「${manifest.name}」 v${manifest.version}。重新加载后生效。`);
  }

  async function onFile(f: File) {
    try {
      const text = await f.text();
      if (/\.json$/i.test(f.name)) {
        const j = JSON.parse(text);
        if (!j.code) throw new Error("插件包 JSON 中缺少 code 字段（可用 plugin-template/pack.mjs 生成）");
        const { code, ...m } = j; importCode(code, m);
      } else importCode(text);
    } catch (e: any) { flash(false, `导入失败：${e.message || e}`); }
  }

  async function fromUrl() {
    const url = window.prompt("请输入插件 index.js 的地址（需允许跨域访问，如 raw.githubusercontent.com 链接）：");
    if (!url) return;
    setBusy("url");
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      importCode(await r.text(), undefined, "url");
    } catch (e: any) { flash(false, `从 URL 安装失败：${e.message || e}`); }
    setBusy(null);
  }

  function reload() {
    try { sessionStorage.setItem("physlab.reopen", "market"); } catch { /* ignore */ }
    location.reload();
  }

  const dirty = pluginManager.isDirty();

  return (
    <div className="mk">
      <div className="card mk-head">
        <div>
          <h2>插件市场</h2>
          <p className="muted">
            用插件扩展 PhysLab：新增模块（如电磁）、图表类型、变量与公式、修正 / 新增计算结果、增强 AI 功能。
          </p>
        </div>
        <div className="mk-actions">
          <button className="btn" onClick={() => refresh(repo)} disabled={loading}>{loading ? "刷新中…" : "刷新目录"}</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>导入本地插件</button>
          <button className="btn" onClick={fromUrl} disabled={busy === "url"}>从 URL 安装</button>
          <button className="btn" onClick={() => setShowSet((v) => !v)}>仓库设置</button>
          <input ref={fileRef} type="file" accept=".js,.json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        </div>
      </div>

      {showSet && (
        <div className="card mk-set">
          <label className="fld">
            <span>在线插件仓库地址（indexplugin 目录的 raw 地址，可换成镜像）</span>
            <input type="text" value={repo} onChange={(e) => setRepo(e.target.value)} spellCheck={false} />
          </label>
          <div className="mk-actions">
            <button className="btn pri" onClick={() => { pluginManager.setRepo(repo === DEFAULT_REPO ? "" : repo); refresh(repo); }}>保存并刷新</button>
            <button className="btn" onClick={() => { setRepo(DEFAULT_REPO); pluginManager.setRepo(""); refresh(DEFAULT_REPO); }}>恢复默认</button>
          </div>
          <p className="note">默认仓库：github.com/liuchenxuan/PhysLab-plugin。目录结构：<code>index.json</code> + <code>official/&lt;id&gt;/</code> + <code>users/&lt;id&gt;/</code>。</p>
        </div>
      )}

      {pluginManager.safeMode && <div className="banner bad">当前处于安全模式（地址含 ?safe）：所有插件均未加载。</div>}
      {dirty && (
        <div className="banner warn mk-reload">
          <span>插件有变更，需要重新加载程序才会生效。</span>
          <button className="btn pri mini" onClick={reload}>立即重新加载</button>
        </div>
      )}
      {data?.remoteError && (
        <div className="banner info">
          在线仓库暂时不可用（{data.remoteError}），当前显示随程序内置的插件。联网后点击“刷新目录”即可获取在线插件。
        </div>
      )}
      {msg && <div className={"banner " + (msg.ok ? "ok" : "bad")}>{msg.text}</div>}

      <div className="card">
        <div className="mk-bar">
          <div className="tabs mk-tabs">
            {([["all", "全部"], ["official", "Official 官方插件"], ["users", "Users 用户插件"], ["installed", "已安装"]] as [Tab, string][]).map(([t, l]) => (
              <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{l} <small>{count(t)}</small></button>
            ))}
          </div>
          <input className="mk-search" type="search" placeholder="搜索插件名称、作者、标签…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="chips mk-kinds">
          <button className={kind === "" ? "on" : ""} onClick={() => setKind("")}>全部类型</button>
          {(Object.keys(KIND_LABEL) as PluginKind[]).map((k) => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(kind === k ? "" : k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>

        <div className="mk-grid">
          {shown.map((r) => <PluginCard key={r.m.id} row={r} busy={busy === r.m.id} onInstall={() => install(r)} />)}
          {!shown.length && <p className="muted mk-empty">{loading ? "正在加载插件目录…" : "没有符合条件的插件。"}</p>}
        </div>
      </div>

      <details className="card mk-dev">
        <summary>开发者：如何编写并发布插件</summary>
        <ol>
          <li>复制仓库中的 <code>plugin-template/</code> 文件夹，改名为你的插件 id。</li>
          <li>编辑 <code>plugin.json</code>（元信息）与 <code>index.js</code>（调用 <code>PhysLab.definePlugin</code>）。</li>
          <li>在本页“导入本地插件”选择 <code>index.js</code> 即可本地调试；修改后重新导入并重新加载。</li>
          <li>发布：向 <code>PhysLab-plugin</code> 仓库的 <code>indexplugin/users/&lt;id&gt;/</code> 提交 PR，并在 <code>index.json</code> 登记。</li>
          <li>完整 API 与示例见 <code>docs/PLUGIN_DEVELOPMENT.md</code>；用 AI 生成插件请把 <code>docs/skills/physlab-plugin-skill.md</code> 提供给它。</li>
        </ol>
      </details>
    </div>
  );
}

function PluginCard({ row, busy, onInstall }: { row: Row; busy: boolean; onInstall: () => void }) {
  const { m, item, inst } = row;
  const st = inst ? pluginManager.statusOf(m.id) : null;
  const upd = !!(inst && item && cmpVersion(item.version, inst.manifest.version) > 0);

  return (
    <article className={"mk-card" + (inst ? " installed" : "")}>
      <header>
        <h4>{m.name}</h4>
        <span className={"mk-cat " + m.category}>{CAT_LABEL[m.category]}</span>
      </header>
      <div className="mk-meta">
        v{inst ? inst.manifest.version : m.version} · {m.author}
        {item && <> · {item.origin === "remote" ? "在线" : "内置"}</>}
        {!item && inst && <> · 本地导入</>}
      </div>
      <p className="mk-desc">{m.description}</p>
      <div className="mk-tags">
        {m.kinds.map((k) => <span key={k} className="mk-kind">{KIND_LABEL[k]}</span>)}
        {(m.tags || []).map((t) => <span key={t} className="mk-tag">#{t}</span>)}
      </div>

      {st && (
        <div className="mk-status">
          {st.state === "active" && <span className="badge ok">运行中</span>}
          {st.state === "pending" && <span className="badge info">待重新加载</span>}
          {st.state === "disabled" && <span className="badge warn">{st.error || "已停用"}</span>}
          {st.state === "error" && <span className="badge bad">加载失败</span>}
          {inst && !inst.enabled && st.state !== "disabled" && <span className="badge warn">将停用</span>}
          {st.state === "error" && <div className="mk-err">{st.error}</div>}
          {st.state === "active" && st.contributions.length > 0 && (
            <details><summary>提供 {st.contributions.length} 项功能</summary>
              <ul>{st.contributions.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      <footer>
        {!inst && item && <button className="btn pri mini" disabled={busy} onClick={onInstall}>{busy ? "安装中…" : "安装"}</button>}
        {upd && <button className="btn pri mini" disabled={busy} onClick={onInstall}>更新到 v{item!.version}</button>}
        {inst && <button className="btn mini" onClick={() => pluginManager.setEnabled(m.id, !inst.enabled)}>{inst.enabled ? "停用" : "启用"}</button>}
        {inst && <button className="btn mini red" onClick={() => { if (window.confirm(`卸载「${m.name}」？使用该插件模块的配置会被保留，重新安装后自动恢复。`)) pluginManager.uninstall(m.id); }}>卸载</button>}
        {m.homepage && <a className="btn mini" href={m.homepage} target="_blank" rel="noreferrer">主页</a>}
      </footer>
    </article>
  );
}

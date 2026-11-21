/**
 * 插件管理器：安装 / 卸载 / 启停 / 激活。
 * 约定：已安装插件的源码保存在 localStorage，应用启动时在内核 init() 之前同步激活，
 * 因此插件的增删需要“重新加载”才会反映到界面（市场页会给出提示）。
 */
import { createApi } from "./api";
import {
  HOST_API_VERSION,
  type InstallSource,
  type InstalledPlugin,
  type PluginDefinition,
  type PluginManifest,
  type RuntimeStatus,
} from "./types";

const KEY = "physlab.plugins.v1";

interface Store { installed: Record<string, InstalledPlugin>; repo?: string }

function readStore(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && typeof s === "object" && s.installed) return s;
  } catch { /* ignore */ }
  return { installed: {} };
}

/** 解析插件源码，取出 PhysLab.definePlugin({...}) 里的定义（不执行 activate） */
export function evaluatePlugin(code: string, id = "plugin"): PluginDefinition {
  let def: PluginDefinition | null = null;
  const PhysLab = {
    apiVersion: HOST_API_VERSION,
    definePlugin: (d: PluginDefinition) => { def = d; },
  };
  // eslint-disable-next-line no-new-func
  new Function("PhysLab", `${code}\n//# sourceURL=physlab-plugin-${id}.js`)(PhysLab);
  if (!def || typeof (def as PluginDefinition).activate !== "function") {
    throw new Error("插件源码必须调用 PhysLab.definePlugin({ ..., activate(api) {} })");
  }
  return def;
}

export function checkManifest(m: Partial<PluginManifest>): PluginManifest {
  const miss = ["id", "name", "version"].filter((k) => !(m as any)[k]);
  if (miss.length) throw new Error(`缺少必要字段：${miss.join("、")}`);
  if (!/^[a-z][a-z0-9-]*$/.test(m.id!)) throw new Error("id 只能由小写字母、数字、连字符组成，且以字母开头");
  const major = String(m.apiVersion || HOST_API_VERSION).split(".")[0];
  if (major !== HOST_API_VERSION.split(".")[0]) {
    throw new Error(`插件要求 API ${m.apiVersion}，当前程序提供 API ${HOST_API_VERSION}，不兼容`);
  }
  return {
    id: m.id!, name: m.name!, version: String(m.version), author: m.author || "未知",
    category: m.category === "official" ? "official" : "users",
    description: m.description || "", kinds: m.kinds || [], tags: m.tags || [],
    apiVersion: m.apiVersion || HOST_API_VERSION, homepage: m.homepage, license: m.license, path: m.path, entry: m.entry,
  };
}

type Listener = () => void;

class PluginManager {
  private store: Store = readStore();
  private status: Record<string, RuntimeStatus> = {};
  private session: InstalledPlugin[] = [];       // 导出网页内嵌的临时插件（不写入 localStorage）
  private listeners = new Set<Listener>();
  private snapshot = 0;
  /** 本次启动后插件集合是否发生变化（需要重新加载） */
  private dirty = false;
  safeMode = /[?#&]safe\b/.test(location.search + location.hash);

  subscribe = (l: Listener) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  getSnapshot = () => this.snapshot;
  private emit() { this.snapshot++; this.listeners.forEach((l) => l()); }

  list(): InstalledPlugin[] { return Object.values(this.store.installed); }
  get(id: string) { return this.store.installed[id]; }
  statusOf(id: string): RuntimeStatus {
    return this.status[id] || { state: this.store.installed[id]?.enabled ? "pending" : "disabled", contributions: [] };
  }
  isDirty() { return this.dirty; }
  getRepo(): string | undefined { return this.store.repo; }
  setRepo(url: string) { this.store.repo = url || undefined; this.save(); this.emit(); }

  private save() { localStorage.setItem(KEY, JSON.stringify(this.store)); }

  install(manifest: PluginManifest, code: string, source: InstallSource) {
    const m = checkManifest(manifest);
    evaluatePlugin(code, m.id); // 先做一次语法 / 结构校验，失败则不安装
    const old = this.store.installed[m.id];
    this.store.installed[m.id] = { manifest: m, code, enabled: old ? old.enabled : true, installedAt: Date.now(), source };
    this.save(); this.dirty = true; this.emit();
  }
  uninstall(id: string) { delete this.store.installed[id]; this.save(); this.dirty = true; this.emit(); }
  setEnabled(id: string, on: boolean) {
    const p = this.store.installed[id]; if (!p) return;
    p.enabled = on; this.save(); this.dirty = true; this.emit();
  }

  /** 供“导出本配置网页”内嵌：只带启用的插件 */
  exportList() {
    return this.list().filter((p) => p.enabled).map((p) => ({ manifest: p.manifest, code: p.code }));
  }

  /** 在内核 init() 之前调用：同步激活全部已启用插件 */
  activateAll = (core: any) => {
    try {
      const emb = JSON.parse(document.getElementById("embedded-config")?.textContent || "null");
      if (emb && Array.isArray(emb._plugins)) {
        emb._plugins.forEach((p: any) => {
          if (p && p.manifest && p.code && !this.store.installed[p.manifest.id]) {
            this.session.push({ manifest: p.manifest, code: p.code, enabled: true, installedAt: 0, source: "local" });
          }
        });
      }
    } catch { /* ignore */ }

    const all = [...this.list(), ...this.session];
    for (const p of all) {
      const id = p.manifest.id;
      if (this.safeMode) { this.status[id] = { state: "disabled", error: "安全模式：未加载", contributions: [] }; continue; }
      if (!p.enabled) { this.status[id] = { state: "disabled", contributions: [] }; continue; }
      const { api, contributions, rollback } = createApi(core, p.manifest);
      try {
        const def = evaluatePlugin(p.code, id);
        def.activate(api);
        this.status[id] = { state: "active", contributions };
      } catch (e: any) {
        rollback();
        this.status[id] = { state: "error", error: String(e?.message || e), contributions: [] };
        console.error(`[PhysLab] 插件 ${id} 激活失败`, e);
      }
    }
    this.emit();
  };
}

export const pluginManager = new PluginManager();

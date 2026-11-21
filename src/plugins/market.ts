/**
 * 插件市场数据源。
 *  - 在线：https://github.com/liuchenxuan/PhysLab-plugin 仓库 indexplugin/ 目录（通过 raw.githubusercontent.com 读取）
 *  - 内置：本仓库 indexplugin/ 目录（构建时打包进程序，离线可用）
 * 两个来源的目录结构完全相同：index.json + <official|users>/<id>/{plugin.json,index.js}
 */
import { checkManifest } from "./manager";
import type { MarketItem, PluginManifest } from "./types";

export const DEFAULT_REPO =
  "https://raw.githubusercontent.com/liuchenxuan/PhysLab-plugin/main/indexplugin";

const bundledFiles = import.meta.glob("/indexplugin/**/*.{json,js}", {
  query: "?raw", import: "default", eager: true,
}) as Record<string, string>;

const bundled = (rel: string) => bundledFiles[`/indexplugin/${rel}`];

function parseIndex(text: string): PluginManifest[] {
  const j = JSON.parse(text);
  const list = Array.isArray(j) ? j : j.plugins;
  if (!Array.isArray(list)) throw new Error("index.json 格式错误：缺少 plugins 数组");
  const out: PluginManifest[] = [];
  for (const m of list) {
    try { out.push(checkManifest(m)); } catch (e) { console.warn("忽略无效的索引条目", m, e); }
  }
  return out;
}

async function fetchText(url: string, ms = 9000): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}

const vnum = (v: string) => v.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
export function cmpVersion(a: string, b: string) {
  const x = vnum(a), y = vnum(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export interface MarketResult { items: MarketItem[]; remoteError?: string; repo: string }

export async function loadMarket(repo: string): Promise<MarketResult> {
  const map = new Map<string, MarketItem>();
  try {
    parseIndex(bundled("index.json") || "[]").forEach((m) => map.set(m.id, { ...m, origin: "bundled" }));
  } catch (e) { console.warn("内置索引解析失败", e); }

  let remoteError: string | undefined;
  try {
    const list = parseIndex(await fetchText(`${repo.replace(/\/+$/, "")}/index.json`));
    for (const m of list) {
      const b = map.get(m.id);
      if (!b || cmpVersion(m.version, b.version) >= 0) {
        map.set(m.id, { ...m, origin: "remote", bundledVersion: b?.version });
      } else {
        map.set(m.id, { ...b, bundledVersion: b.version });
      }
    }
  } catch (e: any) {
    remoteError = e?.name === "AbortError" ? "连接超时" : String(e?.message || e);
  }
  const items = [...map.values()].sort((a, b) =>
    a.category === b.category ? a.name.localeCompare(b.name, "zh") : a.category === "official" ? -1 : 1);
  return { items, remoteError, repo };
}

/** 取得插件源码：在线条目走网络，内置条目直接取打包文件 */
export async function loadPluginCode(item: MarketItem, repo: string): Promise<string> {
  const dir = item.path || `${item.category}/${item.id}`;
  const file = `${dir}/${item.entry || "index.js"}`;
  if (item.origin === "bundled") {
    const c = bundled(file);
    if (!c) throw new Error(`内置包中缺少 ${file}`);
    return c;
  }
  return fetchText(`${repo.replace(/\/+$/, "")}/${file}`);
}

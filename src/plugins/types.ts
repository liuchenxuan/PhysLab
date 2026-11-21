/** 插件市场与插件运行时共用的类型定义 */

export type PluginCategory = "official" | "users";
export type PluginKind = "module" | "chart" | "variable" | "result" | "ai";

/** 宿主 API 主版本号：插件 manifest.apiVersion 的主版本必须与它一致 */
export const HOST_API_VERSION = "1.0";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  category: PluginCategory;
  description: string;
  /** 插件涉及的功能范畴，用于市场筛选 */
  kinds: PluginKind[];
  tags?: string[];
  apiVersion: string;
  homepage?: string;
  license?: string;
  /** 在市场仓库 indexplugin/ 下的相对目录，如 official/electromagnetism */
  path?: string;
  /** 入口文件名，默认 index.js */
  entry?: string;
}

export type InstallSource = "online" | "bundled" | "local" | "url";

export interface InstalledPlugin {
  manifest: PluginManifest;
  code: string;
  enabled: boolean;
  installedAt: number;
  source: InstallSource;
}

export interface MarketItem extends PluginManifest {
  /** remote = 来自在线仓库；bundled = 随程序内置的离线副本 */
  origin: "remote" | "bundled";
  /** 同一个 id 同时存在内置副本时记录其版本 */
  bundledVersion?: string;
}

export type RuntimeState = "active" | "error" | "disabled" | "pending";

export interface RuntimeStatus {
  state: RuntimeState;
  error?: string;
  /** 本次启动该插件注册的内容，例如 “模块：em-particle” */
  contributions: string[];
}

export interface PluginDefinition extends Partial<PluginManifest> {
  activate: (api: any) => void;
  deactivate?: () => void;
}

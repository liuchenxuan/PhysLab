import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import bodyHtml from "./core/body.html?raw";
import "./core/legacy.css";
import bootPhysLab from "./core/physlab.js";
import Market from "./market/Market";
import { pluginManager } from "./plugins/manager";

/**
 * 原 PhysLab 界面的静态标记。内核（src/core/physlab.js）直接操作这些 DOM，
 * 所以必须只渲染一次、永不由 React 重新协调。
 */
const LegacyShell = memo(
  () => <div id="physlab-shell" dangerouslySetInnerHTML={{ __html: bodyHtml }} />,
  () => true,
);

let booted = false;

export default function App() {
  const [marketEl, setMarketEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (booted) return;
    booted = true;
    const host: any = {
      pristineHtml: (window as any).__PHYSLAB_PRISTINE__,
      beforeInit: (core: unknown) => pluginManager.activateAll(core),
      exportPlugins: () => pluginManager.exportList(),
    };
    bootPhysLab(host);
    setMarketEl(document.getElementById("market-root"));

    // 安装 / 卸载插件后重新加载：回到插件市场页
    try {
      if (sessionStorage.getItem("physlab.reopen") === "market") {
        sessionStorage.removeItem("physlab.reopen");
        host.core.helpers.showView("market");
      }
    } catch { /* ignore */ }
  }, []);

  return (
    <>
      <LegacyShell />
      {marketEl && createPortal(<Market />, marketEl)}
    </>
  );
}

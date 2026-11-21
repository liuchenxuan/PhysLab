import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// “导出本配置网页”需要页面最初的源码：必须在任何 DOM 变更之前保存
(window as unknown as { __PHYSLAB_PRISTINE__: string }).__PHYSLAB_PRISTINE__ =
  document.documentElement.outerHTML;

// 内核直接操作 DOM，不使用 StrictMode（避免开发模式下重复初始化）
createRoot(document.getElementById("root")!).render(<App />);

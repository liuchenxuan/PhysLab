/**
 * 受控的插件 API。
 * 插件只通过 activate(api) 拿到这个对象，不应直接修改内核的 MODELS / CHARTS 等表。
 * 所有注册项都会被记录，激活失败时自动回滚。
 */
import { HOST_API_VERSION, type PluginManifest } from "./types";

type Undo = () => void;
interface Scoped { api: any; contributions: string[]; rollback: () => void }

export function createApi(core: any, manifest: PluginManifest): Scoped {
  const { PL, MODELS, CHARTS, METRICS, CHAT_QUICK, AI, PROMPTS } = core;
  const owner = manifest.id;
  const undo: Undo[] = [];
  const contributions: string[] = [];
  const note = (s: string) => contributions.push(s);

  const addTo = <T,>(arr: T[], item: T) => {
    arr.push(item);
    undo.push(() => { const i = arr.indexOf(item); if (i >= 0) arr.splice(i, 1); });
  };
  const hook = (name: string, fn: (...a: any[]) => any) => {
    if (typeof fn !== "function") throw new Error(`钩子 ${name} 需要函数`);
    undo.push(PL.on(owner, name, fn));
  };
  const scopedList = (list: any[], what: string) => (fn: (...a: any[]) => any, opt?: { models?: string | string[] }) => {
    if (typeof fn !== "function") throw new Error(`${what} 需要函数`);
    addTo(list, { owner, fn, models: opt && opt.models });
    note(what);
  };

  const storageKey = (k: string) => `physlab.plugin.${owner}.${k}`;

  const api = {
    apiVersion: HOST_API_VERSION,
    manifest,
    /** 内核对象（高级用法）：Expr、COMMON_PARAMS、COL、helpers…… */
    core,
    helpers: core.helpers,
    kit: PL.kit,
    log: (...a: unknown[]) => console.log(`[PhysLab 插件 ${owner}]`, ...a),
    storage: {
      get: (k: string, d?: unknown) => { try { const v = localStorage.getItem(storageKey(k)); return v == null ? d : JSON.parse(v); } catch { return d; } },
      set: (k: string, v: unknown) => localStorage.setItem(storageKey(k), JSON.stringify(v)),
      remove: (k: string) => localStorage.removeItem(storageKey(k)),
    },

    /* ① 模块 */
    models: {
      register(def: any) {
        const M = PL.registerModel(owner, def);
        undo.push(() => { delete MODELS[M.id]; });
        note(`模块：${M.id}`);
        return M;
      },
      extend(id: string, patch: any) {
        const M = MODELS[id];
        const before = M && { build: M.build, params: M.params.length, presets: M.presets.length };
        PL.extendModel(owner, id, patch);
        undo.push(() => { if (!M) return; M.build = before.build; M.params.splice(before.params); M.presets.splice(before.presets); });
        note(`扩展模块：${id}`);
      },
      get: (id: string) => MODELS[id],
      list: () => Object.keys(MODELS),
    },

    /* ② 图表 */
    charts: {
      register(def: any) {
        PL.registerChart(owner, def);
        undo.push(() => { const i = CHARTS.indexOf(def); if (i >= 0) CHARTS.splice(i, 1); });
        note(`图表：${def.id}`);
      },
    },

    /* ③ 变量与公式 */
    variables: {
      register(def: any) {
        const v = PL.registerVariable(owner, def);
        undo.push(() => {
          let i = PL.vars.indexOf(v); if (i >= 0) PL.vars.splice(i, 1);
          i = CHARTS.findIndex((c: any) => c.id === "var_" + v.key); if (i >= 0) CHARTS.splice(i, 1);
          i = METRICS.findIndex((m: any) => m.id === "v_" + v.key); if (i >= 0) METRICS.splice(i, 1);
        });
        note(`变量：${v.key}`);
      },
    },
    metrics: {
      register(def: any) {
        if (!def || !def.id || typeof def.f !== "function") throw new Error("metric 需要 { id, name, unit, f(sim) }");
        if (METRICS.some((m: any) => m.id === def.id)) throw new Error(`指标 id「${def.id}」已存在`);
        addTo(METRICS, Object.assign({ unit: "", plugin: owner }, def));
        note(`扫描指标：${def.id}`);
      },
    },

    /* ④ 计算结果 */
    results: {
      /** fn(sim) => [[label, value], ...] 追加结果行 */
      add: scopedList(PL.extraRows, "新增结果"),
      /** fn(rows, sim) => rows 修正（改写 / 删除 / 重排）已有结果行 */
      transform: scopedList(PL.rowFilters, "修正结果"),
    },
    checks: { add: scopedList(PL.checkFns, "新增校验") },
    solution: {
      add: scopedList(PL.solAdds, "新增解题步骤"),
      transform: scopedList(PL.solFilters, "修正解题步骤"),
    },
    simulation: {
      /** 模拟前修改输入 P（可修正参数） */
      before: (fn: any) => { hook("beforeSimulate", fn); note("模拟前钩子"); },
      /** 模拟后修改 sim（修正 summary / 状态 / 过程描述） */
      after: (fn: any) => { hook("afterSimulate", fn); note("模拟后钩子"); },
      onChange: (fn: any) => { hook("configChanged", fn); },
    },

    /* ⑤ AI */
    ai: {
      addTool(def: any) { PL.addAITool(owner, def); undo.push(() => { const i = PL.aiTools.findIndex((t: any) => t.id === def.id && t.owner === owner); if (i >= 0) PL.aiTools.splice(i, 1); }); note(`AI 工具：${def.id}`); },
      addPrompt(id: string, def: any) { PL.addPrompt(owner, id, def); undo.push(() => { delete PROMPTS[id]; }); note(`提示词：${id}`); },
      /** 修改已有提示词：fn(text, ctx) => 新文本；也可传 { prepend, append } */
      extendPrompt(id: string, patch: any) {
        const fn = typeof patch === "function" ? patch : (t: string) => (patch.prepend || "") + t + (patch.append || "");
        PL.patchPrompt(owner, id, fn);
        undo.push(() => { const l = PL.promptPatches[id] || []; const i = l.findIndex((p: any) => p.fn === fn); if (i >= 0) l.splice(i, 1); });
        note(`修改提示词：${id}`);
      },
      addProvider(key: string, preset: any) { PL.addProvider(owner, key, preset); undo.push(() => { delete AI.PRESETS[key]; }); note(`AI 供应商：${key}`); },
      addQuickQuestion(q: string) { addTo(CHAT_QUICK, q); note("AI 对话快捷问题"); },
      /** fn(sim) => 对象：把插件算出的数据附加进发给 AI 的“模拟摘要” */
      addContext: scopedList(PL.digestFns, "AI 上下文"),
      onRequest: (fn: any) => { hook("aiRequest", fn); note("AI 请求钩子"); },
      onResponse: (fn: any) => { hook("aiResponse", fn); note("AI 响应钩子"); },
      call: (o: any) => core.helpers.callAI(o),
      run: (o: any) => core.helpers.runAI(o),
    },

    /* ⑥ 界面 */
    ui: {
      addInfoTab(def: any) { PL.addInfoTab(owner, def); undo.push(() => { const i = PL.infoTabs.findIndex((t: any) => t.id === def.id && t.owner === owner); if (i >= 0) PL.infoTabs.splice(i, 1); }); note(`分析选项卡：${def.id}`); },
      toast: core.helpers.toast,
      onReady: (fn: any) => hook("ready", fn),
    },
  };

  return { api, contributions, rollback: () => { while (undo.length) { try { undo.pop()!(); } catch { /* ignore */ } } } };
}

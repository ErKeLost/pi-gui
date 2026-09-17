import { useMemo, useReducer } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  listProviderProfiles,
  probeProviderModels,
  saveProvider,
  syncProviderModels,
  queryClient,
  connect,
  disconnect,
  request,
  refresh,
  persistDefaultModel,
  type ProviderModel,
  type ProviderProfile,
} from "../lib/rpc";
import { report } from "../lib/rpc";
import { Button, Input, Select, Switch, Disclosure, Skeleton } from "./UI";
import { useWorkspace } from "../lib/store";
import { ModelLogo, ModelModalities } from "./ModelMeta";
import { formatContextLength, modelDisplayName, modelModalities } from "../lib/model-meta";
import { gooeyToast } from "goey-toast";
import { Icon } from "./Icon";

const apiTypes = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "azure-openai-responses",
  "mistral-conversations",
] as const;

const presets = [
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", api: "openai-completions" },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", api: "openai-completions" },
  { id: "anthropic", name: "Anthropic / Claude", baseUrl: "https://api.anthropic.com/v1", api: "anthropic-messages" },
] as const;

const display = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "接口未返回";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "接口返回空数组";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
};

function ModelDetails({ model, onUse, disabled }: { model: ProviderModel; onUse: () => void; disabled: boolean }) {
  const inputs = modelModalities(model, "input");
  const outputs = modelModalities(model, "output");
  return (
    <div className="provider-model-details">
      <dl className="provider-meta-grid">
        <div><dt>ID</dt><dd>{display(model.id)}</dd></div>
        <div><dt>名称</dt><dd>{display(modelDisplayName(model))}</dd></div>
        <div><dt>上下文长度</dt><dd>{display(model.context_length ?? model.context_window)}</dd></div>
        <div><dt>最大输出</dt><dd>{display(model.max_output_tokens ?? model.max_tokens)}</dd></div>
        <div><dt>输入类型</dt><dd>{display(inputs)}</dd></div>
        <div><dt>输出类型</dt><dd>{display(outputs)}</dd></div>
        <div><dt>端点类型</dt><dd>{display(model.supported_endpoint_types)}</dd></div>
        <div><dt>Thinking / reasoning</dt><dd>{display(model.reasoning)}</dd></div>
        <div><dt>支持参数</dt><dd>{display(model.supported_parameters)}</dd></div>
        <div><dt>价格</dt><dd>{display(model.pricing)}</dd></div>
      </dl>
      <Button className="secondary provider-use-model" disabled={disabled} onClick={onUse}>使用此模型</Button>
      <Disclosure title="接口原始元数据">
        <pre className="provider-raw-metadata">{JSON.stringify(model, null, 2)}</pre>
      </Disclosure>
    </div>
  );
}

export function ProviderSettings() {
  const profiles = useQuery({ queryKey: ["provider-profiles"], queryFn: listProviderProfiles, staleTime: 10_000 });
  const first = profiles.data?.[0];
  return <ProviderSettingsEditor key={first?.id ?? "new-provider"} profiles={profiles} initialProfile={first} />;
}

type ProviderFormState = {
  provider: string;
  name: string;
  baseUrl: string;
  modelsUrl: string;
  api: (typeof apiTypes)[number];
  apiKey: string;
  authHeader: boolean;
  models: ProviderModel[];
  search: string;
  busy: "save" | "probe" | "use" | null;
};

function initialForm(profile?: ProviderProfile): ProviderFormState {
  return {
    provider: profile?.id ?? "",
    name: profile?.name ?? "",
    baseUrl: profile?.baseUrl ?? "",
    modelsUrl: profile?.modelsUrl ?? "",
    api: (profile?.api as (typeof apiTypes)[number]) || "openai-completions",
    apiKey: "",
    authHeader: profile?.authHeader !== false,
    models: [],
    search: "",
    busy: null,
  };
}

function ProviderSettingsEditor({ profiles, initialProfile }: { profiles: UseQueryResult<ProviderProfile[]>; initialProfile?: ProviderProfile }) {
  const cwd = useWorkspace((state) => state.cwd);
  const online = useWorkspace((state) => state.connection === "online");
  const running = useWorkspace((state) => state.transcript.running);
  const [form, update] = useReducer((state: ProviderFormState, patch: Partial<ProviderFormState>) => ({ ...state, ...patch }), initialProfile, initialForm);
  const { provider, name, baseUrl, modelsUrl, api, apiKey, authHeader, models, search, busy } = form;

  const selected = profiles.data?.find((item) => item.id === provider);
  function selectProvider(id: string) {
    const profile = profiles.data?.find((item) => item.id === id);
    update(profile ? { ...initialForm(profile), provider: id } : { provider: id, models: [] });
  }

  function newProvider() {
    update(initialForm());
  }

  function applyPreset(preset: (typeof presets)[number]) {
    update({ ...initialForm(), provider: preset.id, name: preset.name, baseUrl: preset.baseUrl, modelsUrl: `${preset.baseUrl}/models`, api: preset.api });
    gooeyToast.info(`已填入 ${preset.name} 官方端点`, { showTimestamp: false });
  }

  async function save() {
    update({ busy: "save" });
    try {
      const result = await saveProvider({ provider: provider.trim(), name: name.trim() || undefined, baseUrl: baseUrl.trim(), modelsUrl: modelsUrl.trim() || undefined, api, apiKey: apiKey.trim() || undefined, authHeader });
      update({ provider: result.id, apiKey: "" });
      let synced: Awaited<ReturnType<typeof syncProviderModels>>;
      try {
        synced = await syncProviderModels(result.id);
      } catch (syncError) {
        throw new Error(`Provider 已保存，但同步到 Pi 失败：${syncError instanceof Error ? syncError.message : String(syncError)}`);
      }
      let switchedModel: { provider: string; id: string } | null = null;
      try {
        if (online) await disconnect();
        await connect(cwd);
        const available = await request<{ models: { provider: string; id: string }[] }>({ type: "get_available_models" }, 30_000, cwd);
        const firstModel = available.models.find((model) => model.provider === result.id && model.id === synced.firstModelId)
          ?? available.models.find((model) => model.provider === result.id);
        if (firstModel) {
          await request({ type: "set_model", provider: firstModel.provider, modelId: firstModel.id }, 30_000, cwd);
          const current = await refresh(cwd);
          if (current.model?.provider !== firstModel.provider || current.model?.id !== firstModel.id) {
            throw new Error(`Pi 仍在使用 ${current.model?.provider ?? "未知 Provider"}/${current.model?.id ?? "未知模型"}`);
          }
          await persistDefaultModel(firstModel.provider, firstModel.id);
          switchedModel = firstModel;
        } else {
          throw new Error(`Pi 没有加载 ${result.id} 的可用模型`);
        }
      } catch (activationError) {
        gooeyToast.warning("模型已同步，但暂时无法切换", { description: activationError instanceof Error ? activationError.message : String(activationError), showTimestamp: false });
      }
      gooeyToast.success("已保存并同步到 Pi", { description: switchedModel ? `${synced.count} 个模型 · 已切换到 ${switchedModel.id}` : `${synced.count} 个模型已写入 Pi`, showTimestamp: false });
      await queryClient.invalidateQueries({ queryKey: ["pi", "models", cwd] });
      await profiles.refetch();
    } catch (error) { report(error); } finally { update({ busy: null }); }
  }

  async function probe() {
    update({ busy: "probe" });
    try {
      const catalog = await probeProviderModels(provider.trim(), baseUrl.trim(), api, apiKey.trim() || undefined, authHeader, modelsUrl.trim() || undefined);
      const next = Array.isArray(catalog.data) ? catalog.data : [];
      update({ models: next }); gooeyToast.success(`已加载 ${next.length} 个模型`, { description: "模型目录已更新", showTimestamp: false });
    } catch (error) { report(error); } finally { update({ busy: null }); }
  }

  async function applyModel(model: ProviderModel) {
    update({ busy: "use" });
    try {
      await saveProvider({ provider: provider.trim(), name: name.trim() || undefined, baseUrl: baseUrl.trim(), modelsUrl: modelsUrl.trim() || undefined, api, apiKey: apiKey.trim() || undefined, authHeader });
      await syncProviderModels(provider.trim());
      if (online) await disconnect();
      await connect(cwd);
      await request({ type: "set_model", provider: provider.trim(), modelId: model.id }, 30_000, cwd);
      const current = await refresh(cwd);
      if (current.model?.provider !== provider.trim() || current.model?.id !== model.id) throw new Error("Pi 没有确认模型切换");
      await persistDefaultModel(provider.trim(), model.id);
      update({ apiKey: "" }); gooeyToast.success("模型已切换", { description: `${provider.trim()} / ${model.id}`, showTimestamp: false });
      await profiles.refetch();
    } catch (error) { report(error); } finally { update({ busy: null }); }
  }

  const visibleModels = useMemo(() => models.filter((model) => `${model.id} ${modelDisplayName(model)}`.toLowerCase().includes(search.toLowerCase())), [models, search]);
  return (
    <section className="settings-section provider-settings">
      <header className="provider-settings-heading">
        <div className="provider-heading-copy"><span className="provider-heading-icon"><Icon name="plugs-connected" /></span><div><h2>Provider 配置</h2><p>连接模型服务，并把模型目录直接写入 Pi。</p></div></div>
        <span className={`provider-config-state ${selected ? "saved" : "draft"}`}><i />{selected ? "已保存配置" : "新配置"}</span>
      </header>
      <div className="provider-profile-bar">
        <div className="provider-profile-picker"><span>当前配置</span><Select aria-label="已保存 Provider" value={provider} onChange={(event) => selectProvider(event.target.value)}>
         <option value="">新 Provider</option>
         {(profiles.data ?? []).map((item: ProviderProfile) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
        </Select></div>
        <Button className="secondary provider-new-button" onClick={newProvider}><Icon name="plus" />新建 Provider</Button>
      </div>
      {profiles.isLoading && <Skeleton active paragraph={{ rows: 2 }} />}
      <div className="provider-preset-strip"><span>快速填充</span><div className="provider-preset-row">{presets.map((preset) => <Button key={preset.id} className="secondary" onClick={() => applyPreset(preset)}>{preset.name}<Icon name="arrow-down-right" /></Button>)}</div></div>
      <div className="provider-editor">
       <section className="provider-form-section"><header><span>01</span><div><h3>标识</h3><p>用于 Pi 配置和模型选择器。</p></div></header><div className="provider-form-grid">
        <label>Provider ID<Input value={provider} onChange={(event) => update({ provider: event.target.value })} placeholder="例如 my-gateway" /></label>
        <label>显示名称<Input value={name} onChange={(event) => update({ name: event.target.value })} placeholder="例如 Team Gateway" /></label>
       </div></section>
       <section className="provider-form-section"><header><span>02</span><div><h3>接口</h3><p>填写兼容协议和模型目录地址。</p></div></header><div className="provider-form-grid">
        <label>Base URL<Input value={baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} placeholder="https://example.com/v1" /></label>
        <label>模型列表接口<Input value={modelsUrl} onChange={(event) => update({ modelsUrl: event.target.value })} placeholder="留空则使用 Base URL/models" /></label>
        <label className="provider-form-wide">API 类型<Select value={api} onChange={(event) => update({ api: event.target.value as (typeof apiTypes)[number] })}>{apiTypes.map((item) => <option key={item} value={item}>{item}</option>)}</Select></label>
       </div></section>
       <section className="provider-form-section"><header><span>03</span><div><h3>凭据</h3><p>API Key 只写入本机 Pi 配置，不会回显。</p></div></header><div className="provider-credentials">
        <label>API Key<Input type="password" value={apiKey} onChange={(event) => update({ apiKey: event.target.value })} placeholder={selected?.hasApiKey ? "已保存，留空保持不变" : "输入服务商 API Key"} autoComplete="off" /></label>
        <div className="provider-auth-row"><div><strong>发送认证请求头</strong><p>关闭后，模型服务请求不会附带 API Key。</p></div><Switch aria-label="发送 API 认证请求头" checked={authHeader} onChange={(value) => update({ authHeader: value })} /><span className="provider-secret-state">{selected?.hasApiKey ? "凭据已保存" : "尚未保存凭据"}</span></div>
       </div></section>
       <footer className="provider-actions"><div className="provider-save-note"><Icon name="arrows-clockwise"/><span>保存会更新 Pi 模型配置并重新连接当前项目。</span></div><div><Button className="secondary" disabled={!!busy || !provider.trim() || !baseUrl.trim()} onClick={() => void probe()}>{busy === "probe" ? "正在查询…" : "测试连接"}</Button><Button className="primary" disabled={!!busy || !provider.trim() || !baseUrl.trim()} onClick={() => void save()}>{busy === "save" ? "正在保存并同步…" : "保存并同步到 Pi"}</Button></div></footer>
      </div>
      {models.length > 0 && <div className="provider-catalog-panel"><div className="provider-catalog-header"><strong>接口返回的模型（{visibleModels.length}/{models.length}）</strong><Input value={search} onChange={(event) => update({ search: event.target.value })} placeholder="筛选模型" /></div><div className="provider-model-table"><div className="provider-model-table-head" aria-hidden="true"><span>模型</span><span>上下文</span><span>输入模态</span><span>输出模态</span></div><div className="provider-model-list provider-settings-list">{visibleModels.map((model) => { const inputs = modelModalities(model, "input"); const outputs = modelModalities(model, "output"); return <Disclosure key={model.id} title={<span className="provider-model-title"><span className="provider-model-name"><ModelLogo modelId={model.id} size={19} /><strong>{modelDisplayName(model)}</strong></span><span className="provider-model-context">{formatContextLength(model.context_length ?? model.context_window)}{typeof (model.context_length ?? model.context_window) === "number" && <small> tokens</small>}</span><ModelModalities values={inputs} /><ModelModalities values={outputs} /></span>}><ModelDetails model={model} disabled={!!busy || running || !cwd} onUse={() => void applyModel(model)} /></Disclosure> })}</div></div></div>}
    </section>
  );
}

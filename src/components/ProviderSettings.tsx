import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  const cwd = useWorkspace((state) => state.cwd);
  const online = useWorkspace((state) => state.connection === "online");
  const running = useWorkspace((state) => state.transcript.running);
  const profiles = useQuery({ queryKey: ["provider-profiles"], queryFn: listProviderProfiles, staleTime: 10_000 });
  const [provider, setProvider] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelsUrl, setModelsUrl] = useState("");
  const [api, setApi] = useState<(typeof apiTypes)[number]>("openai-completions");
  const [apiKey, setApiKey] = useState("");
  const [authHeader, setAuthHeader] = useState(true);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<"save" | "probe" | "sync" | "use" | null>(null);
  const [isNewProvider, setIsNewProvider] = useState(false);

  const selected = profiles.data?.find((item) => item.id === provider);
  useEffect(() => {
    const first = profiles.data?.[0];
    if (provider || isNewProvider || !first) return;
    setProvider(first.id);
    setName(first.name ?? "");
    setBaseUrl(first.baseUrl ?? "");
    setModelsUrl(first.modelsUrl ?? "");
    setApi((first.api as (typeof apiTypes)[number]) || "openai-completions");
    setAuthHeader(first.authHeader !== false);
  }, [profiles.data, provider, isNewProvider]);
  function selectProvider(id: string) {
    setProvider(id);
    const profile = profiles.data?.find((item) => item.id === id);
    if (profile) {
      setName(profile.name ?? "");
      setBaseUrl(profile.baseUrl ?? "");
      setModelsUrl(profile.modelsUrl ?? "");
      setApi((profile.api as (typeof apiTypes)[number]) || "openai-completions");
      setAuthHeader(profile.authHeader !== false);
      setApiKey("");
    }
    setModels([]);
    setIsNewProvider(false);
  }

  function newProvider() {
    setIsNewProvider(true); setProvider(""); setName(""); setBaseUrl(""); setModelsUrl(""); setApi("openai-completions"); setApiKey(""); setAuthHeader(true); setModels([]);
  }

  function applyPreset(preset: (typeof presets)[number]) {
    setIsNewProvider(true); setProvider(preset.id); setName(preset.name); setBaseUrl(preset.baseUrl); setModelsUrl(`${preset.baseUrl}/models`); setApi(preset.api); setAuthHeader(true); setModels([]); gooeyToast.info(`已填入 ${preset.name} 官方端点`, { showTimestamp: false });
  }

  async function save() {
    setBusy("save");
    try {
      const result = await saveProvider({ provider: provider.trim(), name: name.trim() || undefined, baseUrl: baseUrl.trim(), modelsUrl: modelsUrl.trim() || undefined, api, apiKey: apiKey.trim() || undefined, authHeader });
      setProvider(result.id); setIsNewProvider(false); setApiKey("");
      let switchedModel: { provider: string; id: string } | null = null;
      try {
        const synced = await syncProviderModels(result.id);
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
        gooeyToast.warning("Provider 已保存，但暂时无法切换", { description: activationError instanceof Error ? activationError.message : String(activationError), showTimestamp: false });
      }
      if (switchedModel) gooeyToast.success(`已切换到 ${switchedModel.provider}`, { description: switchedModel.id, showTimestamp: false });
      else gooeyToast.success("Provider 已保存", { showTimestamp: false });
      await queryClient.invalidateQueries({ queryKey: ["pi", "models", cwd] });
      await profiles.refetch();
    } catch (error) { report(error); } finally { setBusy(null); }
  }

  async function probe() {
    setBusy("probe");
    try {
      const catalog = await probeProviderModels(provider.trim(), baseUrl.trim(), api, apiKey.trim() || undefined, authHeader, modelsUrl.trim() || undefined);
      const next = Array.isArray(catalog.data) ? catalog.data : [];
      setModels(next); gooeyToast.success(`已加载 ${next.length} 个模型`, { description: "模型目录已更新", showTimestamp: false });
    } catch (error) { report(error); } finally { setBusy(null); }
  }

  async function sync() {
    setBusy("sync");
    try {
      await saveProvider({ provider: provider.trim(), name: name.trim() || undefined, baseUrl: baseUrl.trim(), modelsUrl: modelsUrl.trim() || undefined, api, apiKey: apiKey.trim() || undefined, authHeader });
      const result = await syncProviderModels(provider.trim());
      gooeyToast.success(`已同步 ${result.count} 个模型`, { description: "缺失字段交给 Pi 默认值", showTimestamp: false });
      await queryClient.invalidateQueries({ queryKey: ["pi", "models"] });
      await profiles.refetch();
    } catch (error) { report(error); } finally { setBusy(null); }
  }

  async function applyModel(model: ProviderModel) {
    setBusy("use");
    try {
      await saveProvider({ provider: provider.trim(), name: name.trim() || undefined, baseUrl: baseUrl.trim(), modelsUrl: modelsUrl.trim() || undefined, api, apiKey: apiKey.trim() || undefined, authHeader });
      await syncProviderModels(provider.trim());
      if (online) await disconnect();
      await connect(cwd);
      await request({ type: "set_model", provider: provider.trim(), modelId: model.id }, 30_000, cwd);
      const current = await refresh(cwd);
      if (current.model?.provider !== provider.trim() || current.model?.id !== model.id) throw new Error("Pi 没有确认模型切换");
      await persistDefaultModel(provider.trim(), model.id);
      setApiKey(""); gooeyToast.success("模型已切换", { description: `${provider.trim()} / ${model.id}`, showTimestamp: false });
      await profiles.refetch();
    } catch (error) { report(error); } finally { setBusy(null); }
  }

  const visibleModels = useMemo(() => models.filter((model) => `${model.id} ${modelDisplayName(model)}`.toLowerCase().includes(search.toLowerCase())), [models, search]);
  return (
    <section className="settings-section provider-settings">
      <div className="provider-settings-heading"><div><h2>Provider 与模型目录</h2><p>URL、协议和凭据保存在 Pi 配置中。模型能力只展示接口返回的元数据。</p></div><div className="provider-preset-row">{presets.map((preset) => <Button key={preset.id} className="secondary" onClick={() => applyPreset(preset)}>{preset.name}</Button>)}</div></div>
      <div className="provider-toolbar">
        <Select aria-label="已保存 Provider" value={provider} onChange={(event) => selectProvider(event.target.value)}>
          <option value="">新 Provider</option>
          {(profiles.data ?? []).map((item: ProviderProfile) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
        </Select>
        <Button className="secondary" onClick={newProvider}>新建</Button>
      </div>
      {profiles.isLoading && <Skeleton active paragraph={{ rows: 2 }} />}
      <div className="provider-form-grid">
        <label>Provider ID<Input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="例如 my-gateway" /></label>
        <label>显示名称<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="可选" /></label>
        <label>Base URL<Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://example.com/v1" /></label>
        <label>模型列表接口<Input value={modelsUrl} onChange={(event) => setModelsUrl(event.target.value)} placeholder="留空则使用 Base URL/models" /></label>
        <label>API 类型<Select value={api} onChange={(event) => setApi(event.target.value as (typeof apiTypes)[number])}>{apiTypes.map((item) => <option key={item} value={item}>{item}</option>)}</Select></label>
        <label>API Key<Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={selected?.hasApiKey ? "已保存，留空保持不变" : "不会显示在前端"} autoComplete="off" /></label>
      </div>
      <div className="provider-auth-row"><span>发送 API 认证请求头</span><Switch aria-label="发送 API 认证请求头" checked={authHeader} onChange={setAuthHeader} /><span className="provider-secret-state">{selected?.hasApiKey ? "已保存凭据" : "未保存凭据"}</span></div>
      <div className="provider-actions"><Button className="primary" disabled={!!busy || !provider.trim() || !baseUrl.trim()} onClick={() => void save()}>{busy === "save" ? "保存中…" : "保存"}</Button><Button className="secondary" disabled={!!busy || !provider.trim() || !baseUrl.trim()} onClick={() => void probe()}>{busy === "probe" ? "查询中…" : "测试并加载模型"}</Button><Button className="secondary" disabled={!!busy || !provider.trim() || !baseUrl.trim()} onClick={() => void sync()}>{busy === "sync" ? "同步中…" : "同步到 Pi"}</Button></div>
      {models.length > 0 && <div className="provider-catalog-panel"><div className="provider-catalog-header"><strong>接口返回的模型（{visibleModels.length}/{models.length}）</strong><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="筛选模型" /></div><div className="provider-model-table"><div className="provider-model-table-head" aria-hidden="true"><span>模型</span><span>上下文</span><span>输入模态</span><span>输出模态</span></div><div className="provider-model-list provider-settings-list">{visibleModels.map((model) => { const inputs = modelModalities(model, "input"); const outputs = modelModalities(model, "output"); return <Disclosure key={model.id} title={<span className="provider-model-title"><span className="provider-model-name"><ModelLogo modelId={model.id} size={19} /><strong>{modelDisplayName(model)}</strong></span><span className="provider-model-context">{formatContextLength(model.context_length ?? model.context_window)}{typeof (model.context_length ?? model.context_window) === "number" && <small> tokens</small>}</span><ModelModalities values={inputs} /><ModelModalities values={outputs} /></span>}><ModelDetails model={model} disabled={!!busy || running || !cwd} onUse={() => void applyModel(model)} /></Disclosure> })}</div></div></div>}
    </section>
  );
}

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
import { Button, Input, Select as CompactSelect, Switch, Disclosure } from "./UI";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "./ui/select";
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
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", baseUrl: "https://ai-gateway.vercel.sh/v1", api: "openai-completions" },
] as const;

function ProviderMark({ id }: { id: string }) {
  return presets.some(preset => preset.id === id)
    ? <ModelLogo modelId={id === "vercel-ai-gateway" ? "vercel" : id} size={17} />
    : <Icon name="plugs-connected" />;
}

function ProviderFieldLabel({ icon, children }: { icon: string; children: string }) {
  return <span className="provider-field-label"><Icon name={icon} />{children}</span>;
}

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
      <Button variant="outline" className="provider-use-model" disabled={disabled} onClick={onUse}><Icon name="check" />使用此模型</Button>
      <Disclosure title={<span className="provider-disclosure-title"><Icon name="code" />接口原始元数据</span>}>
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
  const providerOptions = useMemo(() => {
    const saved = profiles.data ?? [];
    const seen = new Set(saved.map(item => item.id));
    const options = saved.map(item => ({ id: item.id, name: item.name || item.id, saved: true }));
    for (const preset of presets) if (!seen.has(preset.id)) options.push({ id: preset.id, name: preset.name, saved: false });
    if (provider && !options.some(item => item.id === provider)) options.push({ id: provider, name: name || provider, saved: false });
    return options;
  }, [name, profiles.data, provider]);
  const currentProvider = providerOptions.find(item => item.id === provider);
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

  function chooseProvider(id: string | null) {
    if (!id || id === "__new__") { newProvider(); return; }
    const profile = profiles.data?.find(item => item.id === id);
    if (profile) { selectProvider(id); return; }
    const preset = presets.find(item => item.id === id);
    if (preset) applyPreset(preset);
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
    <section className="provider-settings">
      <div className="provider-picker-block">
        <div className="provider-picker-heading"><ProviderFieldLabel icon="buildings">Provider</ProviderFieldLabel>{selected && <span className="provider-config-state saved"><Icon name="check" />已保存</span>}</div>
        <div className="provider-picker-row">
          <Select value={provider || "__new__"} onValueChange={chooseProvider}>
            <SelectTrigger aria-label="Provider" className="provider-main-select"><SelectValue><span className="provider-selected-value">{provider ? <ProviderMark id={provider} /> : <Icon name="plus" />}<span>{currentProvider?.name ?? "自定义 Provider"}</span></span></SelectValue></SelectTrigger>
            <SelectContent align="start" className="provider-main-select-content">
              {providerOptions.map(item => <SelectItem key={item.id} value={item.id}><ProviderMark id={item.id} /><span>{item.name}</span>{item.saved && <small>已保存</small>}</SelectItem>)}
              <SelectSeparator />
              <SelectItem value="__new__"><Icon name="plus" />自定义 Provider</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" className="provider-new-button" onClick={newProvider}><Icon name="plus" />新建</Button>
        </div>
      </div>
      <div className="provider-editor">
       <section className="provider-form-section"><header><div><h2><Icon name="identification-card" />基本信息</h2><p>用于 Pi 配置和模型选择器。</p></div></header><div className="provider-form-grid">
        <label><ProviderFieldLabel icon="identification-card">Provider ID</ProviderFieldLabel><Input value={provider} onChange={(event) => update({ provider: event.target.value })} placeholder="例如 my-gateway" /></label>
        <label><ProviderFieldLabel icon="article">显示名称</ProviderFieldLabel><Input value={name} onChange={(event) => update({ name: event.target.value })} placeholder="例如 Team Gateway" /></label>
       </div></section>
       <section className="provider-form-section"><header><div><h2><Icon name="link" />连接</h2><p>配置兼容协议和模型目录地址。</p></div></header><div className="provider-form-grid">
        <label><ProviderFieldLabel icon="link">Base URL</ProviderFieldLabel><Input value={baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} placeholder="https://example.com/v1" /></label>
        <label><ProviderFieldLabel icon="list-magnifying-glass">模型列表接口</ProviderFieldLabel><Input value={modelsUrl} onChange={(event) => update({ modelsUrl: event.target.value })} placeholder="留空则使用 Base URL/models" /></label>
        <label className="provider-form-wide"><ProviderFieldLabel icon="globe">API 类型</ProviderFieldLabel><CompactSelect aria-label="API 类型" value={api} onChange={(event) => update({ api: event.target.value as (typeof apiTypes)[number] })}>{apiTypes.map((item) => <option key={item} value={item}>{item}</option>)}</CompactSelect></label>
       </div></section>
       <section className="provider-form-section"><header><div><h2><Icon name="key" />凭据</h2><p>API Key 只写入本机 Pi 配置，不会回显。</p></div></header><div className="provider-credentials">
        <label><ProviderFieldLabel icon="key">API Key</ProviderFieldLabel><Input type="password" value={apiKey} onChange={(event) => update({ apiKey: event.target.value })} placeholder={selected?.hasApiKey ? "已保存，留空保持不变" : "输入服务商 API Key"} autoComplete="off" /></label>
        <div className="provider-auth-row"><div><strong><Icon name="shield-check" />发送认证请求头</strong><p>关闭后，模型服务请求不会附带 API Key。</p></div><Switch aria-label="发送 API 认证请求头" checked={authHeader} onChange={(value) => update({ authHeader: value })} /><span className="provider-secret-state">{selected?.hasApiKey ? "凭据已保存" : "尚未保存凭据"}</span></div>
       </div></section>
       <footer className="provider-actions"><div className="provider-save-note"><Icon name="arrows-clockwise"/><span>保存会更新 Pi 模型配置并重新连接当前项目。</span></div><div><Button variant="outline" disabled={!!busy || !provider.trim() || !baseUrl.trim()} onClick={() => void probe()}><Icon name="play-circle" />{busy === "probe" ? "正在查询…" : "测试连接"}</Button><Button variant="default" disabled={!!busy || !provider.trim() || !baseUrl.trim()} onClick={() => void save()}><Icon name="floppy-disk" />{busy === "save" ? "正在保存并同步…" : "保存并同步"}</Button></div></footer>
      </div>
      {models.length > 0 && <div className="provider-catalog-panel"><div className="provider-catalog-header"><strong><Icon name="cpu" />可用模型（{visibleModels.length}/{models.length}）</strong><label className="provider-catalog-search"><Icon name="magnifying-glass" /><Input aria-label="筛选模型" value={search} onChange={(event) => update({ search: event.target.value })} placeholder="筛选模型" /></label></div><div className="provider-model-table"><div className="provider-model-table-head" aria-hidden="true"><span>模型</span><span>上下文</span><span>输入模态</span><span>输出模态</span></div><div className="provider-model-list provider-settings-list">{visibleModels.map((model) => { const inputs = modelModalities(model, "input"); const outputs = modelModalities(model, "output"); return <Disclosure key={model.id} title={<span className="provider-model-title"><span className="provider-model-name"><ModelLogo modelId={model.id} size={19} /><strong>{modelDisplayName(model)}</strong></span><span className="provider-model-context">{formatContextLength(model.context_length ?? model.context_window)}{typeof (model.context_length ?? model.context_window) === "number" && <small> tokens</small>}</span><ModelModalities values={inputs} /><ModelModalities values={outputs} /></span>}><ModelDetails model={model} disabled={!!busy || running || !cwd} onUse={() => void applyModel(model)} /></Disclosure> })}</div></div></div>}
    </section>
  );
}

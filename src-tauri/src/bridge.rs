//! Pi RPC framing: official docs/rpc.md. Tauri streaming: Channel, not broadcast events.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::{fs, io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, ChildStdin, Command, Stdio}, sync::{Arc, Mutex}, thread, time::Duration};
use tauri::{ipc::Channel, State, Manager, AppHandle, path::BaseDirectory};

struct Worker { child: Arc<Mutex<Child>>, stdin: ChildStdin }
#[derive(Default)]
pub struct Bridge(Mutex<HashMap<String, Worker>>);
impl Bridge {
    pub fn stop_project(&self, project: &str) {
        if let Ok(mut workers) = self.0.lock() {
            if let Some(worker) = workers.remove(project) {
                drop(worker.stdin);
                if let Ok(mut child) = worker.child.lock() { let _ = child.kill(); let _ = child.wait(); }
            }
        }
    }
    pub fn stop(&self) {
        let projects = self.0.lock().map(|workers|workers.keys().cloned().collect::<Vec<_>>()).unwrap_or_default();
        for project in projects { self.stop_project(&project); }
    }
}

#[cfg(unix)]
fn executable(name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || !name.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')) {
        return Err("无效的可执行文件名称".into());
    }
    let configured = std::env::var_os("SHELL").map(PathBuf::from);
    let shells = configured.into_iter().chain(["/bin/zsh", "/bin/bash", "/bin/sh"].map(PathBuf::from));
    for shell in shells {
        if !shell.is_file() { continue; }
        for mode in ["-lc", "-lic"] {
            let Ok(found) = Command::new(&shell).args([mode, &format!("command -v {name}")]).stdin(Stdio::null()).stderr(Stdio::null()).output() else { continue };
            if let Some(path) = String::from_utf8_lossy(&found.stdout).lines().rev().map(PathBuf::from).find(|path| path.is_file()) { return Ok(path); }
        }
    }
    Err(format!("找不到 {name}，请在终端安装后重试"))
}
#[cfg(windows)]
fn executable(name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || !name.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')) {
        return Err("无效的可执行文件名称".into());
    }
    if let Ok(found) = Command::new("where.exe").arg(name).output() {
        if let Some(path) = String::from_utf8_lossy(&found.stdout).lines().map(PathBuf::from).find(|path| path.is_file()) { return Ok(path); }
    }
    let script = format!("Get-Command {name} -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source");
    if let Ok(found) = Command::new("powershell.exe").args(["-NoLogo", "-Command", &script]).output() {
        if let Some(path) = String::from_utf8_lossy(&found.stdout).lines().map(str::trim).map(PathBuf::from).find(|path| path.is_file()) { return Ok(path); }
    }
    if name == "pi" {
        if let Some(app_data) = std::env::var_os("APPDATA") {
            let candidate = PathBuf::from(app_data).join("npm/pi.cmd");
            if candidate.is_file() { return Ok(candidate); }
        }
    }
    Err(format!("找不到 {name}，请在终端安装后重试"))
}
fn pi_path() -> Result<PathBuf, String> {
    let launcher = executable("pi")?;
    #[cfg(windows)]
    if matches!(launcher.extension().and_then(|extension| extension.to_str()), Some("cmd" | "ps1")) {
        if let Some(parent) = launcher.parent() {
            let script = parent.join("node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
            if script.is_file() { return script.canonicalize().map_err(|error| error.to_string()); }
        }
    }
    launcher.canonicalize().map_err(|error| error.to_string())
}
fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).ok_or_else(|| "找不到用户目录".into())
}
fn project(cwd: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(cwd).canonicalize().map_err(|e| format!("工作目录不可用：{e}"))?;
    if !path.is_dir() { return Err("请选择文件夹".into()); }
    Ok(path)
}

fn collect_project_files(root: &std::path::Path, current: &std::path::Path, output: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(current) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".env.example" || matches!(name.as_str(), "node_modules" | "target" | "dist" | "build") { continue; }
        if path.is_dir() { collect_project_files(root, &path, output); }
        else if path.is_file() {
            if let Ok(relative) = path.strip_prefix(root) { output.push(relative.to_string_lossy().replace('\\', "/")); }
        }
        if output.len() >= 10000 { return; }
    }
}

fn valid_provider_id(provider: &str) -> bool {
    !provider.is_empty() && provider.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

fn read_json_file(path: PathBuf, label: &str) -> Result<Value, String> {
    serde_json::from_str(&fs::read_to_string(path).map_err(|_| format!("{label} 不可读"))?).map_err(|_| format!("{label} 不是有效 JSON"))
}

fn append_image_input(model: &mut Value) -> bool {
    let Some(model) = model.as_object_mut() else { return false };
    let input = model.entry("input").or_insert_with(|| json!(["text"]));
    let Some(input) = input.as_array_mut() else {
        model.insert("input".into(), json!(["text", "image"]));
        return true;
    };
    if input.iter().any(|value| value.as_str() == Some("image")) { return false; }
    input.push(Value::from("image"));
    true
}

fn append_image_input_to_custom_models(dir: &std::path::Path) -> Result<usize, String> {
    let path = dir.join("models.json");
    if !path.exists() { return Ok(0); }
    let mut config = read_json_file(path.clone(), "Pi models.json")?;
    let mut changed = 0;
    if let Some(providers) = config.get_mut("providers").and_then(Value::as_object_mut) {
        for provider in providers.values_mut() {
            if let Some(models) = provider.get_mut("models").and_then(Value::as_array_mut) {
                for model in models { changed += usize::from(append_image_input(model)); }
            }
        }
    }
    if changed > 0 {
        let backup = dir.join("models.json.pi-gui.bak");
        if !backup.exists() { fs::copy(&path, backup).map_err(|e| format!("备份 Pi models.json 失败：{e}"))?; }
        fs::write(&path, serde_json::to_string_pretty(&config).map_err(|e| e.to_string())? + "\n")
            .map_err(|e| format!("写入 Pi models.json 失败：{e}"))?;
    }
    Ok(changed)
}

async fn fetch_model_catalog(base_url: &str, models_url: Option<&str>, api_key: &str, api: &str, auth_header: bool) -> Result<Value, String> {
    let base_url = base_url.trim_end_matches('/');
    if !(base_url.starts_with("https://") || base_url.starts_with("http://")) { return Err("Base URL 必须是 HTTP(S) 地址".into()); }
    let endpoint = models_url.filter(|value| !value.trim().is_empty()).map(|value| value.trim().to_string()).unwrap_or_else(|| format!("{base_url}/models"));
    if !(endpoint.starts_with("https://") || endpoint.starts_with("http://")) { return Err("模型列表接口必须是 HTTP(S) 地址".into()); }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
    let request = client.get(endpoint);
    let request = if api_key.is_empty() || !auth_header { request } else if api == "anthropic-messages" {
        request.header("x-api-key", api_key).header("anthropic-version", "2023-06-01")
    } else { request.bearer_auth(api_key) };
    let response = request.send().await
        .map_err(|e| format!("模型目录请求失败：{e}"))?
        .error_for_status().map_err(|e| format!("模型目录返回错误：{e}"))?;
    response.json::<Value>().await.map_err(|e| format!("模型目录响应不是有效 JSON：{e}"))
}

fn catalog_models(catalog: &Value) -> Vec<Value> {
    catalog.get("data").and_then(Value::as_array).cloned().unwrap_or_default()
}

fn pi_model_from_catalog(item: &Value) -> Option<Value> {
    let id = item.get("id").and_then(Value::as_str)?.to_string();
    let mut model = json!({"id": id});
    if let Some(name) = item.get("name").or_else(|| item.get("display_name")).and_then(Value::as_str) { model["name"] = Value::from(name); }
    let input_values = item.get("architecture").and_then(|value| value.get("input_modalities"))
        .or_else(|| item.get("input_modalities"));
    if let Some(inputs) = input_values.and_then(Value::as_array) {
        let inputs = inputs.iter().filter_map(Value::as_str).filter(|value| *value == "text" || *value == "image").map(Value::from).collect::<Vec<_>>();
        if !inputs.is_empty() { model["input"] = Value::Array(inputs); }
    } else if let Some(tags) = item.get("capability_tags").and_then(Value::as_array) {
        let mut inputs = Vec::new();
        if tags.iter().any(|tag| matches!(tag.as_str(), Some("chat" | "text" | "completion"))) { inputs.push(Value::from("text")); }
        if tags.iter().any(|tag| matches!(tag.as_str(), Some("vision" | "image" | "image_input"))) { inputs.push(Value::from("image")); }
        if !inputs.is_empty() { model["input"] = Value::Array(inputs); }
    }
    if let Some(context) = item.get("context_length").or_else(|| item.get("context_window")).and_then(Value::as_u64) { model["contextWindow"] = Value::from(context); }
    if let Some(max_tokens) = item.get("max_output_tokens").or_else(|| item.get("max_tokens")).and_then(Value::as_u64) { model["maxTokens"] = Value::from(max_tokens); }
    if let Some(reasoning) = item.get("reasoning").and_then(Value::as_bool) {
        model["reasoning"] = Value::from(reasoning);
    } else if let Some(efforts) = item.get("reasoning").and_then(|value| value.get("supported_efforts")).and_then(Value::as_array) {
        let mut map = serde_json::Map::new();
        for effort in efforts.iter().filter_map(Value::as_str) { map.insert(effort.to_string(), Value::from(effort)); }
        if !map.is_empty() { model["reasoning"] = Value::from(true); model["thinkingLevelMap"] = Value::Object(map); }
    }
    if let Some(pricing) = item.get("pricing").and_then(Value::as_object) {
        let rates = [("prompt", "input"), ("completion", "output"), ("input_cache_read", "cacheRead"), ("input_cache_write", "cacheWrite")];
        let mut cost = serde_json::Map::new();
        for (source, target) in rates { if let Some(value) = pricing.get(source).and_then(Value::as_str).and_then(|value| value.parse::<f64>().ok()) { cost.insert(target.into(), Value::from(value * 1_000_000.0)); } }
        if !cost.is_empty() { model["cost"] = Value::Object(cost); }
    }
    append_image_input(&mut model);
    Some(model)
}

fn agent_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".pi/agent"))
}

fn provider_store_path(dir: &std::path::Path) -> PathBuf { dir.join("pi-gui-providers.json") }

fn settings_path(dir: &std::path::Path) -> PathBuf { dir.join("settings.json") }

fn project_trust_mode(value: &Value) -> &'static str {
    match value.get("defaultProjectTrust").and_then(Value::as_str) {
        Some("always") => "always",
        Some("never") => "never",
        _ => "ask",
    }
}

#[tauri::command]
pub fn get_project_trust_mode() -> Result<String, String> {
    let dir = agent_dir()?;
    let path = settings_path(&dir);
    if !path.exists() { return Ok("ask".into()); }
    Ok(project_trust_mode(&read_json_file(path, "Pi settings.json")?).into())
}

#[tauri::command]
pub fn set_project_trust_mode(mode: String) -> Result<String, String> {
    if !matches!(mode.as_str(), "ask" | "always" | "never") { return Err("无效的项目权限模式".into()); }
    let dir = agent_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建 Pi 配置目录失败：{e}"))?;
    let path = settings_path(&dir);
    let mut settings = if path.exists() { read_json_file(path.clone(), "Pi settings.json")? } else { json!({}) };
    if !settings.is_object() { settings = json!({}); }
    settings["defaultProjectTrust"] = Value::from(mode.clone());
    fs::write(&path, serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())? + "\n")
        .map_err(|e| format!("写入 Pi settings.json 失败：{e}"))?;
    Ok(mode)
}

fn load_provider_store(dir: &std::path::Path) -> Result<Value, String> {
    let path = provider_store_path(dir);
    if path.exists() { read_json_file(path, "Pi GUI Provider 配置") } else { Ok(json!({"providers": {}})) }
}

fn write_provider_store(dir: &std::path::Path, store: &Value) -> Result<(), String> {
    let path = provider_store_path(dir);
    fs::write(&path, serde_json::to_string_pretty(store).map_err(|e| e.to_string())? + "\n").map_err(|e| format!("写入 Provider 配置失败：{e}"))?;
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| format!("设置 Provider 配置权限失败：{e}"))?; }
    Ok(())
}

fn stored_api_key(auth: &Value, provider: &str) -> Option<String> {
    auth.get(provider).and_then(|item| item.get("key")).and_then(Value::as_str).filter(|value| !value.is_empty()).map(ToOwned::to_owned)
}

fn supported_api(api: &str) -> bool {
    matches!(api, "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai" | "azure-openai-responses" | "mistral-conversations")
}

#[tauri::command]
pub async fn discover() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let pi = pi_path()?;
        let node = executable("node")?;
        let output = Command::new(&node).arg(&pi).arg("--version").output().map_err(|e| e.to_string())?;
        let home = home_dir()?;
        Ok(json!({"pi":pi,"node":node,"version":String::from_utf8_lossy(&output.stdout).trim(),"cwd":home.join("Desktop/pi-gui"),"home":home}))
    }).await.map_err(|e|e.to_string())?
}
/// Query the OpenAI-compatible provider catalog configured in Pi's own files.
/// The API key is read and used only inside this process and is never returned.
#[tauri::command]
pub async fn list_provider_models(provider: String) -> Result<Value, String> {
    let dir = agent_dir()?;
    let models = read_json_file(dir.join("models.json"), "Pi models.json")?;
    let provider_config = models.get("providers").and_then(|items| items.get(&provider)).ok_or_else(|| format!("Pi 未配置 provider：{provider}"))?;
    let base_url = provider_config.get("baseUrl").and_then(Value::as_str).ok_or("该 provider 没有 baseUrl")?;
    let auth = read_json_file(dir.join("auth.json"), "Pi auth.json").unwrap_or_else(|_| json!({}));
    let api = provider_config.get("api").and_then(Value::as_str).unwrap_or("openai-completions");
    let auth_header = provider_config.get("authHeader").and_then(Value::as_bool).unwrap_or(true);
    let models_url = provider_config.get("modelsUrl").and_then(Value::as_str);
    fetch_model_catalog(base_url, models_url, &stored_api_key(&auth, &provider).unwrap_or_default(), api, auth_header).await
}

#[tauri::command]
pub async fn list_provider_profiles() -> Result<Value, String> {
    let dir = agent_dir()?;
    let models = read_json_file(dir.join("models.json"), "Pi models.json").unwrap_or_else(|_| json!({"providers": {}}));
    let auth = read_json_file(dir.join("auth.json"), "Pi auth.json").unwrap_or_else(|_| json!({}));
    let store = load_provider_store(&dir).unwrap_or_else(|_| json!({"providers": {}}));
    let mut ids = std::collections::BTreeSet::new();
    if let Some(providers) = models.get("providers").and_then(Value::as_object) { ids.extend(providers.keys().cloned()); }
    if let Some(providers) = store.get("providers").and_then(Value::as_object) { ids.extend(providers.keys().cloned()); }
    let profiles = ids.into_iter().map(|id| {
        let config = models.get("providers").and_then(|items| items.get(&id)).unwrap_or(&Value::Null);
        let saved = store.get("providers").and_then(|items| items.get(&id)).unwrap_or(&Value::Null);
        json!({
            "id": id,
            "name": saved.get("name").and_then(Value::as_str).or_else(|| config.get("name").and_then(Value::as_str)),
            "baseUrl": saved.get("baseUrl").and_then(Value::as_str).or_else(|| config.get("baseUrl").and_then(Value::as_str)),
            "modelsUrl": saved.get("modelsUrl").and_then(Value::as_str).or_else(|| config.get("modelsUrl").and_then(Value::as_str)),
            "api": saved.get("api").and_then(Value::as_str).or_else(|| config.get("api").and_then(Value::as_str)),
            "authHeader": saved.get("authHeader").and_then(Value::as_bool).or_else(|| config.get("authHeader").and_then(Value::as_bool)),
            "hasApiKey": stored_api_key(&auth, &id).is_some(),
            "modelCount": config.get("models").and_then(Value::as_array).map(Vec::len).unwrap_or(0)
        })
    }).collect::<Vec<_>>();
    Ok(Value::Array(profiles))
}

#[tauri::command]
pub async fn probe_provider_models(provider: String, base_url: String, api: String, api_key: Option<String>, auth_header: bool, models_url: Option<String>) -> Result<Value, String> {
    if !valid_provider_id(&provider) { return Err("Provider ID 只能包含字母、数字、-、_、.".into()); }
    if !supported_api(&api) { return Err("不支持的 Pi API 类型".into()); }
    let dir = agent_dir()?;
    let auth = read_json_file(dir.join("auth.json"), "Pi auth.json").unwrap_or_else(|_| json!({}));
    let key = api_key.filter(|value| !value.trim().is_empty()).or_else(|| stored_api_key(&auth, &provider)).unwrap_or_default();
    fetch_model_catalog(&base_url, models_url.as_deref(), &key, &api, auth_header).await
}

#[tauri::command]
pub async fn save_provider(provider: String, name: Option<String>, base_url: String, models_url: Option<String>, api: String, api_key: Option<String>, auth_header: bool) -> Result<Value, String> {
    if !valid_provider_id(&provider) { return Err("Provider ID 只能包含字母、数字、-、_、.".into()); }
    if !supported_api(&api) { return Err("不支持的 Pi API 类型".into()); }
    let dir = agent_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建 Pi 配置目录：{e}"))?;
    let path = dir.join("models.json");
    let mut config = if path.exists() { read_json_file(path.clone(), "Pi models.json")? } else { json!({"providers": {}}) };
    let providers = config.get_mut("providers").and_then(Value::as_object_mut).ok_or("Pi models.json 缺少 providers 对象")?;
    let mut provider_config = providers.get(&provider).cloned().unwrap_or_else(|| json!({}));
    if !provider_config.is_object() { provider_config = json!({}); }
    provider_config["baseUrl"] = Value::from(base_url.trim_end_matches('/'));
    if let Some(value) = models_url.as_ref().filter(|value| !value.trim().is_empty()) { provider_config["modelsUrl"] = Value::from(value.trim_end_matches('/')); } else { provider_config.as_object_mut().map(|object| object.remove("modelsUrl")); }
    provider_config["api"] = Value::from(api.clone());
    provider_config["authHeader"] = Value::from(auth_header);
    if let Some(value) = name.as_ref().filter(|value| !value.trim().is_empty()) { provider_config["name"] = Value::from(value.as_str()); }
    providers.insert(provider.clone(), provider_config);
    if path.exists() { let _ = fs::copy(&path, path.with_extension("json.bak")); }
    fs::write(&path, serde_json::to_string_pretty(&config).map_err(|e| e.to_string())? + "\n").map_err(|e| format!("写入 Pi models.json 失败：{e}"))?;
    if let Some(key) = api_key.as_ref().filter(|value| !value.trim().is_empty()) {
        let auth_path = dir.join("auth.json");
        let mut auth = if auth_path.exists() { read_json_file(auth_path.clone(), "Pi auth.json")? } else { json!({}) };
        auth[&provider] = json!({"type":"api_key","key":key});
        fs::write(&auth_path, serde_json::to_string_pretty(&auth).map_err(|e| e.to_string())? + "\n").map_err(|e| format!("写入 Pi auth.json 失败：{e}"))?;
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; let _ = fs::set_permissions(&auth_path, fs::Permissions::from_mode(0o600)); }
    }
    let mut store = load_provider_store(&dir)?;
    let providers = store.get_mut("providers").and_then(Value::as_object_mut).ok_or("Provider 配置缺少 providers 对象")?;
    let previous_key = providers.get(&provider).and_then(|value| value.get("apiKey")).cloned();
    let normalized_models_url = models_url.as_deref().map(|value| value.trim().trim_end_matches('/')).filter(|value| !value.is_empty());
    let mut entry = json!({"name":name,"baseUrl":base_url.trim_end_matches('/'),"modelsUrl":normalized_models_url,"api":api,"authHeader":auth_header});
    if let Some(key) = api_key.as_ref().filter(|value| !value.trim().is_empty()).map(|value| Value::from(value.as_str())).or(previous_key) { entry["apiKey"] = key; }
    providers.insert(provider.clone(), entry);
    write_provider_store(&dir, &store)?;
    Ok(json!({"id":provider,"hasApiKey": read_json_file(dir.join("auth.json"), "Pi auth.json").ok().and_then(|auth| stored_api_key(&auth, &provider)).is_some()}))
}
#[tauri::command]
pub async fn sync_provider_models(provider: String) -> Result<Value, String> {
    let catalog = list_provider_models(provider.clone()).await?;
    let remote = catalog_models(&catalog);
    if remote.is_empty() { return Err("模型目录缺少 data 数组或没有模型".into()); }
    let dir = agent_dir()?;
    let path = dir.join("models.json");
    let mut config = read_json_file(path.clone(), "Pi models.json")?;
    let provider_config = config.get_mut("providers").and_then(Value::as_object_mut).and_then(|items| items.get_mut(&provider)).ok_or_else(|| format!("Pi 未配置 provider：{provider}"))?;
    let existing = provider_config.get("models").and_then(Value::as_array).cloned().unwrap_or_default();
    let models = remote.iter().filter_map(pi_model_from_catalog).collect::<Vec<_>>();
    if models.is_empty() { return Err("模型目录没有可同步的模型".into()); }
    provider_config["models"] = Value::Array(models.clone());
    let backup = path.with_extension("json.bak"); let _ = fs::copy(&path, backup);
    let serialized = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())? + "\n";
    fs::write(&path, serialized).map_err(|e| format!("写入 Pi models.json 失败：{e}"))?;
    let first_model_id = models.first().and_then(|model| model.get("id")).and_then(Value::as_str);
    Ok(json!({"provider":provider,"count":models.len(),"previous":existing.len(),"firstModelId":first_model_id}))
}

fn set_default_model_in(dir: &std::path::Path, provider: String, model_id: String) -> Result<Value, String> {
    if !valid_provider_id(&provider) || model_id.trim().is_empty() { return Err("Provider 和模型 ID 不能为空".into()); }
    let models = read_json_file(dir.join("models.json"), "Pi models.json")?;
    let exists = models.get("providers")
        .and_then(|providers| providers.get(&provider))
        .and_then(|config| config.get("models"))
        .and_then(Value::as_array)
        .is_some_and(|items| items.iter().any(|model| model.get("id").and_then(Value::as_str) == Some(model_id.as_str())));
    if !exists { return Err(format!("Pi 未配置模型：{provider}/{model_id}")); }

    let path = settings_path(&dir);
    let mut settings = if path.exists() { read_json_file(path.clone(), "Pi settings.json")? } else { json!({}) };
    if !settings.is_object() { settings = json!({}); }
    settings["defaultProvider"] = Value::from(provider.clone());
    settings["defaultModel"] = Value::from(model_id.clone());
    fs::write(&path, serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())? + "\n")
        .map_err(|e| format!("写入 Pi 默认模型失败：{e}"))?;
    Ok(json!({"provider":provider,"id":model_id}))
}

#[tauri::command]
pub fn set_default_model(provider: String, model_id: String) -> Result<Value, String> {
    set_default_model_in(&agent_dir()?, provider, model_id)
}

#[cfg(test)]
mod default_model_tests {
    use super::*;

    #[test]
    fn persists_default_model_without_losing_other_settings() {
        let dir = std::env::temp_dir().join(format!("pi-gui-model-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("models.json"), r#"{"providers":{"llmgate":{"models":[{"id":"codex-auto-review"}]}}}"#).unwrap();
        fs::write(dir.join("settings.json"), r#"{"theme":"dark","defaultProvider":"jamerly","defaultModel":"old"}"#).unwrap();

        set_default_model_in(&dir, "llmgate".into(), "codex-auto-review".into()).unwrap();
        let settings = read_json_file(dir.join("settings.json"), "settings").unwrap();
        assert_eq!(settings["defaultProvider"], "llmgate");
        assert_eq!(settings["defaultModel"], "codex-auto-review");
        assert_eq!(settings["theme"], "dark");

        fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(test)]
mod image_input_tests {
    use super::*;

    #[test]
    fn preserves_existing_inputs_and_appends_image() {
        let dir = std::env::temp_dir().join(format!("pi-gui-image-input-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("models.json"), r#"{"providers":{"relay":{"models":[{"id":"a"},{"id":"b","input":["text"]},{"id":"c","input":["text","image"]}]}}}"#).unwrap();

        assert_eq!(append_image_input_to_custom_models(&dir).unwrap(), 2);
        let config = read_json_file(dir.join("models.json"), "models").unwrap();
        let models = config["providers"]["relay"]["models"].as_array().unwrap();
        assert_eq!(models[0]["input"], json!(["text", "image"]));
        assert_eq!(models[1]["input"], json!(["text", "image"]));
        assert_eq!(models[2]["input"], json!(["text", "image"]));
        assert!(dir.join("models.json.pi-gui.bak").exists());
        assert_eq!(append_image_input_to_custom_models(&dir).unwrap(), 0);

        fs::remove_dir_all(dir).unwrap();
    }
}

#[tauri::command]
pub async fn pi_connect(app: AppHandle, cwd: String, on_event: Channel<Value>, state: State<'_, Bridge>) -> Result<Value, String> {
    let path = project(&cwd)?;
    append_image_input_to_custom_models(&agent_dir()?)?;
    let pi = pi_path()?;
    let node = executable("node")?;
    // Explicit executable paths also work when Finder's PATH lacks the Node version manager.
    state.stop_project(&cwd);
    let extension = app.path().resolve("resources/gui-extension.ts", BaseDirectory::Resource).map_err(|e|e.to_string())?;
    let mut child = Command::new(node).arg(&pi).args(["--mode", "rpc", "--offline"]).arg("--extension").arg(extension).current_dir(&path)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e|e.to_string())?;
    let pid = child.id();
    let stdin = child.stdin.take().ok_or("Pi stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("Pi stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("Pi stderr unavailable")?;
    let child = Arc::new(Mutex::new(child));
    state.0.lock().map_err(|e| e.to_string())?.insert(cwd.clone(), Worker {child: child.clone(), stdin});
    let output_channel = on_event.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut record = Vec::new();
        loop {
            record.clear();
            match reader.read_until(b'\n', &mut record) {
                Ok(0) => break,
                Ok(_) => match serde_json::from_slice::<Value>(&record) {
                    Ok(value) => { if output_channel.send(json!({"kind":"rpc","payload":value})).is_err() { break; } },
                    Err(_) => { let _=output_channel.send(json!({"kind":"protocol_error","message":"Pi 输出了无效 JSONL 记录"})); }
                },
                Err(error) => { let _=output_channel.send(json!({"kind":"protocol_error","message":error.to_string()})); break; }
            }
        }
    });
    // Drain stderr to avoid blocking the child. Never forward credentials or raw diagnostic dumps.
    thread::spawn(move || { for record in BufReader::new(stderr).split(b'\n') { if record.is_err() { break; } } });
    thread::spawn(move || loop {
        let status = child.lock().ok().and_then(|mut c| c.try_wait().ok().flatten());
        if let Some(status) = status { let _=on_event.send(json!({"kind":"exit","code":status.code()})); break; }
        thread::sleep(Duration::from_millis(150));
    });
    Ok(json!({"pid":pid,"cwd":path,"pi":pi}))
}
#[tauri::command]
pub fn pi_send(project: String, command: Value, state: State<'_, Bridge>) -> Result<(), String> {
    if !command.is_object() || command.get("type").and_then(Value::as_str).is_none() { return Err("RPC command requires a type".into()); }
    let mut slot = state.0.lock().map_err(|e|e.to_string())?;
    let worker = slot.get_mut(&project).ok_or("项目尚未连接")?;
    let mut bytes = serde_json::to_vec(&command).map_err(|e|e.to_string())?;
    bytes.push(b'\n');
    worker.stdin.write_all(&bytes).and_then(|_|worker.stdin.flush()).map_err(|e|e.to_string())
}
#[tauri::command]
pub fn pi_disconnect(project: String, state: State<'_, Bridge>) { state.stop_project(&project); }
#[tauri::command]
pub async fn list_sessions(cwd: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = project(&cwd)?;
        let pi = pi_path()?;
        let sdk = pi.parent().ok_or("Invalid Pi path")?.join("index.js");
        // SDK SessionManager.list is the documented session index, not a guessed JSONL parser.
        let code = "const {pathToFileURL}=require('node:url'); (async()=>{const {SessionManager}=await import(pathToFileURL(process.argv[1]).href); console.log(JSON.stringify((await SessionManager.list(process.argv[2])).map(({allMessagesText,...session})=>session)));})().catch(()=>process.exit(1));";
        let output = Command::new(executable("node")?).args(["-e",code]).arg(sdk).arg(path).output().map_err(|e|e.to_string())?;
        if !output.status.success() { return Err("Pi SDK 无法读取会话列表".into()); }
        serde_json::from_slice(&output.stdout).map_err(|e|e.to_string())
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub async fn list_project_files(cwd: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = project(&cwd)?;
        let mut files = Vec::new();
        collect_project_files(&root, &root, &mut files);
        files.sort_unstable();
        Ok(json!(files))
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn delete_session(session_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = home_dir()?.join(".pi/agent/sessions").canonicalize().map_err(|_| "Pi 会话目录不可用".to_string())?;
        let target = PathBuf::from(&session_path).canonicalize().map_err(|_| "会话文件不存在".to_string())?;
        if target.extension().and_then(|value| value.to_str()) != Some("jsonl") || !target.starts_with(&root) { return Err("只能删除 Pi 会话目录中的 JSONL 文件".into()); }
        fs::remove_file(target).map_err(|e| format!("删除会话失败：{e}"))
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn open_pi_terminal(cwd: String, session: Option<String>, command: Option<String>) -> Result<(), String> {
    let path = project(&cwd)?;
    let pi = pi_path()?;
    let node = executable("node")?;

    #[cfg(windows)]
    {
        fn powershell_quote(value: &str) -> String { format!("'{}'", value.replace('\'', "''")) }
        let custom_command = command.is_some();
        let mut script = command.map(|value| format!("Set-Location -LiteralPath {}; {value}", powershell_quote(&path.to_string_lossy())))
            .unwrap_or_else(|| format!("Set-Location -LiteralPath {}; & {} {}", powershell_quote(&path.to_string_lossy()), powershell_quote(&node.to_string_lossy()), powershell_quote(&pi.to_string_lossy())));
        if !custom_command { if let Some(session) = session { script.push_str(&format!(" --session {}", powershell_quote(&session))); } }
        Command::new("cmd.exe").args(["/C", "start", "", "powershell.exe", "-NoExit", "-Command", &script]).spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(unix)]
    {
    fn shell_quote(value: &str) -> String { format!("'{}'",value.replace('\'',"'\\''")) }
    let custom_command = command.is_some();
    let mut command = command.map(|value| format!("cd -- {} && {}", shell_quote(&path.to_string_lossy()), value)).unwrap_or_else(|| format!("cd -- {} && {} {}", shell_quote(&path.to_string_lossy()), shell_quote(&node.to_string_lossy()), shell_quote(&pi.to_string_lossy())));
    if !custom_command { if let Some(session) = session { command.push_str(&format!(" --session {}",shell_quote(&session))); } }

    #[cfg(target_os = "macos")]
    {
    let literal = command.replace('\\',"\\\\").replace('"',"\\\"");
    let status = Command::new("/usr/bin/osascript").args(["-e",&format!("tell application \"Terminal\"\nactivate\ndo script \"{literal}\"\nend tell")]).status().map_err(|e|e.to_string())?;
    return if status.success() { Ok(()) } else { Err("无法打开系统终端".into()) };
    }

    #[cfg(target_os = "linux")]
    {
        let shell = std::env::var_os("SHELL").map(PathBuf::from).filter(|path| path.is_file()).unwrap_or_else(|| PathBuf::from("/bin/sh"));
        for terminal in ["konsole", "x-terminal-emulator", "gnome-terminal", "kgx", "kitty", "foot"] {
            let Ok(path) = executable(terminal) else { continue };
            let mut process = Command::new(path);
            match terminal {
                "gnome-terminal" | "kgx" => { process.arg("--").arg(&shell).args(["-lc", &command]); }
                "kitty" | "foot" => { process.arg(&shell).args(["-lc", &command]); }
                _ => { process.arg("-e").arg(&shell).args(["-lc", &command]); }
            }
            if process.spawn().is_ok() { return Ok(()); }
        }
        return Err("找不到可用终端；请安装 Konsole 或其他常用终端".into());
    }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn worker() -> Worker {
        let mut child=Command::new("/bin/cat").stdin(Stdio::piped()).stdout(Stdio::null()).spawn().unwrap();
        let stdin=child.stdin.take().unwrap();
        Worker {child:Arc::new(Mutex::new(child)),stdin}
    }
    #[test]
    fn disconnecting_one_project_keeps_the_other_process_alive() {
        let bridge=Bridge::default();
        let a=worker();let b=worker();let b_child=b.child.clone();
        bridge.0.lock().unwrap().insert("a".into(),a);
        bridge.0.lock().unwrap().insert("b".into(),b);
        bridge.stop_project("a");
        assert!(!bridge.0.lock().unwrap().contains_key("a"));
        assert!(bridge.0.lock().unwrap().contains_key("b"));
        assert!(b_child.lock().unwrap().try_wait().unwrap().is_none());
        bridge.stop();
        assert!(b_child.lock().unwrap().try_wait().unwrap().is_some());
    }
}

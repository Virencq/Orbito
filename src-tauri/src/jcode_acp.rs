use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, ChildStdin, ChildStdout, Command, Stdio}, sync::{Arc, Mutex, mpsc}, sync::atomic::{AtomicU64, Ordering}, thread, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JCodeEvent { pub session_id: String, pub event: Value }

pub(crate) struct SessionProcess {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    session_id: String,
    next_request_id: AtomicU64,
    permission_requests: Arc<Mutex<HashMap<u64, Value>>>,
}
pub struct JCodeState(pub Arc<Mutex<HashMap<String, SessionProcess>>>);

#[cfg(windows)]
fn configure_no_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    // GUI-launched helper processes must not create a visible console window.
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
}

#[cfg(not(windows))]
fn configure_no_console(_command: &mut Command) {}


#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptImage {
    data: String,
    mime_type: String,
}

#[derive(Debug, Deserialize)]
struct RpcEnvelope { id: Option<Value>, result: Option<Value>, error: Option<Value> }

fn send_rpc(stdin: &Arc<Mutex<ChildStdin>>, id: u64, method: &str, params: Value) -> Result<(), String> {
    let request = json!({"jsonrpc":"2.0","id":id,"method":method,"params":params});
    let mut guard = stdin.lock().map_err(|e| e.to_string())?;
    writeln!(&mut *guard, "{}", request).map_err(|e| format!("Failed to write ACP request: {e}"))?;
    guard.flush().map_err(|e| format!("Failed to flush ACP request: {e}"))
}

fn send_rpc_result(stdin: &Arc<Mutex<ChildStdin>>, id: u64, result: Value) -> Result<(), String> {
    let response = json!({"jsonrpc":"2.0","id":id,"result":result});
    let mut guard = stdin.lock().map_err(|e| e.to_string())?;
    writeln!(&mut *guard, "{}", response).map_err(|e| format!("Failed to write ACP response: {e}"))?;
    guard.flush().map_err(|e| format!("Failed to flush ACP response: {e}"))
}

const JCODE_START_TIMEOUT: Duration = Duration::from_secs(30);

struct ChildKillGuard(Option<Child>);

impl Drop for ChildKillGuard {
    fn drop(&mut self) {
        if let Some(child) = self.0.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn spawn_stdout_reader(stdout: ChildStdout) -> mpsc::Receiver<Result<String, String>> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if tx.send(Ok(line)).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    let _ = tx.send(Err(format!("Failed to read ACP response: {error}")));
                    break;
                }
            }
        }
    });
    rx
}

fn read_until_response(
    response_rx: &mpsc::Receiver<Result<String, String>>,
    request_id: u64,
) -> Result<Value, String> {
    let deadline = Instant::now() + JCODE_START_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(format!("Timed out waiting 30 seconds for JCode ACP response id {request_id}."));
        }
        let line = match response_rx.recv_timeout(remaining) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => return Err(error),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Err(format!("Timed out waiting 30 seconds for JCode ACP response id {request_id}."));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("JCode ACP exited before returning a response.".to_string());
            }
        };
        let Ok(value) = serde_json::from_str::<RpcEnvelope>(line.trim()) else {
            // Some CLI versions print non-JSON banners to stdout; ignore them.
            continue;
        };
        if value.id.as_ref().and_then(Value::as_u64) == Some(request_id) {
            if let Some(error) = value.error {
                return Err(format!("JCode ACP error: {error}"));
            }
            return Ok(value.result.unwrap_or(Value::Null));
        }
    }
}

fn find_jcode() -> Result<PathBuf, String> {
    // A packaged Windows app launched from the Start menu does not necessarily
    // inherit the PATH that was updated in an existing terminal. Check the
    // documented per-user install location before relying on PATH.
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(explicit) = std::env::var_os("JCODE_PATH") {
        candidates.push(PathBuf::from(explicit));
    }

    if cfg!(windows) {
        if let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
            candidates.push(home.join(".jcode").join("bin").join("jcode.exe"));
            candidates.push(home.join(".jcode").join("bin").join("jcode"));
        }
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            candidates.push(local_app_data.join("Programs").join("JCode").join("jcode.exe"));
            candidates.push(local_app_data.join("JCode").join("jcode.exe"));
        }
        if let Some(app_data) = std::env::var_os("APPDATA").map(PathBuf::from) {
            candidates.push(app_data.join("npm").join("jcode.exe"));
        }
        if let Some(path) = std::env::var_os("PATH") {
            candidates.extend(std::env::split_paths(&path).flat_map(|dir| {
                [dir.join("jcode.exe"), dir.join("jcode")].into_iter()
            }));
        }
    } else {
        candidates.push(PathBuf::from("jcode"));
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            candidates.push(home.join(".jcode").join("bin").join("jcode"));
        }
        if let Some(path) = std::env::var_os("PATH") {
            candidates.extend(std::env::split_paths(&path).map(|dir| dir.join("jcode")));
        }
    }

    // De-duplicate candidate paths while retaining priority order.
    let mut seen = std::collections::HashSet::new();
    for candidate in candidates {
        let key = candidate.to_string_lossy().to_ascii_lowercase();
        if !seen.insert(key) {
            continue;
        }
        let executable = if candidate.components().count() == 1 {
            candidate.clone()
        } else if candidate.is_file() {
            candidate.clone()
        } else {
            continue;
        };
        let mut version_command = Command::new(&executable);
        version_command.arg("--version")
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        configure_no_console(&mut version_command);
        if version_command.status().is_ok() {
            return Ok(executable);
        }
    }

    Err("JCode was not found. Checked JCODE_PATH, the per-user JCode install location, and PATH. If JCode is installed, restart Cowork after installation or set JCODE_PATH to the jcode executable.".to_string())
}

fn start_reader(
    app: AppHandle,
    session_key: String,
    response_rx: mpsc::Receiver<Result<String, String>>,
    permission_requests: Arc<Mutex<HashMap<u64, Value>>>,
    sessions: Arc<Mutex<HashMap<String, SessionProcess>>>,
) {
    thread::spawn(move || {
        for line in response_rx {
            let Ok(line) = line else { break };
            let line = line.trim();
            if line.is_empty() { continue; }
            let Ok(value) = serde_json::from_str::<Value>(line) else { continue };
            if value.get("method").and_then(Value::as_str) == Some("session/request_permission") {
                if let Some(id) = value.get("id").and_then(Value::as_u64) {
                    if let Ok(mut requests) = permission_requests.lock() {
                        requests.insert(id, value.clone());
                    }
                }
            }
            if value.get("method").and_then(Value::as_str).is_some() || value.get("result").is_some() || value.get("error").is_some() {
                let _ = app.emit("jcode://event", JCodeEvent { session_id: session_key.clone(), event: value });
            }
        }
        // Remove and reap a process that exited unexpectedly so later prompts
        // cannot keep targeting a dead ACP session in the registry.
        let exited = sessions.lock().ok().and_then(|mut sessions| sessions.remove(&session_key));
        if let Some(mut session) = exited {
            let _ = session.child.wait();
        }
        let _ = app.emit("jcode://event", JCodeEvent {
            session_id: session_key,
            event: json!({"method":"session/closed","params":{"reason":"JCode ACP process exited"}}),
        });
    });
}

#[tauri::command]
pub async fn jcode_start_session(app: AppHandle, state: State<'_, JCodeState>, workspace_dir: Option<String>) -> Result<String, String> {
    let state = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || start_session_blocking(app, state, workspace_dir))
        .await
        .map_err(|e| format!("JCode session start task failed: {e}"))?
}

fn start_session_blocking(app: AppHandle, state: Arc<Mutex<HashMap<String, SessionProcess>>>, workspace_dir: Option<String>) -> Result<String, String> {
    let executable = find_jcode()?;
    let mut command = Command::new(executable);
    configure_no_console(&mut command);
    command.arg("acp").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    if let Some(dir) = workspace_dir.as_deref() { command.current_dir(dir); }
    let child = command.spawn().map_err(|e| format!("Failed to start JCode ACP: {e}"))?;
    let mut child_guard = ChildKillGuard(Some(child));
    let child = child_guard.0.as_mut().ok_or("JCode ACP process unavailable")?;
    let stdin = Arc::new(Mutex::new(child.stdin.take().ok_or("JCode ACP stdin unavailable")?));
    let stdout = child.stdout.take().ok_or("JCode ACP stdout unavailable")?;
    let response_rx = spawn_stdout_reader(stdout);

    send_rpc(&stdin, 1, "initialize", json!({
        "protocolVersion": 1,
        "clientInfo": {"name":"Cowork","version":"0.1.0"},
        "clientCapabilities": {}
    }))?;
    let _ = read_until_response(&response_rx, 1)?;

    let cwd = workspace_dir.clone().unwrap_or_else(|| std::env::current_dir().unwrap_or_default().to_string_lossy().to_string());
    send_rpc(&stdin, 2, "session/new", json!({"cwd": cwd}))?;
    let result = read_until_response(&response_rx, 2)?;
    let session_id = result.get("sessionId").and_then(Value::as_str).ok_or_else(|| format!("JCode ACP did not return sessionId: {result}"))?.to_string();

    let mut sessions = state.lock().map_err(|e| e.to_string())?;
    let child = child_guard.0.take().ok_or("JCode ACP process unavailable")?;
    let permission_requests = Arc::new(Mutex::new(HashMap::new()));
    let process = SessionProcess {
        child,
        stdin: stdin.clone(),
        session_id: session_id.clone(),
        next_request_id: AtomicU64::new(100),
        permission_requests: permission_requests.clone(),
    };
    sessions.insert(session_id.clone(), process);
    drop(sessions);
    start_reader(app, session_id.clone(), response_rx, permission_requests, state.clone());
    Ok(session_id)
}

#[tauri::command]
pub fn jcode_prompt(
    state: State<'_, JCodeState>,
    session_id: String,
    prompt: String,
    images: Option<Vec<PromptImage>>,
) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&session_id).ok_or_else(|| format!("JCode session not found: {session_id}"))?;
    if prompt.trim().is_empty() && images.as_ref().is_none_or(Vec::is_empty) {
        return Err("Prompt cannot be empty.".to_string());
    }

    let mut content = vec![json!({"type":"text","text":prompt})];
    for image in images.unwrap_or_default() {
        if image.data.is_empty() {
            continue;
        }
        if !image.mime_type.starts_with("image/") {
            return Err(format!("Unsupported attachment MIME type: {}", image.mime_type));
        }
        content.push(json!({
            "type": "image",
            "data": image.data,
            "mimeType": image.mime_type,
        }));
    }

    let request_id = session.next_request_id.fetch_add(1, Ordering::Relaxed);
    send_rpc(&session.stdin, request_id, "session/prompt", json!({
        "sessionId": session.session_id,
        "prompt": content
    }))?;
    // ACP is streamed: return immediately after the request is written.
    // The background reader forwards session/update chunks and the final
    // session/prompt response to the frontend through jcode://event.
    Ok(())
}

#[tauri::command]
pub fn jcode_permission_response(
    state: State<'_, JCodeState>,
    session_id: String,
    request_id: String,
    approve: bool,
) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&session_id).ok_or_else(|| format!("JCode session not found: {session_id}"))?;
    let id = request_id.parse::<u64>().map_err(|_| format!("Invalid ACP permission request id: {request_id}"))?;

    let request = session.permission_requests.lock().map_err(|e| e.to_string())?.get(&id).cloned()
        .ok_or_else(|| format!("ACP permission request not found: {request_id}"))?;
    let options = request.get("params")
        .and_then(|v| v.get("options"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let selected = options.iter().find(|option| {
        option.get("kind").and_then(Value::as_str).map(|kind| {
            if approve { kind == "allow_once" || kind == "allow_always" }
            else { kind == "reject_once" || kind == "reject_always" }
        }).unwrap_or(false)
    });

    let result = if let Some(option) = selected {
        let option_id = option.get("optionId").and_then(Value::as_str)
            .or_else(|| option.get("id").and_then(Value::as_str))
            .ok_or("ACP permission option has no optionId.")?;
        json!({"outcome":{"outcome":"selected","optionId":option_id}})
    } else {
        json!({"outcome":{"outcome":"cancelled"}})
    };

    send_rpc_result(&session.stdin, id, result)?;
    {
        let mut requests = session.permission_requests.lock().map_err(|e| e.to_string())?;
        requests.remove(&id);
    }
    Ok(())
}

#[tauri::command]
pub fn jcode_cancel(state: State<'_, JCodeState>, session_id: String) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&session_id).ok_or_else(|| format!("JCode session not found: {session_id}"))?;
    let request_id = session.next_request_id.fetch_add(1, Ordering::Relaxed);
    send_rpc(
        &session.stdin,
        request_id,
        "session/cancel",
        json!({"sessionId": session.session_id}),
    )
}

#[tauri::command]
pub fn jcode_close_session(state: State<'_, JCodeState>, session_id: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&session_id) {
        // Never block the UI indefinitely waiting for an ACP process to exit.
        // JCode receives the close request, then the process is terminated
        // explicitly if it does not exit on its own.
        let request_id = session.next_request_id.fetch_add(1, Ordering::Relaxed);
        let _ = send_rpc(
            &session.stdin,
            request_id,
            "session/close",
            json!({"sessionId": session.session_id}),
        );
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}

/// Close all child ACP processes when the desktop application exits.
pub fn shutdown_all(state: &JCodeState) {
    let sessions = match state.0.lock() {
        Ok(mut sessions) => std::mem::take(&mut *sessions),
        Err(_) => return,
    };

    for (_, mut session) in sessions {
        let request_id = session.next_request_id.fetch_add(1, Ordering::Relaxed);
        let _ = send_rpc(
            &session.stdin,
            request_id,
            "session/close",
            json!({"sessionId": session.session_id}),
        );
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
}

#[tauri::command]
pub async fn jcode_status() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        match find_jcode() {
            Ok(path) => Ok(json!({"installed":true,"path":path.to_string_lossy(),"command":"jcode acp"})),
            Err(error) => Ok(json!({"installed":false,"error":error})),
        }
    })
    .await
    .map_err(|e| format!("JCode status task failed: {e}"))?
}


#[tauri::command]
pub fn jcode_runtime_info() -> Result<Value, String> {
    let executable = find_jcode()?;
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or("Unable to resolve the user home directory.")?;
    let config_path = home.join(".jcode").join("config.json");
    let skills_path = home.join(".jcode").join("skills");
    let mcp_path = home.join(".jcode").join("mcp.json");

    // Read only the documented JCode config. Never write credentials or infer
    // active model settings from arbitrary CLI output.
    let config: Value = if config_path.exists() {
        let raw = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read JCode config {}: {e}", config_path.display()))?;
        serde_json::from_str(&raw)
            .map_err(|e| format!("Invalid JSON in JCode config {}: {e}", config_path.display()))?
    } else {
        Value::Object(serde_json::Map::new())
    };

    let model = config.get("model").and_then(Value::as_str).map(str::to_owned);
    let provider = model.as_deref().and_then(|value| value.split_once('/').map(|(p, _)| p.to_owned()));
    let small_model = config.get("small_model").and_then(Value::as_str);
    let default_mode = config.get("default_mode").and_then(Value::as_str).unwrap_or("approval");
    let default_context_limit = config.get("default_context_limit").and_then(Value::as_u64);
    let context_limit_count = config.get("context_limits").and_then(Value::as_object).map(|v| v.len()).unwrap_or(0);
    let compaction = config.get("compaction");
    let compaction_enabled = compaction.and_then(|v| v.get("enabled")).and_then(Value::as_bool).unwrap_or(false);
    let compaction_threshold = compaction.and_then(|v| v.get("threshold")).and_then(Value::as_f64);
    let disabled_skills = config.get("disabled_skills").and_then(Value::as_array).map(|v| v.len()).unwrap_or(0);
    let mcp_configured = config.get("mcp_servers").and_then(Value::as_object).map(|v| v.len()).unwrap_or(0);

    Ok(json!({
        "installed": true,
        "path": executable.to_string_lossy(),
        "configPath": config_path.to_string_lossy(),
        "configExists": config_path.is_file(),
        "skillsPath": skills_path.to_string_lossy(),
        "skillsExists": skills_path.is_dir(),
        "mcpPath": mcp_path.to_string_lossy(),
        "mcpConfigExists": mcp_path.is_file(),
        "provider": provider,
        "model": model,
        "smallModel": small_model,
        "defaultMode": default_mode,
        "defaultContextLimit": default_context_limit,
        "contextLimitOverrides": context_limit_count,
        "compactionEnabled": compaction_enabled,
        "compactionThreshold": compaction_threshold,
        "configuredMcpServers": mcp_configured,
        "disabledSkills": disabled_skills
    }))
}

#[tauri::command]
pub fn jcode_update_runtime_settings(
    default_mode: String,
    default_context_limit: u64,
    compaction_enabled: bool,
    compaction_threshold: f64,
) -> Result<Value, String> {
    if !matches!(default_mode.as_str(), "approval" | "plan" | "full_access") {
        return Err("Invalid default mode. Use approval, plan, or full_access.".to_string());
    }
    if !(1024..=2_000_000).contains(&default_context_limit) {
        return Err("Default context limit must be between 1,024 and 2,000,000 tokens.".to_string());
    }
    if !compaction_threshold.is_finite() || !(0.5..=0.99).contains(&compaction_threshold) {
        return Err("Compaction threshold must be between 0.50 and 0.99.".to_string());
    }

    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or("Unable to resolve the user home directory.")?;
    let directory = home.join(".jcode");
    std::fs::create_dir_all(&directory)
        .map_err(|e| format!("Failed to create JCode config directory {}: {e}", directory.display()))?;
    let path = directory.join("config.json");

    let mut config = if path.exists() {
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read JCode config {}: {e}", path.display()))?;
        serde_json::from_str::<Value>(&raw)
            .map_err(|e| format!("Invalid JSON in JCode config {}: {e}", path.display()))?
    } else {
        json!({})
    };
    let object = config.as_object_mut()
        .ok_or("JCode config must be a JSON object; file was not changed.")?;
    object.insert("default_mode".to_string(), json!(default_mode));
    object.insert("default_context_limit".to_string(), json!(default_context_limit));

    let compaction = object.entry("compaction".to_string())
        .or_insert_with(|| json!({}));
    let compaction_object = compaction.as_object_mut()
        .ok_or("JCode compaction config must be a JSON object; file was not changed.")?;
    compaction_object.insert("enabled".to_string(), json!(compaction_enabled));
    compaction_object.insert("threshold".to_string(), json!(compaction_threshold));

    let serialized = serde_json::to_vec_pretty(&config)
        .map_err(|e| format!("Failed to serialize JCode config: {e}"))?;
    std::fs::write(&path, serialized)
        .map_err(|e| format!("Failed to write JCode config {}: {e}", path.display()))?;

    jcode_runtime_info()
}

#[tauri::command]
pub async fn jcode_doctor() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let executable = find_jcode()?;
        let mut command = Command::new(executable);
        configure_no_console(&mut command);
        command.args(["doctor"]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let output = command.output().map_err(|e| format!("Failed to run jcode doctor: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Ok(json!({
            "success": output.status.success(),
            "code": output.status.code(),
            "stdout": stdout,
            "stderr": stderr,
            "command": "jcode doctor"
        }))
    })
    .await
    .map_err(|e| format!("JCode doctor task failed: {e}"))?
}

#[tauri::command]
pub fn jcode_sync_mcp_config(servers: Value) -> Result<Value, String> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(std::path::PathBuf::from).ok_or("Unable to resolve the user home directory.")?;
    let dir = home.join(".jcode");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create JCode config directory: {e}"))?;
    let path = dir.join("mcp.json");

    let mut desired = serde_json::Map::new();
    if let Some(items) = servers.as_array() {
        for server in items {
            if server.get("type").and_then(Value::as_str).unwrap_or("stdio") != "stdio" {
                continue;
            }
            let Some(name) = server.get("name").and_then(Value::as_str) else { continue };
            let Some(command) = server.get("command").and_then(Value::as_str) else { continue };
            if server.get("disabled").and_then(Value::as_bool).unwrap_or(false) {
                continue;
            }
            let mut entry = serde_json::Map::new();
            entry.insert("command".into(), Value::String(command.to_string()));
            if let Some(args) = server.get("args") { entry.insert("args".into(), args.clone()); }
            if let Some(env) = server.get("env") { entry.insert("env".into(), env.clone()); }
            desired.insert(name.to_string(), Value::Object(entry));
        }
    }

    let managed_path = dir.join("cowork-mcp-managed.json");
    // New manifests store the exact config Cowork last wrote. Older versions
    // stored only names; those names cannot prove that a user has not edited
    // an entry, so legacy entries are deliberately treated conservatively.
    let previous_manifest: Value = match std::fs::read_to_string(&managed_path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|e| format!("Invalid Cowork MCP ownership manifest at {}: {e}", managed_path.display()))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(e) => return Err(format!("Failed to read {}: {e}", managed_path.display())),
    };
    let previous_values = previous_manifest.as_object();
    let legacy_names: Vec<String> = previous_manifest.as_array()
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default();

    // Fail closed: never replace a malformed existing file with an empty
    // object. That would silently erase the user's JCode MCP configuration.
    let mut config = if path.exists() {
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
        serde_json::from_str::<Value>(&raw)
            .map_err(|e| format!("Invalid JSON in {}; refusing to overwrite it: {e}", path.display()))?
    } else {
        json!({})
    };
    if !config.is_object() {
        return Err(format!("Invalid JCode MCP config at {}: root must be a JSON object; refusing to overwrite it.", path.display()));
    }

    let root = config.as_object_mut().ok_or("Invalid JCode MCP config.")?;
    if root.get("mcpServers").is_some_and(|v| !v.is_object()) {
        return Err(format!("Invalid JCode MCP config at {}: mcpServers must be an object; refusing to overwrite it.", path.display()));
    }
    let existing = root.entry("mcpServers").or_insert_with(|| json!({}));
    let map = existing.as_object_mut().ok_or("JCode mcpServers must be an object.")?;

    // Remove stale entries only when the on-disk value still exactly matches
    // the snapshot Cowork recorded. If a user edited an entry after sync, it
    // is no longer safe for Cowork to claim or delete it.
    if let Some(previous) = previous_values {
        for (name, last_written) in previous {
            if !desired.contains_key(name) && map.get(name) == Some(last_written) {
                map.remove(name);
            }
        }
    }

    // Never overwrite a same-name JCode entry unless the manifest proves it
    // is the unchanged entry Cowork previously managed. This avoids losing
    // independently configured MCP servers through name collisions.
    for (name, new_value) in &desired {
        if let Some(current) = map.get(name) {
            let owned_and_unchanged = previous_values
                .and_then(|previous| previous.get(name))
                .is_some_and(|last_written| last_written == current);
            if !owned_and_unchanged {
                let legacy_claim = legacy_names.iter().any(|managed_name| managed_name == name);
                let detail = if legacy_claim {
                    "a legacy ownership record has no value snapshot"
                } else {
                    "the entry is not owned by Cowork"
                };
                return Err(format!(
                    "MCP server name conflict for '{name}' in {} ({detail}). Rename the Cowork server or resolve the conflict manually; the existing JCode configuration was left unchanged.",
                    path.display()
                ));
            }
        }
        map.insert(name.clone(), new_value.clone());
    }

    let server_count = map.len();
    // Persist the ownership snapshot before the config. If the second write
    // fails, the next run can safely reconcile by comparing exact values.
    let manifest = Value::Object(desired.clone());
    std::fs::write(
        &managed_path,
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    ).map_err(|e| format!("Failed to write Cowork MCP ownership manifest: {e}"))?;

    let content = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write JCode MCP config: {e}"))?;
    Ok(json!({"path": path.to_string_lossy(), "servers": server_count}))
}

/// Read JCode's on-disk MCP configuration so the settings UI can import servers
/// that were added outside Cowork. This is read-only and never rewrites the file.
#[tauri::command]
pub fn jcode_read_mcp_config() -> Result<Value, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or("Unable to resolve the user home directory.")?;
    let path = home.join(".jcode").join("mcp.json");
    if !path.exists() {
        return Ok(json!({ "mcpServers": {} }));
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    serde_json::from_str::<Value>(&raw)
        .map_err(|e| format!("Invalid JSON in {}: {e}", path.display()))
}

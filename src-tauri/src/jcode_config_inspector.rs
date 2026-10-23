use serde::Serialize;
use serde_json::{json, Value};
use std::{env, fs, path::PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InspectedFile {
    name: String,
    path: String,
    exists: bool,
    bytes: Option<u64>,
    valid_json: Option<bool>,
    note: String,
}

fn jcode_home() -> Result<PathBuf, String> {
    let home = env::var_os("JCODE_HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "Could not resolve JCode home (JCODE_HOME, USERPROFILE, or HOME).".to_string())?;
    if env::var_os("JCODE_HOME").is_some() {
        Ok(home)
    } else {
        Ok(home.join(".jcode"))
    }
}

fn read_json(path: &PathBuf) -> Option<Value> {
    fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok())
}

fn count_named_entries(value: &Value, key: &str) -> usize {
    match value {
        Value::Object(map) => {
            let own = map.get(key).map_or(0, |entries| match entries {
                Value::Array(items) => items.len(),
                Value::Object(items) => items.len(),
                _ => 0,
            });
            own + map.iter()
                .filter(|(name, _)| name.as_str() != key)
                .map(|(_, child)| count_named_entries(child, key))
                .sum::<usize>()
        }
        Value::Array(items) => items.iter().map(|child| count_named_entries(child, key)).sum(),
        _ => 0,
    }
}

fn toml_tool_settings(path: &PathBuf) -> (Option<String>, Option<u64>) {
    let Ok(text) = fs::read_to_string(path) else { return (None, None) };
    let mut section = String::new();
    let mut tools = None;
    let mut threshold = None;
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.starts_with('[') && line.ends_with(']') {
            section = line.trim_matches(&['[', ']'][..]).trim().to_string();
            continue;
        }
        if section != "tools" { continue; }
        if let Some((key, value)) = line.split_once('=') {
            match key.trim() {
                "mcp_tools" => tools = Some(value.trim().trim_matches('"').trim_matches('\'').to_string()),
                "mcp_tools_token_threshold" => threshold = value.trim().parse::<u64>().ok(),
                _ => {}
            }
        }
    }
    (tools, threshold)
}

fn file_info(home: &PathBuf, name: &str) -> InspectedFile {
    let path = home.join(name);
    match fs::metadata(&path) {
        Ok(metadata) => {
            let valid_json = if name.ends_with(".json") {
                fs::read_to_string(&path).ok().map(|text| serde_json::from_str::<Value>(&text).is_ok())
            } else { None };
            let note = match valid_json {
                Some(true) => "JSON readable; sensitive contents omitted".to_string(),
                Some(false) => "JSON missing or invalid; contents omitted".to_string(),
                None => "File exists; contents not displayed".to_string(),
            };
            InspectedFile { name: name.to_string(), path: path.display().to_string(), exists: true, bytes: Some(metadata.len()), valid_json, note }
        }
        Err(_) => InspectedFile { name: name.to_string(), path: path.display().to_string(), exists: false, bytes: None, valid_json: None, note: "Not found".to_string() }
    }
}

/// Read-only, targeted inspection of JCode's own configuration home.
/// Reports metadata and selected non-secret settings only; never returns file contents.
#[tauri::command]
pub fn jcode_inspect_config() -> Result<Value, String> {
    let home = jcode_home()?;
    let names = [
        "config.toml",
        "config.json",
        "mcp.json",
        "cowork-mcp-managed.json",
        "mcp-schema-cache.json",
        "remote_header_hint.json",
        "servers.json",
        "AGENTS.md",
    ];
    let files: Vec<InspectedFile> = names.iter().map(|name| file_info(&home, name)).collect();

    let (mcp_tools, mcp_tools_token_threshold) = toml_tool_settings(&home.join("config.toml"));
    let config = read_json(&home.join("config.json"));
    let mcp = read_json(&home.join("mcp.json"));
    let managed = read_json(&home.join("cowork-mcp-managed.json"));
    let cache = read_json(&home.join("mcp-schema-cache.json"));
    let hint = read_json(&home.join("remote_header_hint.json"));

    let configured_mcp_servers = mcp.as_ref()
        .and_then(|v| v.get("mcpServers").or_else(|| v.get("servers")))
        .and_then(Value::as_object).map(|v| v.len());
    let managed_mcp_servers = managed.as_ref().and_then(Value::as_object).map(|v| v.len())
        .or_else(|| managed.as_ref().and_then(Value::as_array).map(Vec::len));
    let cached_tool_entries = cache.as_ref().map(|v| count_named_entries(v, "tools"));
    let cache_top_level_keys = cache.as_ref().and_then(Value::as_object).map(|v| v.len());
    let context_limit = hint.as_ref().and_then(|v| v.pointer("/session/context_limit").or_else(|| v.pointer("/session/contextLimit"))).and_then(Value::as_u64);
    let provider = hint.as_ref().and_then(|v| v.pointer("/session/provider_name").or_else(|| v.pointer("/session/providerName"))).and_then(Value::as_str);
    let model = hint.as_ref().and_then(|v| v.pointer("/session/provider_model").or_else(|| v.pointer("/session/providerModel"))).and_then(Value::as_str);
    let config_profile = config.as_ref().and_then(|v| v.get("mcpProfile").or_else(|| v.get("mcp_profile"))).and_then(Value::as_str);
    let tool_profile = config.as_ref().and_then(|v| v.get("tool_profile").or_else(|| v.get("toolProfile"))).and_then(Value::as_str);

    Ok(json!({
        "home": home.to_string_lossy(),
        "files": files,
        "settings": {
            "mcpTools": mcp_tools,
            "mcpToolsTokenThreshold": mcp_tools_token_threshold,
            "mcpProfile": config_profile,
            "toolProfile": tool_profile,
            "configuredMcpServers": configured_mcp_servers,
            "managedMcpServers": managed_mcp_servers,
            "cachedToolArrayEntries": cached_tool_entries,
            "schemaCacheTopLevelKeys": cache_top_level_keys,
            "provider": provider,
            "model": model,
            "contextLimit": context_limit
        },
        "interpretation": [
            "This is a read-only file/configuration inspection; it does not prove which schemas are sent to the model.",
            "A schema cache may contain all tools even when runtime filtering exposes only a subset.",
            "Runtime lazy-loading activation requires request-level instrumentation or authoritative runtime logs."
        ],
        "secretsExposed": false
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_named_entries_recursively_without_reading_contents() {
        let value = json!({"servers":[{"tools":[{"name":"a"},{"name":"b"}]},{"nested":{"tools":[{"name":"c"}]}}]});
        assert_eq!(count_named_entries(&value, "tools"), 3);
    }

    #[test]
    fn parses_tool_settings_from_toml() {
        let unique = format!("orbito-jcode-inspector-test-{}.toml", std::process::id());
        let path = std::env::temp_dir().join(unique);
        fs::write(&path, "[tools]\nmcp_tools = \"auto\"\nmcp_tools_token_threshold = 8000\n").unwrap();
        let (mode, threshold) = toml_tool_settings(&path);
        let _ = fs::remove_file(&path);
        assert_eq!(mode.as_deref(), Some("auto"));
        assert_eq!(threshold, Some(8000));
    }
}

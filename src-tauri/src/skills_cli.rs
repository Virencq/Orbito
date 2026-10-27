use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
fn configure_no_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    // GUI-launched helper processes must not create a visible console window.
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
}

#[cfg(not(windows))]
fn configure_no_console(_command: &mut Command) {}

use std::time::Duration;

/// Search result from skills.sh API
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SkillsSearchResult {
    pub id: String,
    pub name: String,
    pub source: String,
    pub installs: i64,
}

/// Skills.sh API response wrapper
#[derive(Deserialize)]
struct SkillsSearchResponse {
    skills: Vec<SkillsSearchResult>,
}

/// Result of a skills CLI installation
#[derive(Serialize, Clone, Debug)]
pub struct SkillInstallResult {
    pub success: bool,
    pub message: String,
    pub skill_name: Option<String>,
    pub skill_path: Option<String>,
}

// ─── Mirror configuration ───

fn get_skills_api_url() -> String {
    std::env::var("S_LOOP_SKILLS_API_URL")
        .unwrap_or_else(|_| "https://skills.sh".to_string())
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// Replace characters that are invalid in file/directory names on any platform.
fn sanitize_dir_name(raw: &str) -> String {
    raw.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect::<String>()
        .trim_matches(|c: char| c == '.' || c == ' ')
        .to_string()
}

fn percent_encode(query: &str) -> String {
    let mut result = String::new();
    for byte in query.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
            | b'-' | b'_' | b'.' | b'~' => result.push(byte as char),
            b' ' => result.push_str("%20"),
            _ => result.push_str(&format!("%{:02X}", byte)),
        }
    }
    result
}

// ─── npx resolution (cross-platform — GUI apps may not inherit user PATH) ───

/// Find the npx executable by searching common installation paths.
/// GUI apps on all platforms may not inherit shell-configured PATH.
fn find_npx_cmd() -> Option<PathBuf> {
    let npx_name = if cfg!(target_os = "windows") {
        "npx.cmd"
    } else {
        "npx"
    };

    // 1. Try the system's command locator
    let locator = if cfg!(target_os = "windows") { "where" } else { "which" };
    let mut locate_npx = Command::new(locator);
    locate_npx.arg(npx_name);
    configure_no_console(&mut locate_npx);
    if let Ok(output) = locate_npx.output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(line) = stdout.lines().next() {
            let p = line.trim();
            if !p.is_empty() && std::path::Path::new(p).exists() {
                return Some(PathBuf::from(p));
            }
        }
    }

    // 2. Search common Node.js install directories (cross-platform)
    let home = dirs_home();
    let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
        vec![
            r"C:\Program Files\nodejs\npx.cmd".into(),
            r"C:\Program Files (x86)\nodejs\npx.cmd".into(),
            home.join("AppData").join("Roaming").join("npm").join("npx.cmd"),
        ]
    } else {
        vec![
            // Homebrew (Intel Mac)
            "/usr/local/bin/npx".into(),
            // Homebrew (Apple Silicon Mac)
            "/opt/homebrew/bin/npx".into(),
            // System
            "/usr/bin/npx".into(),
            // Volta (cross-platform version manager)
            home.join(".volta").join("bin").join("npx"),
            // fnm (cross-platform version manager)
            home.join(".local").join("share").join("fnm").join("node-versions"),
        ]
    };

    for candidate in &candidates {
        if candidate.exists() {
            return Some(candidate.clone());
        }
    }

    // 3. Search for node and derive npx path
    let mut locate_node = Command::new(locator);
    locate_node.arg(if cfg!(target_os = "windows") { "node.exe" } else { "node" });
    configure_no_console(&mut locate_node);
    if let Ok(output) = locate_node.output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let node_path = PathBuf::from(line.trim());
            if let Some(parent) = node_path.parent() {
                let npx = parent.join(npx_name);
                if npx.exists() {
                    return Some(npx);
                }
            }
        }
    }

    // 4. nvm: search ~/.nvm/versions/node/*/bin/npx
    let nvm_versions = home.join(".nvm").join("versions").join("node");
    if nvm_versions.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
            for entry in entries.flatten() {
                let npx = entry.path().join("bin").join("npx");
                if npx.exists() {
                    return Some(npx);
                }
            }
        }
    }

    None
}

/// Build a Command for npx, using resolved path when available
fn npx_command() -> Command {
    let mut command = if let Some(npx_path) = find_npx_cmd() {
        Command::new(npx_path)
    } else {
        Command::new("npx")
    };
    configure_no_console(&mut command);
    command
}

// ─── Skills CLI commands ───

/// Search skills via skills.sh API (supports mirror)
#[tauri::command]
pub async fn skills_cli_search(query: String) -> Result<Vec<SkillsSearchResult>, String> {
    let api_base = get_skills_api_url();
    let encoded = percent_encode(&query);
    let url = format!("{}/api/search?q={}&limit=24", api_base, encoded);

    let client = reqwest::Client::builder()
        .user_agent("S-Loop/0.1.0")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let res = client.get(&url).send().await.map_err(|e| format!("Search request failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("Search API returned status {}", res.status()));
    }

    let data = res
        .json::<SkillsSearchResponse>()
        .await
        .map_err(|e| format!("Failed to parse search response: {e}"))?;

    let mut skills = data.skills;
    skills.sort_by(|a, b| b.installs.cmp(&a.installs));
    Ok(skills)
}

/// Update installed skills via npx skills CLI
#[tauri::command]
pub async fn skills_cli_update() -> Result<String, String> {
    let api_url = get_skills_api_url();

    let output = npx_command()
        .args(["skills", "update", "-y"])
        .env("SKILLS_API_URL", &api_url)
        .output()
        .map_err(|e| format!("Failed to run npx skills update: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!("Update failed:\n{}\n{}", stdout, stderr));
    }

    Ok(stdout)
}

/// Remove a skill via npx skills CLI
#[tauri::command]
pub async fn skills_cli_remove(skill_name: String) -> Result<String, String> {
    let output = npx_command()
        .args([
            "skills",
            "remove",
            &skill_name,
            // The app owns JCode's global skill directory directly; no legacy
            // Pi/third-party agent target is involved.
            "--agent",
            "jcode",
            "-g",
            "-y",
        ])
        .output()
        .map_err(|e| format!("Failed to run npx skills remove: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!("Remove failed:\n{}\n{}", stdout, stderr));
    }

    Ok(stdout)
}

/// Delete a skill's directory from disk.
/// First tries the skill's actual location (extracted from the stored path),
/// then falls back to ~/.jcode/skills/{name}/.
#[tauri::command]
pub fn delete_skill_files(skill_name: String, skill_path: Option<String>) -> Result<String, String> {
    // Try the actual skill path first (from the stored location)
    if let Some(ref loc) = skill_path {
        let loc_path = std::path::Path::new(loc);
        // If loc is a SKILL.md file path, delete its parent directory
        let dir_to_delete = if loc_path.is_file()
            || loc_path.extension().map(|e| e == "md").unwrap_or(false)
        {
            loc_path.parent().map(|p| p.to_path_buf())
        } else {
            Some(loc_path.to_path_buf())
        };

        if let Some(dir) = dir_to_delete {
            if dir.exists() {
                std::fs::remove_dir_all(&dir)
                    .map_err(|e| format!("Failed to delete skill directory {}: {}", dir.display(), e))?;
                return Ok(format!("Deleted skill directory: {}", dir.display()));
            }
        }
    }

    // Fallback: try ~/.jcode/skills/{name}/
    let dir = dirs_home().join(".jcode").join("skills").join(&skill_name);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|e| format!("Failed to delete skill directory: {e}"))?;
        Ok(format!("Deleted skill directory: {}", dir.display()))
    } else {
        Ok(format!("Skill directory not found for: {}", skill_name))
    }
}

/// Write a new SKILL.md file to ~/.jcode/skills/{name}/SKILL.md.
/// Returns the path to the created skill directory.
#[tauri::command]
pub fn create_skill_file(name: String, description: String, content: String) -> Result<String, String> {
    let safe_name = sanitize_dir_name(&name);
    let skills_dir = dirs_home().join(".jcode").join("skills");
    let skill_dir = skills_dir.join(&safe_name);
    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create skill directory: {e}"))?;

    let frontmatter = format!(
        "---\nname: {}\ndescription: {}\n---\n\n{}",
        name, description, content
    );
    let skill_md = skill_dir.join("SKILL.md");
    std::fs::write(&skill_md, frontmatter)
        .map_err(|e| format!("Failed to write SKILL.md: {e}"))?;

    Ok(skill_dir.to_string_lossy().to_string())
}

/// Check current mirror configuration

#[tauri::command]
pub async fn clawhub_install_skill(
    slug: String,
    skill_name: Option<String>,
) -> Result<SkillInstallResult, String> {
    let slug = slug.trim();
    if slug.is_empty() || slug.contains("..") || slug.contains('/') || slug.contains('\\') {
        return Err("Invalid ClawHub skill slug.".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("Orbito/0.1.0 (JCode skill installer)")
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get(format!("https://clawhub.ai/api/v1/download?slug={}", urlencoding::encode(slug)))
        .send()
        .await
        .map_err(|e| format!("ClawHub download failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format!("ClawHub download returned HTTP {status}: {}", detail.chars().take(500).collect::<String>()));
    }
    let mut bytes = response.bytes().await
        .map_err(|e| format!("Failed to read ClawHub download: {e}"))?
        .to_vec();
    if bytes.is_empty() {
        return Err("ClawHub returned an empty skill archive.".to_string());
    }

    // ClawHub may return a public-github handoff descriptor instead of ZIP bytes
    // for GitHub-backed skills. Resolve only the documented, trusted archive hosts.
    if bytes.iter().copied().find(|byte| !byte.is_ascii_whitespace()) == Some(b'{') {
        let descriptor: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|e| format!("ClawHub returned JSON instead of a ZIP archive: {e}"))?;
        if descriptor.get("sourceRef").and_then(serde_json::Value::as_str) != Some("public-github") {
            return Err("ClawHub returned an unsupported download descriptor.".to_string());
        }
        let archive_url = descriptor.get("archiveUrl").and_then(serde_json::Value::as_str)
            .ok_or("ClawHub GitHub handoff did not include archiveUrl.")?;
        let parsed_url = reqwest::Url::parse(archive_url)
            .map_err(|e| format!("Invalid ClawHub archive URL: {e}"))?;
        let host = parsed_url.host_str().unwrap_or_default();
        if parsed_url.scheme() != "https" || !matches!(host, "github.com" | "codeload.github.com") {
            return Err(format!("Refusing untrusted ClawHub archive host: {host}"));
        }
        let archive_response = client.get(parsed_url).send().await
            .map_err(|e| format!("Failed to fetch the GitHub-backed skill archive: {e}"))?;
        let final_host = archive_response.url().host_str().unwrap_or_default();
        if !matches!(final_host, "github.com" | "codeload.github.com") {
            return Err(format!("GitHub skill archive redirected to an untrusted host: {final_host}"));
        }
        let archive_status = archive_response.status();
        if !archive_status.is_success() {
            let detail = archive_response.text().await.unwrap_or_default();
            return Err(format!("GitHub skill archive returned HTTP {archive_status}: {}", detail.chars().take(500).collect::<String>()));
        }
        bytes = archive_response.bytes().await
            .map_err(|e| format!("Failed to read the GitHub skill archive: {e}"))?
            .to_vec();
        if bytes.is_empty() {
            return Err("The GitHub skill archive was empty.".to_string());
        }
    }

    let cursor = Cursor::new(bytes.as_slice());
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("ClawHub response was not a valid ZIP archive: {e}"))?;

    struct FoundSkill { base_dir: String, frontmatter_name: String }
    let mut found_skills: Vec<FoundSkill> = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Failed to inspect ZIP entry: {e}"))?;
        let path = entry.name().replace('\\', "/");
        if path.split('/').any(|part| part == "..") || path.starts_with('/') {
            return Err(format!("Unsafe path in downloaded skill archive: {path}"));
        }
        if !path.to_ascii_lowercase().ends_with("skill.md") { continue; }
        let mut content = String::new();
        std::io::Read::read_to_string(&mut entry, &mut content)
            .map_err(|e| format!("Failed to read {path}: {e}"))?;
        let (meta, _) = crate::commands::parse_frontmatter(&content);
        let frontmatter_name = meta.get("name").cloned().unwrap_or_else(|| {
            std::path::Path::new(&path).parent().and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| slug.to_string())
        });
        let base_dir = std::path::Path::new(&path).parent()
            .filter(|p| !p.as_os_str().is_empty())
            .map(|p| format!("{}/", p.to_string_lossy())).unwrap_or_default();
        found_skills.push(FoundSkill { base_dir, frontmatter_name });
    }
    if found_skills.is_empty() {
        return Err("No SKILL.md found in the downloaded ClawHub archive. The published package may be invalid.".to_string());
    }

    let selected = if let Some(filter) = skill_name.as_deref() {
        let filter = filter.trim().to_lowercase();
        found_skills.iter().find(|s| s.frontmatter_name.to_lowercase() == filter)
            .or_else(|| found_skills.first())
    } else { found_skills.first() }.ok_or("No skill found in archive.")?;

    let display_name = selected.frontmatter_name.clone();
    let dir_name = sanitize_dir_name(&display_name);
    if dir_name.is_empty() || dir_name == "." || dir_name == ".." {
        return Err("The skill package contains an invalid skill name.".to_string());
    }

    // JCode's documented global skill directory is ~/.jcode/skills/{name}/SKILL.md.
    let skills_dir = dirs_home().join(".jcode").join("skills");
    let dest_dir = skills_dir.join(&dir_name);
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create JCode skill directory {}: {e}", dest_dir.display()))?;

    let base = selected.base_dir.clone();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Failed to read ZIP entry: {e}"))?;
        let path = entry.name().replace('\\', "/");
        if entry.is_dir() || path.ends_with('/') { continue; }
        if path.split('/').any(|part| part == "..") || path.starts_with('/') {
            return Err(format!("Unsafe path in downloaded skill archive: {path}"));
        }
        let rel_path = if base.is_empty() {
            std::path::Path::new(&path).file_name().map(PathBuf::from).unwrap_or_default()
        } else if path.starts_with(&base) {
            PathBuf::from(&path[base.len()..])
        } else { continue };
        if rel_path.as_os_str().is_empty() { continue; }
        let output = dest_dir.join(&rel_path);
        if !output.starts_with(&dest_dir) {
            return Err(format!("Refusing to write outside the skill directory: {}", output.display()));
        }
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create skill subdirectory {}: {e}", parent.display()))?;
        }
        let mut buf = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut buf)
            .map_err(|e| format!("Failed to extract {}: {e}", path))?;
        std::fs::write(&output, &buf)
            .map_err(|e| format!("Failed to write skill file {}: {e}", output.display()))?;
    }

    let skill_md = dest_dir.join("SKILL.md");
    if !skill_md.is_file() {
        return Err(format!("Skill archive extraction finished but {} is missing.", skill_md.display()));
    }
    Ok(SkillInstallResult {
        success: true,
        message: format!("Installed {} to {}. JCode loads skills from ~/.jcode/skills.", display_name, dest_dir.display()),
        skill_name: Some(display_name),
        skill_path: Some(dest_dir.to_string_lossy().to_string()),
    })
}

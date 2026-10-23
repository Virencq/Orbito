use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::SystemTime,
};

#[derive(serde::Serialize)]
pub struct GlobalInstructionsDocument {
    path: String,
    content: String,
}

struct CachedInstructions {
    path: PathBuf,
    modified: Option<SystemTime>,
    len: Option<u64>,
    content: String,
}

static INSTRUCTIONS_CACHE: OnceLock<Mutex<Option<CachedInstructions>>> = OnceLock::new();

fn instructions_cache() -> &'static Mutex<Option<CachedInstructions>> {
    INSTRUCTIONS_CACHE.get_or_init(|| Mutex::new(None))
}

fn global_instructions_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "Could not determine the user home directory".to_string())?;
    Ok(PathBuf::from(home).join(".jcode").join("AGENTS.md"))
}

#[tauri::command]
pub fn jcode_read_global_instructions() -> Result<GlobalInstructionsDocument, String> {
    let path = global_instructions_path()?;

    // Check file metadata on each call so edits made outside Orbito are picked
    // up too. The potentially larger file read is skipped while the file is
    // unchanged. Missing files are cached as empty until they appear.
    let (modified, len) = match fs::metadata(&path) {
        Ok(metadata) => (
            Some(metadata.modified().map_err(|error| {
                format!("Could not inspect global instructions timestamp: {error}")
            })?),
            Some(metadata.len()),
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (None, None),
        Err(error) => return Err(format!("Could not inspect global instructions: {error}")),
    };

    let mut cache = instructions_cache()
        .lock()
        .map_err(|_| "Global instructions cache lock was poisoned".to_string())?;

    if let Some(cached) = cache.as_ref() {
        if cached.path == path && cached.modified == modified && cached.len == len {
            return Ok(GlobalInstructionsDocument {
                path: path.display().to_string(),
                content: cached.content.clone(),
            });
        }
    }

    let content = match (modified, len) {
        (None, None) => String::new(),
        _ => fs::read_to_string(&path)
            .map_err(|error| format!("Could not read global instructions: {error}"))?,
    };

    *cache = Some(CachedInstructions {
        path: path.clone(),
        modified,
        len,
        content: content.clone(),
    });

    Ok(GlobalInstructionsDocument { path: path.display().to_string(), content })
}

#[tauri::command]
pub fn jcode_save_global_instructions(content: String) -> Result<GlobalInstructionsDocument, String> {
    if content.len() > 1_000_000 {
        return Err("Global instructions must be 1 MB or smaller".to_string());
    }
    let path = global_instructions_path()?;
    let parent = path.parent().ok_or_else(|| "Invalid global instructions path".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Could not create .jcode directory: {error}"))?;
    fs::write(&path, content.as_bytes()).map_err(|error| format!("Could not save global instructions: {error}"))?;

    // Invalidate explicitly: a save can replace a file with same-length
    // contents within the filesystem's timestamp resolution.
    if let Ok(mut cache) = instructions_cache().lock() {
        *cache = None;
    }

    Ok(GlobalInstructionsDocument { path: path.display().to_string(), content })
}

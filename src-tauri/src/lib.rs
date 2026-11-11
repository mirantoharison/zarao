use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

/// Process Node du backend (Express + SQLite). Conservé pour pouvoir le tuer à la sortie.
struct Backend(Mutex<Option<Child>>);

/// Trouve server/index.mjs : en dev à côté du projet, en prod dans les ressources empaquetées.
fn server_entry(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("server").join("index.mjs");
    if dev.exists() {
        return Some(dev);
    }
    app.path()
        .resource_dir()
        .ok()
        .map(|d| d.join("server").join("index.mjs"))
        .filter(|p| p.exists())
}

/// ffmpeg minimal embarqué (resources/ffmpeg). Absent = on laisse le serveur retomber sur les Paramètres ou le PATH.
fn bundled_ffmpeg(app: &tauri::AppHandle) -> Option<PathBuf> {
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("ffmpeg").join(name);
    if dev.exists() {
        return Some(dev);
    }
    app.path().resource_dir().ok().map(|d| d.join("ffmpeg").join(name)).filter(|p| p.exists())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            // IMPORTANT : on ne fait pas échouer l'app si Node est absent — l'écran de choix
            // de mode doit s'afficher quand même, le front gère l'état "serveur indisponible".
            match server_entry(app.handle()) {
                Some(entry) => match {
                    let mut cmd = Command::new("node");
                    cmd.arg(&entry);
                    // IMPORTANT : simple valeur par défaut. Un chemin saisi dans les Paramètres reste prioritaire côté serveur.
                    if let Some(ff) = bundled_ffmpeg(app.handle()) {
                        cmd.env("ZARAO_FFMPEG", ff);
                    }
                    cmd.spawn()
                } {
                    Ok(child) => *app.state::<Backend>().0.lock().unwrap() = Some(child),
                    Err(e) => eprintln!("[zarao] impossible de lancer node: {e}"),
                },
                None => eprintln!("[zarao] server/index.mjs introuvable"),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erreur lors de la construction de l'application Tauri");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = handle.state::<Backend>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}

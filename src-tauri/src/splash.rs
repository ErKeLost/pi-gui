//! Native launch splash, following the Tauri v2 "Splashscreen" guide:
//! the main window starts hidden, a transparent undecorated `splashscreen`
//! window plays the intro, and once both the frontend and Rust setup report
//! ready (and the intro had time to play) the windows are swapped.

use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

// The failsafe is only a guard for a lost readiness signal. Normal startup
// begins the leave animation as soon as both initialization signals arrive.
const LEAVE_ANIMATION: Duration = Duration::from_millis(300);
const FAILSAFE: Duration = Duration::from_secs(6);

pub struct SplashState {
    inner: Mutex<Progress>,
}

#[derive(Default)]
struct Progress {
    frontend: bool,
    backend: bool,
    finished: bool,
}

impl Default for SplashState {
    fn default() -> Self {
        Self { inner: Mutex::new(Progress::default()) }
    }
}

/// Frontend calls this with `task: "frontend"` after the first React paint.
#[tauri::command]
pub fn splash_ready(app: AppHandle, state: State<'_, SplashState>, task: String) {
    mark(&app, &state, &task);
}

pub fn mark(app: &AppHandle, state: &SplashState, task: &str) {
    let ready = {
        let mut progress = state.inner.lock().unwrap();
        match task {
            "frontend" => progress.frontend = true,
            "backend" => progress.backend = true,
            _ => {}
        }
        progress.frontend && progress.backend
    };
    if ready {
        finish(app);
    } else if task == "frontend" {
        // Dev reloads re-run the frontend after the splash is gone.
        show_main(app);
    }
}

/// Never leave the user staring at the splash if a readiness signal is lost.
pub fn arm_failsafe(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FAILSAFE);
        finish(&app);
    });
}

fn finish(app: &AppHandle) {
    {
        let state = app.state::<SplashState>();
        let mut progress = state.inner.lock().unwrap();
        if progress.finished {
            return;
        }
        progress.finished = true;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let splash = app.get_webview_window("splashscreen");
        if let Some(splash) = &splash {
            let _ = splash.eval("window.__orbitSplashLeave && window.__orbitSplashLeave()");
            std::thread::sleep(LEAVE_ANIMATION);
        }
        show_main(&app);
        if let Some(splash) = splash {
            let _ = splash.close();
        }
    });
}

fn show_main(app: &AppHandle) {
    if app.state::<SplashState>().inner.lock().unwrap().finished {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }
}

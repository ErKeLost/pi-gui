//! Native launch splash, following the Tauri v2 "Splashscreen" guide:
//! the main window starts hidden, a transparent undecorated `splashscreen`
//! window plays the intro, and once both the frontend and Rust setup report
//! ready (and the intro had time to play) the windows are swapped.

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

const MIN_VISIBLE: Duration = Duration::from_millis(2200);
const LEAVE_ANIMATION: Duration = Duration::from_millis(450);
const FAILSAFE: Duration = Duration::from_secs(10);

pub struct SplashState {
    started: Instant,
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
        Self { started: Instant::now(), inner: Mutex::new(Progress::default()) }
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
        finish(app, state.started.elapsed());
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
        finish(&app, FAILSAFE);
    });
}

fn finish(app: &AppHandle, elapsed: Duration) {
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
        std::thread::sleep(MIN_VISIBLE.saturating_sub(elapsed));
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

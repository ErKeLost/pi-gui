use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEnvironment {
    pub target: &'static str,
    pub platform: &'static str,
}

#[tauri::command]
pub fn runtime_environment() -> RuntimeEnvironment {
    RuntimeEnvironment {
        target: if cfg!(mobile) { "mobile" } else { "desktop" },
        platform: std::env::consts::OS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_compile_time_runtime_boundary() {
        let environment = runtime_environment();
        assert_eq!(
            environment.target,
            if cfg!(mobile) { "mobile" } else { "desktop" }
        );
        assert!(!environment.platform.is_empty());
    }
}

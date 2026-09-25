//! Read-only xa11y diagnostics. Never performs an accessibility action.
//! Usage: cargo run --bin ax_dump -- <exact app name> [max nodes]

#[cfg(target_os = "macos")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use serde_json::json;
    use std::time::Duration;
    use xa11y::{App, AppExt, Element};

    fn walk(element: &Element, depth: usize, remaining: &mut usize) -> serde_json::Value {
        let data = element.data();
        let mut node = json!({
            "role": data.role.to_snake_case(),
            "name": data.name,
            "description": data.description,
            "value": data.value,
            "bounds": data.bounds,
            "states": data.states,
            "actions": data.actions,
            "stable_id": data.stable_id,
            "pid": data.pid,
            "raw": data.raw,
            "children": [],
        });
        if depth >= 32 || *remaining == 0 {
            node["truncated"] = json!(true);
            return node;
        }
        match element.children() {
            Ok(children) => {
                let mut output = Vec::new();
                for child in children {
                    if *remaining == 0 {
                        node["truncated"] = json!(true);
                        break;
                    }
                    *remaining -= 1;
                    output.push(walk(&child, depth + 1, remaining));
                }
                node["children"] = json!(output);
            }
            Err(error) => node["children_error"] = json!(error.to_string()),
        }
        node
    }

    let name = std::env::args()
        .nth(1)
        .ok_or("usage: ax_dump <exact app name> [max nodes]")?;
    let max_nodes = std::env::args()
        .nth(2)
        .map(|n| n.parse::<usize>())
        .transpose()?
        .unwrap_or(2000)
        .clamp(1, 10000);
    let app = App::by_name(&name, Duration::ZERO)?;
    let mut remaining = max_nodes - 1;
    let mut root = json!({
        "role": app.data.role.to_snake_case(),
        "name": app.data.name,
        "pid": app.data.pid,
        "windows": [],
    });
    let windows = app.children()?;
    let mut output = Vec::new();
    for window in windows {
        if remaining == 0 {
            root["truncated"] = json!(true);
            break;
        }
        remaining -= 1;
        output.push(walk(&window, 1, &mut remaining));
    }
    root["windows"] = json!(output);
    root["node_count"] = json!(max_nodes - remaining);
    println!("{}", serde_json::to_string_pretty(&root)?);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("ax_dump is only available on macOS");
    std::process::exit(1);
}

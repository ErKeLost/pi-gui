use computer_use_core::ObservationLedger;
use criterion::{black_box, criterion_group, criterion_main, Criterion};
use serde_json::{json, Value};

fn snapshot(nodes: usize) -> Value {
    let children: Vec<Value> = (0..nodes)
        .map(|index| {
            json!({
                "ref_id": format!("ref-{index}"), "role": "button", "name": format!("item-{index}"),
                "stable_id": format!("id-{index}"), "actions": ["press"], "children": []
            })
        })
        .collect();
    json!({"snapshot_id":"bench","app":"Bench","complete":true,"tree":{"pid":1,"children":[
        {"ref_id":"window","role":"window","name":"Main","actions":[],"children":children}
    ]}})
}

fn register(c: &mut Criterion) {
    for size in [1_000usize, 10_000, 100_000] {
        let value = snapshot(size);
        c.bench_function(&format!("register_{size}_nodes"), |b| {
            b.iter(|| {
                let mut ledger = ObservationLedger::default();
                ledger.register(black_box(&value)).unwrap();
                black_box(ledger);
            })
        });
    }
}
criterion_group!(benches, register);
criterion_main!(benches);

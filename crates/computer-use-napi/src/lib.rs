use computer_use_core::ObservationLedger;
use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Stable Node-facing handle. Native platform adapters are intentionally kept
/// outside this package; the N-API surface accepts normalized observations and
/// returns decisions/outcomes without exposing AX handles.
#[napi]
pub struct ComputerUseSession {
    ledger: ObservationLedger,
}

#[napi]
impl ComputerUseSession {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            ledger: ObservationLedger::default(),
        }
    }

    #[napi]
    pub fn register_observation(&mut self, snapshot_json: String) -> Result<()> {
        let snapshot: serde_json::Value = serde_json::from_str(&snapshot_json)
            .map_err(|error| Error::from_reason(error.to_string()))?;
        self.ledger
            .register(&snapshot)
            .map_err(|error| Error::from_reason(error.to_string()))
    }

    #[napi]
    pub fn clear(&mut self) {
        self.ledger.clear();
    }

    /// Authorizes and consumes one observed ref. Platform execution remains in
    /// the native adapter; this API is the single JS-visible transaction gate.
    #[napi]
    pub fn begin_action(
        &mut self,
        app: String,
        pid: i64,
        reference: String,
        action: String,
    ) -> Result<String> {
        self.ledger
            .consume(&app, pid, &reference, &action)
            .map(|_| reference)
            .map_err(|error| Error::from_reason(error.to_string()))
    }

    #[napi]
    pub fn delivery_name(delivery: String) -> String {
        delivery
    }
}

#[napi]
pub fn version() -> String {
    "orbit-computer-use-napi/0.1".into()
}

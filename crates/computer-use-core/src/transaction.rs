//! Platform-independent one-shot action transaction. No UI transport may
//! bypass this boundary. Verification of application-specific goals belongs to
//! a successor observation/semantic decision, not to a successful AX call.
use crate::{ObservationLedger, ObservedTarget};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delivery {
    NotDelivered,
    DeliveredUnverified,
    DeliveredVerified,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub delivery: Delivery,
    pub successor: Option<String>,
    pub reason: &'static str,
}

/// The adapter must obtain `live` from the platform immediately before dispatch,
/// not from a previously serialized snapshot. `successor` must be a fresh read.
/// Dispatch errors are deliberately considered uncertain unless the adapter can
/// prove non-delivery *before* entering dispatch.
pub trait Platform {
    fn live(&mut self, target: &ObservedTarget) -> Result<LiveIdentity, &'static str>;
    fn dispatch(
        &mut self,
        target: &ObservedTarget,
        action: &str,
        value: Option<&str>,
    ) -> Result<(), &'static str>;
    fn successor(&mut self) -> Result<Successor, &'static str>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveIdentity {
    pub path: Vec<usize>,
    pub window_role: String,
    pub window_name: Option<String>,
    pub role: String,
    pub name: Option<String>,
    pub stable_id: Option<String>,
    pub actions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Successor {
    pub generation: String,
    /// Value of the same verified target, when the adapter can resolve it.
    pub target_value: Option<String>,
}

pub fn execute<P: Platform>(
    ledger: &mut ObservationLedger,
    platform: &mut P,
    app: &str,
    pid: i64,
    reference: &str,
    action: &str,
    value: Option<&str>,
) -> Outcome {
    let target = match ledger.consume(app, pid, reference, action) {
        Ok(target) => target,
        Err(reason) => {
            return Outcome {
                delivery: Delivery::NotDelivered,
                successor: None,
                reason,
            }
        }
    };
    let live = match platform.live(&target) {
        Ok(live) => live,
        Err(reason) => {
            return Outcome {
                delivery: Delivery::NotDelivered,
                successor: None,
                reason,
            }
        }
    };
    if !target.matches_live(
        &live.path,
        &live.window_role,
        live.window_name.as_deref(),
        &live.role,
        live.name.as_deref(),
        live.stable_id.as_deref(),
        &live.actions,
    ) {
        return Outcome {
            delivery: Delivery::NotDelivered,
            successor: None,
            reason: "live target identity changed",
        };
    }
    // From this point forward even a platform error may mean delivery happened.
    let dispatched = platform.dispatch(&target, action, value);
    let successor = platform.successor().ok();
    let verified = dispatched.is_ok()
        && action == "set_value"
        && value.is_some()
        && successor
            .as_ref()
            .and_then(|state| state.target_value.as_deref())
            == value;
    Outcome {
        delivery: if verified {
            Delivery::DeliveredVerified
        } else {
            Delivery::DeliveredUnverified
        },
        successor: successor.map(|state| state.generation),
        reason: if dispatched.is_err() {
            "dispatch outcome uncertain; do not replay"
        } else if verified {
            "element value verified; application commit not verified"
        } else {
            "successor does not prove action postcondition"
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Mock {
        live: Option<LiveIdentity>,
        dispatches: usize,
        fail_dispatch: bool,
        successor: Option<Successor>,
    }
    impl Platform for Mock {
        fn live(&mut self, _: &ObservedTarget) -> Result<LiveIdentity, &'static str> {
            self.live.clone().ok_or("live read failed")
        }
        fn dispatch(
            &mut self,
            _: &ObservedTarget,
            _: &str,
            _: Option<&str>,
        ) -> Result<(), &'static str> {
            self.dispatches += 1;
            if self.fail_dispatch {
                Err("unknown")
            } else {
                Ok(())
            }
        }
        fn successor(&mut self) -> Result<Successor, &'static str> {
            self.successor.clone().ok_or("successor unavailable")
        }
    }
    fn setup() -> (ObservationLedger, Mock) {
        let mut ledger = ObservationLedger::default();
        ledger.register(&json!({"snapshot_id":"one","app":"Example","complete":true,"tree":{"pid":42,"children":[
            {"ref_id":"window","role":"window","name":"A","actions":[],"children":[
                {"ref_id":"field","role":"text_area","name":"Draft","actions":["set_value"],"children":[]}
            ]}
        ]}})).unwrap();
        let mock = Mock {
            live: Some(LiveIdentity {
                path: vec![0, 0],
                window_role: "window".into(),
                window_name: Some("A".into()),
                role: "text_area".into(),
                name: Some("Draft".into()),
                stable_id: None,
                actions: vec!["set_value".into()],
            }),
            dispatches: 0,
            fail_dispatch: false,
            successor: Some(Successor {
                generation: "two".into(),
                target_value: Some("draft".into()),
            }),
        };
        (ledger, mock)
    }
    #[test]
    fn requires_fresh_live_identity_before_dispatch() {
        let (mut ledger, mut mock) = setup();
        mock.live.as_mut().unwrap().window_name = Some("Other".into());
        assert_eq!(
            execute(
                &mut ledger,
                &mut mock,
                "Example",
                42,
                "field",
                "set_value",
                Some("draft")
            )
            .delivery,
            Delivery::NotDelivered
        );
        assert_eq!(mock.dispatches, 0);
    }
    #[test]
    fn verifies_value_only_and_never_replays() {
        let (mut ledger, mut mock) = setup();
        assert_eq!(
            execute(
                &mut ledger,
                &mut mock,
                "Example",
                42,
                "field",
                "set_value",
                Some("draft")
            )
            .delivery,
            Delivery::DeliveredVerified
        );
        assert_eq!(
            execute(
                &mut ledger,
                &mut mock,
                "Example",
                42,
                "field",
                "set_value",
                Some("draft")
            )
            .delivery,
            Delivery::NotDelivered
        );
        assert_eq!(mock.dispatches, 1);
    }
    #[test]
    fn dispatch_error_or_missing_successor_is_not_safe_to_retry() {
        let (mut ledger, mut mock) = setup();
        mock.fail_dispatch = true;
        assert_eq!(
            execute(
                &mut ledger,
                &mut mock,
                "Example",
                42,
                "field",
                "set_value",
                Some("draft")
            )
            .delivery,
            Delivery::DeliveredUnverified
        );
        assert_eq!(mock.dispatches, 1);
        let (mut ledger, mut mock) = setup();
        mock.successor = None;
        assert_eq!(
            execute(
                &mut ledger,
                &mut mock,
                "Example",
                42,
                "field",
                "set_value",
                Some("draft")
            )
            .delivery,
            Delivery::DeliveredUnverified
        );
    }
}

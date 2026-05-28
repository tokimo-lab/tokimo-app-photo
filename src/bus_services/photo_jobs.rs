use std::sync::Arc;

use tokimo_bus_client::BusClientBuilder;
use tokimo_bus_protocol::{BusError, HttpMethod, MethodDecl};

use crate::ctx::AppCtx;

fn decl(name: &str, description: &str) -> MethodDecl {
    MethodDecl {
        name: name.into(),
        description: Some(description.into()),
        requires_auth: false,
        streaming: false,
        http_method: HttpMethod::Post,
        path: None,
    }
}

pub fn register(builder: BusClientBuilder, _ctx: Arc<AppCtx>) -> BusClientBuilder {
    builder
        .method(decl("capabilities", "Return photo bus service capabilities"))
        .on_invoke("capabilities", |_req| async move {
            serde_json::to_vec(&serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "methods": ["capabilities"],
            }))
            .map_err(|e| BusError::Internal(e.to_string()))
        })
}

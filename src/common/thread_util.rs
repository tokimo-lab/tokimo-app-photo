//! Thread naming utilities.

use tokio::task::JoinHandle;

const IDLE_NAME: &[u8] = b"tokimo-idle";

/// Spawn a blocking task with an OS-visible thread name.
pub fn named_spawn_blocking<F, R>(name: &'static str, f: F) -> JoinHandle<R>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        set_current_thread_name(name.as_bytes());
        let result = f();
        set_current_thread_name(IDLE_NAME);
        result
    })
}

#[cfg(target_os = "linux")]
fn set_current_thread_name(name: &[u8]) {
    let _ = std::fs::write("/proc/thread-self/comm", &name[..name.len().min(15)]);
}

#[cfg(not(target_os = "linux"))]
fn set_current_thread_name(_name: &[u8]) {}

//! Thread naming utilities.
//!
//! On Linux, `spawn_blocking` threads are from a shared pool managed by tokio.
//! We write to `/proc/thread-self/comm` to set the OS thread name so it shows
//! in the process monitor. The name resets to a generic label after the closure
//! finishes, keeping the pool clean.

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
fn set_current_thread_name(_name: &[u8]) {
    // No-op on non-Linux platforms.
}

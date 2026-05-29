//! Photo background job machinery (sidecar port).
//!
//! Job handlers are dispatched from `bus_services::photo_jobs` and run inside
//! a [`cancellation::CurrentJobContext`] scope so that cooperative cancellation
//! (bridged from the bus `jobs.query` status into a local
//! [`cancellation::JobCancel`] token) propagates down to the AI worker.

pub mod cancellation;

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostSnapshot {
    pub os: &'static str,
    pub arch: &'static str,
    pub cpu_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeError {
    CpuCountUnavailable(String),
}

impl fmt::Display for NativeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CpuCountUnavailable(reason) => {
                write!(f, "failed to read available CPU parallelism: {reason}")
            }
        }
    }
}

impl std::error::Error for NativeError {}

/// Collects a deterministic host snapshot using standard OS queries.
///
/// # Errors
/// Returns [`NativeError::CpuCountUnavailable`] if the OS rejects the CPU parallelism query.
pub fn collect_host_snapshot() -> Result<HostSnapshot, NativeError> {
    let cpu_count = std::thread::available_parallelism()
        .map(std::num::NonZeroUsize::get)
        .map_err(|err| NativeError::CpuCountUnavailable(err.to_string()))?;

    Ok(HostSnapshot {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        cpu_count,
    })
}

#[must_use]
pub fn format_snapshot_json(snapshot: &HostSnapshot) -> String {
    format!(
        "{{\"os\":\"{}\",\"arch\":\"{}\",\"cpuCount\":{}}}",
        snapshot.os, snapshot.arch, snapshot.cpu_count
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_snapshot_deterministically() {
        let snapshot = HostSnapshot {
            os: "linux",
            arch: "x86_64",
            cpu_count: 8,
        };
        assert_eq!(
            format_snapshot_json(&snapshot),
            r#"{"os":"linux","arch":"x86_64","cpuCount":8}"#
        );
    }

    #[test]
    fn collects_live_host_snapshot() {
        let snapshot = collect_host_snapshot();
        assert!(snapshot.is_ok());
        if let Ok(snap) = snapshot {
            assert!(snap.cpu_count >= 1);
            assert!(!snap.os.is_empty());
            assert!(!snap.arch.is_empty());
        }
    }
}

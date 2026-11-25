use std::process::ExitCode;

use scuttle_native::{collect_host_snapshot, format_snapshot_json};

fn main() -> ExitCode {
    match collect_host_snapshot() {
        Ok(snapshot) => {
            println!("{}", format_snapshot_json(&snapshot));
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("{err}");
            ExitCode::FAILURE
        }
    }
}

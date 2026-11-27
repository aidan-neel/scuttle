use std::io::{self, BufRead, BufWriter, Write};
use std::process::ExitCode;

use scuttle_native::usage_scan::{ScanJob, ScanProvider, format_scan_output_line, scan_usage_jobs};
use scuttle_native::{collect_host_snapshot, format_snapshot_json};

fn run_scan_usage() -> ExitCode {
    let stdin = io::stdin();
    let mut jobs = Vec::new();
    for line in stdin.lock().lines() {
        let Ok(raw) = line else {
            break;
        };
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some((provider_raw, path_raw)) = trimmed.split_once('\t') else {
            continue;
        };
        if let Some(provider) = ScanProvider::parse(provider_raw) {
            jobs.push(ScanJob {
                provider,
                path: path_raw.to_owned(),
            });
        }
    }

    let outputs = scan_usage_jobs(&jobs);
    let stdout = io::stdout();
    let mut out = BufWriter::new(stdout.lock());
    for item in &outputs {
        if writeln!(out, "{}", format_scan_output_line(item)).is_err() {
            return ExitCode::FAILURE;
        }
    }
    if out.flush().is_err() {
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    if let Some(cmd) = args.next() {
        if cmd == "scan-usage" {
            return run_scan_usage();
        }
        eprintln!("unknown subcommand: {cmd}");
        return ExitCode::FAILURE;
    }

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

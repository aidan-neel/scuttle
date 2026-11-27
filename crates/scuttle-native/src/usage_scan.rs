use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::json_cursor::{
    contains_subslice, escape_json_str, find_object_field, parse_json_f64, parse_json_str,
    parse_json_u64,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanProvider {
    Claude,
    Codex,
}

impl ScanProvider {
    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            _ => None,
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ScanJob {
    pub provider: ScanProvider,
    pub path: String,
}

#[derive(Debug, Clone, Default)]
pub struct BucketTotals {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone)]
pub struct FileScanOutput {
    pub path: String,
    pub provider: ScanProvider,
    pub session_id: String,
    pub buckets: Vec<(String, String, BucketTotals)>,
}

fn bucket_hour_from_iso(ts: &str) -> Option<String> {
    let bytes = ts.as_bytes();
    if bytes.len() < 13 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    Some(ts[..13].to_owned())
}

fn fallback_session_id(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map_or_else(|| path.to_owned(), ToOwned::to_owned)
}

#[derive(Debug, Clone)]
struct ClaudeEntry {
    model: String,
    hour: String,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    cost_usd: f64,
}

fn is_non_assistant_claude_prefix(buf: &[u8]) -> bool {
    let prefix_len = buf.len().min(768);
    let head = &buf[..prefix_len];
    if contains_subslice(head, b"\"type\":\"assistant\"") {
        return false;
    }
    contains_subslice(head, b"\"type\":\"user\"")
        || contains_subslice(head, b"\"type\":\"progress\"")
        || contains_subslice(head, b"\"type\":\"file-history-snapshot\"")
        || contains_subslice(head, b"\"type\":\"queue-operation\"")
}

fn parse_claude_line(
    buf: &[u8],
    session_id: &mut String,
    fallback_seq: &mut u64,
) -> Option<(String, ClaudeEntry)> {
    if is_non_assistant_claude_prefix(buf) || !contains_subslice(buf, b"\"usage\"") {
        return None;
    }
    let msg_slice = find_object_field(buf, "message")?;
    let usage_slice = find_object_field(msg_slice, "usage")?;
    let model = find_object_field(msg_slice, "model").and_then(parse_json_str)?;
    if model.is_empty() || model == "<synthetic>" {
        return None;
    }
    let hour = find_object_field(buf, "timestamp")
        .and_then(parse_json_str)
        .and_then(|ts| bucket_hour_from_iso(&ts))?;
    if let Some(sid) = find_object_field(buf, "sessionId").and_then(parse_json_str)
        && !sid.is_empty()
    {
        *session_id = sid;
    }

    let input_tokens = find_object_field(usage_slice, "input_tokens")
        .and_then(parse_json_u64)
        .unwrap_or(0);
    let output_tokens = find_object_field(usage_slice, "output_tokens")
        .and_then(parse_json_u64)
        .unwrap_or(0);
    let cache_read_tokens = find_object_field(usage_slice, "cache_read_input_tokens")
        .and_then(parse_json_u64)
        .unwrap_or(0);
    let cache_write_tokens = find_object_field(usage_slice, "cache_creation_input_tokens")
        .and_then(parse_json_u64)
        .unwrap_or(0);
    if input_tokens == 0 && output_tokens == 0 && cache_read_tokens == 0 && cache_write_tokens == 0
    {
        return None;
    }
    let cost_usd = find_object_field(buf, "costUSD")
        .and_then(parse_json_f64)
        .unwrap_or(0.0);

    let key = find_object_field(msg_slice, "id")
        .and_then(parse_json_str)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            find_object_field(buf, "requestId")
                .and_then(parse_json_str)
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| {
            *fallback_seq += 1;
            format!("seq:{}", *fallback_seq)
        });

    Some((
        key,
        ClaudeEntry {
            model,
            hour,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_write_tokens,
            cost_usd,
        },
    ))
}

fn scan_claude_file(path: &str) -> FileScanOutput {
    let mut session_id = fallback_session_id(path);
    let mut deduped: HashMap<String, ClaudeEntry> = HashMap::new();
    let mut fallback_seq: u64 = 0;

    if let Ok(file) = File::open(path) {
        let mut reader = BufReader::with_capacity(256 * 1024, file);
        let mut buf: Vec<u8> = Vec::with_capacity(8192);
        loop {
            buf.clear();
            let Ok(read) = reader.read_until(b'\n', &mut buf) else {
                break;
            };
            if read == 0 {
                break;
            }
            if let Some((key, entry)) = parse_claude_line(&buf, &mut session_id, &mut fallback_seq)
            {
                deduped.insert(key, entry);
            }
        }
    }

    let mut buckets: HashMap<(String, String), BucketTotals> = HashMap::new();
    for entry in deduped.into_values() {
        let agg = buckets.entry((entry.model, entry.hour)).or_default();
        agg.input_tokens = agg.input_tokens.saturating_add(entry.input_tokens);
        agg.output_tokens = agg.output_tokens.saturating_add(entry.output_tokens);
        agg.cache_read_tokens = agg
            .cache_read_tokens
            .saturating_add(entry.cache_read_tokens);
        agg.cache_write_tokens = agg
            .cache_write_tokens
            .saturating_add(entry.cache_write_tokens);
        agg.cost_usd += entry.cost_usd;
    }

    FileScanOutput {
        path: path.to_owned(),
        provider: ScanProvider::Claude,
        session_id,
        buckets: buckets.into_iter().map(|((m, h), t)| (m, h, t)).collect(),
    }
}

#[derive(Default)]
struct CodexCumulative {
    input: u64,
    cached: u64,
    cache_write: u64,
    output: u64,
}

fn scan_codex_file(path: &str) -> FileScanOutput {
    let mut session_id = fallback_session_id(path);
    let mut current_model = String::from("codex");
    let mut prev = CodexCumulative::default();
    let mut buckets: HashMap<(String, String), BucketTotals> = HashMap::new();

    if let Ok(file) = File::open(path) {
        let mut reader = BufReader::with_capacity(256 * 1024, file);
        let mut buf: Vec<u8> = Vec::with_capacity(8192);
        loop {
            buf.clear();
            let Ok(read) = reader.read_until(b'\n', &mut buf) else {
                break;
            };
            if read == 0 {
                break;
            }
            if contains_subslice(&buf, b"\"session_meta\"") {
                if let Some(payload) = find_object_field(&buf, "payload")
                    && let Some(sid) = find_object_field(payload, "id").and_then(parse_json_str)
                    && !sid.is_empty()
                {
                    session_id = sid;
                }
                continue;
            }
            if contains_subslice(&buf, b"\"turn_context\"") {
                if let Some(payload) = find_object_field(&buf, "payload")
                    && let Some(m) = find_object_field(payload, "model").and_then(parse_json_str)
                    && !m.is_empty()
                {
                    current_model = m;
                }
                continue;
            }
            if !contains_subslice(&buf, b"\"token_count\"") {
                continue;
            }
            let Some(payload) = find_object_field(&buf, "payload") else {
                continue;
            };
            let Some(info) = find_object_field(payload, "info") else {
                continue;
            };
            let Some(total) = find_object_field(info, "total_token_usage") else {
                continue;
            };
            let Some(hour) = find_object_field(&buf, "timestamp")
                .and_then(parse_json_str)
                .and_then(|ts| bucket_hour_from_iso(&ts))
            else {
                continue;
            };

            let tot_in = find_object_field(total, "input_tokens")
                .and_then(parse_json_u64)
                .unwrap_or(0);
            let tot_cached = find_object_field(total, "cached_input_tokens")
                .and_then(parse_json_u64)
                .unwrap_or(0);
            let tot_cw = find_object_field(total, "cache_write_input_tokens")
                .and_then(parse_json_u64)
                .unwrap_or(0);
            let tot_out = find_object_field(total, "output_tokens")
                .and_then(parse_json_u64)
                .unwrap_or(0);

            if tot_in <= prev.input
                && tot_cached <= prev.cached
                && tot_cw <= prev.cache_write
                && tot_out <= prev.output
            {
                continue;
            }

            let delta_raw_in = tot_in.saturating_sub(prev.input);
            let delta_cached = tot_cached.saturating_sub(prev.cached);
            let delta_cw = tot_cw.saturating_sub(prev.cache_write);
            let delta_out = tot_out.saturating_sub(prev.output);
            prev = CodexCumulative {
                input: tot_in,
                cached: tot_cached,
                cache_write: tot_cw,
                output: tot_out,
            };

            let delta_uncached_in = delta_raw_in.saturating_sub(delta_cached);
            let agg = buckets.entry((current_model.clone(), hour)).or_default();
            agg.input_tokens = agg.input_tokens.saturating_add(delta_uncached_in);
            agg.output_tokens = agg.output_tokens.saturating_add(delta_out);
            agg.cache_read_tokens = agg.cache_read_tokens.saturating_add(delta_cached);
            agg.cache_write_tokens = agg.cache_write_tokens.saturating_add(delta_cw);
        }
    }

    FileScanOutput {
        path: path.to_owned(),
        provider: ScanProvider::Codex,
        session_id,
        buckets: buckets.into_iter().map(|((m, h), t)| (m, h, t)).collect(),
    }
}

#[must_use]
pub fn scan_single_job(job: &ScanJob) -> FileScanOutput {
    match job.provider {
        ScanProvider::Claude => scan_claude_file(&job.path),
        ScanProvider::Codex => scan_codex_file(&job.path),
    }
}

#[must_use]
pub fn scan_usage_jobs(jobs: &[ScanJob]) -> Vec<FileScanOutput> {
    if jobs.is_empty() {
        return Vec::new();
    }
    let worker_count = std::thread::available_parallelism()
        .map(std::num::NonZeroUsize::get)
        .unwrap_or(4)
        .clamp(1, 16)
        .min(jobs.len());

    let next_idx = AtomicUsize::new(0);
    let mut results: Vec<Vec<FileScanOutput>> = Vec::with_capacity(worker_count);

    std::thread::scope(|scope| {
        let mut handles = Vec::with_capacity(worker_count);
        for _ in 0..worker_count {
            handles.push(scope.spawn(|| {
                let mut local = Vec::new();
                loop {
                    let idx = next_idx.fetch_add(1, Ordering::Relaxed);
                    let Some(job) = jobs.get(idx) else {
                        break;
                    };
                    local.push(scan_single_job(job));
                }
                local
            }));
        }
        for handle in handles {
            if let Ok(part) = handle.join() {
                results.push(part);
            }
        }
    });

    results.into_iter().flatten().collect()
}

#[must_use]
pub fn format_scan_output_line(out: &FileScanOutput) -> String {
    let mut line = String::with_capacity(256);
    line.push_str("{\"path\":");
    line.push_str(&escape_json_str(&out.path));
    line.push_str(",\"provider\":");
    line.push_str(&escape_json_str(out.provider.as_str()));
    line.push_str(",\"sessionId\":");
    line.push_str(&escape_json_str(&out.session_id));
    line.push_str(",\"buckets\":[");
    for (idx, (model, hour, t)) in out.buckets.iter().enumerate() {
        if idx > 0 {
            line.push(',');
        }
        let _ = write!(
            line,
            "{{\"model\":{},\"hour\":{},\"in\":{},\"out\":{},\"cr\":{},\"cw\":{},\"cost\":{:.6}}}",
            escape_json_str(model),
            escape_json_str(hour),
            t.input_tokens,
            t.output_tokens,
            t.cache_read_tokens,
            t.cache_write_tokens,
            t.cost_usd
        );
    }
    line.push_str("]}");
    line
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn deduplicates_claude_streaming_snapshots() {
        let dir = std::env::temp_dir();
        let file_path = dir.join(format!("scuttle-test-claude-{}.jsonl", std::process::id()));
        {
            let Ok(mut f) = File::create(&file_path) else {
                panic!("create temp file");
            };
            let _ = writeln!(
                f,
                r#"{{"type":"assistant","timestamp":"2026-11-27T09:10:00.000Z","sessionId":"sess-1","message":{{"id":"msg-1","model":"claude-opus-5-5","usage":{{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}}}}}}"#
            );
            let _ = writeln!(
                f,
                r#"{{"type":"assistant","timestamp":"2026-11-27T09:10:02.000Z","sessionId":"sess-1","message":{{"id":"msg-1","model":"claude-opus-5-5","usage":{{"input_tokens":10,"output_tokens":200,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}}}}}}"#
            );
            let _ = writeln!(
                f,
                r#"{{"type":"assistant","timestamp":"2026-11-27T09:11:00.000Z","sessionId":"sess-1","message":{{"id":"msg-2","model":"claude-opus-5-5","usage":{{"input_tokens":5,"output_tokens":25,"cache_read_input_tokens":300,"cache_creation_input_tokens":0}}}}}}"#
            );
        }

        let out = scan_claude_file(&file_path.to_string_lossy());
        let _ = std::fs::remove_file(&file_path);

        assert_eq!(out.session_id, "sess-1");
        assert_eq!(out.buckets.len(), 1);
        let (model, hour, totals) = &out.buckets[0];
        assert_eq!(model, "claude-opus-5-5");
        assert_eq!(hour, "2026-11-27T09");
        assert_eq!(totals.input_tokens, 15);
        assert_eq!(totals.output_tokens, 225);
        assert_eq!(totals.cache_read_tokens, 400);
        assert_eq!(totals.cache_write_tokens, 50);
    }

    #[test]
    fn computes_codex_deltas_without_double_counting() {
        let dir = std::env::temp_dir();
        let file_path = dir.join(format!("scuttle-test-codex-{}.jsonl", std::process::id()));
        {
            let Ok(mut f) = File::create(&file_path) else {
                panic!("create temp file");
            };
            let _ = writeln!(
                f,
                r#"{{"timestamp":"2026-11-27T10:00:00Z","type":"session_meta","payload":{{"id":"codex-sess-1"}}}}"#
            );
            let _ = writeln!(
                f,
                r#"{{"timestamp":"2026-11-27T10:00:01Z","type":"turn_context","payload":{{"model":"gpt-6.2-sol"}}}}"#
            );
            let _ = writeln!(
                f,
                r#"{{"timestamp":"2026-11-27T10:00:05Z","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":1000,"cached_input_tokens":200,"cache_write_input_tokens":0,"output_tokens":50}}}}}}}}"#
            );
            let _ = writeln!(
                f,
                r#"{{"timestamp":"2026-11-27T10:00:06Z","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":1000,"cached_input_tokens":200,"cache_write_input_tokens":0,"output_tokens":50}}}}}}}}"#
            );
            let _ = writeln!(
                f,
                r#"{{"timestamp":"2026-11-27T10:01:05Z","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":2500,"cached_input_tokens":1400,"cache_write_input_tokens":0,"output_tokens":150}}}}}}}}"#
            );
        }

        let out = scan_codex_file(&file_path.to_string_lossy());
        let _ = std::fs::remove_file(&file_path);

        assert_eq!(out.session_id, "codex-sess-1");
        assert_eq!(out.buckets.len(), 1);
        let (model, hour, totals) = &out.buckets[0];
        assert_eq!(model, "gpt-6.2-sol");
        assert_eq!(hour, "2026-11-27T10");
        assert_eq!(totals.input_tokens, 1100);
        assert_eq!(totals.cache_read_tokens, 1400);
        assert_eq!(totals.output_tokens, 150);
    }
}

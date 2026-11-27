#[must_use]
pub fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
    let nlen = needle.len();
    if nlen == 0 {
        return true;
    }
    if haystack.len() < nlen {
        return false;
    }
    let first = needle[0];
    let last = needle[nlen - 1];
    let limit = haystack.len() - nlen + 1;
    let mut pos = 0;
    while pos < limit {
        let Some(rel) = haystack[pos..limit].iter().position(|&b| b == first) else {
            return false;
        };
        let start = pos + rel;
        if haystack[start + nlen - 1] == last && &haystack[start..start + nlen] == needle {
            return true;
        }
        pos = start + 1;
    }
    false
}

fn skip_ws(bytes: &[u8], mut i: usize) -> usize {
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    i
}

fn skip_string(bytes: &[u8], mut i: usize) -> Option<usize> {
    if *bytes.get(i)? != b'"' {
        return None;
    }
    i += 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'"' => return Some(i + 1),
            _ => i += 1,
        }
    }
    None
}

fn skip_value(bytes: &[u8], start: usize) -> Option<usize> {
    let i = skip_ws(bytes, start);
    let b = *bytes.get(i)?;
    match b {
        b'"' => skip_string(bytes, i),
        b'{' | b'[' => {
            let mut depth = 0_usize;
            let mut cur = i;
            while cur < bytes.len() {
                match bytes[cur] {
                    b'"' => cur = skip_string(bytes, cur)?,
                    b'{' | b'[' => {
                        depth += 1;
                        cur += 1;
                    }
                    b'}' | b']' => {
                        depth = depth.checked_sub(1)?;
                        cur += 1;
                        if depth == 0 {
                            return Some(cur);
                        }
                    }
                    _ => cur += 1,
                }
            }
            None
        }
        _ => {
            let mut cur = i;
            while cur < bytes.len()
                && !matches!(
                    bytes[cur],
                    b',' | b'}' | b']' | b' ' | b'\t' | b'\r' | b'\n'
                )
            {
                cur += 1;
            }
            Some(cur)
        }
    }
}

/// Finds a top-level field value slice inside a JSON object slice `{ ... }`.
#[must_use]
pub fn find_object_field<'a>(obj: &'a [u8], key: &str) -> Option<&'a [u8]> {
    let mut i = skip_ws(obj, 0);
    if *obj.get(i)? != b'{' {
        return None;
    }
    i += 1;
    let key_bytes = key.as_bytes();

    loop {
        i = skip_ws(obj, i);
        let b = *obj.get(i)?;
        if b == b'}' {
            return None;
        }
        if b == b',' {
            i += 1;
            continue;
        }
        if b != b'"' {
            return None;
        }
        let key_start = i + 1;
        let key_end_quote = skip_string(obj, i)?;
        let key_end = key_end_quote - 1;
        i = skip_ws(obj, key_end_quote);
        if *obj.get(i)? != b':' {
            return None;
        }
        i = skip_ws(obj, i + 1);
        let val_end = skip_value(obj, i)?;
        if &obj[key_start..key_end] == key_bytes {
            return Some(&obj[i..val_end]);
        }
        i = val_end;
    }
}

#[must_use]
pub fn parse_json_str(slice: &[u8]) -> Option<String> {
    let i = skip_ws(slice, 0);
    if *slice.get(i)? != b'"' {
        return None;
    }
    let end = skip_string(slice, i)?;
    let inner = &slice[i + 1..end - 1];
    if !inner.contains(&b'\\') {
        return std::str::from_utf8(inner).ok().map(ToOwned::to_owned);
    }
    let mut out = String::with_capacity(inner.len());
    let mut idx = 0;
    while idx < inner.len() {
        if inner[idx] == b'\\' && idx + 1 < inner.len() {
            match inner[idx + 1] {
                b'"' => out.push('"'),
                b'\\' => out.push('\\'),
                b'/' => out.push('/'),
                b'n' => out.push('\n'),
                b'r' => out.push('\r'),
                b't' => out.push('\t'),
                other => out.push(char::from(other)),
            }
            idx += 2;
        } else {
            let ch_slice = std::str::from_utf8(&inner[idx..]).ok()?;
            let ch = ch_slice.chars().next()?;
            out.push(ch);
            idx += ch.len_utf8();
        }
    }
    Some(out)
}

#[must_use]
pub fn parse_json_u64(slice: &[u8]) -> Option<u64> {
    let text = std::str::from_utf8(slice).ok()?.trim();
    text.parse::<u64>().ok()
}

#[must_use]
pub fn parse_json_f64(slice: &[u8]) -> Option<f64> {
    let text = std::str::from_utf8(slice).ok()?.trim();
    let val = text.parse::<f64>().ok()?;
    if val.is_finite() && val >= 0.0 {
        Some(val)
    } else {
        None
    }
}

#[must_use]
pub fn escape_json_str(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 2);
    out.push('"');
    for ch in input.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                use std::fmt::Write;
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

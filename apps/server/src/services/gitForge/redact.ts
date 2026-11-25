const TOKEN_PATTERN =
  /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{16,}|gloas-[A-Za-z0-9_-]{16,})/g;
const HTTP_USERINFO = /\b(https?:\/\/)[^\s/@]+@/gi;

export const REDACTED = "[redacted]";

export const redactUrlCredentials = (url: string): string => url.replace(HTTP_USERINFO, "$1");

export const redactSecrets = (text: string, knownSecrets: ReadonlyArray<string> = []): string => {
  let result = text.replace(HTTP_USERINFO, "$1").replace(TOKEN_PATTERN, REDACTED);
  for (const secret of knownSecrets) {
    if (secret.length >= 8) result = result.split(secret).join(REDACTED);
  }
  return result;
};

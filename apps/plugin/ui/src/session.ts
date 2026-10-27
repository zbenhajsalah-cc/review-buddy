const KEY = "rb.token";

function readToken(): string {
  const fromUrl = new URLSearchParams(location.search).get("token");
  if (fromUrl) {
    try {
      sessionStorage.setItem(KEY, fromUrl);
    } catch {
      /* private mode — header auth still works this load */
    }
    // Remove the credential from the address bar / history entry.
    const url = new URL(location.href);
    url.searchParams.delete("token");
    history.replaceState(null, "", url);
    return fromUrl;
  }
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

const token = readToken(); // run ONCE at module load, then memoize

export function getReviewToken(): string {
  return token;
}
export const authHeaders: HeadersInit = { "x-review-buddy-token": getReviewToken() };

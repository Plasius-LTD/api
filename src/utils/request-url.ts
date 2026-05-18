export function resolveRequestPath(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname && pathname.length > 0 ? pathname : "/";
  } catch {
    const [pathname] = url.split("?");
    return pathname && pathname.length > 0 ? pathname : "/";
  }
}

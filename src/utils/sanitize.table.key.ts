export function sanitizeUrlForPartitionKey(rawUrl: string): string {
  try {
    const { hostname } = new URL(rawUrl);
    const sanitized = hostname
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-") // convert all non-alphanumeric characters to hyphens
      .replace(/^-+|-+$/g, ""); // remove leading/trailing hyphens
    return sanitized;
  } catch (e) {
    throw new Error(`Invalid URL passed for sanitization: "${rawUrl}"`);
  }
}
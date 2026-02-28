export function splitDisplayName(displayName: string): {
  firstName: string;
  middleName: string;
  lastName: string;
} {
  const parts = displayName.trim().split(/\s+/);

  if (parts.length === 0) {
    return { firstName: "", middleName: "", lastName: "" };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], middleName: "", lastName: "" };
  }

  if (parts.length === 2) {
    return { firstName: parts[0], middleName: "", lastName: parts[1] };
  }

  // 3 or more parts
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  const middleName = parts.slice(1, parts.length - 1).join(" ");

  return { firstName, middleName, lastName };
}

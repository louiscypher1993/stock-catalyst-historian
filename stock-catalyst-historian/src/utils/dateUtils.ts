export function safeToLocaleString(dateValue: string | number | Date | null | undefined): string {
  if (!dateValue) return "Unknown date";
  try {
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return "Unknown date";
    return d.toLocaleString();
  } catch (e) {
    return "Unknown date";
  }
}

export function safeToLocaleDateString(dateValue: string | number | Date | null | undefined): string {
  if (!dateValue) return "Unknown date";
  try {
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return "Unknown date";
    return d.toLocaleDateString();
  } catch (e) {
    return "Unknown date";
  }
}

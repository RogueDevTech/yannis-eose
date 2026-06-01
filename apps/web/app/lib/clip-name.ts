/** Hard-clip a customer/user name for table cells. Full name goes in a `title` attr. */
export function clipName(name: string | null | undefined, max = 20): string {
  if (!name) return '—';
  return name.length > max ? name.slice(0, max) + '…' : name;
}

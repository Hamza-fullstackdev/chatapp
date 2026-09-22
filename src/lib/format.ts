export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatConversationTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();

  if (sameDay(d, now)) return formatTime(iso);

  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 1) return 'Yesterday';

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (diffDays < 7) return days[d.getDay()];

  if (d.getFullYear() === now.getFullYear()) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }

  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export function formatMessageTime(iso: string): string {
  return formatTime(iso);
}

/** Relative-ish timestamp used in the status feed / viewer. */
export function formatStatusTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (diffMs < 86_400_000) return `Today, ${formatTime(iso)}`;
  if (diffMs < 172_800_000) return `Yesterday, ${formatTime(iso)}`;
  return formatConversationTime(iso);
}

export function formatLastSeen(iso: string | null): string {
  if (!iso) return 'last seen recently';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'offline';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'online';
  if (mins < 60) return `last seen ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `last seen ${hours} hour${hours > 1 ? 's' : ''} ago`;
  return `last seen on ${formatConversationTime(iso)}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function previewText(type: string, text: string | null, senderName?: string): string {
  const prefix = senderName ? `${senderName}: ` : '';
  switch (type) {
    case 'image':
      return `${prefix}Photo`;
    case 'video':
      return `${prefix}Video`;
    case 'audio':
      return `${prefix}Voice message`;
    case 'sticker':
      return `${prefix}Sticker`;
    case 'gif':
      return `${prefix}GIF`;
    case 'file':
      return `${prefix}Document`;
    case 'system':
      // Server-authored notices ("X has left the chat") never take a sender
      // prefix — the name is already in the text.
      return text ?? '';
    default:
      return `${prefix}${text ?? ''}`;
  }
}
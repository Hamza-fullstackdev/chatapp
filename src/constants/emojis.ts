import compactEmojiData from 'emojibase-data/en/compact.json';

export interface EmojiEntry {
  char: string;
  label: string;
  group: number;
}

type RawCompactEmoji = {
  group?: number;
  hexcode: string;
  label: string;
  order?: number;
  unicode?: string;
};

const RAW_EMOJIS = compactEmojiData as unknown as RawCompactEmoji[];

const GROUP_LABELS: Record<number, string> = {
  0: 'Smileys',
  1: 'People',
  3: 'Animals',
  4: 'Food',
  5: 'Travel',
  6: 'Activities',
  7: 'Objects',
  8: 'Symbols',
  9: 'Flags',
};

export const EMOJI_GROUPS: { key: number; label: string }[] = Object.keys(GROUP_LABELS)
  .map((k) => Number(k))
  .sort((a, b) => a - b)
  .map((key) => ({ key, label: GROUP_LABELS[key] }));

export const EMOJIS: EmojiEntry[] = RAW_EMOJIS.filter(
  (e): e is RawCompactEmoji & { group: number; unicode: string } =>
    typeof e.group === 'number' &&
    typeof e.unicode === 'string' &&
    e.unicode.length > 0 &&
    GROUP_LABELS[e.group] !== undefined,
)
  .sort((a, b) => a.group - b.group || (a.order ?? 0) - (b.order ?? 0))
  .map((e) => ({ char: e.unicode, label: e.label, group: e.group }));
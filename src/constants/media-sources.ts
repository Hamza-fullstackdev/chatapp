export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Fallback GIFs used when GIPHY/remote content is unavailable. */
export const BUILTIN_GIFS: { id: string; url: string; title: string }[] = [
  { id: 'bye', url: 'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif', title: 'Bye' },
  { id: 'lol', url: 'https://media.giphy.com/media/l0HlNaQ6gWfllcjDO/giphy.gif', title: 'LOL' },
  { id: 'party', url: 'https://media.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.gif', title: 'Party' },
  { id: 'wow', url: 'https://media.giphy.com/media/mCRJDo24UvJMA/giphy.gif', title: 'Wow' },
  { id: 'thanks', url: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif', title: 'Thanks' },
  { id: 'love', url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', title: 'Love' },
  { id: 'mindblown', url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif', title: 'Mind blown' },
  { id: 'hi', url: 'https://media.giphy.com/media/xUPGGDNsLvqsBOhuU0/giphy.gif', title: 'Hi' },
  { id: 'loading', url: 'https://media.giphy.com/media/3o7TKtnuHOHHUjR38Y/giphy.gif', title: 'Loading' },
  { id: 'cat', url: 'https://media.giphy.com/media/13CoXDiaCcCoyk/giphy.gif', title: 'Cat wiggle' },
  { id: 'blackcat', url: 'https://media.giphy.com/media/3o7aD2saalBwwftBIY/giphy.gif', title: 'Black cat' },
  { id: 'kitten', url: 'https://media.giphy.com/media/3oriO0OEd9QIDdllqo/giphy.gif', title: 'Kitten' },
];

interface OpenMojiSticker {
  id: string;
  url: string;
  title: string;
}

const OPENMOJI_BASE = 'https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@latest/color/618x618';

const openMoji = (hex: string, title: string): OpenMojiSticker => ({
  id: hex.toLowerCase(),
  url: `${OPENMOJI_BASE}/${hex}.png`,
  title,
});

/** Fallback stickers (OpenMoji art) used when the server sticker bucket is empty. */
export const BUILTIN_STICKERS: OpenMojiSticker[] = [
  openMoji('1F600', 'Grinning'),
  openMoji('1F601', 'Beaming'),
  openMoji('1F602', 'Joy'),
  openMoji('1F603', 'Smiling eyes'),
  openMoji('1F604', 'Smile'),
  openMoji('1F606', 'LOL'),
  openMoji('1F60D', 'Heart eyes'),
  openMoji('1F618', 'Kiss'),
  openMoji('1F60A', 'Blush'),
  openMoji('1F617', 'Kiss lips'),
  openMoji('1F609', 'Wink'),
  openMoji('1F61B', 'Tongue'),
  openMoji('1F61D', 'Squint tongue'),
  openMoji('1F633', 'Flushed'),
  openMoji('1F62D', 'Crying'),
  openMoji('1F62E', 'Open mouth'),
  openMoji('1F621', 'Angry'),
  openMoji('1F64F', 'Pray'),
  openMoji('1F44D', 'Thumbs up'),
  openMoji('1F44E', 'Thumbs down'),
  openMoji('1F4AA', 'Muscle'),
  openMoji('1F91A', 'OK hand'),
  openMoji('2764', 'Heart'),
  openMoji('1F493', 'Heartbeat'),
  openMoji('1F4A9', 'Poop'),
  openMoji('1F389', 'Party'),
  openMoji('1F382', 'Cake'),
  openMoji('1F680', 'Rocket'),
  openMoji('1F31F', 'Sparkles'),
  openMoji('1F984', 'Unicorn'),
];
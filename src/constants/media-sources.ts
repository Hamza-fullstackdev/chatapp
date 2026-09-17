export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Fallback GIFs used when GIPHY/remote content is unavailable. */
export const BUILTIN_GIFS: { id: string; url: string; title: string }[] = [
  { id: 'bye', url: 'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif', title: 'Bye' },
  { id: 'hello', url: 'https://media.giphy.com/media/LnQjpWaONNn0U/giphy.gif', title: 'Hello' },
  { id: 'lol', url: 'https://media.giphy.com/media/l0HlNaQ6gWfllcjDO/giphy.gif', title: 'LOL' },
  { id: 'love', url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', title: 'Love' },
  { id: 'party', url: 'https://media.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.gif', title: 'Party' },
  { id: 'thanks', url: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif', title: 'Thanks' },
  { id: 'wow', url: 'https://media.giphy.com/media/mCRJDo24UvJMA/giphy.gif', title: 'Wow' },
  { id: 'yes', url: 'https://media.giphy.com/media/SGG1YNnLzoNsc/giphy.gif', title: 'Yes' },
];

/** Fallback stickers (emoji art) used when the server sticker bucket is empty. */
export const BUILTIN_STICKERS = [
  { id: 'st-1', url: 'https://media.tenor.com/images/1e1d1e2d1e2d1e2d1e2d1e2d1e2d1e2d/tenor.gif', title: 'Good vibes' },
  { id: 'st-2', url: 'https://media.tenor.com/images/0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0/tenor.gif', title: 'High five' },
  { id: 'st-3', url: 'https://media.tenor.com/images/2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2/tenor.gif', title: 'Celebrate' },
];
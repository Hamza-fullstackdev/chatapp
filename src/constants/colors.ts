// WhatsApp-inspired palette (light / dark)
export const waColors = {
  light: {
    brand: '#00A884', // WhatsApp green (teal)
    brandDark: '#008069', // header green
    brandLight: '#D9FDD3', // outgoing bubble
    background: '#FFFFFF',
    backgroundSecondary: '#F0F2F5', // app background
    chatBackground: '#EFEAE2', // chat wallpaper base
    incomingBubble: '#FFFFFF',
    text: '#111B21',
    textSecondary: '#667781',
    divider: '#E9EDEF',
    tabActive: '#00A884',
    tabInactive: '#54656F',
    unreadBadge: '#25D366',
    outline: '#8696A0',
  },
  dark: {
    brand: '#00A884',
    brandDark: '#0B141A',
    brandLight: '#005C4B', // outgoing bubble dark
    background: '#111B21',
    backgroundSecondary: '#0B141A',
    chatBackground: '#0B141A',
    incomingBubble: '#202C33',
    text: '#E9EDEF',
    textSecondary: '#8696A0',
    divider: '#222D34',
    tabActive: '#00A884',
    tabInactive: '#8696A0',
    unreadBadge: '#25D366',
    outline: '#8696A0',
  },
} as const;

export interface WaPalette {
  brand: string;
  brandDark: string;
  brandLight: string;
  background: string;
  backgroundSecondary: string;
  chatBackground: string;
  incomingBubble: string;
  text: string;
  textSecondary: string;
  divider: string;
  tabActive: string;
  tabInactive: string;
  unreadBadge: string;
  outline: string;
}

export function getWaColors(dark: boolean): WaPalette {
  return dark ? { ...waColors.dark } : { ...waColors.light };
}
import { createContext, useContext } from 'react';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getWaColors, type WaPalette } from '@/constants/colors';

interface WaThemeValue {
  colors: WaPalette;
  dark: boolean;
}

const WaThemeContext = createContext<WaThemeValue>({ colors: getWaColors(false), dark: false });

export function WaThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  return (
    <WaThemeContext.Provider value={{ colors: getWaColors(dark), dark }}>
      {children}
    </WaThemeContext.Provider>
  );
}

export function useWaTheme(): WaThemeValue {
  return useContext(WaThemeContext);
}
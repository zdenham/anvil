import { createContext, useContext, ReactNode } from "react";

interface MainWindowContextValue {
  isMainWindow: true;
}

const MainWindowContext = createContext<MainWindowContextValue | null>(null);

export function MainWindowProvider({ children }: { children: ReactNode }) {
  return (
    <MainWindowContext.Provider value={{ isMainWindow: true }}>
      {children}
    </MainWindowContext.Provider>
  );
}

export function useIsMainWindow(): boolean {
  const context = useContext(MainWindowContext);
  return context?.isMainWindow === true;
}

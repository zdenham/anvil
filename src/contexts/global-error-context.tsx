import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { GlobalErrorView } from "../components/global-error-view";

interface GlobalError {
  message: string;
  stack?: string;
}

interface GlobalErrorContextValue {
  error: GlobalError | null;
  showError: (message: string, stack?: string) => void;
  clearError: () => void;
}

const GlobalErrorContext = createContext<GlobalErrorContextValue | null>(null);

interface GlobalErrorProviderProps {
  children: ReactNode;
}

export function GlobalErrorProvider({ children }: GlobalErrorProviderProps) {
  const [error, setError] = useState<GlobalError | null>(null);

  const showError = useCallback((message: string, stack?: string) => {
    setError({ message, stack });
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value: GlobalErrorContextValue = {
    error,
    showError,
    clearError,
  };

  return (
    <GlobalErrorContext.Provider value={value}>
      {children}
      {error && (
        <GlobalErrorView
          message={error.message}
          stack={error.stack}
          onDismiss={clearError}
        />
      )}
    </GlobalErrorContext.Provider>
  );
}

export function useGlobalError(): GlobalErrorContextValue {
  const context = useContext(GlobalErrorContext);

  if (!context) {
    throw new Error(
      "useGlobalError must be used within a GlobalErrorProvider"
    );
  }

  return context;
}

/**
 * Custom render function for UI isolation tests.
 *
 * Wraps components with necessary providers and exports
 * testing-library utilities for convenience.
 */

import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { type ReactElement, type ReactNode } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ============================================================================
// Provider Wrapper
// ============================================================================

interface AllProvidersProps {
  children: ReactNode;
}

/**
 * Wraps components with all required providers for testing.
 * Add new providers here as needed (router, theme, etc.).
 */
function AllProviders({ children }: AllProvidersProps): ReactElement {
  // Currently no providers needed - add them here as the app grows
  // Example:
  // return (
  //   <MemoryRouter>
  //     <ThemeProvider>
  //       {children}
  //     </ThemeProvider>
  //   </MemoryRouter>
  // );
  return <>{children}</>;
}

// ============================================================================
// Custom Render
// ============================================================================

interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  /**
   * Override the default wrapper.
   * Use this when you need a custom provider setup for a specific test.
   */
  wrapper?: RenderOptions["wrapper"];
}

/**
 * Custom render function that wraps components with providers.
 *
 * @example
 * import { render, screen, fireEvent } from "@/test/helpers/render";
 *
 * it("renders the component", () => {
 *   render(<MyComponent />);
 *   expect(screen.getByText("Hello")).toBeInTheDocument();
 * });
 */
export function renderUI(ui: ReactElement, options: CustomRenderOptions = {}): RenderResult {
  const { wrapper = AllProviders, ...restOptions } = options;
  return render(ui, { wrapper, ...restOptions });
}

// ============================================================================
// Router Integration
// ============================================================================

interface RenderWithRouterOptions extends Omit<RenderOptions, "wrapper"> {
  /**
   * The URL to navigate to (e.g., "/threads/thread-456").
   * This becomes the initial entry in MemoryRouter.
   */
  route?: string;

  /**
   * The route pattern for matching (e.g., "/threads/:threadId").
   * If not specified, defaults to the `route` value (exact match).
   */
  path?: string;
}

/**
 * Render a component with React Router context.
 *
 * Use this for components that use useParams, useNavigate, or useLocation.
 * The component is rendered inside a MemoryRouter with Routes configured
 * to match the specified path pattern.
 *
 * @param ui - The React element to render
 * @param options - Route configuration and standard render options
 * @returns Standard testing-library render result
 *
 * @example
 * // Testing a component that reads route params
 * renderWithRouter(<ThreadPanel />, {
 *   route: "/threads/thread-456",
 *   path: "/threads/:threadId"
 * });
 *
 * // The component can now call useParams() and receive:
 * // { threadId: "thread-456" }
 *
 * @example
 * // Testing a component with navigation
 * renderWithRouter(<ThreadCard threadId="thread-123" />, {
 *   route: "/threads",
 *   path: "/threads"
 * });
 * // Component can call useNavigate() to navigate
 */
export function renderWithRouter(
  ui: ReactElement,
  { route = "/", path = route, ...renderOptions }: RenderWithRouterOptions = {}
): RenderResult {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={path} element={ui} />
      </Routes>
    </MemoryRouter>,
    renderOptions
  );
}

// ============================================================================
// Re-exports
// ============================================================================

// Re-export everything from testing-library for convenience
export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";

// Override the default render with our custom one
export { renderUI as render };

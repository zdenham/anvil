# Spotlight Component Refactoring Plan

## Executive Summary

The Spotlight component has grown to 39.8KB and contains significant technical debt that hinders scalability and maintainability. This plan outlines a comprehensive refactoring strategy to break it down into clean, testable sub-components and services while evaluating the feasibility of migrating to a contentEditable-based input system.

## Current State Analysis

### Technical Debt Assessment

#### 1. **Monolithic Component Structure**
- **Main Component Size**: 39.8KB - far exceeding recommended component size limits
- **Mixed Responsibilities**: Single component handles UI, business logic, state management, and side effects
- **SpotlightController Class**: 430+ lines mixing data fetching, state management, and business logic
- **Massive useEffect Dependencies**: Complex dependency arrays making change tracking difficult

#### 2. **State Management Issues**
- **Complex Local State**: 6+ state variables with interdependent updates
- **Async State Race Conditions**: Window resizing, search results, and input state updates can get out of sync
- **Ref-Based State Tracking**: `inputExpandedRef` used to avoid stale closures indicates architectural issues
- **History State Conflicts**: Separate history results state creates potential conflicts with main results

#### 3. **Business Logic Coupling**
- **Inline Result Processing**: Search logic mixed with UI rendering logic
- **Hard-coded Action Types**: Actions scattered throughout activateResult function
- **Task Creation Complexity**: Two different task creation flows with duplicated error handling
- **Tightly Coupled Services**: Direct service calls mixed with component logic

#### 4. **Event Handling Complexity**
- **Massive Keyboard Handler**: 100+ line keyboard event handler with nested conditionals
- **Mixed Event Sources**: DOM events, eventBus events, and Tauri events all handled differently
- **Trigger State Coordination**: Complex coordination between TriggerSearchInput and main component

#### 5. **Testing Challenges**
- **Monolithic Structure**: Makes unit testing specific functionality difficult
- **Mixed Concerns**: UI and business logic intertwined making mocking complex
- **Side Effect Dependencies**: Heavy reliance on external services and Tauri APIs
- **State Interactions**: Complex state interdependencies make isolated testing nearly impossible

### Current Input System Analysis

The current system uses a **textarea-based** approach with the following characteristics:

#### Strengths:
- **Stable Cursor Management**: Textarea provides reliable cursor positioning
- **Synchronous State Updates**: Current implementation handles value/height changes synchronously
- **React Compatibility**: Well-established patterns for controlled components
- **Accessibility**: Native textarea accessibility features
- **Auto-resize Logic**: Smart expansion based on content width/height

#### Limitations:
- **Limited Rich Text**: Cannot support inline formatting, syntax highlighting, or rich media
- **Visual Constraints**: Limited styling flexibility for complex UI features
- **Extension Difficulties**: Hard to add features like inline tags, mentions with visual styling, or interactive elements

## ContentEditable Feasibility Analysis

### Research Findings

Based on current React and browser capabilities in 2026, contentEditable presents both opportunities and significant challenges:

#### Advantages:
- **Rich Text Capabilities**: Support for inline formatting, syntax highlighting, and rich media
- **Visual Flexibility**: Complete control over styling and interactive elements
- **Native Browser Features**: Built-in spell check, context menus, and accessibility
- **Future-Proofing**: Foundation for advanced features like inline code blocks, file previews

#### Critical Challenges:
- **Cursor Jumping**: Well-documented React issue with cursor position resets during re-renders
- **State Synchronization**: Conflicts between React's Virtual DOM and direct DOM manipulation
- **Complexity Overhead**: Significantly more complex implementation and maintenance
- **Performance Impact**: Can impact performance with frequent DOM manipulations

### Synchronous Update Requirements

The current spotlight requirement for synchronous value/height changes is **partially compatible** with contentEditable:

#### Solutions for Cursor Stability:
1. **useLayoutEffect**: For synchronous DOM updates after React renders
2. **Conditional Updates**: Only update DOM when content actually changes
3. **Manual Cursor Management**: Save/restore cursor position around critical updates
4. **Local State Caching**: Synchronous local state with async backend synchronization

#### Recommendation:
**Defer contentEditable migration** until core architectural issues are resolved. Focus first on breaking down the monolithic structure, then evaluate contentEditable as a future enhancement once the new architecture is stable.

## Proposed Architecture

### Phase 1: Component Decomposition

#### 1.1 Core Input System
```
spotlight-input/
├── SpotlightInput.tsx           # Main input orchestrator
├── InputController.ts           # Input-specific business logic
├── input-state-manager.ts       # Centralized input state
├── cursor-manager.ts            # Cursor position utilities
├── expansion-detector.ts        # Auto-resize logic
└── types.ts                     # Input-related types
```

#### 1.2 Search System
```
spotlight-search/
├── SearchOrchestrator.ts        # Coordinates all search types
├── search-providers/
│   ├── AppSearchProvider.ts     # Application search
│   ├── CalculatorProvider.ts    # Math expression evaluation
│   ├── ActionProvider.ts        # Built-in actions
│   ├── HistoryProvider.ts       # Prompt history
│   └── TriggerProvider.ts       # File mentions (@)
├── SearchResultsManager.ts      # Result aggregation and ranking
├── search-state-manager.ts      # Search state management
└── types.ts                     # Search-related types
```

#### 1.3 Results Display
```
spotlight-results/
├── ResultsTray.tsx              # Current results display
├── result-renderers/
│   ├── AppResultRenderer.tsx    # Application results
│   ├── CalculatorRenderer.tsx   # Math results
│   ├── ActionRenderer.tsx       # Built-in actions
│   ├── HistoryRenderer.tsx      # History entries
│   ├── FileRenderer.tsx         # File mentions
│   └── TaskRenderer.tsx         # Create task option
├── ResultSelectionManager.ts    # Keyboard/mouse selection
└── types.ts                     # Result display types
```

#### 1.4 Action System
```
spotlight-actions/
├── ActionOrchestrator.ts        # Coordinates all actions
├── action-handlers/
│   ├── AppLaunchHandler.ts      # Launch applications
│   ├── TaskCreationHandler.ts   # Create tasks (simple/full)
│   ├── RepositoryHandler.ts     # Repository operations
│   ├── ClipboardHandler.ts      # Clipboard operations
│   └── NavigationHandler.ts     # Window/panel navigation
├── action-state-manager.ts      # Action execution state
└── types.ts                     # Action-related types
```

### Phase 2: State Management Architecture

#### 2.1 Centralized State Stores
```typescript
// spotlight-state/
interface SpotlightState {
  input: InputState
  search: SearchState
  results: ResultsState
  selection: SelectionState
  ui: UIState
}

interface InputState {
  value: string
  cursorPosition: number
  isExpanded: boolean
  isFocused: boolean
  triggerState: TriggerState | null
}

interface SearchState {
  isLoading: boolean
  providers: Record<string, ProviderState>
  lastQuery: string
  debounceTimeoutId: number | null
}

interface ResultsState {
  items: SpotlightResult[]
  selectedIndex: number
  displayMode: 'normal' | 'history' | 'trigger'
}
```

#### 2.2 Event-Driven Architecture
```typescript
// Event system for decoupled communication
interface SpotlightEvents {
  'input:changed': { value: string; cursorPosition: number }
  'input:expanded': { expanded: boolean }
  'search:started': { query: string; providers: string[] }
  'search:results': { provider: string; results: any[] }
  'result:selected': { result: SpotlightResult; index: number }
  'action:triggered': { action: string; data: any }
  'ui:resize-needed': { resultCount: number; inputExpanded: boolean }
}
```

### Phase 3: Service Layer Refactoring

#### 3.1 Search Services
```typescript
interface SearchProvider<T = any> {
  name: string
  priority: number
  canHandle(query: string): boolean
  search(query: string, context: SearchContext): Promise<T[]>
  formatResult(data: T): SpotlightResult
}

class SearchOrchestrator {
  private providers: SearchProvider[] = []

  registerProvider(provider: SearchProvider): void
  search(query: string): Promise<SpotlightResult[]>
  private aggregateResults(results: Map<string, any[]>): SpotlightResult[]
}
```

#### 3.2 Action Services
```typescript
interface ActionHandler<T = any> {
  name: string
  canHandle(result: SpotlightResult): boolean
  execute(result: SpotlightResult, options?: T): Promise<void>
}

class ActionOrchestrator {
  private handlers: ActionHandler[] = []

  registerHandler(handler: ActionHandler): void
  execute(result: SpotlightResult, options?: any): Promise<void>
}
```

### Phase 4: Hook-Based Architecture

#### 4.1 Custom Hooks
```typescript
// Focused, single-responsibility hooks
function useSpotlightInput(options: InputOptions): InputAPI
function useSpotlightSearch(inputState: InputState): SearchAPI
function useSpotlightResults(searchState: SearchState): ResultsAPI
function useSpotlightActions(): ActionAPI
function useSpotlightKeyboard(deps: KeyboardDeps): void
function useSpotlightWindow(resultCount: number, inputExpanded: boolean): void
```

#### 4.2 Hook Composition
```typescript
// Main component becomes a simple orchestrator
function Spotlight() {
  const input = useSpotlightInput({ variant: 'spotlight' })
  const search = useSpotlightSearch(input.state)
  const results = useSpotlightResults(search.state)
  const actions = useSpotlightActions()

  useSpotlightKeyboard({ input, results, actions })
  useSpotlightWindow(results.count, input.isExpanded)

  return (
    <SpotlightContainer>
      <SpotlightInput {...input.props} />
      <SpotlightResults {...results.props} onActivate={actions.execute} />
    </SpotlightContainer>
  )
}
```

## Pre-Refactoring: 100% Behavioral Test Coverage

### Phase 0: Comprehensive Behavioral Documentation and Testing

Before any refactoring begins, we need 100% behavioral test coverage to ensure the new implementation maintains identical functionality. This phase establishes the behavioral contract that the new implementation must satisfy.

#### 0.1 Current Spotlight Behavior Documentation
- [ ] **Input Behavior Documentation**
  - Document all keyboard shortcuts and combinations
  - Map trigger behaviors (@, /, calculator expressions)
  - Document auto-expansion logic and timing
  - Record cursor positioning behaviors
  - Document focus/blur behavior and window interactions

- [ ] **Search Behavior Documentation**
  - Document search debouncing timing and behavior
  - Map all search provider triggers and priorities
  - Document result ranking algorithms
  - Record error handling scenarios
  - Document history search behavior

- [ ] **Results Display Behavior**
  - Document result rendering for each provider type
  - Map keyboard navigation behaviors (arrow keys, page up/down)
  - Document selection visual feedback
  - Record result ordering and grouping logic
  - Document empty state and loading state behaviors

- [ ] **Action Execution Behavior**
  - Document all activation methods (Enter, click, double-click)
  - Map all action types and their specific behaviors
  - Document error scenarios and recovery
  - Record task creation flows (simple vs full)
  - Document window/panel state changes after actions

#### 0.2 Behavioral Test Suite Implementation
```
tests/spotlight-behavior/
├── input-behavior.test.ts        # Complete input interaction testing
├── search-behavior.test.ts       # All search scenarios and edge cases
├── results-behavior.test.ts      # Result display and navigation
├── actions-behavior.test.ts      # Action execution and side effects
├── integration-behavior.test.ts  # End-to-end user workflows
├── performance-behavior.test.ts  # Performance baseline and thresholds
├── accessibility.test.ts         # Screen reader and keyboard accessibility
└── test-fixtures/
    ├── search-responses/         # Mock search result datasets
    ├── user-scenarios/           # Complete user workflow recordings
    └── edge-cases/               # Error conditions and boundary cases
```

#### 0.3 Behavior Capture and Validation
- [ ] **User Interaction Recording**
  - Implement test recorder for actual user interactions
  - Capture timing-sensitive behaviors (debouncing, animation)
  - Record all keyboard combinations and sequences
  - Document mouse interaction patterns

- [ ] **State Transition Testing**
  - Map all possible state transitions and combinations
  - Test concurrent operations (typing while searching)
  - Validate race condition scenarios
  - Test window resize behavior during operations

- [ ] **Cross-Platform Behavior Validation**
  - Validate macOS specific keyboard shortcuts
  - Test Tauri-specific window management behaviors
  - Validate native application launch behaviors
  - Test file system interaction behaviors

#### 0.4 Behavior Test Automation
- [ ] **Continuous Behavioral Testing**
  - Automated test runs on every commit
  - Performance regression detection
  - Behavioral diff reporting
  - Visual regression testing for UI changes

- [ ] **Test Data Management**
  - Comprehensive mock data sets for all providers
  - Edge case data scenarios (empty, large, malformed)
  - Performance test datasets (stress testing)
  - Realistic user workflow test scripts

#### 0.5 Behavioral Contract Definition
- [ ] **API Contract Documentation**
  - Define exact input/output specifications
  - Document timing requirements and constraints
  - Specify error handling requirements
  - Define performance benchmarks and thresholds

- [ ] **Acceptance Criteria**
  - 100% behavioral test passing requirement
  - Performance parity or improvement requirement
  - Zero regression tolerance for existing functionality
  - Accessibility compliance maintenance

## New Architecture Development Strategy

### Parallel Development Approach

To ensure zero-risk migration, the new spotlight implementation will be developed in parallel in a separate directory structure, allowing for comprehensive comparison testing before switchover.

#### Directory Structure
```
src/components/
├── spotlight/                    # Current implementation (unchanged)
│   ├── Spotlight.tsx
│   ├── SpotlightController.ts
│   └── ...existing files...
├── spotlight-new/               # New modular implementation
│   ├── index.ts                 # Main export
│   ├── Spotlight.tsx            # New main component
│   ├── components/              # Sub-components
│   │   ├── SpotlightInput/
│   │   ├── SpotlightResults/
│   │   ├── SpotlightActions/
│   │   └── shared/
│   ├── hooks/                   # Custom hooks
│   │   ├── useSpotlightInput.ts
│   │   ├── useSpotlightSearch.ts
│   │   ├── useSpotlightResults.ts
│   │   └── useSpotlightActions.ts
│   ├── services/                # Business logic services
│   │   ├── search-orchestrator.ts
│   │   ├── action-orchestrator.ts
│   │   └── providers/
│   ├── state/                   # State management
│   │   ├── spotlight-state.ts
│   │   ├── event-bus.ts
│   │   └── state-managers/
│   ├── types/                   # TypeScript definitions
│   │   ├── index.ts
│   │   ├── input-types.ts
│   │   ├── search-types.ts
│   │   └── action-types.ts
│   └── utils/                   # Utilities
│       ├── cursor-management.ts
│       ├── expansion-detection.ts
│       └── performance-utils.ts
├── spotlight-shared/            # Shared utilities between implementations
│   ├── test-utils/
│   ├── mock-data/
│   └── behavior-contracts/
└── spotlight-comparison/        # A/B testing component
    ├── SpotlightComparison.tsx  # Side-by-side testing
    ├── BehaviorValidator.tsx    # Automated behavior comparison
    └── PerformanceProfiler.tsx  # Performance comparison
```

#### Development Process
- [ ] **Feature Flag Integration**
  - Environment variable to switch between implementations
  - A/B testing capability for gradual rollout
  - Rollback mechanism for immediate fallback

- [ ] **Behavior Validation During Development**
  - Real-time behavioral comparison testing
  - Automated regression detection
  - Performance monitoring and comparison
  - User acceptance testing framework

## Refactoring Implementation Plan

### Phase 1: Foundation and Setup

#### 1.1 Directory Structure Setup
- [ ] Create `src/components/spotlight-new/` directory structure
- [ ] Set up `spotlight-shared/` for common utilities
- [ ] Initialize `spotlight-comparison/` for A/B testing
- [ ] Configure build and test infrastructure for new structure

#### 1.2 Behavioral Contract Implementation
- [ ] Create behavioral test suite in `tests/spotlight-behavior/`
- [ ] Implement behavior recording and validation tools
- [ ] Set up automated behavioral comparison framework
- [ ] Document current spotlight behavior specifications

#### 1.3 Core Types and Infrastructure
- [ ] Create shared type definitions in `spotlight-new/types/`
- [ ] Implement EventEmitter for internal communication
- [ ] Set up state management architecture
- [ ] Create testing utilities and behavior validators
- [ ] Establish error handling patterns

#### 1.4 Input System Foundation
- [ ] Create `SpotlightInput/` component structure
- [ ] Implement cursor management utilities
- [ ] Create expansion detection logic
- [ ] Set up input behavioral tests
- [ ] Validate input behavior against existing implementation

### Phase 2: Search System Development
#### 2.1 Search Provider Architecture
- [ ] Create `SearchProvider` interface in `spotlight-new/services/`
- [ ] Implement `AppSearchProvider` with behavioral parity
- [ ] Implement `CalculatorProvider` with exact expression handling
- [ ] Implement `ActionProvider` maintaining all current actions
- [ ] Implement `HistoryProvider` with identical search behavior
- [ ] Validate each provider against behavioral test suite

#### 2.2 Search Orchestration Implementation
- [ ] Create `SearchOrchestrator` in `services/`
- [ ] Implement result aggregation matching current behavior
- [ ] Add debouncing with identical timing characteristics
- [ ] Create search state manager with event-driven architecture
- [ ] Implement caching with performance parity
- [ ] Continuous behavioral validation against original

#### 2.3 Results Display System
- [ ] Create `SpotlightResults/` component structure
- [ ] Implement individual result renderers for each type
- [ ] Create selection management with identical keyboard behavior
- [ ] Implement result ordering and grouping logic
- [ ] Add visual feedback matching current implementation
- [ ] Validate all results display behaviors

### Phase 3: Action System Development
#### 3.1 Action Handler Architecture
- [ ] Create `ActionHandler` interface in `services/action-handlers/`
- [ ] Implement `AppLaunchHandler` with platform-specific behavior
- [ ] Implement `TaskCreationHandler` supporting both creation flows
- [ ] Implement `RepositoryHandler` with git integration
- [ ] Implement `NavigationHandler` for window/panel management
- [ ] Create `ClipboardHandler` for copy/paste operations
- [ ] Validate all action behaviors against test suite

#### 3.2 Action Orchestration and Integration
- [ ] Implement `ActionOrchestrator` with error handling
- [ ] Create action state management and execution tracking
- [ ] Add comprehensive action recovery mechanisms
- [ ] Implement action result feedback and notifications
- [ ] Integrate with window management and focus handling
- [ ] Continuous behavioral validation

### Phase 4: Component Integration and Hook Development
#### 4.1 Custom Hooks Implementation
- [ ] Create `useSpotlightInput` with behavioral parity
- [ ] Implement `useSpotlightSearch` matching current timing
- [ ] Create `useSpotlightResults` with identical navigation
- [ ] Implement `useSpotlightActions` with error handling
- [ ] Create `useSpotlightKeyboard` matching all shortcuts
- [ ] Implement `useSpotlightWindow` with resize behavior

#### 4.2 Main Component Integration
- [ ] Create new `Spotlight.tsx` using hook composition
- [ ] Implement component orchestration and coordination
- [ ] Add comprehensive integration testing
- [ ] Performance optimization and monitoring
- [ ] Memory leak detection and prevention
- [ ] Accessibility compliance validation

### Phase 5: A/B Testing and Validation
#### 5.1 Comparison Framework Implementation
- [ ] Create `SpotlightComparison.tsx` for side-by-side testing
- [ ] Implement `BehaviorValidator.tsx` for automated comparison
- [ ] Create `PerformanceProfiler.tsx` for performance analysis
- [ ] Set up feature flag system for implementation switching
- [ ] Implement rollback mechanism for immediate fallback

#### 5.2 Comprehensive Validation
- [ ] Run full behavioral test suite against new implementation
- [ ] Performance benchmarking and comparison
- [ ] Memory usage analysis and optimization
- [ ] Accessibility testing and compliance verification
- [ ] Cross-platform behavior validation
- [ ] User acceptance testing with real workflows

### Phase 6: Migration and Switchover
#### 6.1 Production Preparation
- [ ] Feature flag integration for gradual rollout
- [ ] Monitoring and alerting setup for new implementation
- [ ] Documentation update for new architecture
- [ ] Developer experience improvements and tooling

#### 6.2 Safe Migration Process
- [ ] Gradual rollout to subset of users
- [ ] Real-time behavioral monitoring and comparison
- [ ] Performance monitoring and alerting
- [ ] User feedback collection and analysis
- [ ] Immediate rollback capability if issues detected

#### 6.3 Complete Migration
- [ ] Full switchover to new implementation
- [ ] Legacy code removal and cleanup
- [ ] Final performance validation
- [ ] Post-migration monitoring and optimization

### Phase 5: Future Enhancements (Week 5+)
#### 5.1 ContentEditable Preparation
- [ ] Create input abstraction layer
- [ ] Implement cursor management utilities
- [ ] Create rich text experiment branch
- [ ] Evaluate performance impact

#### 5.2 Advanced Features
- [ ] Plugin system for search providers
- [ ] Advanced result ranking
- [ ] Caching and performance optimization
- [ ] Analytics and telemetry

## Enhanced Testing Strategy

### Behavioral Test Coverage (100% Required)

#### Baseline Behavior Documentation
- **Input Behavior Matrix**: Complete mapping of all input interactions, keyboard shortcuts, and cursor behaviors
- **Search Behavior Specification**: Exact timing, debouncing, provider priority, and result ranking algorithms
- **Action Behavior Catalog**: Every action type, execution path, and error scenario
- **UI Behavior Standards**: Visual feedback, animations, transitions, and responsive behaviors

#### Behavioral Test Suite Architecture
```typescript
// Comprehensive behavioral testing framework
interface BehaviorTest<T = any> {
  name: string
  setup: () => Promise<void>
  execute: () => Promise<T>
  validate: (result: T, expected: T) => boolean
  teardown: () => Promise<void>
}

interface BehaviorComparison {
  original: SpotlightComponent
  new: SpotlightNewComponent
  validators: BehaviorTest[]
  performanceMetrics: PerformanceProfile
}
```

#### Test Categories

##### 1. Input Behavior Testing
- **Keyboard Interaction Testing**: Every key combination, modifier states, and sequences
- **Cursor Management Testing**: Position tracking, restoration, and edge cases
- **Auto-expansion Testing**: Timing, triggers, and visual feedback
- **Focus/Blur Behavior**: Window interactions and state management
- **Trigger Detection Testing**: @-mentions, calculator expressions, command prefixes

##### 2. Search Behavior Testing
- **Provider Behavior Testing**: Each provider's exact behavior and timing
- **Debounce and Timing Testing**: Exact millisecond timing validation
- **Result Aggregation Testing**: Ordering, priority, and ranking algorithms
- **Cache Behavior Testing**: Cache hits, misses, and invalidation
- **Error Scenario Testing**: Network failures, malformed responses, timeouts

##### 3. Results Display Testing
- **Rendering Testing**: Visual output for each result type
- **Keyboard Navigation Testing**: Arrow keys, page up/down, home/end
- **Selection Visual Feedback**: Highlighting, hover states, active states
- **Result Ordering Testing**: Priority algorithms and grouping logic
- **Empty/Loading State Testing**: UI states and transitions

##### 4. Action Execution Testing
- **Activation Method Testing**: Enter key, mouse clicks, double-clicks
- **Action Handler Testing**: Each action type's exact behavior
- **Error Recovery Testing**: Failed actions, retries, and user feedback
- **Window State Testing**: Focus changes, panel switches, app launches
- **Task Creation Testing**: Simple vs full creation flows

##### 5. Integration Flow Testing
- **Complete User Workflows**: End-to-end interaction patterns
- **Concurrent Operation Testing**: Typing while searching, rapid interactions
- **State Transition Testing**: All possible state combinations
- **Performance Under Load**: Large result sets, rapid typing, memory pressure
- **Cross-Platform Testing**: macOS specific behaviors and shortcuts

#### Behavioral Validation Framework
- **Real-time Comparison**: Side-by-side execution and result comparison
- **Automated Regression Detection**: Continuous monitoring for behavioral drift
- **Performance Parity Validation**: Response times, memory usage, CPU utilization
- **Visual Regression Testing**: Screenshot-based UI comparison
- **Accessibility Compliance**: Screen reader, keyboard navigation, ARIA attributes

#### Test Data and Scenarios
- **Realistic User Data**: Actual application lists, file systems, and usage patterns
- **Edge Case Data**: Empty results, malformed data, extreme result counts
- **Performance Test Data**: Large datasets for stress testing
- **Error Simulation Data**: Network failures, permission errors, missing dependencies

## Migration Strategy

### Backward Compatibility
- Maintain existing API surface during transition
- Feature flags for new architecture components
- Gradual migration with rollback capability
- Comprehensive regression testing

### Risk Mitigation
- **Incremental Rollout**: Phase-by-phase implementation
- **A/B Testing**: Compare old vs new implementations
- **Performance Monitoring**: Track performance impacts
- **User Feedback**: Collect user experience data

### Success Metrics
- **Code Maintainability**: Reduced component size, improved test coverage
- **Development Velocity**: Faster feature implementation
- **Bug Reduction**: Fewer state-related bugs
- **Performance**: Maintained or improved response times

## ContentEditable Future Roadmap

### Phase 1: Architecture Preparation
- [ ] Abstract input system for multiple implementations
- [ ] Create cursor management utilities
- [ ] Implement synchronous state update patterns
- [ ] Build comprehensive test suite

### Phase 2: Prototype Implementation
- [ ] Create contentEditable proof-of-concept
- [ ] Implement cursor jumping solutions
- [ ] Test synchronous value/height updates
- [ ] Performance comparison with textarea

### Phase 3: Feature Development
- [ ] Rich text formatting capabilities
- [ ] Inline syntax highlighting
- [ ] Interactive file mentions
- [ ] Advanced autocomplete UI

### Phase 4: Production Migration
- [ ] Feature flag rollout
- [ ] User acceptance testing
- [ ] Performance validation
- [ ] Full migration

## Updated Timeline and Resource Allocation

### Phase 0: Behavioral Documentation and Test Setup
- **Activities**: Complete behavioral documentation, test suite creation, baseline establishment
- **Key Deliverables**: 100% behavioral test coverage, comparison framework, performance baselines
- **Success Criteria**: All current behaviors documented and validated, automated test suite operational

### Phase 1: Foundation and Setup
- **Activities**: Directory structure, behavioral contracts, core infrastructure, input system foundation
- **Key Deliverables**: Complete project structure, working behavioral validation, basic input system
- **Success Criteria**: Input system passes all behavioral tests, comparison framework functional

### Phase 2: Search System Development
- **Activities**: Search providers, orchestration, results display with continuous behavioral validation
- **Key Deliverables**: Complete search system with identical behavior to original
- **Success Criteria**: 100% search behavioral test passing, performance parity achieved

### Phase 3: Action System Development
- **Activities**: Action handlers, orchestration, integration with continuous validation
- **Key Deliverables**: Complete action system with behavioral parity
- **Success Criteria**: All action flows pass behavioral tests, error handling validated

### Phase 4: Component Integration and Hooks
- **Activities**: Hook development, main component creation, integration testing
- **Key Deliverables**: Complete new spotlight implementation ready for A/B testing
- **Success Criteria**: Full integration test suite passing, performance benchmarks met

### Phase 5: A/B Testing and Validation
- **Activities**: Comparison framework implementation, comprehensive validation, user testing
- **Key Deliverables**: Production-ready implementation with validation evidence
- **Success Criteria**: Side-by-side comparison shows behavioral parity, user acceptance achieved

### Phase 6: Migration and Switchover
- **Activities**: Feature flag setup, gradual rollout, monitoring, complete migration
- **Key Deliverables**: Successful migration with zero regressions
- **Success Criteria**: New implementation fully deployed, old implementation cleanly removed

### Risk Mitigation Timeline
- **Continuous Validation**: Behavioral tests run on every commit throughout all phases
- **Rollback Capability**: Immediate fallback available at any point during migration
- **Performance Monitoring**: Real-time performance comparison throughout development
- **User Feedback Integration**: Continuous user experience validation during A/B testing phase

### Success Metrics and Quality Gates
- **Phase Gate Requirements**: Each phase must achieve 100% behavioral test passing before proceeding
- **Performance Requirements**: New implementation must match or exceed current performance
- **Zero Regression Tolerance**: Any behavioral regression blocks phase progression
- **User Acceptance Threshold**: User testing must show equivalent or improved experience

## Conclusion

This updated refactoring plan provides a comprehensive, risk-mitigated approach to modernizing the Spotlight component while ensuring zero behavioral regressions. The strategy delivers:

### Key Benefits
1. **Zero-Risk Migration**: Parallel development with comprehensive behavioral validation ensures no functionality loss
2. **100% Behavioral Parity**: Exhaustive test coverage guarantees identical user experience
3. **Architectural Excellence**: Clean, modular design enables future enhancements and easier maintenance
4. **Performance Assurance**: Continuous performance monitoring ensures optimal user experience
5. **Developer Confidence**: Comprehensive testing and validation provides confidence in the new implementation

### Risk Mitigation Advantages
- **Parallel Development**: Old implementation remains untouched until validation is complete
- **Comprehensive Testing**: Behavioral test suite captures every interaction and edge case
- **Gradual Migration**: Feature flags and rollback capabilities ensure safe deployment
- **Continuous Validation**: Real-time comparison prevents behavioral drift during development
- **User Acceptance**: A/B testing validates real-world usage before full deployment

### Future-Proofing Foundation
- **Modular Architecture**: Components can evolve independently without system-wide impact
- **Plugin System**: Easy addition of new search providers and action handlers
- **ContentEditable Ready**: Architecture prepared for future rich text input migration
- **Testing Infrastructure**: Robust testing framework supports future feature development
- **Performance Monitoring**: Established metrics enable ongoing optimization

### Strategic Implementation
The six-phase approach with quality gates ensures that each stage achieves full behavioral parity before progression. The `spotlight-new/` directory structure allows for safe experimentation while the behavioral test suite provides an authoritative contract for functionality.

This plan transforms a high-risk monolithic refactor into a methodical, validated modernization that enhances code quality while preserving user experience integrity. The result will be a maintainable, scalable architecture ready for future enhancements like rich text input, advanced search capabilities, and improved performance.

---

**Sources:**
- [I notice a lot of apps are choosing <div contenteditable=true> instead of <textarea> for user input. Why is this? The <text area> seems m...](https://www.quora.com/I-notice-a-lot-of-apps-are-choosing-div-contenteditable-true-instead-of-textarea-for-user-input-Why-is-this-The-text-area-seems-much-better-supported-by-all-browsers)
- [Leverage React Contenteditable for Engaging User Experiences](https://www.dhiwise.com/post/guide-to-implementing-react-contenteditable-in-your-website)
- [GitHub - FormidableLabs/use-editable: A small React hook to turn elements into fully renderable & editable content surfaces, like code editors, using contenteditable (and magic)](https://github.com/FormidableLabs/use-editable)
- [Mastering Rich Text Editing with React.js](https://www.toolify.ai/ai-news/mastering-rich-text-editing-with-reactjs-51760)
- [Adding Editable HTML Content to a React App](https://blixtdev.com/how-to-use-contenteditable-with-react/)
- [Contenteditable vs Other Web Editing Tools](https://www.linkedin.com/advice/0/what-benefits-drawbacks-contenteditable-compared-other-web)
- [About the State Management of a Contenteditable Element in React | by Cristian Salcescu | Frontend Essentials | Medium](https://medium.com/programming-essentials/good-to-know-about-the-state-management-of-a-contenteditable-element-in-react-adb4f933df12)
- [Solving Caret Jumping in React Inputs - DEV Community](https://dev.to/kwirke/solving-caret-jumping-in-react-inputs-36ic)
- [ContentEditable element and caret position jumps · Issue #2047 · facebook/react](https://github.com/facebook/react/issues/2047)
- [Using contenteditable in React | David Tang](https://dtang.dev/using-content-editable-in-react/)
- [useLayoutEffect With Practical Example – DevMuscle](https://devmuscle.com/blog/practical-usage-uselayouteffect)
- [Keep that cursor still!](https://giacomocerquone.com/blog/keep-input-cursor-still/)
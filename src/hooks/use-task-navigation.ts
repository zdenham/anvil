import { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { TaskMetadata } from '@/entities/tasks/types';

interface TaskNavigationState {
  selectedIndex: number;
  isNavigating: boolean;
}

export function useTaskNavigation(
  tasks: TaskMetadata[],
  onTaskSelect: (task: TaskMetadata) => void
): TaskNavigationState {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const isActiveRef = useRef(true); // Track if this hook/component is active

  // Listen for navigation events from Rust - filter to only handle when this panel is active
  useEffect(() => {
    const unlistenNavigation = listen<{ direction: 'up' | 'down' }>('task-navigation', (event) => {
      // Only handle if this hook instance is active (tasks panel is mounted and visible)
      if (!isActiveRef.current || tasks.length === 0) return;

      setIsNavigating(true);
      const { direction } = event.payload;

      setSelectedIndex(prev => {
        return direction === 'down' ? (prev + 1) % tasks.length : prev === 0 ? tasks.length - 1 : prev - 1;
      });
    });

    const unlistenSelection = listen('task-selection', () => {
      // Only handle if this hook instance is active and we have tasks
      if (!isActiveRef.current || tasks.length === 0) return;

      if (tasks[selectedIndex]) {
        onTaskSelect(tasks[selectedIndex]);
      }
      setIsNavigating(false);
    });

    const unlistenEnd = listen('navigation-end', () => {
      // Only handle if this hook instance is active
      if (!isActiveRef.current) return;

      setIsNavigating(false);
    });

    return () => {
      unlistenNavigation.then(fn => fn());
      unlistenSelection.then(fn => fn());
      unlistenEnd.then(fn => fn());
    };
  }, [tasks, selectedIndex, onTaskSelect]);

  // Reset selection when tasks change
  useEffect(() => {
    setSelectedIndex(0);
  }, [tasks]);

  // Set inactive when component unmounts
  useEffect(() => {
    isActiveRef.current = true;
    return () => {
      isActiveRef.current = false;
    };
  }, []);

  return { selectedIndex, isNavigating };
}
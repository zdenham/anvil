/**
 * QueuedMessagesBanner UI Tests
 *
 * Validates rendering of the queued messages banner with different states.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/helpers';
import { QueuedMessagesBanner } from './queued-messages-banner';

describe('QueuedMessagesBanner UI', () => {
  describe('empty state', () => {
    it('renders nothing when no messages are queued', () => {
      const { container } = render(<QueuedMessagesBanner messages={[]} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('single message', () => {
    it('shows single queued message with singular label', () => {
      render(
        <QueuedMessagesBanner
          messages={[
            { id: 'msg-1', content: 'Follow-up task', timestamp: Date.now() },
          ]}
        />
      );

      // Should show singular "Queued" text (part of the label)
      expect(screen.getByText(/queued/i)).toBeInTheDocument();
      expect(screen.getByText('Follow-up task')).toBeInTheDocument();
    });

    it('displays message content in preview', () => {
      const content = 'Please also check the tests';
      render(
        <QueuedMessagesBanner
          messages={[{ id: 'msg-1', content, timestamp: Date.now() }]}
        />
      );

      expect(screen.getByText(content)).toBeInTheDocument();
    });
  });

  describe('multiple messages', () => {
    it('shows plural label for multiple messages', () => {
      render(
        <QueuedMessagesBanner
          messages={[
            { id: 'msg-1', content: 'First message', timestamp: Date.now() },
            { id: 'msg-2', content: 'Second message', timestamp: Date.now() },
          ]}
        />
      );

      // Should show "messages" (plural)
      expect(screen.getByText(/messages/i)).toBeInTheDocument();
    });

    it('renders all queued messages', () => {
      render(
        <QueuedMessagesBanner
          messages={[
            { id: 'msg-1', content: 'First task', timestamp: Date.now() },
            { id: 'msg-2', content: 'Second task', timestamp: Date.now() },
            { id: 'msg-3', content: 'Third task', timestamp: Date.now() },
          ]}
        />
      );

      expect(screen.getByText('First task')).toBeInTheDocument();
      expect(screen.getByText('Second task')).toBeInTheDocument();
      expect(screen.getByText('Third task')).toBeInTheDocument();
    });
  });

  describe('visual indicators', () => {
    it('displays visual indicator (pulse dot)', () => {
      const { container } = render(
        <QueuedMessagesBanner
          messages={[{ id: 'msg-1', content: 'Test', timestamp: Date.now() }]}
        />
      );

      // Should have an animated pulse indicator
      const pulseElement = container.querySelector('.animate-pulse');
      expect(pulseElement).toBeInTheDocument();
    });

    it('shows informational text about when messages will be sent', () => {
      render(
        <QueuedMessagesBanner
          messages={[{ id: 'msg-1', content: 'Test', timestamp: Date.now() }]}
        />
      );

      // Should explain when the message will be sent
      expect(screen.getByText(/will be sent when agent is ready/i)).toBeInTheDocument();
    });
  });

  describe('message uniqueness', () => {
    it('uses message id as key for rendering', () => {
      const { rerender } = render(
        <QueuedMessagesBanner
          messages={[
            { id: 'unique-id-1', content: 'Message A', timestamp: 1000 },
          ]}
        />
      );

      expect(screen.getByText('Message A')).toBeInTheDocument();

      // Re-render with different message
      rerender(
        <QueuedMessagesBanner
          messages={[
            { id: 'unique-id-2', content: 'Message B', timestamp: 2000 },
          ]}
        />
      );

      expect(screen.queryByText('Message A')).not.toBeInTheDocument();
      expect(screen.getByText('Message B')).toBeInTheDocument();
    });
  });

  describe('long content handling', () => {
    it('truncates long message content', () => {
      const longContent = 'A'.repeat(500);
      const { container } = render(
        <QueuedMessagesBanner
          messages={[{ id: 'msg-1', content: longContent, timestamp: Date.now() }]}
        />
      );

      // The message container should have truncate class
      const messageElement = container.querySelector('.truncate');
      expect(messageElement).toBeInTheDocument();
    });
  });
});

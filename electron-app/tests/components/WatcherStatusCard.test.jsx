// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import WatcherStatusCard from '../../src/pages/games/WatcherStatusCard';

describe('WatcherStatusCard', () => {
  const defaultProps = {
    status: {
      running: false,
      startedAt: null,
      gameState: 'IDLE',
    },
    onToggle: vi.fn(),
    scriptWarning: null,
    onDismissWarning: vi.fn(),
    onGoToSettings: vi.fn(),
    onOpenOBS: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with idle state', () => {
    render(<WatcherStatusCard {...defaultProps} />);
    expect(screen.getByText(/Watcher Status/)).toBeVisible();
    expect(screen.getByText(/Idle - watching for games/)).toBeVisible();
  });

  it('renders recording state with game info', () => {
    render(
      <WatcherStatusCard
        {...defaultProps}
        status={{ running: true, startedAt: Date.now() - 60000, gameState: 'RECORDING|Valorant|Gaming Scene' }}
      />
    );
    expect(screen.getByText(/Recording Valorant/)).toBeVisible();
    expect(screen.getByText(/Scene: Gaming Scene/)).toBeVisible();
  });

  it('shows script warning when present', () => {
    render(
      <WatcherStatusCard
        {...defaultProps}
        status={{ ...defaultProps.status, running: true }}
        scriptWarning="Warning: Script not found"
      />
    );
    expect(screen.getByText(/OBS plugin not detected/)).toBeInTheDocument();
  });
});

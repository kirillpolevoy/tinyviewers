import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeedbackModal from '../../src/app/components/FeedbackModal';

// Mock fetch
global.fetch = jest.fn();

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('FeedbackModal', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    mockFetch.mockClear();
    mockOnClose.mockClear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('renders correctly when open', () => {
    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByText('Share Your Feedback')).toBeInTheDocument();
    expect(screen.getByLabelText(/Your Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Your Feedback/)).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<FeedbackModal isOpen={false} onClose={mockOnClose} />);
    
    expect(screen.queryByText('Share Your Feedback')).not.toBeInTheDocument();
  });

  it('shows required indicators for name and email fields', () => {
    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    const nameLabel = screen.getByText('Your Name');
    const emailLabel = screen.getByText('Email');
    const commentsLabel = screen.getByText('Your Feedback');
    
    // Check for red asterisks indicating required fields
    expect(nameLabel.parentElement).toHaveTextContent('*');
    expect(emailLabel.parentElement).toHaveTextContent('*');
    expect(commentsLabel.parentElement).toHaveTextContent('*');
  });

  it('has required attributes on form fields', () => {
    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    expect(screen.getByLabelText(/Your Name/)).toBeRequired();
    expect(screen.getByLabelText(/Email/)).toBeRequired();
    expect(screen.getByLabelText(/Your Feedback/)).toBeRequired();
  });

  it('submit button is initially disabled', () => {
    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    const submitButton = screen.getByRole('button', { name: /Send Feedback/ });
    expect(submitButton).toBeDisabled();
  });

  it('submit button remains disabled when only some fields are filled', async () => {
    const user = userEvent.setup();
    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    const nameInput = screen.getByLabelText(/Your Name/);
    const submitButton = screen.getByRole('button', { name: /Send Feedback/ });
    
    await user.type(nameInput, 'John Doe');
    expect(submitButton).toBeDisabled();
    
    const emailInput = screen.getByLabelText(/Email/);
    await user.type(emailInput, 'john@example.com');
    expect(submitButton).toBeDisabled();
  });

  it('submit button is enabled when all required fields are filled', async () => {
    const user = userEvent.setup();
    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    const nameInput = screen.getByLabelText(/Your Name/);
    const emailInput = screen.getByLabelText(/Email/);
    const commentsInput = screen.getByLabelText(/Your Feedback/);
    const submitButton = screen.getByRole('button', { name: /Send Feedback/ });
    
    await user.type(nameInput, 'John Doe');
    await user.type(emailInput, 'john@example.com');
    await user.type(commentsInput, 'Great app!');
    
    expect(submitButton).not.toBeDisabled();
  });

  it('shows error when trying to submit without name', async () => {
    const user = userEvent.setup();
    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    const emailInput = screen.getByLabelText(/Email/);
    const commentsInput = screen.getByLabelText(/Your Feedback/);
    const submitButton = screen.getByRole('button', { name: /Send Feedback/ });
    
    await user.type(emailInput, 'john@example.com');
    await user.type(commentsInput, 'Great app!');
    await user.click(submitButton);
    
    await waitFor(() => {
      expect(screen.getByText('Please provide your name')).toBeInTheDocument();
    });
  });

  it('shows error when trying to submit without email', async () => {
    const user = userEvent.setup();
    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    const nameInput = screen.getByLabelText(/Your Name/);
    const commentsInput = screen.getByLabelText(/Your Feedback/);
    const submitButton = screen.getByRole('button', { name: /Send Feedback/ });
    
    await user.type(nameInput, 'John Doe');
    await user.type(commentsInput, 'Great app!');
    await user.click(submitButton);
    
    await waitFor(() => {
      expect(screen.getByText('Please provide your email')).toBeInTheDocument();
    });
  });

  it('shows error when trying to submit without comments', async () => {
    const user = userEvent.setup();
    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    const nameInput = screen.getByLabelText(/Your Name/);
    const emailInput = screen.getByLabelText(/Email/);
    const submitButton = screen.getByRole('button', { name: /Send Feedback/ });
    
    await user.type(nameInput, 'John Doe');
    await user.type(emailInput, 'john@example.com');
    await user.click(submitButton);
    
    await waitFor(() => {
      expect(screen.getByText('Please provide your feedback comments')).toBeInTheDocument();
    });
  });

  it('successfully submits feedback with all required fields', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    const nameInput = screen.getByLabelText(/Your Name/);
    const emailInput = screen.getByLabelText(/Email/);
    const commentsInput = screen.getByLabelText(/Your Feedback/);
    const submitButton = screen.getByRole('button', { name: /Send Feedback/ });
    
    await user.type(nameInput, 'John Doe');
    await user.type(emailInput, 'john@example.com');
    await user.type(commentsInput, 'Great app!');
    await user.click(submitButton);
    
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
          comments: 'Great app!',
          timestamp: expect.any(String),
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Thank You!')).toBeInTheDocument();
    });
  });

  it('shows error message when submission fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    const nameInput = screen.getByLabelText(/Your Name/);
    const emailInput = screen.getByLabelText(/Email/);
    const commentsInput = screen.getByLabelText(/Your Feedback/);
    const submitButton = screen.getByRole('button', { name: /Send Feedback/ });
    
    await user.type(nameInput, 'John Doe');
    await user.type(emailInput, 'john@example.com');
    await user.type(commentsInput, 'Great app!');
    await user.click(submitButton);
    
    await waitFor(() => {
      expect(screen.getByText('Failed to submit feedback. Please try again.')).toBeInTheDocument();
    });
  });

  it('shows loading state during submission', async () => {
    const user = userEvent.setup();
    let resolvePromise: (value: any) => void;
    const delayedPromise = new Promise(resolve => {
      resolvePromise = resolve;
    });
    
    mockFetch.mockReturnValueOnce(delayedPromise as Promise<Response>);

    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    const nameInput = screen.getByLabelText(/Your Name/);
    const emailInput = screen.getByLabelText(/Email/);
    const commentsInput = screen.getByLabelText(/Your Feedback/);
    const submitButton = screen.getByRole('button', { name: /Send Feedback/ });
    
    await user.type(nameInput, 'John Doe');
    await user.type(emailInput, 'john@example.com');
    await user.type(commentsInput, 'Great app!');
    await user.click(submitButton);
    
    expect(screen.getByText('Sending...')).toBeInTheDocument();
    expect(submitButton).toBeDisabled();
    
    // Resolve the promise to complete the test
    resolvePromise!({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  it('closes modal when cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    const cancelButton = screen.getByRole('button', { name: /Cancel/ });
    await user.click(cancelButton);
    
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('closes modal when close button (X) is clicked', async () => {
    const user = userEvent.setup();
    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    const closeButton = screen.getByRole('button', { name: /✕/ });
    await user.click(closeButton);
    
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('closes modal when backdrop is clicked', async () => {
    const user = userEvent.setup();
    render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    // The backdrop is the first div with class containing 'backdrop'
    const backdrop = document.querySelector('.absolute.inset-0');
    expect(backdrop).toBeInTheDocument();
    
    if (backdrop) {
      await user.click(backdrop);
      expect(mockOnClose).toHaveBeenCalled();
    }
  });

  it('resets form when modal is closed and reopened', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    const nameInput = screen.getByLabelText(/Your Name/);
    const emailInput = screen.getByLabelText(/Email/);
    const commentsInput = screen.getByLabelText(/Your Feedback/);
    
    await user.type(nameInput, 'John Doe');
    await user.type(emailInput, 'john@example.com');
    await user.type(commentsInput, 'Great app!');
    
    // Close modal
    rerender(<FeedbackModal isOpen={false} onClose={mockOnClose} />);
    
    // Reopen modal
    rerender(<FeedbackModal isOpen={true} onClose={mockOnClose} />);
    
    // Form should be reset
    expect(screen.getByLabelText(/Your Name/)).toHaveValue('');
    expect(screen.getByLabelText(/Email/)).toHaveValue('');
    expect(screen.getByLabelText(/Your Feedback/)).toHaveValue('');
  });
}); 
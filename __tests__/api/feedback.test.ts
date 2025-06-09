import { NextRequest } from 'next/server';
import { POST } from '../../src/app/api/feedback/route';

// Mock the Resend library
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({
        data: { id: 'test-id' },
        error: null
      })
    }
  }))
}));

// Mock environment variables
const originalEnv = process.env;

describe('/api/feedback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const createMockRequest = (body: any) => {
    return {
      json: jest.fn().mockResolvedValue(body),
    } as unknown as NextRequest;
  };

  describe('validation', () => {
    it('returns 400 when name is missing', async () => {
      const request = createMockRequest({
        name: '',
        email: 'test@example.com',
        comments: 'Great app!',
        timestamp: new Date().toISOString()
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Name is required');
    });

    it('returns 400 when name is only whitespace', async () => {
      const request = createMockRequest({
        name: '   ',
        email: 'test@example.com',
        comments: 'Great app!',
        timestamp: new Date().toISOString()
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Name is required');
    });

    it('returns 400 when email is missing', async () => {
      const request = createMockRequest({
        name: 'John Doe',
        email: '',
        comments: 'Great app!',
        timestamp: new Date().toISOString()
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Email is required');
    });

    it('returns 400 when email is only whitespace', async () => {
      const request = createMockRequest({
        name: 'John Doe',
        email: '   ',
        comments: 'Great app!',
        timestamp: new Date().toISOString()
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Email is required');
    });

    it('returns 400 when comments are missing', async () => {
      const request = createMockRequest({
        name: 'John Doe',
        email: 'test@example.com',
        comments: '',
        timestamp: new Date().toISOString()
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Comments are required');
    });

    it('returns 400 when comments are only whitespace', async () => {
      const request = createMockRequest({
        name: 'John Doe',
        email: 'test@example.com',
        comments: '   ',
        timestamp: new Date().toISOString()
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Comments are required');
    });

    it('returns 400 when all fields are missing', async () => {
      const request = createMockRequest({});

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Name is required');
    });
  });

  describe('successful submission', () => {
    it('processes valid feedback successfully with Resend API key', async () => {
      process.env.RESEND_API_KEY = 'test-api-key';
      
      const requestData = {
        name: 'John Doe',
        email: 'john@example.com',
        comments: 'This is great feedback!',
        timestamp: new Date().toISOString()
      };

      const request = createMockRequest(requestData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Feedback sent successfully!');
    });

    it('processes valid feedback successfully without Resend API key', async () => {
      delete process.env.RESEND_API_KEY;
      
      const requestData = {
        name: 'John Doe',
        email: 'john@example.com',
        comments: 'This is great feedback!',
        timestamp: new Date().toISOString()
      };

      const request = createMockRequest(requestData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Feedback received!');
    });

    it('handles email sending failure gracefully', async () => {
      process.env.RESEND_API_KEY = 'test-api-key';
      
      // Mock Resend to throw an error
      const { Resend } = require('resend');
      const mockResend = new Resend();
      mockResend.emails.send.mockRejectedValueOnce(new Error('Email service error'));

      const requestData = {
        name: 'John Doe',
        email: 'john@example.com',
        comments: 'This is great feedback!',
        timestamp: new Date().toISOString()
      };

      const request = createMockRequest(requestData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Feedback received! (Email delivery pending)');
    });

    it('trims whitespace from input fields', async () => {
      const requestData = {
        name: '  John Doe  ',
        email: '  john@example.com  ',
        comments: '  This is great feedback!  ',
        timestamp: new Date().toISOString()
      };

      const request = createMockRequest(requestData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('generates timestamp if not provided', async () => {
      const requestData = {
        name: 'John Doe',
        email: 'john@example.com',
        comments: 'This is great feedback!'
        // No timestamp provided
      };

      const request = createMockRequest(requestData);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('handles JSON parsing errors', async () => {
      const request = {
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
      } as unknown as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to process feedback');
    });

    it('handles unexpected errors during processing', async () => {
      // Mock console.error to avoid noise in test output
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const request = createMockRequest({
        name: 'John Doe',
        email: 'john@example.com',
        comments: 'This is great feedback!',
        timestamp: new Date().toISOString()
      });

      // Force an error by making the request.json() method throw after first call
      (request.json as jest.Mock).mockRejectedValueOnce(new Error('Database error'));

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to process feedback');
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('email content generation', () => {
    it('generates correct email subject with user name', async () => {
      process.env.RESEND_API_KEY = 'test-api-key';
      
      const { Resend } = require('resend');
      const mockResend = new Resend();
      const mockSend = mockResend.emails.send;

      const requestData = {
        name: 'Jane Smith',
        email: 'jane@example.com',
        comments: 'Awesome app!',
        timestamp: new Date().toISOString()
      };

      const request = createMockRequest(requestData);
      await POST(request);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'New Feedback from Tiny Viewers: Jane Smith'
        })
      );
    });

    it('generates correct email HTML content', async () => {
      process.env.RESEND_API_KEY = 'test-api-key';
      
      const { Resend } = require('resend');
      const mockResend = new Resend();
      const mockSend = mockResend.emails.send;

      const requestData = {
        name: 'Jane Smith',
        email: 'jane@example.com',
        comments: 'Awesome app!\nMultiline feedback.',
        timestamp: '2023-12-01T12:00:00.000Z'
      };

      const request = createMockRequest(requestData);
      await POST(request);

      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.html).toContain('<h2>New Feedback from Tiny Viewers App</h2>');
      expect(callArgs.html).toContain('<strong>Name:</strong> Jane Smith');
      expect(callArgs.html).toContain('<strong>Email:</strong> jane@example.com');
      expect(callArgs.html).toContain('Awesome app!<br>Multiline feedback.');
      expect(callArgs.html).toContain('2023-12-01T12:00:00.000Z');
    });
  });
}); 
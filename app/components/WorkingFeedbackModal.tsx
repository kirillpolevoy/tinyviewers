'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface WorkingFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WorkingFeedbackModal({ isOpen, onClose }: WorkingFeedbackModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    comments: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      setError('Please provide your name');
      return;
    }
    
    if (!formData.email.trim()) {
      setError('Please provide your email');
      return;
    }
    
    if (!formData.comments.trim()) {
      setError('Please provide your feedback comments');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit feedback');
      }

      setIsSubmitted(true);
      setFormData({ name: '', email: '', comments: '' });
    } catch (err) {
      setError('Failed to submit feedback. Please try again.');
      console.error('Feedback submission error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setIsSubmitted(false);
    setError(null);
    setFormData({ name: '', email: '', comments: '' });
    onClose();
  };

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        zIndex: 2147483647,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '60px 20px 20px 20px',
        overflowY: 'auto',
        isolation: 'isolate'
      }}
      onClick={handleClose}
    >
      <div 
        style={{
          width: '100%',
          maxWidth: '28rem',
          backgroundColor: 'rgba(255, 255, 255, 0.98)',
          backdropFilter: 'blur(12px)',
          borderRadius: '24px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid rgba(236, 72, 153, 0.2)',
          overflow: 'hidden',
          maxHeight: '90vh',
          overflowY: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {!isSubmitted ? (
          <div style={{ padding: '20px' }}>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>💭</div>
              <h2 
                style={{
                  fontSize: '1.5rem',
                  fontWeight: '300',
                  color: '#1e293b',
                  letterSpacing: '-0.025em',
                  marginBottom: '8px',
                  fontFamily: 'system-ui, -apple-system, serif',
                  textShadow: '0 2px 8px rgba(168, 85, 247, 0.15)',
                  background: 'linear-gradient(to right, #db2777, #a855f7, #059669)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text'
                }}
              >
                Share Your Feedback
              </h2>
              <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
                Help us make Tiny Viewers even better! ✨
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Name Field */}
              <div>
                <label 
                  htmlFor="name" 
                  style={{ 
                    display: 'block', 
                    fontSize: '0.875rem', 
                    fontWeight: '500', 
                    color: '#374151', 
                    marginBottom: '8px' 
                  }}
                >
                  Your Name <span style={{ color: '#f87171' }}>*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    backgroundColor: 'rgba(255, 255, 255, 0.8)',
                    border: '1px solid rgba(236, 72, 153, 0.2)',
                    borderRadius: '16px',
                    outline: 'none',
                    transition: 'all 0.3s',
                    color: '#1e293b',
                    fontSize: '1rem'
                  }}
                  placeholder="Your name"
                  onFocus={(e) => {
                    e.target.style.borderColor = 'rgba(168, 85, 247, 0.5)';
                    e.target.style.boxShadow = '0 0 0 2px rgba(168, 85, 247, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(236, 72, 153, 0.2)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              {/* Email Field */}
              <div>
                <label 
                  htmlFor="email" 
                  style={{ 
                    display: 'block', 
                    fontSize: '0.875rem', 
                    fontWeight: '500', 
                    color: '#374151', 
                    marginBottom: '8px' 
                  }}
                >
                  Email <span style={{ color: '#f87171' }}>*</span>
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    backgroundColor: 'rgba(255, 255, 255, 0.8)',
                    border: '1px solid rgba(236, 72, 153, 0.2)',
                    borderRadius: '16px',
                    outline: 'none',
                    transition: 'all 0.3s',
                    color: '#1e293b',
                    fontSize: '1rem'
                  }}
                  placeholder="your@email.com"
                  onFocus={(e) => {
                    e.target.style.borderColor = 'rgba(168, 85, 247, 0.5)';
                    e.target.style.boxShadow = '0 0 0 2px rgba(168, 85, 247, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(236, 72, 153, 0.2)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              {/* Comments Field */}
              <div>
                <label 
                  htmlFor="comments" 
                  style={{ 
                    display: 'block', 
                    fontSize: '0.875rem', 
                    fontWeight: '500', 
                    color: '#374151', 
                    marginBottom: '8px' 
                  }}
                >
                  Your Feedback <span style={{ color: '#f87171' }}>*</span>
                </label>
                <textarea
                  id="comments"
                  name="comments"
                  value={formData.comments}
                  onChange={handleInputChange}
                  rows={4}
                  required
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    backgroundColor: 'rgba(255, 255, 255, 0.8)',
                    border: '1px solid rgba(236, 72, 153, 0.2)',
                    borderRadius: '16px',
                    outline: 'none',
                    transition: 'all 0.3s',
                    color: '#1e293b',
                    fontSize: '1rem',
                    resize: 'none'
                  }}
                  placeholder="Tell us what you think, what could be improved, or share any suggestions..."
                  onFocus={(e) => {
                    e.target.style.borderColor = 'rgba(168, 85, 247, 0.5)';
                    e.target.style.boxShadow = '0 0 0 2px rgba(168, 85, 247, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(236, 72, 153, 0.2)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              {/* Error Message */}
              {error && (
                <div style={{
                  color: '#dc2626',
                  fontSize: '0.875rem',
                  backgroundColor: '#fef2f2',
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid #fecaca'
                }}>
                  {error}
                </div>
              )}

              {/* Buttons */}
              <div style={{ display: 'flex', gap: '12px', paddingTop: '16px' }}>
                <button
                  type="button"
                  onClick={handleClose}
                  style={{
                    flex: 1,
                    padding: '12px 24px',
                    color: '#64748b',
                    backgroundColor: '#f1f5f9',
                    border: 'none',
                    borderRadius: '16px',
                    transition: 'all 0.3s',
                    fontWeight: '500',
                    cursor: 'pointer',
                    fontSize: '1rem'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = '#e2e8f0';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = '#f1f5f9';
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !formData.name.trim() || !formData.email.trim() || !formData.comments.trim()}
                  style={{
                    flex: 1,
                    padding: '12px 24px',
                    background: 'linear-gradient(to right, #ec4899, #a855f7, #059669)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '16px',
                    transition: 'all 0.3s',
                    fontWeight: '500',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    opacity: (isSubmitting || !formData.name.trim() || !formData.email.trim() || !formData.comments.trim()) ? 0.5 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    fontSize: '1rem'
                  }}
                  onMouseOver={(e) => {
                    if (!isSubmitting) {
                      e.currentTarget.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.1)';
                    }
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  {isSubmitting ? (
                    <>
                      <div style={{
                        width: '16px',
                        height: '16px',
                        border: '2px solid rgba(255, 255, 255, 0.3)',
                        borderTop: '2px solid white',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                      }} />
                      Sending...
                    </>
                  ) : (
                    <>
                      Send Feedback
                      <span style={{ fontSize: '1.125rem' }}>💌</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* Thank You Message */
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <div style={{ fontSize: '4rem', marginBottom: '24px' }}>
              🎉
            </div>
            <h2 
              style={{
                fontSize: '1.5rem',
                fontWeight: '300',
                color: '#1e293b',
                letterSpacing: '-0.025em',
                marginBottom: '16px',
                fontFamily: 'system-ui, -apple-system, serif',
                textShadow: '0 2px 8px rgba(168, 85, 247, 0.15)',
                background: 'linear-gradient(to right, #db2777, #a855f7, #059669)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}
            >
              Thank You!
            </h2>
            <p style={{ color: '#64748b', marginBottom: '32px', lineHeight: '1.6' }}>
              Your feedback has been received! We really appreciate you taking the time to help us improve Tiny Viewers. 💜
            </p>
            <button
              onClick={handleClose}
              style={{
                padding: '12px 32px',
                background: 'linear-gradient(to right, #ec4899, #a855f7, #059669)',
                color: 'white',
                border: 'none',
                borderRadius: '16px',
                transition: 'all 0.3s',
                fontWeight: '500',
                cursor: 'pointer',
                fontSize: '1rem'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.1)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              Close
            </button>
          </div>
        )}
        
        {/* Close Button */}
        <button
          onClick={handleClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94a3b8',
            backgroundColor: 'transparent',
            border: 'none',
            borderRadius: '50%',
            transition: 'all 0.3s',
            cursor: 'pointer',
            fontSize: '1.25rem'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.color = '#64748b';
            e.currentTarget.style.backgroundColor = '#f1f5f9';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.color = '#94a3b8';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          ✕
        </button>
      </div>

      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}      </style>
    </div>
  );

  return createPortal(modalContent, document.body);
}

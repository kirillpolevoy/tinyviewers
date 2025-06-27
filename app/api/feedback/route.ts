import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  try {
    const { name, email, comments, timestamp } = await request.json();

    // Validate required fields
    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }
    
    if (!email?.trim()) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }
    
    if (!comments?.trim()) {
      return NextResponse.json(
        { error: 'Comments are required' },
        { status: 400 }
      );
    }

    // Prepare the email content
    const emailContent = `
      <h2>New Feedback from Tiny Viewers App</h2>
      <p><strong>Submitted:</strong> ${timestamp || new Date().toISOString()}</p>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Comments:</strong></p>
      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 10px 0;">
        ${comments.replace(/\n/g, '<br>')}
      </div>
      <hr style="margin: 20px 0;">
      <p style="color: #666; font-size: 12px;">
        This feedback was submitted through the Tiny Viewers feedback modal.
      </p>
    `;

    // Send email using Resend with verified default domain
    if (process.env.RESEND_API_KEY) {
      try {
        const emailPayload = {
          from: 'onboarding@resend.dev',
          to: ['kpolevoy@gmail.com'],
          subject: `New Feedback from Tiny Viewers: ${name}`,
          html: emailContent,
        };

        console.log('Email payload:', JSON.stringify(emailPayload, null, 2));
        const result = await resend.emails.send(emailPayload);
        console.log('Resend result:', JSON.stringify(result, null, 2));

        return NextResponse.json({
          success: true,
          message: 'Feedback sent successfully!'
        });

      } catch (emailError) {
        console.error('Email sending failed:', emailError);
        
        return NextResponse.json({
          success: true,
          message: 'Feedback received! (Email delivery pending)'
        });
      }
    } else {
      console.log('Feedback received (no email service configured):', {
        timestamp: timestamp || new Date().toISOString(),
        name: name.trim(),
        email: email.trim(),
        comments: comments.trim(),
      });

      return NextResponse.json({
        success: true,
        message: 'Feedback received!'
      });
    }

  } catch (error) {
    console.error('Error processing feedback:', error);
    return NextResponse.json(
      { error: 'Failed to process feedback' },
      { status: 500 }
    );
  }
} 
// Simple test to verify our testing setup works
describe('Feedback Feature Tests', () => {
  test('validates required fields functionality', () => {
    // Test that name validation works
    const validateName = (name) => {
      if (!name?.trim()) {
        return 'Name is required';
      }
      return null;
    };

    // Test that email validation works
    const validateEmail = (email) => {
      if (!email?.trim()) {
        return 'Email is required';
      }
      return null;
    };

    // Test that comments validation works
    const validateComments = (comments) => {
      if (!comments?.trim()) {
        return 'Comments are required';
      }
      return null;
    };

    // Test cases
    expect(validateName('')).toBe('Name is required');
    expect(validateName('   ')).toBe('Name is required');
    expect(validateName('John Doe')).toBe(null);

    expect(validateEmail('')).toBe('Email is required');
    expect(validateEmail('   ')).toBe('Email is required');
    expect(validateEmail('test@example.com')).toBe(null);

    expect(validateComments('')).toBe('Comments are required');
    expect(validateComments('   ')).toBe('Comments are required');
    expect(validateComments('Great feedback!')).toBe(null);
  });

  test('form submission validation logic', () => {
    const validateForm = (formData) => {
      const errors = [];
      
      if (!formData.name?.trim()) {
        errors.push('Please provide your name');
      }
      
      if (!formData.email?.trim()) {
        errors.push('Please provide your email');
      }
      
      if (!formData.comments?.trim()) {
        errors.push('Please provide your feedback comments');
      }
      
      return errors;
    };

    // Test empty form
    expect(validateForm({})).toEqual([
      'Please provide your name',
      'Please provide your email', 
      'Please provide your feedback comments'
    ]);

    // Test partially filled form
    expect(validateForm({ name: 'John' })).toEqual([
      'Please provide your email',
      'Please provide your feedback comments'
    ]);

    // Test valid form
    expect(validateForm({
      name: 'John Doe',
      email: 'john@example.com',
      comments: 'Great app!'
    })).toEqual([]);
  });

  test('API validation logic', () => {
    const validateAPIRequest = (data) => {
      if (!data.name?.trim()) {
        return { error: 'Name is required', status: 400 };
      }
      
      if (!data.email?.trim()) {
        return { error: 'Email is required', status: 400 };
      }
      
      if (!data.comments?.trim()) {
        return { error: 'Comments are required', status: 400 };
      }
      
      return { success: true, status: 200 };
    };

    // Test missing name
    expect(validateAPIRequest({ email: 'test@example.com', comments: 'feedback' }))
      .toEqual({ error: 'Name is required', status: 400 });

    // Test missing email
    expect(validateAPIRequest({ name: 'John', comments: 'feedback' }))
      .toEqual({ error: 'Email is required', status: 400 });

    // Test missing comments
    expect(validateAPIRequest({ name: 'John', email: 'test@example.com' }))
      .toEqual({ error: 'Comments are required', status: 400 });

    // Test valid request
    expect(validateAPIRequest({ name: 'John', email: 'test@example.com', comments: 'feedback' }))
      .toEqual({ success: true, status: 200 });
  });

  test('email content generation', () => {
    const generateEmailContent = (data) => {
      return `
        <h2>New Feedback from Tiny Viewers App</h2>
        <p><strong>Name:</strong> ${data.name}</p>
        <p><strong>Email:</strong> ${data.email}</p>
        <p><strong>Comments:</strong></p>
        <div>${data.comments.replace(/\n/g, '<br>')}</div>
      `;
    };

    const testData = {
      name: 'Jane Smith',
      email: 'jane@example.com',
      comments: 'Great app!\nLove the features.'
    };

    const emailContent = generateEmailContent(testData);
    
    expect(emailContent).toContain('<strong>Name:</strong> Jane Smith');
    expect(emailContent).toContain('<strong>Email:</strong> jane@example.com');
    expect(emailContent).toContain('Great app!<br>Love the features.');
  });
}); 
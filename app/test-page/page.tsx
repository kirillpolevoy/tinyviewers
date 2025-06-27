'use client';

import React from 'react';

export default function TestRoute() {
  React.useEffect(() => {
    alert('🚨 BRAND NEW ROUTE WORKS! 🚨');
  }, []);

  return (
    <div style={{ 
      padding: '50px', 
      backgroundColor: '#00ff00', 
      color: 'black',
      fontSize: '30px',
      textAlign: 'center',
      border: '10px solid red'
    }}>
      <h1>🚨 NEW ROUTE TEST 🚨</h1>
      <p>This is a completely new route at /test-page</p>
      <p>If you see this GREEN page, file changes DO work!</p>
    </div>
  );
} 
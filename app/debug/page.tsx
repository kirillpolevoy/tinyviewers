'use client';

import { useState } from 'react';

export default function DebugPage() {
  const [results, setResults] = useState<any>({});
  const [loading, setLoading] = useState<string | null>(null);

  const testEnvironment = async () => {
    setLoading('env');
    try {
      const response = await fetch('/api/test-env');
      const data = await response.json();
      setResults((prev: any) => ({ ...prev, environment: data }));
    } catch (error) {
      setResults((prev: any) => ({ 
        ...prev, 
        environment: { error: error instanceof Error ? error.message : 'Failed to test environment' }
      }));
    }
    setLoading(null);
  };

  const testCheckExists = async () => {
    setLoading('check-exists');
    try {
      const response = await fetch('/api/movies/check-exists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imdbId: 'tt0398286' }) // Sample IMDB ID (Tangled)
      });
      const data = await response.json();
      setResults((prev: any) => ({ 
        ...prev, 
        checkExists: { 
          status: response.status,
          data 
        }
      }));
    } catch (error) {
      setResults((prev: any) => ({ 
        ...prev, 
        checkExists: { 
          error: error instanceof Error ? error.message : 'Failed to test check-exists' 
        }
      }));
    }
    setLoading(null);
  };

  const testFetchMetadata = async () => {
    setLoading('fetch-metadata');
    try {
      const response = await fetch('/api/movies/fetch-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imdbId: 'tt0398286' }) // Sample IMDB ID (Tangled)
      });
      const data = await response.json();
      setResults((prev: any) => ({ 
        ...prev, 
        fetchMetadata: { 
          status: response.status,
          data 
        }
      }));
    } catch (error) {
      setResults((prev: any) => ({ 
        ...prev, 
        fetchMetadata: { 
          error: error instanceof Error ? error.message : 'Failed to test fetch-metadata' 
        }
      }));
    }
    setLoading(null);
  };

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">API Debug Page</h1>
      
      <div className="space-y-4">
        <div>
          <button
            onClick={testEnvironment}
            disabled={loading === 'env'}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading === 'env' ? 'Testing...' : 'Test Environment Variables'}
          </button>
          
          {results.environment && (
            <div className="mt-2 p-4 bg-gray-100 rounded">
              <h3 className="font-bold">Environment Test Results:</h3>
              <pre className="mt-2 text-sm overflow-auto">
                {JSON.stringify(results.environment, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div>
          <button
            onClick={testCheckExists}
            disabled={loading === 'check-exists'}
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:opacity-50"
          >
            {loading === 'check-exists' ? 'Testing...' : 'Test Check Exists API'}
          </button>
          
          {results.checkExists && (
            <div className="mt-2 p-4 bg-gray-100 rounded">
              <h3 className="font-bold">Check Exists Test Results:</h3>
              <pre className="mt-2 text-sm overflow-auto">
                {JSON.stringify(results.checkExists, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div>
          <button
            onClick={testFetchMetadata}
            disabled={loading === 'fetch-metadata'}
            className="bg-purple-500 text-white px-4 py-2 rounded hover:bg-purple-600 disabled:opacity-50"
          >
            {loading === 'fetch-metadata' ? 'Testing...' : 'Test Fetch Metadata API'}
          </button>
          
          {results.fetchMetadata && (
            <div className="mt-2 p-4 bg-gray-100 rounded">
              <h3 className="font-bold">Fetch Metadata Test Results:</h3>
              <pre className="mt-2 text-sm overflow-auto">
                {JSON.stringify(results.fetchMetadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
      
      <div className="mt-8">
        <h2 className="text-xl font-bold mb-4">Instructions</h2>
        <div className="bg-yellow-100 p-4 rounded">
          <p>This debug page helps identify production issues with the API endpoints.</p>
          <ol className="list-decimal list-inside mt-2 space-y-1">
            <li>First, test environment variables to ensure they're properly configured</li>
            <li>Then test each API endpoint individually</li>
            <li>Check the console/logs for detailed error messages</li>
            <li>Compare results between local development and production</li>
          </ol>
        </div>
      </div>
    </div>
  );
} 
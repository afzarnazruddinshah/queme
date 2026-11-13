'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function QueueTrackerContent() {
  const searchParams = useSearchParams();
  // Added optional chaining (?) to fix the TypeScript 'possibly null' error
  const tenantId = searchParams?.get('tenantId') || 'neefa';
  
  const [serving, setServing] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/queue/status?tenantId=${tenantId}`);
      const data = await res.json();
      setServing(data.currentServing);
    } catch (err) {
      console.error('Failed to load status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Auto-refresh every 60 seconds
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, [tenantId]);

  return (
    <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 max-w-sm w-full text-center">
      <h1 className="text-xl font-semibold text-gray-800 mb-2 capitalize">{tenantId} Clinic</h1>
      <p className="text-sm text-gray-500 mb-8">Live Queue Status</p>
      
      <div className="bg-blue-50 text-blue-900 rounded-xl p-6 mb-8">
        <p className="text-sm font-medium mb-1">Currently Serving</p>
        {loading ? (
          <div className="text-4xl font-bold animate-pulse">...</div>
        ) : (
          <div className="text-6xl font-bold">
            {serving === 0 ? '-' : `#${serving}`}
          </div>
        )}
      </div>

      <button 
        onClick={fetchStatus}
        className="w-full py-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition"
      >
        Refresh Status
      </button>
    </div>
  );
}

export default function PublicQueueTracker() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      {/* Suspense boundary required by Next.js when using useSearchParams */}
      <Suspense fallback={<div className="text-gray-500 font-medium">Loading Queue...</div>}>
        <QueueTrackerContent />
      </Suspense>
    </div>
  );
}

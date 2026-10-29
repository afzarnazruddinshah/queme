'use client';

import React, { useState } from 'react';
import { UserCheck, Clock, ArrowRight, Loader2, Stethoscope } from 'lucide-react';

interface Patient {
  tokenNumber: string;
  patientName: string;
  phoneNumber: string;
  source?: string;
}

interface ActiveTokenCardProps {
  tenantId: string;
  nowServing: Patient | null;
  nextPatient: Patient | null;
  onQueueAdvanced: () => void;
}

export default function ActiveTokenCard({ tenantId, nowServing, nextPatient, onQueueAdvanced }: ActiveTokenCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCallNext = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/desk/advance?tenantId=${tenantId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const result = await response.json();

      if (result.success) {
        onQueueAdvanced(); // Trigger parent data refresh
      } else {
        setError(result.error || 'Failed to advance queue.');
      }
    } catch (err) {
      console.error('Error advancing queue:', err);
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
      
      {/* NOW SERVING CARD (Takes up 2 columns on desktop) */}
      <div className="lg:col-span-2 rounded-2xl bg-white border border-gray-100 shadow-sm p-6 relative overflow-hidden flex flex-col justify-between">
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-full blur-2xl -z-0 pointer-events-none" />
        
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2 text-blue-600 font-semibold text-xs uppercase tracking-wider">
              <Stethoscope className="h-4 w-4" />
              <span>Now Serving (Consultation Room)</span>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-100">
              Live
            </span>
          </div>

          {nowServing ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="text-4xl font-black text-gray-900 tracking-tight mb-1">
                  {nowServing.tokenNumber}
                </div>
                <div className="text-lg font-bold text-gray-800">
                  {nowServing.patientName}
                </div>
                <div className="text-sm text-gray-500 font-medium">
                  {nowServing.phoneNumber} {nowServing.source && `• (${nowServing.source})`}
                </div>
              </div>

              {/* Action Button to Advance Queue */}
              <button
                onClick={handleCallNext}
                disabled={loading}
                className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 transition"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Calling...
                  </>
                ) : (
                  <>
                    Call Next Token
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="text-2xl font-bold text-gray-400 mb-1">No Active Token</div>
                <p className="text-sm text-gray-500">Click the button to call the first patient in line.</p>
              </div>
              <button
                onClick={handleCallNext}
                disabled={loading}
                className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 transition"
              >
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Call First Token'}
              </button>
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-xs text-red-600 font-medium">{error}</p>}
      </div>

      {/* NEXT PATIENT PREVIEW CARD */}
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 flex flex-col justify-between">
        <div>
          <div className="flex items-center space-x-2 text-gray-400 font-semibold text-xs uppercase tracking-wider mb-4">
            <Clock className="h-4 w-4" />
            <span>Next In Line</span>
          </div>

          {nextPatient ? (
            <div>
              <div className="text-2xl font-bold text-gray-800 tracking-tight mb-1">
                {nextPatient.tokenNumber}
              </div>
              <div className="text-base font-semibold text-gray-700">
                {nextPatient.patientName}
              </div>
              <div className="text-xs text-gray-400 font-medium mt-1">
                {nextPatient.phoneNumber}
              </div>
            </div>
          ) : (
            <div className="py-4">
              <div className="text-lg font-semibold text-gray-300">Queue is empty</div>
              <p className="text-xs text-gray-400 mt-1">No pending patients waiting.</p>
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-gray-50 text-xs text-gray-400 flex items-center justify-between">
          <span>Waiting count</span>
          <span className="font-bold text-gray-700">Auto-synced</span>
        </div>
      </div>

    </div>
  );
}

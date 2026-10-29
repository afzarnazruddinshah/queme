'use client';

import React, { useState } from 'react';
import { Users, Trash2, Smartphone, UserCheck, Loader2 } from 'lucide-react';

interface Patient {
  tokenNumber: string;
  patientName: string;
  phoneNumber: string;
  source?: string;
  createdAt?: string;
}

interface QueueTableProps {
  tenantId: string;
  waitingQueue: Patient[];
  onQueueUpdated: () => void;
}

export default function QueueTable({ tenantId, waitingQueue, onQueueUpdated }: QueueTableProps) {
  const [actionLoadingToken, setActionLoadingToken] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleCancelToken = async (tokenNumber: string) => {
    setActionLoadingToken(tokenNumber);
    setError('');

    try {
      const response = await fetch(`/api/desk/cancel?tenantId=${tenantId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenNumber }),
      });

      const result = await response.json();

      if (result.success) {
        onQueueUpdated(); // Refresh parent queue state
      } else {
        setError(result.error || 'Failed to cancel token.');
      }
    } catch (err) {
      console.error('Error cancelling token:', err);
      setError('Network error. Please try again.');
    } finally {
      setActionLoadingToken(null);
    }
  };

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      
      {/* Table Header / Title Bar */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Users className="h-5 w-5 text-blue-600" />
          <h3 className="text-base font-bold text-gray-800">Waiting Queue</h3>
        </div>
        <span className="inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100">
          {waitingQueue.length} {waitingQueue.length === 1 ? 'Patient' : 'Patients'} Waiting
        </span>
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 border border-red-100">
          {error}
        </div>
      )}

      {/* Table Content */}
      <div className="overflow-x-auto">
        {waitingQueue.length > 0 ? (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/75 border-b border-gray-100 text-xs font-semibold uppercase tracking-wider text-gray-400">
                <th className="py-3 px-6">Token #</th>
                <th className="py-3 px-6">Patient Name</th>
                <th className="py-3 px-6">Phone Number</th>
                <th className="py-3 px-6">Source</th>
                <th className="py-3 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
              {waitingQueue.map((patient, index) => (
                <tr key={`${patient.tokenNumber}-${index}`} className="hover:bg-gray-50/50 transition">
                  <td className="py-4 px-6 font-bold text-blue-600">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-100 text-xs">
                      {patient.tokenNumber}
                    </span>
                  </td>
                  <td className="py-4 px-6 font-semibold text-gray-800">
                    {patient.patientName}
                  </td>
                  <td className="py-4 px-6 text-gray-500 font-medium">
                    {patient.phoneNumber}
                  </td>
                  <td className="py-4 px-6">
                    {patient.source === 'walk-in' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100">
                        Walk-in
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                        <Smartphone className="h-3 w-3 mr-1" />
                        WhatsApp
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-right">
                    <button
                      onClick={() => handleCancelToken(patient.tokenNumber)}
                      disabled={actionLoadingToken === patient.tokenNumber}
                      title="Cancel Token"
                      className="inline-flex items-center justify-center p-2 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-50"
                    >
                      {actionLoadingToken === patient.tokenNumber ? (
                        <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="py-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-50 text-gray-400 mb-3">
              <Users className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-gray-600">No patients in the waiting queue</p>
            <p className="text-xs text-gray-400 mt-1">Walk-in tokens or WhatsApp bookings will appear here instantly.</p>
          </div>
        )}
      </div>

    </div>
  );
}

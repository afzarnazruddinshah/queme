'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Stethoscope, UserPlus, RefreshCw, ShieldCheck } from 'lucide-react';
import ActiveTokenCard from './_components/ActiveTokenCard';
import QueueTable from './_components/QueueTable';
import NewTokenModal from './_components/NewTokenModal';

interface Patient {
  tokenNumber: string;
  patientName: string;
  phoneNumber: string;
  source?: string;
  createdAt?: string;
}

export default function DeskDashboard({ searchParams }: { searchParams?: { tenantId?: string } }) {
  // Extract tenantId from URL query params (default to demo clinic if not provided)
  const tenantId = searchParams?.tenantId || 'default_clinic';

  const [nowServing, setNowServing] = useState<Patient | null>(null);
  const [nextPatient, setNextPatient] = useState<Patient | null>(null);
  const [waitingQueue, setWaitingQueue] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // Fetch queue data from backend API
  const fetchQueueData = useCallback(async () => {
    try {
      const response = await fetch(`/api/desk?tenantId=${tenantId}`);
      const result = await response.json();

      if (result.success) {
        setNowServing(result.data.nowServing);
        setNextPatient(result.data.nextPatient);
        setWaitingQueue(result.data.waitingQueue || []);
        setLastRefreshed(new Date());
      }
    } catch (err) {
      console.error('Failed to fetch queue data:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // Initial load and automatic polling interval (every 5 seconds for real-time sync)
  useEffect(() => {
    fetchQueueData();
    const interval = setInterval(fetchQueueData, 5000);
    return () => clearInterval(interval);
  }, [fetchQueueData]);

  return (
    <div className="min-h-screen bg-gray-50/50 text-gray-900 pb-12">
      
      {/* Top Header Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          
          {/* Clinic Brand & Title */}
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Stethoscope className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">Neefa Solutions Desk</h1>
              <div className="flex items-center space-x-2 text-xs text-gray-400 font-medium">
                <span>Tenant: <strong className="text-gray-600">{tenantId}</strong></span>
                <span>•</span>
                <span className="inline-flex items-center text-emerald-600 font-semibold">
                  <ShieldCheck className="h-3 w-3 mr-0.5" /> Secure Live
                </span>
              </div>
            </div>
          </div>

          {/* Header Action Controls */}
          <div className="flex items-center space-x-3">
            <button
              onClick={fetchQueueData}
              title="Refresh Queue"
              className="p-2.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* Prominent New Walk-in Token Button */}
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center space-x-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition"
            >
              <UserPlus className="h-4 w-4" />
              <span>New Walk-In Token</span>
            </button>
          </div>

        </div>
      </header>

      {/* Main Content Dashboard Body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        
        {/* Step 3 Component: Now Serving & Next Patient Cards */}
        <ActiveTokenCard
          tenantId={tenantId}
          nowServing={nowServing}
          nextPatient={nextPatient}
          onQueueAdvanced={fetchQueueData}
        />

        {/* Step 4 Component: Waiting Queue Data Table */}
        <QueueTable
          tenantId={tenantId}
          waitingQueue={waitingQueue}
          onQueueUpdated={fetchQueueData}
        />

      </main>

      {/* Step 2 Component: New Walk-In Token Modal Form */}
      <NewTokenModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        tenantId={tenantId}
        onTokenAdded={fetchQueueData}
      />

    </div>
  );
}

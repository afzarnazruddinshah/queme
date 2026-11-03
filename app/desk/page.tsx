'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Stethoscope, UserPlus, RefreshCw, ShieldCheck, Lock, AlertCircle, Loader2 } from 'lucide-react';
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
  // Read tenantId from Next.js useSearchParams for reliability in client components
  const browserSearchParams = useSearchParams();
    const rawTenantId = browserSearchParams?.get('tenantId') || searchParams?.tenantId || 'neefa';

  const tenantId = rawTenantId.toLowerCase().trim();

  // Authentication States
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const [pin, setPin] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);

  // Queue Data States
  const [nowServing, setNowServing] = useState<Patient | null>(null);
  const [nextPatient, setNextPatient] = useState<Patient | null>(null);
  const [waitingQueue, setWaitingQueue] = useState<Patient[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // 1. Check existing session cookie on load
  useEffect(() => {
    async function verifySession() {
      try {
        const response = await fetch('/api/desk/auth');
        const result = await response.json();

        if (result.authenticated) {
          setIsAuthenticated(true);
        }
      } catch (err) {
        console.error('Session verification failed:', err);
      } finally {
        setIsCheckingAuth(false);
      }
    }
    verifySession();
  }, []);

  // 2. Fetch queue data from backend API
  const fetchQueueData = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      const response = await fetch(`/api/desk?tenantId=${tenantId}`);
      const result = await response.json();

      if (result.success && result.data) {
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
  }, [tenantId, isAuthenticated]);

  // 3. Real-time polling every 5 seconds (only when authenticated)
  useEffect(() => {
    if (!isAuthenticated) return;

    fetchQueueData();
    const interval = setInterval(fetchQueueData, 5000);
    return () => clearInterval(interval);
  }, [fetchQueueData, isAuthenticated]);

  // 4. Handle PIN submission
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    if (pin.length !== 6) {
      setAuthError('Please enter a 6-digit PIN.');
      return;
    }

    setIsAuthenticating(true);
    try {
      const res = await fetch('/api/desk/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicCode: tenantId,
          pin: pin.trim(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setIsAuthenticated(true);
      } else {
        setAuthError(data.message || 'Invalid PIN. Please try again.');
        setPin('');
      }
    } catch (err) {
      setAuthError('Network error. Check connection and retry.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // -------------------------------------------------------------
  // VIEW 1: Initial Session Verification Spinner
  // -------------------------------------------------------------
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <Loader2 className="h-8 w-8 text-blue-600 animate-spin mb-3" />
        <p className="text-sm font-medium text-gray-500">Checking clinic authorization...</p>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW 2: PIN Pad Gate (Clinic Code + 6-digit PIN)
  // -------------------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50/70 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-100 shadow-xl p-6 sm:p-8">
          
          <div className="flex flex-col items-center text-center mb-6">
            <div className="h-12 w-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-3 shadow-sm">
              <Lock className="h-6 w-6" />
            </div>
            <h1 className="text-lg font-bold text-gray-900">Reception Desk Access</h1>
            <p className="text-xs text-gray-500 mt-1">
              Clinic Code: <strong className="text-gray-800 font-mono uppercase">{tenantId}</strong>
            </p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5 text-center">
                Enter 6-Digit PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
                autoFocus
                className="w-full text-center tracking-[0.5em] text-2xl font-mono py-3 px-4 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition text-gray-900 placeholder:text-gray-300"
              />
            </div>

            {authError && (
              <div className="flex items-center space-x-2 text-xs text-rose-600 bg-rose-50 border border-rose-100 p-2.5 rounded-lg">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isAuthenticating || pin.length !== 6}
              className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition flex items-center justify-center space-x-2"
            >
              {isAuthenticating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Verifying PIN...</span>
                </>
              ) : (
                <span>Unlock Desk</span>
              )}
            </button>
          </form>

          <p className="text-[11px] text-gray-400 text-center mt-6">
            Authorized session persists across low-RAM app unloads and screen locks.
          </p>

        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VIEW 3: Full Authenticated Desk Dashboard
  // -------------------------------------------------------------
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
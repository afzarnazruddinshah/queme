'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Stethoscope,
  Plus,
  RefreshCw,
  ShieldCheck,
  Lock,
  AlertCircle,
  Loader2,
  Settings,
  CalendarOff,
} from 'lucide-react';
import ActiveTokenCard from './_components/ActiveTokenCard';
import QueueTable from './_components/QueueTable';
import NewTokenModal from './_components/NewTokenModal';
import SettingsDrawer from './_components/SettingsDrawer';
import ChangePinModal from './_components/ChangePinModal';
import OooModal from './_components/OooModal';

interface Patient {
  tokenNumber: string;
  patientName: string;
  phoneNumber: string;
  source?: string;
  createdAt?: string;
}

function DeskDashboardContent({ searchParams }: { searchParams?: { tenantId?: string } }) {
  const browserSearchParams = useSearchParams();
  const rawTenantId = browserSearchParams?.get('tenantId') || searchParams?.tenantId || 'neefa';
  const tenantId = rawTenantId.toLowerCase().trim();

  // Dynamic branding: "Neefa AdminDesk"
  const formattedTenantTitle = `${tenantId.charAt(0).toUpperCase() + tenantId.slice(1)} AdminDesk`;

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

  // OOO State (Rule 2: Auto-disable button during OOO)
  const [isOooActive, setIsOooActive] = useState<boolean>(false);
  const [oooMessage, setOooMessage] = useState<string>('');

  // Modals & Drawer States
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isChangePinOpen, setIsChangePinOpen] = useState<boolean>(false);
  const [isOooModalOpen, setIsOooModalOpen] = useState<boolean>(false);

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

  // 2. Fetch queue data and OOO status from backend API
  const fetchQueueData = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      // Parallel fetch: Queue state + OOO configuration
      const [queueRes, oooRes] = await Promise.all([
        fetch(`/api/desk?tenantId=${tenantId}`),
        fetch(`/api/desk/ooo?tenantId=${tenantId}`),
      ]);

      const queueResult = await queueRes.json();
      if (queueResult.success && queueResult.data) {
        setNowServing(queueResult.data.nowServing);
        setNextPatient(queueResult.data.nextPatient);
        setWaitingQueue(queueResult.data.waitingQueue || []);
      }

      const oooResult = await oooRes.json();
      if (oooResult.success && oooResult.config) {
        const config = oooResult.config;
        if (!config.enabled) {
          setIsOooActive(false);
          setOooMessage('');
        } else {
          // Verify current time against scheduled range
          const now = new Date();
          const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
          const istMinutes = (utcMinutes + 330) % 1440;

          const pad = (n: number) => String(n).padStart(2, '0');
          const todayStr = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;

          let withinDates = true;
          if (config.startDate && todayStr < config.startDate) withinDates = false;
          if (config.endDate && todayStr > config.endDate) withinDates = false;

          let withinTimes = true;
          if (config.startTime && config.endTime) {
            const [sH, sM] = config.startTime.split(':').map(Number);
            const [eH, eM] = config.endTime.split(':').map(Number);
            const startMin = sH * 60 + sM;
            const endMin = eH * 60 + eM;
            if (istMinutes < startMin || istMinutes > endMin) withinTimes = false;
          }

          const currentlyOoo = withinDates && withinTimes;
          setIsOooActive(currentlyOoo);
          setOooMessage(config.message || 'Clinic is currently Out of Office.');
        }
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
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
    } catch {
      setAuthError('Network error. Check connection and retry.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // 5. Handle Locking Desk Session
  const handleLockSession = () => {
    setIsAuthenticated(false);
    setPin('');
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
            <h1 className="text-lg font-bold text-gray-900">{formattedTenantTitle}</h1>
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
      
      {/* Top Header Navigation Bar - Mobile Responsive & Realigned */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-100 shadow-xs">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
          
          {/* Clinic Brand & Title (Truncates cleanly if space is tight) */}
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/30 shrink-0">
              <Stethoscope className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-gray-900 leading-tight truncate">
                {formattedTenantTitle}
              </h1>
              <div className="flex items-center space-x-1.5 text-[11px] text-gray-400 font-medium">
                <span className="truncate">Tenant: <strong className="text-gray-600 uppercase font-mono">{tenantId}</strong></span>
                <span>•</span>
                <span className="inline-flex items-center text-emerald-600 font-semibold shrink-0">
                  <ShieldCheck className="h-3 w-3 mr-0.5" /> Live
                </span>
              </div>
            </div>
          </div>

          {/* Header Action Controls */}
          <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
            {/* Refresh Queue */}
            <button
              onClick={fetchQueueData}
              title="Refresh Queue"
              className="p-2 sm:p-2.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* + New Token Button (Disabled when OOO is active) */}
            <button
              disabled={isOooActive}
              onClick={() => setIsModalOpen(true)}
              title={isOooActive ? `Clinic is OOO: ${oooMessage}` : 'Create Walk-In Token'}
              className={`inline-flex items-center space-x-1.5 rounded-xl px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-white transition ${
                isOooActive
                  ? 'bg-amber-600/70 hover:bg-amber-600/70 cursor-not-allowed opacity-80 shadow-none'
                  : 'bg-blue-600 shadow-sm shadow-blue-500/30 hover:bg-blue-700 active:scale-[0.98]'
              }`}
            >
              {isOooActive ? (
                <>
                  <CalendarOff className="h-4 w-4" />
                  <span>OOO Active</span>
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  <span>New Token</span>
                </>
              )}
            </button>

            {/* Settings Trigger */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              title="Clinic Settings"
              className="p-2 sm:p-2.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>

        </div>
      </header>

      {/* Main Content Dashboard Body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
        
        {/* Active OOO Notice Banner */}
        {isOooActive && (
          <div className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start justify-between shadow-xs">
            <div className="flex items-start space-x-3">
              <CalendarOff className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                  Out of Office Mode Active
                </h3>
                <p className="text-xs text-amber-800 mt-0.5">{oooMessage}</p>
                <p className="text-[11px] text-amber-700/80 mt-1">
                  Walk-in and WhatsApp token registrations are paused.
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsOooModalOpen(true)}
              className="text-xs font-semibold text-amber-700 underline hover:text-amber-900 shrink-0 ml-3"
            >
              Edit
            </button>
          </div>
        )}

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

      {/* Modal: New Walk-In Token Form */}
      <NewTokenModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        tenantId={tenantId}
        onTokenAdded={fetchQueueData}
      />

      {/* Drawer: Clinic Settings Navigation */}
      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        tenantId={tenantId}
        onOpenChangePin={() => setIsChangePinOpen(true)}
        onOpenOoo={() => setIsOooModalOpen(true)}
        onLockSession={handleLockSession}
      />

      {/* Modal: Change 6-Digit PIN */}
      <ChangePinModal
        isOpen={isChangePinOpen}
        onClose={() => setIsChangePinOpen(false)}
        tenantId={tenantId}
      />

      {/* Modal: Out of Office Schedule & Message */}
      <OooModal
        isOpen={isOooModalOpen}
        onClose={() => setIsOooModalOpen(false)}
        tenantId={tenantId}
        onOooUpdated={fetchQueueData}
      />

    </div>
  );
}

export default function DeskDashboard(props: { searchParams?: { tenantId?: string } }) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
      </div>
    }>
      <DeskDashboardContent {...props} />
    </Suspense>
  );
}
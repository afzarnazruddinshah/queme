'use client';

import React, { useState } from 'react';
import { KeyRound, X, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

interface ChangePinModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
}

export default function ChangePinModal({ isOpen, onClose, tenantId }: ChangePinModalProps) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  if (!isOpen) return null;

  const handleClose = () => {
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setErrorMessage('');
    setSuccessMessage('');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (currentPin.length !== 6) {
      setErrorMessage('Current PIN must be 6 digits.');
      return;
    }

    if (newPin.length !== 6) {
      setErrorMessage('New PIN must be 6 digits.');
      return;
    }

    if (newPin !== confirmPin) {
      setErrorMessage('New PIN and confirmation PIN do not match.');
      return;
    }

    if (currentPin === newPin) {
      setErrorMessage('New PIN must be different from current PIN.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/desk/auth/change-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          currentPin,
          newPin,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSuccessMessage('PIN changed successfully!');
        setTimeout(() => {
          handleClose();
        }, 1200);
      } else {
        setErrorMessage(data.message || 'Failed to update PIN.');
      }
    } catch {
      setErrorMessage('Network error. Check connection and retry.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-gray-100">
        <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm">Change Desk PIN</h3>
              <p className="text-[11px] text-gray-400 font-mono uppercase">{tenantId}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Current 6-Digit PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
              autoFocus
              className="w-full font-mono text-center tracking-[0.3em] text-lg py-2 px-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              New 6-Digit PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
              className="w-full font-mono text-center tracking-[0.3em] text-lg py-2 px-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Confirm New PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
              className="w-full font-mono text-center tracking-[0.3em] text-lg py-2 px-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition"
            />
          </div>

          {errorMessage && (
            <div className="flex items-center space-x-1.5 p-2 rounded-lg bg-rose-50 text-rose-600 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="flex items-center space-x-1.5 p-2 rounded-lg bg-emerald-50 text-emerald-600 text-xs">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          <div className="flex space-x-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="w-1/2 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || currentPin.length !== 6 || newPin.length !== 6 || confirmPin.length !== 6}
              className="w-1/2 py-2.5 rounded-xl bg-blue-600 text-xs font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center space-x-1.5"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Update PIN</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
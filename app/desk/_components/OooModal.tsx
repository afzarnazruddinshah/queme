'use client';

import React, { useState, useEffect } from 'react';
import { CalendarClock, X, AlertCircle, CheckCircle2, Loader2, Send } from 'lucide-react';

interface OooModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  onOooUpdated?: () => void;
}

export default function OooModal({ isOpen, onClose, tenantId, onOooUpdated }: OooModalProps) {
  const [enabled, setEnabled] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [message, setMessage] = useState('');
  const [notifyExisting, setNotifyExisting] = useState(true);

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // Fetch current OOO config when opened
  useEffect(() => {
    if (!isOpen) return;

    async function loadConfig() {
      setIsFetching(true);
      setStatusMessage(null);
      try {
        const res = await fetch(`/api/desk/ooo?tenantId=${tenantId}`);
        const data = await res.json();
        if (data.success && data.config) {
          setEnabled(Boolean(data.config.enabled));
          setStartDate(data.config.startDate || '');
          setEndDate(data.config.endDate || '');
          setStartTime(data.config.startTime || '');
          setEndTime(data.config.endTime || '');
          setMessage(
            data.config.message ||
              'The doctor is currently Out of Office. Consultation and token registrations are temporarily paused.'
          );
        }
      } catch {
        setStatusMessage({ type: 'error', text: 'Failed to load existing OOO settings.' });
      } finally {
        setIsFetching(false);
      }
    }
    loadConfig();
  }, [isOpen, tenantId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    if (enabled && !message.trim()) {
      setStatusMessage({ type: 'error', text: 'Please provide an away message for patients.' });
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/desk/ooo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          enabled,
          startDate,
          endDate,
          startTime,
          endTime,
          message: message.trim(),
          notifyExisting,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setStatusMessage({ type: 'success', text: data.message });
        if (onOooUpdated) onOooUpdated();
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setStatusMessage({ type: 'error', text: data.error || 'Failed to update OOO settings.' });
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 sm:p-6 shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm">Out of Office & Auto-Reply</h3>
              <p className="text-[11px] text-gray-400 font-mono uppercase">{tenantId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isFetching ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-2">
            <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
            <p className="text-xs text-gray-400">Loading schedule...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {/* Master Toggle */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
              <div>
                <p className="font-bold text-gray-800">Activate OOO Mode</p>
                <p className="text-[11px] text-gray-500">Pauses walk-ins and sends away reply</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
              </label>
            </div>

            {/* Schedule Section */}
            <div className="space-y-3 pt-1">
              <p className="font-semibold text-gray-700">Schedule Timings (Optional)</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-gray-200 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-gray-200 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-gray-200 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">End Time</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-gray-200 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Message Template Section */}
            <div>
              <label className="block font-semibold text-gray-700 mb-1">
                WhatsApp Away & Broadcast Message
              </label>
              <textarea
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="The doctor is attending an emergency. Token registrations reopen at 4:30 PM."
                className="w-full p-2.5 rounded-xl border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition"
              />
            </div>

            {/* Rule 1: Notify active token holders toggle */}
            {enabled && (
              <label className="flex items-start space-x-2 p-2.5 rounded-xl bg-amber-50/60 border border-amber-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyExisting}
                  onChange={(e) => setNotifyExisting(e.target.checked)}
                  className="mt-0.5 rounded text-amber-600 focus:ring-amber-500"
                />
                <span className="text-[11px] text-amber-900 leading-tight">
                  <strong>Broadcast alert:</strong> Send this away message immediately to all currently waiting token holders via WhatsApp.
                </span>
              </label>
            )}

            {/* Status alerts */}
            {statusMessage && (
              <div
                className={`flex items-center space-x-1.5 p-2 rounded-lg text-xs ${
                  statusMessage.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                    : 'bg-rose-50 text-rose-600 border border-rose-100'
                }`}
              >
                {statusMessage.type === 'success' ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0" />
                )}
                <span>{statusMessage.text}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="w-1/2 py-2.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="w-1/2 py-2.5 rounded-xl bg-amber-600 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50 transition flex items-center justify-center space-x-1.5"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>Save Settings</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

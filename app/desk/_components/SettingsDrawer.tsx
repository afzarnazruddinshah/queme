'use client';

import React from 'react';
import { X, Lock, CalendarClock, ChevronRight, LogOut } from 'lucide-react';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  onOpenChangePin: () => void;
  onLockSession: () => void;
  onOpenOoo: () => void;
}

export default function SettingsDrawer({
  isOpen,
  onClose,
  tenantId,
  onOpenChangePin,
  onLockSession,
onOpenOoo
}: SettingsDrawerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Container */}
      <div className="relative w-full max-w-xs sm:max-w-sm bg-white h-full shadow-2xl z-50 flex flex-col justify-between animate-in slide-in-from-right duration-200 border-l border-gray-100">
        
        {/* Header */}
        <div>
          <div className="p-4 sm:p-5 flex items-center justify-between border-b border-gray-100">
            <div>
              <h2 className="text-base font-bold text-gray-900">Clinic Settings</h2>
              <p className="text-xs text-gray-400 font-mono">
                Tenant: <span className="uppercase text-gray-600 font-semibold">{tenantId}</span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Action List */}
          <div className="p-4 space-y-3">
            {/* 1. Change PIN */}
            <button
              onClick={() => {
                onClose();
                onOpenChangePin();
              }}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-gray-100 bg-white shadow-xs hover:border-blue-200 hover:bg-blue-50/40 active:bg-blue-50 transition text-left group"
            >
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition">
                  <Lock className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-gray-900">Change 6-Digit PIN</h4>
                  <p className="text-[11px] text-gray-400">Update reception access PIN</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-blue-600 transition" />
            </button>

            {/* 2. Unified OOO Schedule & Auto-Reply */}
            <button
              onClick={() => {
    onClose();
    onOpenOoo();
  }}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-gray-100 bg-white shadow-xs hover:border-blue-200 hover:bg-blue-50/40 active:bg-blue-50 transition text-left group"
            >
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition">
                  <CalendarClock className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-gray-900">OOO Schedule & Reply</h4>
                  <p className="text-[11px] text-gray-400">Set break timings & away message</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-amber-600 transition" />
            </button>
          </div>
        </div>

        {/* Footer / Lock Desk */}
        <div className="p-4 border-t border-gray-100">
          <button
            onClick={() => {
              onClose();
              onLockSession();
            }}
            className="w-full flex items-center justify-center space-x-2 p-3 rounded-xl border border-rose-100 bg-rose-50/60 text-rose-600 hover:bg-rose-100/70 font-semibold text-xs transition"
          >
            <LogOut className="h-4 w-4" />
            <span>Lock / End Session</span>
          </button>
        </div>

      </div>
    </div>
  );
}
import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, CheckCircle2 } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => (typeof window !== 'undefined' ? window.__deferredPWAInstallPrompt || null : null)
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIOSDevice);

    let inFrame = false;
    try {
      inFrame = window.self !== window.top;
    } catch {
      inFrame = true;
    }
    setIsInIframe(inFrame);

    if (window.__deferredPWAInstallPrompt) {
      setDeferredPrompt(window.__deferredPWAInstallPrompt);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      window.__deferredPWAInstallPrompt = e;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleCustomAvailable = () => {
      if (window.__deferredPWAInstallPrompt) {
        setDeferredPrompt(window.__deferredPWAInstallPrompt);
      }
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      window.__deferredPWAInstallPrompt = null;
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('pwa-install-available', handleCustomAvailable);
    window.addEventListener('appinstalled', handleAppInstalled);

    // If the user opened the standalone tab via ?install=1, auto-trigger as soon as prompt is ready
    const params = new URLSearchParams(window.location.search);
    if (params.get('install') === '1' && window.__deferredPWAInstallPrompt) {
      setTimeout(() => {
        const p = window.__deferredPWAInstallPrompt;
        if (p) {
          p.prompt().catch(() => {});
        }
      }, 300);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('pwa-install-available', handleCustomAvailable);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    const promptEvent = deferredPrompt || window.__deferredPWAInstallPrompt;
    if (!promptEvent) return false;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      window.__deferredPWAInstallPrompt = null;
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!(deferredPrompt || (typeof window !== 'undefined' && window.__deferredPWAInstallPrompt)),
    isInstalled,
    isIOS,
    isInIframe,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export const OfflineIndicator: React.FC<{ label?: string }> = ({ label }) => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg">
      <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
      <span>{label || 'Offline Mode — Cached PWA data is active'}</span>
    </div>
  );
};

export const PWAInstallButton: React.FC<{ installLabel?: string }> = ({ installLabel }) => {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isInstalled) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5" />
        Installed
      </span>
    );
  }

  const standaloneInstallUrl = (() => {
    if (typeof window === 'undefined') return '/';
    const url = new URL(window.location.href);
    url.searchParams.set('install', '1');
    return url.toString();
  })();

  // When running inside the AI Studio preview iframe and native prompt is blocked by iframe policy,
  // render the button as a direct link that opens the app in a top-level tab to install immediately.
  if (isInIframe && !isInstallable && !isIOS) {
    return (
      <a
        href={standaloneInstallUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open in top-level tab to install SubBill as a desktop/mobile app"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors whitespace-nowrap shadow-xs"
      >
        <Download className="w-3.5 h-3.5" />
        <span>{installLabel || 'Install App'}</span>
        <ExternalLink className="w-3 h-3 opacity-80" />
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const triggered = await install();
          if (!triggered) {
            setShowGuideModal(true);
          }
        }}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors whitespace-nowrap shadow-xs"
      >
        <Download className="w-3.5 h-3.5" />
        <span>{installLabel || 'Install App'}</span>
      </button>

      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 border border-slate-200 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-slate-950 text-white font-bold text-sm flex items-center justify-center">
                  S
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-950">
                    Install SubBill App
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Subscription Billing Automation System
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-mono font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                PWA Ready
              </span>
            </div>

            {isIOS ? (
              <div className="mt-4 space-y-2 text-xs text-slate-600 leading-relaxed bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <p className="font-semibold text-slate-900">Install on iPhone / iPad:</p>
                <p>1. Open this app in <strong>Safari</strong>.</p>
                <p>2. Tap the <strong>Share</strong> icon in the toolbar.</p>
                <p>3. Scroll down and select <strong>Add to Home Screen</strong>.</p>
              </div>
            ) : (
              <div className="mt-4 space-y-3 text-xs text-slate-600 leading-relaxed bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <p className="font-semibold text-slate-900">
                  Direct Browser Installation:
                </p>
                <p>
                  1. Look at the right side of your browser&apos;s address bar (URL bar) and click the <strong>Install SubBill</strong> (computer/download) icon.
                </p>
                <p>
                  2. Or click your browser menu (<strong>⋮</strong> in Chrome/Edge) → <strong>Save and share</strong> / <strong>Apps</strong> → <strong>Install Subscription Billing Automation System</strong>.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="mt-4 w-full rounded-lg bg-slate-950 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};

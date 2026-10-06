import React, { useState, useEffect, useCallback } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleAuthProvider } from './lib/firebase.ts';
import {
  LayoutDashboard,
  Layers,
  Users,
  Repeat,
  FileText,
  CreditCard,
  ShieldCheck,
  LogOut,
  ArrowUpRight,
  PanelLeftClose,
  PanelLeftOpen,
  Globe,
} from 'lucide-react';
import {
  AdminDashboardView,
  DashboardSummary,
  RevenueByPlanItem,
  SubscriptionMetrics,
  AuditLogItem,
} from './components/AdminDashboardView.tsx';
import { PlansAndSubscriptionsView, PlanItem, SubscriptionItem } from './components/PlansAndSubscriptionsView.tsx';
import { BillingOperationsView } from './components/BillingOperationsView.tsx';
import { CustomersAndAuditView } from './components/CustomersAndAuditView.tsx';
import { PWAInstallButton, OfflineIndicator } from './components/PWAInstallButton.tsx';
import { LANGUAGE_OPTIONS, TRANSLATIONS, SupportedLang } from './lib/i18n.ts';

interface UserAccount {
  id: number;
  uid: string;
  email: string;
  name: string;
  role: 'admin' | 'customer';
}

type NavTab =
  | 'dashboard'
  | 'plans'
  | 'customers'
  | 'subscriptions'
  | 'invoices'
  | 'payments'
  | 'audit';

export default function App() {
  const [user, setUser] = useState<UserAccount | null>(null);
  const [token, setToken] = useState<string>('');
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'authenticated'>('signin');
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Auth form fields
  const [emailInput, setEmailInput] = useState('admin@subbill.com');
  const [passwordInput, setPasswordInput] = useState('admin123');
  const [nameInput, setNameInput] = useState('');
  const [companyInput, setCompanyInput] = useState('');

  // Navigation & Language state
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [lang, setLang] = useState<SupportedLang>('en');
  const t = TRANSLATIONS[lang];

  // Data state
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [revenueByPlan, setRevenueByPlan] = useState<RevenueByPlanItem[]>([]);
  const [metrics, setMetrics] = useState<SubscriptionMetrics | null>(null);
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [failedPayments, setFailedPayments] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  const fetchAllWorkspaceData = useCallback(
    async (activeToken: string, role: 'admin' | 'customer') => {
      if (!activeToken) return;
      const headers = { Authorization: `Bearer ${activeToken}` };

      try {
        const baseRequests = [
          fetch('/api/plans?includeArchived=true', { headers }),
          fetch('/api/customers', { headers }),
          fetch('/api/subscriptions', { headers }),
          fetch('/api/invoices', { headers }),
          fetch('/api/payments', { headers }),
          fetch('/api/payments/failed', { headers }),
          fetch('/api/refunds', { headers }),
          fetch('/api/audit-logs', { headers }),
        ];

        const responses = await Promise.all(baseRequests);
        const [
          plansRes,
          custRes,
          subsRes,
          invRes,
          payRes,
          failPayRes,
          refRes,
          auditRes,
        ] = responses;

        if (plansRes.ok) setPlans(await plansRes.json());
        if (custRes.ok) setCustomers(await custRes.json());
        if (subsRes.ok) setSubscriptions(await subsRes.json());
        if (invRes.ok) setInvoices(await invRes.json());
        if (payRes.ok) setPayments(await payRes.json());
        if (failPayRes.ok) setFailedPayments(await failPayRes.json());
        if (refRes.ok) setRefunds(await refRes.json());
        if (auditRes.ok) setAuditLogs(await auditRes.json());

        if (role === 'admin') {
          const [sumRes, revRes, metRes] = await Promise.all([
            fetch('/api/dashboard/summary', { headers }),
            fetch('/api/dashboard/revenue-by-plan', { headers }),
            fetch('/api/dashboard/subscription-metrics', { headers }),
          ]);
          if (sumRes.ok) setSummary(await sumRes.json());
          if (revRes.ok) setRevenueByPlan(await revRes.json());
          if (metRes.ok) setMetrics(await metRes.json());
        } else {
          setSummary(null);
          setRevenueByPlan([]);
          setMetrics(null);
        }
      } catch (err) {
        console.error('Error fetching workspace data:', err);
      }
    },
    []
  );

  useEffect(() => {
    if (token && user) {
      fetchAllWorkspaceData(token, user.role);
    }
  }, [token, user, fetchAllWorkspaceData]);

  // Enforce RBAC navigation rule: Admin Dashboard is ONLY visible to Admin!
  useEffect(() => {
    if (user && user.role !== 'admin' && activeTab === 'dashboard') {
      setActiveTab('subscriptions');
    }
  }, [user, activeTab]);

  const handleJwtSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput, password: passwordInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Sign in failed');
        return;
      }
      setToken(data.token);
      setUser(data.user);
      setAuthMode('authenticated');
      setActiveTab(data.user.role === 'admin' ? 'dashboard' : 'subscriptions');
    } catch {
      setAuthError('Network error during sign in');
    }
  };

  const handleJwtSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nameInput,
          email: emailInput,
          password: passwordInput,
          companyName: companyInput,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Registration failed');
        return;
      }
      setToken(data.token);
      setUser(data.user);
      setAuthMode('authenticated');
      setActiveTab(data.user.role === 'admin' ? 'dashboard' : 'subscriptions');
    } catch {
      setAuthError('Network error during sign up');
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      const meRes = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (meRes.ok) {
        const meData = await meRes.json();
        setToken(idToken);
        setUser(meData.user);
        setAuthMode('authenticated');
        setActiveTab(meData.user.role === 'admin' ? 'dashboard' : 'subscriptions');
      }
    } catch (err: any) {
      setAuthError(err.message || 'Google Sign-In could not complete');
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm font-medium text-slate-600">
          Initializing Subscription Billing Automation System...
        </div>
      </div>
    );
  }

  // Task 3: Unified Sign In / Sign Up Screen (Backend determines role automatically)
  if (authMode !== 'authenticated' || !user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-6 lg:px-8">
        <OfflineIndicator label={t.offlineMessage} />
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          {/* Top Language & PWA Bar on Auth Screen */}
          <div className="flex items-center justify-between mb-4">
            <div className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
              <Globe className="w-3.5 h-3.5 text-slate-500" />
              <label htmlFor="auth-lang-select" className="sr-only">
                Select Language
              </label>
              <select
                id="auth-lang-select"
                value={lang}
                onChange={(e) => setLang(e.target.value as SupportedLang)}
                className="text-xs font-medium text-slate-800 bg-transparent focus:outline-none cursor-pointer"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.nativeLabel} ({opt.label})
                  </option>
                ))}
              </select>
            </div>
            <PWAInstallButton installLabel={t.installApp} />
          </div>

          <div className="bg-white py-9 px-6 border border-slate-200 rounded-xl shadow-xs sm:px-10">
            <div className="flex flex-col items-center mb-7">
              <div className="inline-flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-slate-950 text-white font-bold text-sm flex items-center justify-center shadow-xs">
                  S
                </span>
                <h1 className="text-2xl font-bold tracking-tight text-slate-950">
                  SubBill
                </h1>
              </div>
              <p className="mt-1.5 text-center text-xs font-medium text-slate-500">
                {t.systemSubtitle}
              </p>
            </div>

            {authError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-md">
                {authError}
              </div>
            )}

            {authMode === 'signin' ? (
              <form onSubmit={handleJwtSignIn} className="space-y-4">
                <div>
                  <label htmlFor="signin-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                    {t.email}
                  </label>
                  <input
                    id="signin-email"
                    type="email"
                    required
                    placeholder="admin@subbill.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label htmlFor="signin-password" className="block text-xs font-medium text-slate-700 mb-1.5">
                    {t.password}
                  </label>
                  <input
                    id="signin-password"
                    type="password"
                    required
                    placeholder="•••••••••••"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div className="pt-1">
                  <button
                    type="submit"
                    className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-slate-950 rounded-lg hover:bg-slate-800 transition-colors"
                  >
                    {t.signIn}
                  </button>
                </div>

                <div className="pt-3 text-center text-xs text-slate-600">
                  {t.noAccountPrompt}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('signup');
                      setAuthError(null);
                      setEmailInput('');
                      setPasswordInput('');
                    }}
                    className="font-semibold text-indigo-600 hover:text-indigo-800 underline"
                  >
                    {t.signUp}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleJwtSignUp} className="space-y-4">
                <div>
                  <label htmlFor="signup-name" className="block text-xs font-medium text-slate-700 mb-1.5">
                    {t.fullName}
                  </label>
                  <input
                    id="signup-name"
                    type="text"
                    required
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Priya Nair"
                    className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label htmlFor="signup-company" className="block text-xs font-medium text-slate-700 mb-1.5">
                    {t.companyName}
                  </label>
                  <input
                    id="signup-company"
                    type="text"
                    required
                    value={companyInput}
                    onChange={(e) => setCompanyInput(e.target.value)}
                    placeholder="Apex Cloud Pvt Ltd"
                    className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label htmlFor="signup-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                    {t.email}
                  </label>
                  <input
                    id="signup-email"
                    type="email"
                    required
                    placeholder="you@company.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label htmlFor="signup-password" className="block text-xs font-medium text-slate-700 mb-1.5">
                    {t.password}
                  </label>
                  <input
                    id="signup-password"
                    type="password"
                    required
                    placeholder="•••••••••••"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div className="pt-1">
                  <button
                    type="submit"
                    className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-slate-950 rounded-lg hover:bg-slate-800 transition-colors"
                  >
                    {t.signUp}
                  </button>
                </div>

                <div className="pt-3 text-center text-xs text-slate-600">
                  {t.hasAccountPrompt}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('signin');
                      setAuthError(null);
                      setEmailInput('admin@subbill.com');
                      setPasswordInput('admin123');
                    }}
                    className="font-semibold text-indigo-600 hover:text-indigo-800 underline"
                  >
                    {t.signIn}
                  </button>
                </div>
              </form>
            )}

            <div className="mt-5 pt-5 border-t border-slate-200">
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="w-full py-2 px-4 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                {t.continueWithGoogle}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    adminOnly?: boolean;
  }> = [
    { id: 'dashboard', label: t.navDashboard, icon: LayoutDashboard, adminOnly: true },
    { id: 'plans', label: t.navPlans, icon: Layers },
    {
      id: 'subscriptions',
      label: t.navSubscriptions,
      icon: Repeat,
    },
    {
      id: 'invoices',
      label: t.navInvoices,
      icon: FileText,
    },
    {
      id: 'payments',
      label: t.navPayments,
      icon: CreditCard,
    },
    {
      id: 'customers',
      label: t.navCustomers,
      icon: Users,
    },
    {
      id: 'audit',
      label: t.navAudit,
      icon: ShieldCheck,
    },
  ];

  const visibleNavItems = navItems.filter((item) => !item.adminOnly || user.role === 'admin');

  const activeNavMeta: Record<NavTab, { title: string }> = {
    dashboard: { title: t.headerDashboard },
    plans: { title: t.headerPlans },
    subscriptions: { title: t.headerSubscriptions },
    invoices: { title: t.headerInvoices },
    payments: { title: t.headerPayments },
    customers: { title: t.headerCustomers },
    audit: { title: t.headerAudit },
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col text-slate-900">
      <OfflineIndicator label={t.offlineMessage} />
      {/* Top Bar Contract: Zone 1 (Brand [S] SubBill) | Zone 2 (Clean text links) | Zone 3 (Actions) */}
      <header className="bg-white/95 backdrop-blur-sm border-b border-slate-200/90 px-6 py-3.5 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label={sidebarOpen ? 'Hide sidebar navigation' : 'Show sidebar navigation'}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            className="p-2 rounded-lg text-slate-600 hover:text-slate-950 hover:bg-slate-100 border border-slate-200/80 transition-colors"
          >
            {sidebarOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </button>

          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab(user.role === 'admin' ? 'dashboard' : 'subscriptions');
            }}
            className="inline-flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-950 whitespace-nowrap group"
          >
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-slate-950 text-white font-bold text-sm flex items-center justify-center shadow-sm group-hover:from-indigo-500 transition-all">
              S
            </span>
            <span>SubBill</span>
          </a>
        </div>

        <nav className="hidden xl:flex items-center gap-7 text-xs font-medium text-slate-600">
          {user.role === 'admin' && (
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`hover:text-slate-950 transition-colors whitespace-nowrap py-1 ${
                activeTab === 'dashboard'
                  ? 'text-indigo-600 font-semibold underline underline-offset-8 decoration-2 decoration-indigo-600'
                  : ''
              }`}
            >
              {t.navDashboard}
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab('plans')}
            className={`hover:text-slate-950 transition-colors whitespace-nowrap py-1 ${
              activeTab === 'plans'
                ? 'text-indigo-600 font-semibold underline underline-offset-8 decoration-2 decoration-indigo-600'
                : ''
            }`}
          >
            {t.navPlans}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('subscriptions')}
            className={`hover:text-slate-950 transition-colors whitespace-nowrap py-1 ${
              activeTab === 'subscriptions'
                ? 'text-indigo-600 font-semibold underline underline-offset-8 decoration-2 decoration-indigo-600'
                : ''
            }`}
          >
            {t.navSubscriptions}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('invoices')}
            className={`hover:text-slate-950 transition-colors whitespace-nowrap py-1 ${
              activeTab === 'invoices'
                ? 'text-indigo-600 font-semibold underline underline-offset-8 decoration-2 decoration-indigo-600'
                : ''
            }`}
          >
            {t.navInvoices}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('payments')}
            className={`hover:text-slate-950 transition-colors whitespace-nowrap py-1 ${
              activeTab === 'payments'
                ? 'text-indigo-600 font-semibold underline underline-offset-8 decoration-2 decoration-indigo-600'
                : ''
            }`}
          >
            {t.navPayments}
          </button>
        </nav>

        <div className="flex items-center gap-2.5">
          {/* Language Switcher (English, Kannada, Hindi, Telugu, Tamil, Malayalam, Marathi) */}
          <div className="inline-flex items-center gap-1.5 bg-slate-100 border border-slate-200/80 rounded-lg px-2.5 py-1.5">
            <Globe className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            <label htmlFor="header-lang-select" className="sr-only">
              Select Language
            </label>
            <select
              id="header-lang-select"
              value={lang}
              onChange={(e) => setLang(e.target.value as SupportedLang)}
              className="text-xs font-semibold text-slate-900 bg-transparent focus:outline-none cursor-pointer"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.nativeLabel}
                </option>
              ))}
            </select>
          </div>

          {/* In-App PWA Install Button */}
          <PWAInstallButton installLabel={t.installApp} />

          <button
            type="button"
            onClick={() => {
              setUser(null);
              setToken('');
              setAuthMode('signin');
            }}
            aria-label="Sign out"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            {t.signOut}
          </button>
        </div>
      </header>

      {/* Main Workspace Layout: Toggleable Sidebar + Content Viewport */}
      <div className="flex-1 flex flex-col md:flex-row">
        {sidebarOpen && (
          <aside className="w-full md:w-64 bg-slate-950 text-slate-300 shrink-0 flex flex-col justify-between p-4 border-b md:border-b-0 md:border-r border-slate-900">
            <div className="space-y-1">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                      isActive
                        ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {isActive && <ArrowUpRight className="w-3.5 h-3.5 shrink-0 opacity-80" />}
                  </button>
                );
              })}
            </div>

            <div className="hidden md:block pt-4 mt-6 border-t border-slate-800/80 px-3 text-xs space-y-1.5">
              <div className="font-semibold text-white truncate">{user.name}</div>
              <div className="text-slate-400 truncate text-[11px]">{user.email}</div>
              <div className="pt-1 text-[11px] text-slate-400">
                {t.accessMode} ·{' '}
                <span className="font-mono font-semibold text-indigo-400 uppercase">{user.role}</span>
              </div>
            </div>
          </aside>
        )}

        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {/* Page Header Banner with Sidebar Color */}
          <div className="mb-7 bg-slate-950 text-white px-6 py-5 rounded-xl border border-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
              {activeNavMeta[activeTab]?.title}
            </h1>

            <div className="flex items-center gap-3 text-xs text-slate-300 font-mono tabular-nums">
              <span>
                {plans.length} {t.statPlans}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {subscriptions.length} {t.statSubscriptions}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {invoices.length} {t.statInvoices}
              </span>
            </div>
          </div>

          {toastMessage && (
            <div className="mb-6 bg-slate-900 text-white px-4 py-3 rounded-lg text-xs flex items-center justify-between shadow-sm">
              <span>{toastMessage}</span>
              <button
                type="button"
                onClick={() => setToastMessage(null)}
                className="text-indigo-300 hover:text-white underline ml-4"
              >
                Dismiss
              </button>
            </div>
          )}

          {activeTab === 'dashboard' && user.role === 'admin' && (
            <AdminDashboardView
              summary={summary}
              revenueByPlan={revenueByPlan}
              metrics={metrics}
              recentLogs={auditLogs}
              onNavigate={(tab) => setActiveTab(tab as NavTab)}
              t={t}
            />
          )}

          {(activeTab === 'plans' || activeTab === 'subscriptions') && (
            <PlansAndSubscriptionsView
              mode={activeTab}
              userRole={user.role}
              plans={plans}
              subscriptions={subscriptions}
              customers={customers}
              token={token}
              t={t}
              onCreatePlan={async (data) => {
                const res = await fetch('/api/plans', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify(data),
                });
                if (res.ok) {
                  await fetchAllWorkspaceData(token, user.role);
                  showToast(`Plan '${data.name}' created and logged to Audit Trail.`);
                }
              }}
              onUpdatePlan={async (id, data) => {
                const res = await fetch(`/api/plans/${id}`, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify(data),
                });
                if (res.ok) {
                  await fetchAllWorkspaceData(token, user.role);
                  showToast(`Plan '${data.name}' updated.`);
                }
              }}
              onArchivePlan={async (id, isArchived) => {
                const res = await fetch(`/api/plans/${id}/archive`, {
                  method: 'PATCH',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ isArchived }),
                });
                if (res.ok) {
                  await fetchAllWorkspaceData(token, user.role);
                  showToast(isArchived ? 'Plan archived.' : 'Plan restored.');
                }
              }}
              onDeletePlan={async (id) => {
                const res = await fetch(`/api/plans/${id}`, {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                  await fetchAllWorkspaceData(token, user.role);
                  showToast('Plan removed or archived.');
                }
              }}
              onCreateSubscription={async (customerId, planId, startImmediately) => {
                const res = await fetch('/api/subscriptions', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    customer_id: customerId,
                    plan_id: planId,
                    start_immediately: startImmediately,
                  }),
                });
                if (res.ok) {
                  await fetchAllWorkspaceData(token, user.role);
                }
              }}
              onTransitionState={async (subId, targetStatus) => {
                const res = await fetch(`/api/subscriptions/${subId}/transition`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ target_status: targetStatus }),
                });
                if (!res.ok) {
                  const err = await res.json();
                  throw new Error(err.error || 'Invalid state transition');
                }
                await fetchAllWorkspaceData(token, user.role);
                showToast(`Subscription #${subId} transitioned to '${targetStatus}'.`);
              }}
              onChangePlanWithProration={async (subId, newPlanId, remainingDays) => {
                const res = await fetch(`/api/subscriptions/${subId}/change-plan`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    new_plan_id: newPlanId,
                    remaining_days: remainingDays,
                  }),
                });
                if (res.ok) {
                  await fetchAllWorkspaceData(token, user.role);
                }
              }}
              onPauseResumeSubscription={async (subId, pause) => {
                const endpoint = pause ? 'pause' : 'resume';
                const res = await fetch(`/api/subscriptions/${subId}/${endpoint}`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                  await fetchAllWorkspaceData(token, user.role);
                  showToast(`Subscription #${subId} ${pause ? 'paused' : 'resumed'}.`);
                }
              }}
              onCancelSubscription={async (subId) => {
                const res = await fetch(`/api/subscriptions/${subId}/cancel`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                  await fetchAllWorkspaceData(token, user.role);
                  showToast(`Subscription #${subId} cancelled.`);
                }
              }}
            />
          )}

          {(activeTab === 'invoices' || activeTab === 'payments') && (
            <BillingOperationsView
              activeSubTab={activeTab}
              userRole={user.role}
              invoices={invoices}
              payments={payments}
              failedPayments={failedPayments}
              refunds={refunds}
              t={t}
              onGenerateInvoices={async () => {
                const res = await fetch('/api/invoices/generate', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({}),
                });
                if (res.ok) {
                  const data = await res.json();
                  await fetchAllWorkspaceData(token, user.role);
                  showToast(`Generated ${data.count} GST invoices for active billing cycles.`);
                }
              }}
              onProcessPayment={async (invoiceId, amount, simulateOutcome) => {
                const res = await fetch('/api/payments/process', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    invoice_id: invoiceId,
                    amount,
                    simulate_outcome: simulateOutcome,
                  }),
                });
                if (res.ok) {
                  const data = await res.json();
                  await fetchAllWorkspaceData(token, user.role);
                  showToast(
                    `Payment processed: ${data.payment.paymentReference} (${data.webhookTriggered})`
                  );
                }
              }}
              onTriggerWebhook={async (invoiceId, event) => {
                const res = await fetch('/api/webhooks/payment', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ invoice_id: invoiceId, event }),
                });
                if (res.ok) {
                  await fetchAllWorkspaceData(token, user.role);
                  showToast(`Webhook '${event}' processed for Invoice #${invoiceId}.`);
                }
              }}
              onRetryPayment={async (paymentId, simulateOutcome) => {
                const res = await fetch(`/api/payments/${paymentId}/retry`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ simulate_outcome: simulateOutcome }),
                });
                if (res.ok) {
                  const data = await res.json();
                  await fetchAllWorkspaceData(token, user.role);
                  showToast(
                    `Dunning retry outcome: ${data.outcome} (Subscription status: ${data.subscriptionStatus})`
                  );
                }
              }}
              onIssueRefund={async (invoiceId, usedDays, reason) => {
                const res = await fetch('/api/refunds', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ invoice_id: invoiceId, used_days: usedDays, reason }),
                });
                if (res.ok) {
                  const rf = await res.json();
                  await fetchAllWorkspaceData(token, user.role);
                  showToast(`Refund ${rf.refundNumber} issued for ₹${rf.amount}.`);
                }
              }}
            />
          )}

          {(activeTab === 'customers' || activeTab === 'audit') && (
            <CustomersAndAuditView
              mode={activeTab}
              userRole={user.role}
              customers={customers}
              auditLogs={auditLogs}
              token={token}
              t={t}
              onCreateCustomer={async (data) => {
                const res = await fetch('/api/customers', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify(data),
                });
                if (res.ok) {
                  await fetchAllWorkspaceData(token, user.role);
                  showToast(`Customer '${data.company_name}' added.`);
                }
              }}
              onUpdateCustomer={async (id, data) => {
                const res = await fetch(`/api/customers/${id}`, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify(data),
                });
                if (res.ok) {
                  await fetchAllWorkspaceData(token, user.role);
                  showToast(`Customer '${data.company_name}' updated.`);
                }
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

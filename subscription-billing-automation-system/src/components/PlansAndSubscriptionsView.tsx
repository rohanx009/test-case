import React, { useState, useEffect } from 'react';
import { Archive, Trash2, Edit2, Plus } from 'lucide-react';
import { TranslationStrings } from '../lib/i18n.ts';

export interface PlanItem {
  id: number;
  name: string;
  price: number;
  billingInterval: string;
  trialDays: number;
  features: string;
  targetAudience: string;
  isArchived: boolean;
}

export interface SubscriptionItem {
  id: number;
  customerId: number;
  planId: number;
  status: string; // 'trial' | 'active' | 'past_due' | 'cancelled'
  isPaused: boolean;
  hadTrial: boolean;
  startDate: string;
  endDate: string;
  statusChangedAt: string;
  customer: {
    id: number;
    name: string;
    email: string;
    companyName: string;
  } | null;
  plan: PlanItem | null;
  cycles: Array<{
    id: number;
    cycleStartDate: string;
    cycleEndDate: string;
    renewalDate: string;
    status: string;
  }>;
}

interface PlansAndSubscriptionsViewProps {
  mode: 'plans' | 'subscriptions';
  userRole: 'admin' | 'customer';
  plans: PlanItem[];
  subscriptions: SubscriptionItem[];
  customers: Array<{ id: number; name: string; companyName: string; email: string }>;
  token: string;
  t?: TranslationStrings;
  onCreatePlan: (data: {
    name: string;
    price: number;
    billing_interval: string;
    trial_days: number;
    features: string[];
    target_audience: string;
  }) => Promise<void>;
  onUpdatePlan: (
    id: number,
    data: {
      name: string;
      price: number;
      billing_interval: string;
      trial_days: number;
      features: string[];
      target_audience: string;
    }
  ) => Promise<void>;
  onArchivePlan: (id: number, isArchived: boolean) => Promise<void>;
  onDeletePlan: (id: number) => Promise<void>;
  onCreateSubscription: (customerId: number, planId: number, startImmediately: boolean) => Promise<void>;
  onTransitionState: (subId: number, targetStatus: string) => Promise<void>;
  onChangePlanWithProration: (subId: number, newPlanId: number, remainingDays: number) => Promise<void>;
  onPauseResumeSubscription: (subId: number, pause: boolean) => Promise<void>;
  onCancelSubscription: (subId: number) => Promise<void>;
}

export const PlansAndSubscriptionsView: React.FC<PlansAndSubscriptionsViewProps> = ({
  mode,
  userRole,
  plans,
  subscriptions,
  customers,
  token,
  t,
  onCreatePlan,
  onUpdatePlan,
  onArchivePlan,
  onDeletePlan,
  onCreateSubscription,
  onTransitionState,
  onChangePlanWithProration,
  onPauseResumeSubscription,
  onCancelSubscription,
}) => {
  // Plan modal / form state (Admin only)
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanItem | null>(null);
  const [planName, setPlanName] = useState('');
  const [planPrice, setPlanPrice] = useState<number>(1500);
  const [planInterval, setPlanInterval] = useState('monthly');
  const [planTrialDays, setPlanTrialDays] = useState<number>(14);
  const [planAudience, setPlanAudience] = useState('For scaling SaaS operations');
  const [planFeaturesText, setPlanFeaturesText] = useState(
    'Up to 5,000 active subscribers\nAutomated GST invoices\nProration credit engine'
  );

  // New Subscription form state
  const [subCustomerId, setSubCustomerId] = useState<number>(customers[0]?.id || 1);
  const [subPlanId, setSubPlanId] = useState<number>(plans[0]?.id || 1);
  const [startImmediately, setStartImmediately] = useState(false);

  // Proration & Plan Change state (Milestone 2 Task 2)
  const [selectedSubId, setSelectedSubId] = useState<number>(subscriptions[0]?.id || 1);
  const [newPlanId, setNewPlanId] = useState<number>(
    plans.find((p) => p.name === 'Premium')?.id || plans[1]?.id || 2
  );
  const [remainingDays, setRemainingDays] = useState<number>(15);
  const [prorationPreview, setProrationPreview] = useState<{
    unusedCredit: number;
    newPlanCharge: number;
    amountDue: number;
    remainingDays: number;
    currentPlan?: PlanItem;
    newPlan?: PlanItem;
  } | null>(null);
  const [stateMachineError, setStateMachineError] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  useEffect(() => {
    if (customers.length > 0 && !customers.some((c) => c.id === subCustomerId)) {
      setSubCustomerId(customers[0].id);
    }
  }, [customers, subCustomerId]);

  useEffect(() => {
    if (subscriptions.length > 0 && !subscriptions.some((s) => s.id === selectedSubId)) {
      setSelectedSubId(subscriptions[0].id);
    }
  }, [subscriptions, selectedSubId]);

  const selectedSub =
    subscriptions.find((s) => s.id === Number(selectedSubId)) || subscriptions[0];

  // Live Proration Preview fetch whenever selectedSub, newPlanId, or remainingDays changes
  useEffect(() => {
    if (!selectedSub || !newPlanId || !token) return;
    let active = true;
    const fetchPreview = async () => {
      try {
        const res = await fetch(`/api/subscriptions/${selectedSub.id}/proration-preview`, {
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
        if (res.ok && active) {
          setProrationPreview(await res.json());
        }
      } catch (e) {
        console.error('Proration preview error:', e);
      }
    };
    fetchPreview();
    return () => {
      active = false;
    };
  }, [selectedSub?.id, selectedSub?.planId, newPlanId, remainingDays, token]);

  if (mode === 'plans') {
    return (
      <div className="space-y-6">
        <div className="bg-slate-950 text-white border border-slate-900 rounded-xl px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">
              {t?.planCatalogTitle || 'Subscription Plan Catalog & Tier Architecture'}
            </h2>
          </div>

          {userRole === 'admin' ? (
            <button
              type="button"
              onClick={() => {
                setEditingPlan(null);
                setPlanName('');
                setPlanPrice(1500);
                setPlanInterval('monthly');
                setPlanTrialDays(14);
                setPlanAudience('For scaling SaaS operations');
                setPlanFeaturesText(
                  'Up to 5,000 active subscribers\nAutomated GST invoices\nProration credit engine'
                );
                setShowPlanForm(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              {t?.createNewPlan || 'Create New Plan'}
            </button>
          ) : (
            <div className="text-xs font-medium text-amber-300 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-md">
              {t?.adminOnlyPlansNote || 'Admin Role Required to Create Plans'}
            </div>
          )}
        </div>

        {/* Admin-Only Plan Creation / Edit Form */}
        {userRole === 'admin' && showPlanForm && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const featuresList = planFeaturesText
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);
              if (editingPlan) {
                await onUpdatePlan(editingPlan.id, {
                  name: planName,
                  price: Number(planPrice),
                  billing_interval: planInterval,
                  trial_days: Number(planTrialDays),
                  features: featuresList,
                  target_audience: planAudience,
                });
              } else {
                await onCreatePlan({
                  name: planName,
                  price: Number(planPrice),
                  billing_interval: planInterval,
                  trial_days: Number(planTrialDays),
                  features: featuresList,
                  target_audience: planAudience,
                });
              }
              setShowPlanForm(false);
              setEditingPlan(null);
            }}
            className="bg-white border border-slate-300 rounded-lg p-6 space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">
              {editingPlan ? `Update Plan: ${editingPlan.name}` : 'Create New Subscription Plan'}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label htmlFor="plan-name-input" className="block text-xs font-medium text-slate-700 mb-1">
                  Plan Name
                </label>
                <input
                  id="plan-name-input"
                  type="text"
                  required
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder="e.g. Growth Plus"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md"
                />
              </div>

              <div>
                <label htmlFor="plan-price-input" className="block text-xs font-medium text-slate-700 mb-1">
                  Price (INR ₹)
                </label>
                <input
                  id="plan-price-input"
                  type="number"
                  required
                  min={0}
                  value={planPrice}
                  onChange={(e) => setPlanPrice(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md font-mono"
                />
              </div>

              <div>
                <label htmlFor="plan-interval-select" className="block text-xs font-medium text-slate-700 mb-1">
                  Billing Interval
                </label>
                <select
                  id="plan-interval-select"
                  value={planInterval}
                  onChange={(e) => setPlanInterval(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white"
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>

              <div>
                <label htmlFor="plan-trial-input" className="block text-xs font-medium text-slate-700 mb-1">
                  Trial Days
                </label>
                <input
                  id="plan-trial-input"
                  type="number"
                  min={0}
                  max={90}
                  value={planTrialDays}
                  onChange={(e) => setPlanTrialDays(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="plan-audience-input" className="block text-xs font-medium text-slate-700 mb-1">
                  Target Audience Summary
                </label>
                <input
                  id="plan-audience-input"
                  type="text"
                  value={planAudience}
                  onChange={(e) => setPlanAudience(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md"
                />
              </div>

              <div>
                <label htmlFor="plan-features-textarea" className="block text-xs font-medium text-slate-700 mb-1">
                  Concrete Features & Quotas (One per line)
                </label>
                <textarea
                  id="plan-features-textarea"
                  rows={3}
                  value={planFeaturesText}
                  onChange={(e) => setPlanFeaturesText(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
              >
                {editingPlan ? 'Save Plan Updates' : 'Publish Plan'}
              </button>
              <button
                type="button"
                onClick={() => setShowPlanForm(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Pricing Tier Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {plans.map((plan) => {
            let featureList: string[] = [];
            try {
              featureList = JSON.parse(plan.features);
            } catch {
              featureList = [plan.features];
            }

            const isPopular = plan.name === 'Pro' || plan.name === 'Premium';
            return (
              <div
                key={plan.id}
                className={`bg-white border rounded-xl p-6 flex flex-col justify-between transition-all ${
                  plan.isArchived
                    ? 'border-slate-200 opacity-60'
                    : isPopular
                    ? 'border-indigo-200 border-t-4 border-t-indigo-600'
                    : 'border-slate-200/90 border-t-4 border-t-slate-900'
                }`}
              >
                <div>
                  <div className="text-xs font-medium text-indigo-600">{plan.targetAudience}</div>
                  <div className="flex items-baseline justify-between mt-1.5">
                    <h3 className="text-lg font-bold text-slate-950">{plan.name}</h3>
                    {plan.isArchived && (
                      <span className="text-xs text-amber-700 font-medium">Archived</span>
                    )}
                  </div>

                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-slate-950 font-mono tabular-nums tracking-tight">
                      ₹{plan.price.toLocaleString()}
                    </span>
                    <span className="text-xs text-slate-500">/{plan.billingInterval}</span>
                  </div>

                  <div className="mt-1.5 text-xs text-slate-500 font-mono tabular-nums">
                    {plan.trialDays} {t?.freeTrialIncluded || 'days free trial included'}
                  </div>

                  <ul className="mt-5 pt-4 border-t border-slate-100 space-y-2.5 text-xs text-slate-700">
                    {featureList.map((feat, i) => (
                      <li key={i} className="leading-relaxed">
                        · {feat}
                      </li>
                    ))}
                  </ul>
                </div>

                {userRole === 'admin' && (
                  <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPlan(plan);
                        setPlanName(plan.name);
                        setPlanPrice(plan.price);
                        setPlanInterval(plan.billingInterval);
                        setPlanTrialDays(plan.trialDays);
                        setPlanAudience(plan.targetAudience);
                        setPlanFeaturesText(featureList.join('\n'));
                        setShowPlanForm(true);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded hover:bg-slate-50"
                    >
                      <Edit2 className="w-3 h-3" />
                      {t?.editBtn || 'Edit'}
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onArchivePlan(plan.id, !plan.isArchived)}
                        aria-label={`Archive ${plan.name}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded hover:bg-slate-50"
                      >
                        <Archive className="w-3 h-3" />
                        {plan.isArchived ? t?.restoreBtn || 'Restore' : t?.archiveBtn || 'Archive'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeletePlan(plan.id)}
                        aria-label={`Delete ${plan.name}`}
                        className="p-1.5 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Subscriptions, State Machine, Billing Cycle Engine & Mid-Cycle Proration View
  return (
    <div className="space-y-8">
      {actionBanner && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-xs flex items-center justify-between">
          <span>{actionBanner}</span>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            className="text-emerald-800 underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {stateMachineError && (
        <div className="bg-red-50 border border-red-200 text-red-900 px-4 py-3 rounded-lg text-xs flex items-center justify-between">
          <span>{stateMachineError}</span>
          <button
            type="button"
            onClick={() => setStateMachineError(null)}
            className="text-red-800 underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top Row: Create Subscription (Task 7) + Mid-Cycle Plan Change & Proration Preview (M2 Task 2) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Task 7: Create Subscription & Calculate Renewal Cycle */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-base font-semibold text-slate-900">
            {t?.subscribeCustomerTitle || 'Subscribe Customer to Plan'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Validates customer & plan, assigns trial period, and initializes billing cycle renewal dates
          </p>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await onCreateSubscription(subCustomerId, subPlanId, startImmediately);
              setActionBanner('Subscription created and initial billing cycle scheduled.');
            }}
            className="mt-4 space-y-4"
          >
            <div>
              <label htmlFor="sub-cust-select" className="block text-xs font-medium text-slate-700 mb-1">
                {t?.selectCustomerLabel || 'Select Customer'}
              </label>
              <select
                id="sub-cust-select"
                value={subCustomerId}
                onChange={(e) => setSubCustomerId(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName} ({c.name})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="sub-plan-select" className="block text-xs font-medium text-slate-700 mb-1">
                {t?.selectPlanLabel || 'Select Subscription Plan'}
              </label>
              <select
                id="sub-plan-select"
                value={subPlanId}
                onChange={(e) => setSubPlanId(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — ₹{p.price}/{p.billingInterval} ({p.trialDays}d trial)
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="start-active-checkbox"
                type="checkbox"
                checked={startImmediately}
                onChange={(e) => setStartImmediately(e.target.checked)}
                className="rounded border-slate-300"
              />
              <label htmlFor="start-active-checkbox" className="text-xs text-slate-600">
                {t?.skipTrialLabel || 'Skip trial period and start as active immediately'}
              </label>
            </div>

            <button
              type="submit"
              className="w-full px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
            >
              {t?.createSubscriptionBtn || 'Create Subscription'}
            </button>
          </form>
        </div>

        {/* Milestone 2 Task 2: Plan Change & Proration Preview */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {t?.prorationEngineTitle || 'Mid-Cycle Plan Upgrade / Downgrade & Proration Engine'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Calculates Unused Plan Credit vs. New Plan Remaining Cost before confirming upgrade
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
            <div className="space-y-4">
              <div>
                <label htmlFor="prorate-sub-select" className="block text-xs font-medium text-slate-700 mb-1">
                  {t?.targetSubscriptionLabel || 'Target Subscription'}
                </label>
                <select
                  id="prorate-sub-select"
                  value={selectedSubId}
                  onChange={(e) => setSelectedSubId(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-md bg-white"
                >
                  {subscriptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.id} — {s.customer?.companyName} (Current: {s.plan?.name} ₹{s.plan?.price})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="text-xs font-medium text-slate-700 mb-1.5">
                  {t?.selectNewPlanLabel || 'Select New Plan'}
                </div>
                <div className="space-y-1.5">
                  {plans.map((p) => (
                    <label
                      key={p.id}
                      className={`flex items-center justify-between px-3 py-2 border rounded-md cursor-pointer text-xs ${
                        Number(newPlanId) === p.id
                          ? 'border-slate-900 bg-slate-50 font-semibold'
                          : 'border-slate-200 hover:bg-slate-50/50'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="new_plan_radio"
                          checked={Number(newPlanId) === p.id}
                          onChange={() => setNewPlanId(p.id)}
                        />
                        <span>{p.name} Plan</span>
                      </span>
                      <span className="font-mono tabular-nums">
                        ₹{p.price}/{p.billingInterval}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="remaining-days-input" className="block text-xs font-medium text-slate-700 mb-1">
                  {t?.remainingCycleDaysLabel || 'Remaining Cycle Days (e.g., 15 days left in 30-day cycle)'}
                </label>
                <input
                  id="remaining-days-input"
                  type="number"
                  min={1}
                  max={30}
                  value={remainingDays}
                  onChange={(e) => setRemainingDays(Number(e.target.value))}
                  className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-md font-mono"
                />
              </div>
            </div>

            {/* Proration Preview Box matching specification */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-900 border-b border-slate-200 pb-2">
                  {t?.prorationSummaryTitle || 'Plan Upgrade Proration Summary'}
                </div>

                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Current Plan ({selectedSub?.plan?.name})</span>
                    <span className="font-mono tabular-nums">
                      ₹{selectedSub?.plan?.price ?? 1000}/month
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>New Plan ({prorationPreview?.newPlan?.name})</span>
                    <span className="font-mono tabular-nums">
                      ₹{prorationPreview?.newPlan?.price ?? 2000}/month
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Remaining Cycle Days</span>
                    <span className="font-mono tabular-nums">{remainingDays} days</span>
                  </div>

                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-emerald-700 font-medium">
                    <span>{t?.unusedPlanCreditLabel || 'Unused Plan Credit'}</span>
                    <span className="font-mono tabular-nums">
                      -₹{(prorationPreview?.unusedCredit ?? 500).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-900 font-medium">
                    <span>
                      {t?.newPlanChargeLabel || 'New Plan Charge'} ({remainingDays}d)
                    </span>
                    <span className="font-mono tabular-nums">
                      +₹{(prorationPreview?.newPlanCharge ?? 1000).toLocaleString()}
                    </span>
                  </div>

                  <div className="pt-3 border-t border-slate-300 flex items-center justify-between text-sm font-bold text-slate-900">
                    <span>{t?.netAmountDueLabel || 'Net Amount Due'}</span>
                    <span className="font-mono tabular-nums">
                      ₹{(prorationPreview?.amountDue ?? 500).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={async () => {
                  if (!selectedSub) return;
                  await onChangePlanWithProration(selectedSub.id, newPlanId, remainingDays);
                  setActionBanner(
                    `Upgraded ${selectedSub.customer?.companyName} to ${prorationPreview?.newPlan?.name} Plan with ₹${prorationPreview?.amountDue} proration adjustment invoice.`
                  );
                }}
                className="mt-5 w-full px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
              >
                {t?.confirmUpgradeBtn || 'Confirm Upgrade & Create Proration Invoice'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Subscriptions & State Machine Lifecycle Table (Task 4, 8, 9) */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {t?.activeSubscriptionsTableTitle ||
                'Active Subscriptions, State Machine & Billing Cycle Engine'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Allowed Transitions: <span className="font-mono">trial → active | cancelled</span> ·{' '}
              <span className="font-mono">active → past_due | cancelled</span> ·{' '}
              <span className="font-mono">past_due → active | cancelled</span>
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="py-3 px-6">{t?.colCustomer || 'Customer'}</th>
                <th className="py-3 px-4">{t?.colCurrentPlan || 'Current Plan'}</th>
                <th className="py-3 px-4">{t?.colLifecycleState || 'Lifecycle State'}</th>
                <th className="py-3 px-4">{t?.colCycleDates || 'Cycle Start → Renewal Date'}</th>
                <th className="py-3 px-4">Status Changed At</th>
                <th className="py-3 px-6 text-right">
                  {t?.colControls || 'Lifecycle & State Machine Controls'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {subscriptions.map((sub) => {
                const latestCycle = sub.cycles?.[0];
                return (
                  <tr key={sub.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-6">
                      <div className="font-semibold text-slate-900">
                        {sub.customer?.companyName || `Customer #${sub.customerId}`}
                      </div>
                      <div className="text-xs text-slate-500">{sub.customer?.name}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{sub.plan?.name}</div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums">
                        ₹{sub.plan?.price}/{sub.plan?.billingInterval}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <span
                        className={
                          sub.status === 'active'
                            ? 'text-emerald-700 font-semibold capitalize'
                            : sub.status === 'trial'
                            ? 'text-blue-700 font-semibold capitalize'
                            : sub.status === 'past_due'
                            ? 'text-amber-700 font-semibold capitalize'
                            : 'text-red-600 font-semibold capitalize'
                        }
                      >
                        {sub.status}
                      </span>
                      {sub.isPaused && (
                        <span className="ml-1.5 text-slate-500 font-mono">(Paused)</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {new Date(sub.startDate).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                      })}{' '}
                      →{' '}
                      {new Date(
                        latestCycle ? latestCycle.renewalDate : sub.endDate
                      ).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {new Date(sub.statusChangedAt).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="py-3 px-6 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {sub.status === 'trial' && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                setStateMachineError(null);
                                await onTransitionState(sub.id, 'active');
                              } catch (err: any) {
                                setStateMachineError(err.message);
                              }
                            }}
                            className="px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                          >
                            Activate
                          </button>
                        )}

                        {sub.status === 'active' && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                setStateMachineError(null);
                                await onTransitionState(sub.id, 'past_due');
                              } catch (err: any) {
                                setStateMachineError(err.message);
                              }
                            }}
                            className="px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100"
                          >
                            Mark Past Due
                          </button>
                        )}

                        {sub.status === 'past_due' && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                setStateMachineError(null);
                                await onTransitionState(sub.id, 'active');
                              } catch (err: any) {
                                setStateMachineError(err.message);
                              }
                            }}
                            className="px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                          >
                            Recover to Active
                          </button>
                        )}

                        {sub.status !== 'cancelled' && (
                          <>
                            <button
                              type="button"
                              onClick={() => onPauseResumeSubscription(sub.id, !sub.isPaused)}
                              className="px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200 rounded hover:bg-slate-100"
                            >
                              {sub.isPaused ? 'Resume' : 'Pause'}
                            </button>
                            <button
                              type="button"
                              onClick={() => onCancelSubscription(sub.id)}
                              className="px-2.5 py-1 text-xs font-medium text-red-700 border border-red-200 rounded hover:bg-red-50"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

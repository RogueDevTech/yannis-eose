import { useState, useEffect, useRef } from 'react';
import { Form, useActionData, useNavigation, Link } from '@remix-run/react';
import type { UserCreateLoaderData, UserCreateProduct, UserCreateLocation, UserCreateCommissionPlan } from './types';

// ─── Constants ──────────────────────────────────────────

const ROLES = [
  { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing', description: 'Oversees all marketing campaigns and media buyers' },
  { value: 'MEDIA_BUYER', label: 'Media Buyer', description: 'Runs ad campaigns and manages ad spend' },
  { value: 'HEAD_OF_CS', label: 'Head of CS', description: 'Manages customer service team and order processing' },
  { value: 'CS_AGENT', label: 'CS Agent', description: 'Handles customer calls and order confirmation' },
  { value: 'FINANCE_OFFICER', label: 'Finance Officer', description: 'Manages financials, invoices, and payouts' },
  { value: 'HEAD_OF_LOGISTICS', label: 'Head of Logistics', description: 'Oversees all logistics and 3PL partners' },
  { value: 'WAREHOUSE_MANAGER', label: 'Warehouse Manager', description: 'Manages inventory and stock movements' },
  { value: 'TPL_MANAGER', label: '3PL Manager', description: 'Manages a third-party logistics location' },
  { value: 'TPL_RIDER', label: '3PL Rider', description: 'Handles deliveries for a 3PL location' },
  { value: 'HR_MANAGER', label: 'HR Manager', description: 'Manages payroll, commissions, and staff' },
  { value: 'SUPER_ADMIN', label: 'Super Admin', description: 'Full system access — use with caution' },
];

const ORDER_STATUSES = [
  { value: 'UNPROCESSED', label: 'Unprocessed', color: 'bg-surface-500' },
  { value: 'CS_ENGAGED', label: 'CS Engaged', color: 'bg-blue-500' },
  { value: 'CONFIRMED', label: 'Confirmed', color: 'bg-green-500' },
  { value: 'CANCELLED', label: 'Cancelled', color: 'bg-red-500' },
  { value: 'ALLOCATED', label: 'Allocated', color: 'bg-indigo-500' },
  { value: 'DISPATCHED', label: 'Dispatched', color: 'bg-purple-500' },
  { value: 'IN_TRANSIT', label: 'In Transit', color: 'bg-amber-500' },
  { value: 'DELIVERED', label: 'Delivered', color: 'bg-emerald-500' },
  { value: 'PARTIALLY_DELIVERED', label: 'Partial Delivery', color: 'bg-teal-500' },
  { value: 'RETURNED', label: 'Returned', color: 'bg-orange-500' },
  { value: 'RESTOCKED', label: 'Restocked', color: 'bg-cyan-500' },
  { value: 'WRITTEN_OFF', label: 'Written Off', color: 'bg-rose-500' },
  { value: 'COMPLETED', label: 'Completed', color: 'bg-green-700' },
];

// ─── Component ──────────────────────────────────────────

export function UserCreatePage({ products, locations, plans }: UserCreateLoaderData) {
  const actionData = useActionData<{ error?: string; success?: boolean; requiresApproval?: boolean; message?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (actionData?.error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [actionData?.error]);

  const [selectedRole, setSelectedRole] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(
    ORDER_STATUSES.map((s) => s.value), // all selected by default
  );
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [compensationMode, setCompensationMode] = useState<'existing' | 'inline'>('inline');

  // Role-conditional visibility
  const showCapacity = ['CS_AGENT', 'HEAD_OF_CS'].includes(selectedRole);
  const showOrderStatuses = ['CS_AGENT', 'HEAD_OF_CS'].includes(selectedRole);
  const showLogisticsLocation = ['TPL_MANAGER', 'TPL_RIDER'].includes(selectedRole);
  const showProductAssignment = ['MEDIA_BUYER', 'HEAD_OF_MARKETING', 'CS_AGENT', 'HEAD_OF_CS'].includes(selectedRole);
  const showCompensation = ['CS_AGENT', 'MEDIA_BUYER', 'TPL_RIDER'].includes(selectedRole);

  const toggleStatus = (value: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );
  };

  const toggleProduct = (id: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const filteredPlans = plans.filter((p) => !selectedRole || p.role === selectedRole);

  return (
    <div className="w-full space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/admin/users" className="text-surface-800 dark:text-surface-400 hover:text-brand-500">
          Users
        </Link>
        <svg className="w-4 h-4 text-surface-300 dark:text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-surface-900 dark:text-white font-medium">Add User</span>
      </div>

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Add User</h1>
        <p className="text-sm text-surface-800 dark:text-surface-400 mt-1">
          Create a new account for a team member with role-specific settings.
        </p>
      </div>

      {/* Success: requires approval */}
      {actionData?.requiresApproval && (
        <div className="rounded-lg bg-success-50 dark:bg-success-700/20 border border-success-200 dark:border-success-700/50 px-4 py-3">
          <p className="text-sm text-success-700 dark:text-success-500">{actionData.message ?? 'User creation request submitted. SuperAdmin will review.'}</p>
          <Link to="/admin/permission-requests" className="text-sm font-medium text-success-600 dark:text-success-400 hover:underline mt-1 inline-block">
            View pending requests →
          </Link>
        </div>
      )}

      {/* Error */}
      {actionData?.error && (
        <div ref={errorRef} className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{actionData.error}</p>
        </div>
      )}

      <Form method="post" className="space-y-6">
        {/* Hidden fields for JSON arrays */}
        {showOrderStatuses && (
          <input type="hidden" name="visibleOrderStatuses" value={JSON.stringify(selectedStatuses)} />
        )}
        {showProductAssignment && selectedProductIds.length > 0 && (
          <input type="hidden" name="productIds" value={JSON.stringify(selectedProductIds)} />
        )}

        {/* Section 1: Account Details */}
        <div className="card space-y-4">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Account Details</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Role — first so conditional sections appear below */}
            <div className="sm:col-span-2">
              <label htmlFor="role" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                Role *
              </label>
              <select
                id="role"
                name="role"
                required
                className="input"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
              >
                <option value="">Select a role</option>
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
              {selectedRole && (
                <p className="text-xs text-surface-700 dark:text-surface-500 mt-1">
                  {ROLES.find((r) => r.value === selectedRole)?.description}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                Full Name *
              </label>
              <input id="name" name="name" type="text" required minLength={2} className="input" placeholder="John Doe" />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                Email Address *
              </label>
              <input id="email" name="email" type="email" required className="input" placeholder="john@company.com" />
              <p className="text-xs text-surface-700 dark:text-surface-500 mt-1">
                A password will be auto-generated and sent to this email.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                Status *
              </label>
              <div className="flex items-center gap-4 mt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="status" value="ACTIVE" defaultChecked className="text-brand-500 focus:ring-brand-500" />
                  <span className="text-sm text-surface-700 dark:text-surface-300">Active</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="status" value="INACTIVE" className="text-brand-500 focus:ring-brand-500" />
                  <span className="text-sm text-surface-700 dark:text-surface-300">Inactive</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Role-Specific Settings */}
        {(showCapacity || showOrderStatuses || showLogisticsLocation || showProductAssignment) && (
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Role Settings</h2>

            {/* Capacity (CS roles) */}
            {showCapacity && (
              <div>
                <label htmlFor="capacity" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Order Capacity
                </label>
                <input
                  id="capacity"
                  name="capacity"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={10}
                  className="input w-full sm:w-32"
                />
                <p className="text-xs text-surface-700 dark:text-surface-500 mt-1">
                  Maximum concurrent orders this agent can handle.
                </p>
              </div>
            )}

            {/* Visible Order Statuses (CS roles) */}
            {showOrderStatuses && (
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Active Tabs
                </label>
                <p className="text-xs text-surface-700 dark:text-surface-500 mb-2">
                  Select which order statuses this user can see. Click to toggle.
                </p>
                <div className="flex flex-wrap gap-2">
                  {ORDER_STATUSES.map((status) => {
                    const isActive = selectedStatuses.includes(status.value);
                    return (
                      <button
                        key={status.value}
                        type="button"
                        onClick={() => toggleStatus(status.value)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 ${
                          isActive
                            ? `${status.color} text-white shadow-sm`
                            : 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-500'
                        }`}
                      >
                        {status.label}
                        {isActive && (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Logistics Location (TPL roles) */}
            {showLogisticsLocation && (
              <div>
                <label htmlFor="logisticsLocationId" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Logistics Location
                </label>
                <select id="logisticsLocationId" name="logisticsLocationId" className="input">
                  <option value="">Select location</option>
                  {locations.map((loc: UserCreateLocation) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} — {loc.address}
                    </option>
                  ))}
                </select>
                {locations.length === 0 && (
                  <p className="text-xs text-warning-500 mt-1">No logistics locations found. Create one first.</p>
                )}
              </div>
            )}

            {/* Product Assignment */}
            {showProductAssignment && (
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Assign Products
                </label>
                <p className="text-xs text-surface-700 dark:text-surface-500 mb-2">
                  Leave blank to assign all products. Select specific products to restrict.
                </p>
                {products.length > 0 ? (
                  <div className="border border-surface-200 dark:border-surface-700 rounded-lg max-h-48 overflow-y-auto">
                    {products.map((product: UserCreateProduct) => (
                      <label
                        key={product.id}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-pointer border-b border-surface-100 dark:border-surface-800 last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={selectedProductIds.includes(product.id)}
                          onChange={() => toggleProduct(product.id)}
                          className="rounded border-surface-300 dark:border-surface-600 text-brand-500 focus:ring-brand-500"
                        />
                        <span className="text-sm text-surface-900 dark:text-surface-100">{product.name}</span>
                        <span className="text-xs text-surface-700 dark:text-surface-500 ml-auto">{product.category ?? ''}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-surface-700">No products found.</p>
                )}

                {selectedProductIds.length > 0 && (
                  <div className="mt-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        name="restrictProductAccess"
                        value="true"
                        className="rounded border-surface-300 dark:border-surface-600 text-brand-500 focus:ring-brand-500"
                      />
                      <span className="text-sm text-surface-700 dark:text-surface-300">
                        Restrict access to only assigned products
                      </span>
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Section 3: Compensation */}
        {showCompensation && (
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Compensation</h2>

            {/* Mode toggle */}
            {filteredPlans.length > 0 && (
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={compensationMode === 'inline'}
                    onChange={() => setCompensationMode('inline')}
                    className="text-brand-500 focus:ring-brand-500"
                  />
                  <span className="text-sm text-surface-700 dark:text-surface-300">Define compensation</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={compensationMode === 'existing'}
                    onChange={() => setCompensationMode('existing')}
                    className="text-brand-500 focus:ring-brand-500"
                  />
                  <span className="text-sm text-surface-700 dark:text-surface-300">Use existing plan</span>
                </label>
              </div>
            )}

            {/* Existing plan selector */}
            {compensationMode === 'existing' && filteredPlans.length > 0 && (
              <div>
                <label htmlFor="commissionPlanId" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Commission Plan
                </label>
                <select id="commissionPlanId" name="commissionPlanId" className="input">
                  <option value="">Select a plan</option>
                  {filteredPlans.map((plan: UserCreateCommissionPlan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.planName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Inline compensation fields */}
            {compensationMode === 'inline' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Fixed Salary */}
                  <div>
                    <label htmlFor="fixedSalary" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                      Fixed Salary
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-surface-800 dark:text-surface-400">NGN</span>
                      <input
                        id="fixedSalary"
                        name="fixedSalary"
                        type="number"
                        min={0}
                        step={0.01}
                        className="input pl-12"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  {/* Bonus */}
                  <div>
                    <label htmlFor="bonus" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                      Bonus
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-surface-800 dark:text-surface-400">NGN</span>
                      <input
                        id="bonus"
                        name="bonus"
                        type="number"
                        min={0}
                        step={0.01}
                        className="input pl-12"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>

                {/* Commission for Main Products */}
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                    Commission for Main Products
                  </label>
                  <div className="flex items-center gap-3">
                    <select name="commissionType" className="input w-36" defaultValue="FLAT">
                      <option value="FLAT">&#8358; Flat</option>
                      <option value="PERCENTAGE">% Percentage</option>
                    </select>
                    <input
                      name="commissionValue"
                      type="number"
                      min={0}
                      step={0.01}
                      className="input flex-1"
                      placeholder="0.00"
                    />
                  </div>
                  <p className="text-xs text-surface-700 dark:text-surface-500 mt-1">
                    Per delivered order. Leave blank if none.
                  </p>
                </div>

                {/* Commission for Upsells */}
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                    Commission for Bump Offers & Upsells
                  </label>
                  <div className="flex items-center gap-3">
                    <select name="upsellCommissionType" className="input w-36" defaultValue="FLAT">
                      <option value="FLAT">&#8358; Flat</option>
                      <option value="PERCENTAGE">% Percentage</option>
                    </select>
                    <input
                      name="upsellCommissionValue"
                      type="number"
                      min={0}
                      step={0.01}
                      className="input flex-1"
                      placeholder="0.00"
                    />
                  </div>
                  <p className="text-xs text-surface-700 dark:text-surface-500 mt-1">
                    Leave blank if none.
                  </p>
                </div>

                {/* Sales Target */}
                <div className="border-t border-surface-100 dark:border-surface-800 pt-4">
                  <SalesTargetSection />
                </div>
              </>
            )}
          </div>
        )}

        {/* Section 4: Contact */}
        {selectedRole && (
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Contact</h2>
            <div className="sm:w-1/2">
              <label htmlFor="phone" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                WhatsApp / Phone Number
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                className="input"
                placeholder="08031234567"
              />
              <p className="text-xs text-surface-700 dark:text-surface-500 mt-1">
                Never displayed publicly. Masked in all views.
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
          <Link to="/admin/users" className="btn-secondary w-full sm:w-auto">
            Cancel
          </Link>
          <button type="submit" className="btn-primary w-full sm:w-auto" disabled={isSubmitting || !selectedRole}>
            {isSubmitting ? 'Creating...' : 'Create User'}
          </button>
        </div>
      </Form>
    </div>
  );
}

// ─── Sales Target Sub-component ─────────────────────────

function SalesTargetSection() {
  const [targetEnabled, setTargetEnabled] = useState(false);

  return (
    <>
      <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
        Activate Commission Only After Meeting Sales Target?
      </label>
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="salesTargetEnabled"
            value="true"
            checked={targetEnabled}
            onChange={() => setTargetEnabled(true)}
            className="text-brand-500 focus:ring-brand-500"
          />
          <span className="text-sm text-surface-700 dark:text-surface-300">Yes</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="salesTargetEnabled"
            value="false"
            checked={!targetEnabled}
            onChange={() => setTargetEnabled(false)}
            className="text-brand-500 focus:ring-brand-500"
          />
          <span className="text-sm text-surface-700 dark:text-surface-300">No (add commission even if target not met)</span>
        </label>
      </div>

      {targetEnabled && (
        <div className="mt-3 sm:w-1/3">
          <label htmlFor="salesTargetPercentage" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
            Sales Target
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-surface-800 dark:text-surface-400">%</span>
            <input
              id="salesTargetPercentage"
              name="salesTargetPercentage"
              type="number"
              min={0}
              max={100}
              step={1}
              className="input pl-8"
              placeholder="0"
            />
          </div>
        </div>
      )}
    </>
  );
}

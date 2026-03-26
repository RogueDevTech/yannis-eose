import { useState, useEffect, useRef } from 'react';
import { Form, useActionData, useNavigation, Link } from '@remix-run/react';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { InlineNotification } from '~/components/ui/inline-notification';
import { PageNotification } from '~/components/ui/page-notification';
import { Checkbox } from '~/components/ui/checkbox';
import type {
  UserCreateLoaderData,
  UserCreateProduct,
  UserCreateLocation,
  UserCreateCommissionPlan,
  UserCreateBranch,
} from './types';

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
];

// ─── Component ──────────────────────────────────────────

export function UserCreatePage({ products, locations, plans, branches }: UserCreateLoaderData) {
  const actionData = useActionData<{ error?: string; success?: boolean; requiresApproval?: boolean; message?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const errorRef = useRef<HTMLDivElement>(null);
  const [dismissedError, setDismissedError] = useState(false);

  useEffect(() => {
    if (actionData?.error) setDismissedError(false);
  }, [actionData?.error]);

  useEffect(() => {
    if (actionData?.error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [actionData?.error]);

  const [selectedRole, setSelectedRole] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [compensationMode, setCompensationMode] = useState<'existing' | 'inline'>('inline');

  // Role-conditional visibility
  const showCapacity = ['CS_AGENT', 'HEAD_OF_CS'].includes(selectedRole);
  const showLogisticsLocation = ['TPL_MANAGER', 'TPL_RIDER'].includes(selectedRole);
  const is3PLRole = ['TPL_MANAGER', 'TPL_RIDER'].includes(selectedRole);
  const showProductAssignment = selectedRole === 'MEDIA_BUYER';
  const showCompensation = !!selectedRole;

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
        <Link to="/hr/users" className="text-surface-800 dark:text-surface-200 hover:text-brand-500">
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
        <p className="text-sm text-surface-800 dark:text-surface-200 mt-1">
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
      {actionData?.error && !dismissedError && (
        <div ref={errorRef}>
          <PageNotification
            variant="error"
            message={actionData.error}
            durationMs={5000}
            onDismiss={() => setDismissedError(true)}
          />
        </div>
      )}

      <Form method="post" className="space-y-6">
        {/* Hidden fields for JSON arrays */}
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
                <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
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
              <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                A password will be auto-generated and sent to this email.
              </p>
            </div>

            <div>
              <label htmlFor="primaryBranchId" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                Primary Branch *
              </label>
              <select
                id="primaryBranchId"
                name="primaryBranchId"
                required
                className="input"
              >
                <option value="">Select primary branch</option>
                {branches
                  .filter((branch: UserCreateBranch) => branch.status === 'ACTIVE')
                  .map((branch: UserCreateBranch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name} ({branch.code})
                    </option>
                  ))}
              </select>
              <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                Determines the default branch context and data scope on first login.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                Status
              </label>
              <p className="text-sm text-surface-600 dark:text-surface-400">
                New users are created as <strong>Pending</strong> and become <strong>Active</strong> after they log in for the first time.
              </p>
              <input type="hidden" name="status" value="PENDING" />
            </div>
          </div>
        </div>

        {/* Section 2: Role-Specific Settings */}
        {(showCapacity || showLogisticsLocation || showProductAssignment) && (
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
                <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                  Maximum concurrent orders this agent can handle.
                </p>
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
                  <InlineNotification
                    variant="warning"
                    message="No logistics locations found. Create one first."
                    action={{ label: 'Go to Logistics', href: '/admin/logistics' }}
                    className="mt-2"
                  />
                )}
              </div>
            )}

            {/* Product Assignment */}
            {showProductAssignment && (
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Assign Products
                </label>
                <p className="text-xs text-surface-700 dark:text-surface-300 mb-2">
                  Leave blank to assign all products. Select specific products to restrict.
                </p>
                {products.length > 0 ? (
                  <div className="border border-surface-200 dark:border-surface-700 rounded-lg max-h-48 overflow-y-auto">
                    {products.map((product: UserCreateProduct) => (
                      <label
                        key={product.id}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-pointer border-b border-surface-100 dark:border-surface-800 last:border-b-0"
                      >
                        <Checkbox
                          checked={selectedProductIds.includes(product.id)}
                          onChange={() => toggleProduct(product.id)}
                        />
                        <span className="text-sm text-surface-900 dark:text-surface-100">{product.name}</span>
                        <span className="text-xs text-surface-700 dark:text-surface-300 ml-auto">{product.category ?? ''}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-surface-700">No products found.</p>
                )}

                {selectedProductIds.length > 0 && (
                  <div className="mt-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        name="restrictProductAccess"
                        value="true"
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

            {/* Mode toggle — always show so user can choose plan vs flat */}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={compensationMode === 'inline'}
                  onChange={() => setCompensationMode('inline')}
                  className="text-brand-500 focus:ring-brand-500"
                />
                <span className="text-sm text-surface-700 dark:text-surface-300">Define compensation (flat)</span>
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

            {/* Existing plan selector — dropdown when plans exist */}
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

            {/* No plans for this role — show Create plan action */}
            {compensationMode === 'existing' && filteredPlans.length === 0 && (
              <div className="rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700 px-4 py-3">
                <p className="text-sm text-surface-700 dark:text-surface-300">
                  No commission plans for this role yet.
                </p>
                <Link
                  to="/hr/payroll?open=plan"
                  className="text-sm font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 mt-2 inline-block"
                >
                  Create plan →
                </Link>
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
                    <AmountInput
                      id="fixedSalary"
                      name="fixedSalary"
                      prefix="NGN"
                      className="input"
                      placeholder="0.00"
                    />
                  </div>

                  {/* Bonus */}
                  <div>
                    <label htmlFor="bonus" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                      Bonus
                    </label>
                    <AmountInput
                      id="bonus"
                      name="bonus"
                      prefix="NGN"
                      className="input"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <p className="text-xs text-surface-600 dark:text-surface-400">
                  Fixed salary, bonus, and flat commission amounts are monthly.
                </p>

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
                placeholder="08031234567 or +2348031234567"
                pattern="^(0[789]\d{9}|\+234[789]\d{9})$"
                title="Enter a valid Nigerian phone number (e.g. 08031234567 or +2348031234567)"
              />
              <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                Never displayed publicly. Masked in all views.
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
          <Link to="/hr/users" className="btn-secondary w-full sm:w-auto">
            Cancel
          </Link>
          <Button type="submit" variant="primary" className="w-full sm:w-auto" loading={isSubmitting} loadingText="Creating..." disabled={!selectedRole}>
            Create User
          </Button>
        </div>
      </Form>
    </div>
  );
}


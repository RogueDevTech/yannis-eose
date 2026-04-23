import { useState, useEffect, useRef } from 'react';
import { Form, useActionData, useNavigation, Link } from '@remix-run/react';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { InlineNotification } from '~/components/ui/inline-notification';
import { PageNotification } from '~/components/ui/page-notification';
import { Checkbox } from '~/components/ui/checkbox';
import { Breadcrumb } from '~/components/ui/breadcrumb';
import { PageHeader } from '~/components/ui/page-header';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { RadioGroup } from '~/components/ui/radio-group';
import type {
  UserCreateLoaderData,
  UserCreateProduct,
  UserCreateLocation,
  UserCreateCommissionPlan,
  UserCreateBranch,
} from './types';
import { formatRole } from './types';

const HEAD_ROLES = ['HEAD_OF_CS', 'HEAD_OF_MARKETING', 'HEAD_OF_LOGISTICS'];

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

export function UserCreatePage({ products, locations, plans, branches, activeHeads }: UserCreateLoaderData) {
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
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [compensationMode, setCompensationMode] = useState<'existing' | 'inline'>('inline');

  const conflictingHead =
    HEAD_ROLES.includes(selectedRole) && selectedBranchId
      ? activeHeads.find(
          (h) => h.role === selectedRole && h.primaryBranchId === selectedBranchId,
        )
      : undefined;
  const conflictingBranch = conflictingHead
    ? branches.find((b) => b.id === conflictingHead.primaryBranchId)
    : undefined;

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
      <Breadcrumb items={[{ label: 'Users', to: '/hr/users' }, { label: 'Add User' }]} />

      <PageHeader
        title="Add User"
        description="Create a new account for a team member with role-specific settings."
      />

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
          <h2 className="text-lg font-semibold text-app-fg">Account Details</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Role — first so conditional sections appear below */}
            <div className="sm:col-span-2">
              <FormSelect
                id="role"
                name="role"
                label="Role"
                required
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                placeholder="Select a role"
                options={ROLES.map((r) => ({ value: r.value, label: r.label }))}
              />
              {selectedRole && (
                <p className="text-xs text-app-fg-muted mt-1">
                  {ROLES.find((r) => r.value === selectedRole)?.description}
                </p>
              )}
            </div>

            <div>
              <TextInput
                id="name"
                name="name"
                label="Full Name"
                required
                minLength={2}
                placeholder="John Doe"
              />
            </div>

            <div>
              <TextInput
                id="email"
                name="email"
                type="email"
                label="Email Address"
                required
                placeholder="john@company.com"
                hint="A password will be auto-generated and sent to this email."
              />
            </div>

            <div>
              <FormSelect
                id="primaryBranchId"
                name="primaryBranchId"
                label="Primary Branch"
                required
                placeholder="Select primary branch"
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                options={branches
                  .filter((branch: UserCreateBranch) => branch.status === 'ACTIVE')
                  .map((branch: UserCreateBranch) => ({
                    value: branch.id,
                    label: `${branch.name} (${branch.code})`,
                  }))}
              />
              <p className="text-xs text-app-fg-muted mt-1">
                Determines the default branch context and data scope on first login.
              </p>
            </div>

            {conflictingHead && (
              <div className="sm:col-span-2">
                <InlineNotification
                  variant="warning"
                  message={`${conflictingBranch ? conflictingBranch.name : 'This branch'} already has an active ${formatRole(selectedRole)} (${conflictingHead.name}). Creating another will be rejected — deactivate them first.`}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-app-fg-muted mb-1.5">
                Status
              </label>
              <p className="text-sm text-app-fg-muted">
                New users are created as <strong>Pending</strong> and become <strong>Active</strong> after they log in for the first time.
              </p>
              <input type="hidden" name="status" value="PENDING" />
            </div>
          </div>
        </div>

        {/* Section 2: Role-Specific Settings */}
        {(showCapacity || showLogisticsLocation || showProductAssignment) && (
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Role Settings</h2>

            {/* Capacity (CS roles) */}
            {showCapacity && (
              <div>
                <TextInput
                  id="capacity"
                  name="capacity"
                  type="number"
                  label="Order Capacity"
                  min={1}
                  max={100}
                  defaultValue="10"
                  wrapperClassName="w-full sm:w-32"
                  hint="Maximum concurrent orders this agent can handle."
                />
              </div>
            )}

            {/* Logistics Location (TPL roles) */}
            {showLogisticsLocation && (
              <div>
                <FormSelect
                  id="logisticsLocationId"
                  name="logisticsLocationId"
                  label="Logistics Location"
                  placeholder="Select location"
                  options={locations.map((loc: UserCreateLocation) => ({
                    value: loc.id,
                    label: `${loc.name} — ${loc.address}`,
                  }))}
                />
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
                <label className="block text-sm font-medium text-app-fg-muted mb-1.5">
                  Assign Products
                </label>
                <p className="text-xs text-app-fg-muted mb-2">
                  Leave blank to assign all products. Select specific products to restrict.
                </p>
                {products.length > 0 ? (
                  <div className="border border-app-border rounded-lg max-h-48 overflow-y-auto">
                    {products.map((product: UserCreateProduct) => (
                      <label
                        key={product.id}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-app-hover/50 cursor-pointer border-b border-app-border last:border-b-0"
                      >
                        <Checkbox
                          checked={selectedProductIds.includes(product.id)}
                          onChange={() => toggleProduct(product.id)}
                        />
                        <span className="text-sm text-app-fg">{product.name}</span>
                        <span className="text-xs text-app-fg-muted ml-auto">{product.category ?? ''}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-app-fg-muted">No products found.</p>
                )}

                {selectedProductIds.length > 0 && (
                  <div className="mt-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        name="restrictProductAccess"
                        value="true"
                      />
                      <span className="text-sm text-app-fg-muted">
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
            <h2 className="text-lg font-semibold text-app-fg">Compensation</h2>

            {/* Mode toggle — always show so user can choose plan vs flat */}
            <RadioGroup
              name="_compensationModeToggle"
              options={[
                { value: 'inline', label: 'Define compensation (flat)' },
                { value: 'existing', label: 'Use existing plan' },
              ]}
              value={compensationMode}
              onChange={(v) => setCompensationMode(v as 'inline' | 'existing')}
              layout="horizontal"
            />

            {/* Existing plan selector — dropdown when plans exist */}
            {compensationMode === 'existing' && filteredPlans.length > 0 && (
              <div>
                <FormSelect
                  id="commissionPlanId"
                  name="commissionPlanId"
                  label="Commission Plan"
                  placeholder="Select a plan"
                  options={filteredPlans.map((plan: UserCreateCommissionPlan) => ({
                    value: plan.id,
                    label: plan.planName,
                  }))}
                />
              </div>
            )}

            {/* No plans for this role — show Create plan action */}
            {compensationMode === 'existing' && filteredPlans.length === 0 && (
              <div className="rounded-lg bg-app-hover border border-app-border px-4 py-3">
                <p className="text-sm text-app-fg-muted">
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
                    <label htmlFor="fixedSalary" className="block text-sm font-medium text-app-fg-muted mb-1.5">
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
                    <label htmlFor="bonus" className="block text-sm font-medium text-app-fg-muted mb-1.5">
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

                <p className="text-xs text-app-fg-muted">
                  Fixed salary, bonus, and flat commission amounts are monthly.
                </p>

              </>
            )}
          </div>
        )}

        {/* Section 4: Contact */}
        {selectedRole && (
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Contact</h2>
            <div className="sm:w-1/2">
              <TextInput
                id="phone"
                name="phone"
                type="tel"
                label="WhatsApp / Phone Number"
                placeholder="08031234567 or +2348031234567"
                pattern="^(0[789]\d{9}|\+234[789]\d{9})$"
                title="Enter a valid Nigerian phone number (e.g. 08031234567 or +2348031234567)"
                hint="Never displayed publicly. Masked in all views."
              />
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


import { Suspense, useState } from 'react';
import { Await, Form, Link, useActionData, useNavigation } from '@remix-run/react';
import {
  PayrollUserProfileSection,
  type PayrollProfileValues,
} from '~/features/hr/PayrollUserProfileSection';
import type { PayRole } from '~/features/hr/payroll-prd-types';
import type { EditingUser } from '~/features/users/UserCreatePage';
import type { UserCreateLoaderData } from '~/features/users/types';
import { useFetcherToast } from '~/components/ui/toast';

/**
 * Self-serve payroll editor — the payroll-ONLY view of the user edit page shown
 * when a user opens their OWN profile for editing. The full staff-edit form
 * (role, branches, permissions, account) is intentionally out of reach for
 * self (see canEditUser); this lets a user maintain just their payroll
 * declarations — pay role, salary basis, tax status, flat amount, and the
 * annual rent used for PAYE rent relief. It submits `intent=updateMyPayroll`,
 * which the route action routes to `hr.updateMyPayrollProfile` (target forced
 * to the authenticated user; no role/branch/permission fields exist on it).
 */
export function SelfPayrollEditForm({
  editingUser,
  picklistsPromise,
}: {
  editingUser: EditingUser;
  picklistsPromise: Promise<UserCreateLoaderData>;
}) {
  const navigation = useNavigation();
  const actionData = useActionData<{ error?: string; success?: boolean }>();
  useFetcherToast(actionData, { successMessage: 'Payroll profile updated' });

  const [values, setValues] = useState<PayrollProfileValues>({
    payRoleId: editingUser.payRoleId ?? null,
    employmentType: editingUser.employmentType ?? 'STAFF',
    salaryBasis: editingUser.salaryBasis ?? 'FORMULA_BASED',
    taxStatus: editingUser.taxStatus ?? 'STANDARD_PAYE',
    flatMonthlyAmount: editingUser.flatMonthlyAmount ?? '',
    annualRent: editingUser.annualRent ?? '',
  });

  const isSaving =
    navigation.state !== 'idle' &&
    navigation.formData?.get('intent') === 'updateMyPayroll';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-app-fg">Edit payroll profile</h1>
          <p className="mt-0.5 text-sm text-app-fg-muted">
            Your pay role, tax treatment, and annual rent for PAYE relief.
          </p>
        </div>
        <Link to={`/hr/users/${editingUser.id}`} className="btn-secondary btn-sm shrink-0">
          Cancel
        </Link>
      </div>

      <Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="updateMyPayroll" />
        {/* Fields the section renders as native inputs (flatMonthlyAmount,
            annualRent) submit themselves; the rest are controlled → hidden. */}
        <input type="hidden" name="payRoleId" value={values.payRoleId ?? ''} />
        <input type="hidden" name="employmentType" value={values.employmentType} />
        <input type="hidden" name="salaryBasis" value={values.salaryBasis} />
        <input type="hidden" name="taxStatus" value={values.taxStatus} />

        <Suspense
          fallback={
            <div className="card space-y-2">
              <h2 className="text-lg font-semibold text-app-fg">Payroll profile</h2>
              <p className="text-sm text-app-fg-muted">Loading pay roles…</p>
            </div>
          }
        >
          <Await resolve={picklistsPromise}>
            {(picklists) => {
              const payRoles = (picklists.payRoles ?? []) as unknown as PayRole[];
              return (
                <PayrollUserProfileSection
                  values={values}
                  payRoles={payRoles}
                  userRole={editingUser.role}
                  onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
                />
              );
            }}
          </Await>
        </Suspense>

        {actionData?.error && (
          <p className="text-sm text-danger-600 dark:text-danger-400">{actionData.error}</p>
        )}

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </Form>
    </div>
  );
}

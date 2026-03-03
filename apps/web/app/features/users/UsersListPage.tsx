import { useState } from 'react';
import { Link } from '@remix-run/react';
import type { User } from './types';
import { ROLE_COLORS, USER_STATUS_COLORS, ROLE_OPTIONS, formatRole } from './types';

interface UsersListPageProps {
  users: User[];
  total: number;
}

export function UsersListPage({ users, total }: UsersListPageProps) {
  const [selectedRole, setSelectedRole] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredUsers = users.filter((user) => {
    if (selectedRole !== 'ALL' && user.role !== selectedRole) return false;
    if (
      searchQuery &&
      !user.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !user.email.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Users</h1>
          <p className="text-sm text-surface-800 dark:text-surface-400 mt-0.5">
            Manage team members and their roles
          </p>
        </div>
        <Link to="/admin/users/new" className="btn-primary">
          <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add User
        </Link>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Total Users</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{total}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Active</p>
          <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">
            {users.filter((u) => u.status === 'ACTIVE').length}
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Inactive</p>
          <p className="text-2xl font-bold text-danger-600 dark:text-danger-400 mt-1">
            {users.filter((u) => u.status === 'INACTIVE').length}
          </p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-400 uppercase tracking-wider">Roles</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">
            {new Set(users.map((u) => u.role)).size}
          </p>
        </div>
      </div>

      {/* Filters bar */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10 py-1.5"
            />
          </div>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="input w-full sm:w-48 py-1.5"
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role === 'ALL' ? 'All Roles' : formatRole(role)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Users table */}
      <div className="card p-0 overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Name</th>
                <th className="table-header">Email</th>
                <th className="table-header">Role</th>
                <th className="table-header">Status</th>
                <th className="table-header text-center">Capacity</th>
                <th className="table-header">Joined</th>
                <th className="table-header text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="table-row">
                  <td className="table-cell">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-semibold text-white">
                          {user.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="font-medium text-surface-900 dark:text-surface-100">{user.name}</span>
                    </div>
                  </td>
                  <td className="table-cell text-surface-800 dark:text-surface-400">{user.email}</td>
                  <td className="table-cell">
                    <span className={ROLE_COLORS[user.role] ?? 'badge'}>
                      {formatRole(user.role)}
                    </span>
                  </td>
                  <td className="table-cell">
                    <span className={USER_STATUS_COLORS[user.status] ?? 'badge'}>
                      {user.status}
                    </span>
                  </td>
                  <td className="table-cell text-center">{user.capacity}</td>
                  <td className="table-cell text-surface-800 dark:text-surface-400">
                    {new Date(user.createdAt).toLocaleDateString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="table-cell text-right">
                    <Link
                      to={`/admin/users/${user.id}`}
                      className="text-brand-500 hover:text-brand-600 text-sm font-medium"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-surface-700 dark:text-surface-500">
                    {users.length === 0 ? 'No users yet. Add your first team member.' : 'No matching users found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
          {filteredUsers.map((user) => (
            <Link
              key={user.id}
              to={`/admin/users/${user.id}`}
              className="block p-4 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-full bg-brand-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-white">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-surface-900 dark:text-surface-100 truncate">{user.name}</p>
                  <p className="text-sm text-surface-800 dark:text-surface-400 truncate">{user.email}</p>
                </div>
                <span className={USER_STATUS_COLORS[user.status] ?? 'badge'}>{user.status}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className={ROLE_COLORS[user.role] ?? 'badge'}>
                  {formatRole(user.role)}
                </span>
                <span className="text-xs text-surface-700 dark:text-surface-500">
                  {new Date(user.createdAt).toLocaleDateString('en-NG', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </Link>
          ))}
          {filteredUsers.length === 0 && (
            <div className="p-8 text-center text-surface-700 dark:text-surface-500">
              {users.length === 0 ? 'No users yet' : 'No matching users found'}
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-surface-800 dark:text-surface-400">
          Showing {filteredUsers.length} of {total} users
        </p>
        <div className="flex items-center gap-2">
          <button className="btn-secondary btn-sm" disabled>
            Previous
          </button>
          <span className="text-sm text-surface-800 dark:text-surface-400 px-2">Page 1 of 1</span>
          <button className="btn-secondary btn-sm" disabled>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

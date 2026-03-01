import type { MetaFunction } from '@remix-run/node';

export const meta: MetaFunction = () => {
  return [
    { title: 'Yannis EOSE — Rider Dashboard' },
    { name: 'description', content: '3PL Rider Mobile Dashboard' },
  ];
};

export default function RiderDashboard() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Rider Dashboard</h1>
        <p className="mt-2 text-gray-600">3PL Delivery Management</p>
      </div>
    </div>
  );
}

import type { MetaFunction } from '@remix-run/node';

export const meta: MetaFunction = () => {
  return [
    { title: 'Yannis EOSE — Login' },
    { name: 'description', content: 'Sign in to Yannis EOSE' },
  ];
};

export default function Login() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Login</h1>
        <p className="mt-2 text-gray-600">Sign in to your account</p>
      </div>
    </div>
  );
}

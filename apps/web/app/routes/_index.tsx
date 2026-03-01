import type { MetaFunction } from '@remix-run/node';

export const meta: MetaFunction = () => {
  return [
    { title: 'Yannis EOSE' },
    { name: 'description', content: 'Enterprise Operations & Sales Engine' },
  ];
};

export default function Index() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Yannis EOSE</h1>
        <p className="mt-2 text-lg text-gray-600">
          Enterprise Operations &amp; Sales Engine
        </p>
      </div>
    </div>
  );
}

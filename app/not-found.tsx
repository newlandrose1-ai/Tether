import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0B0E14] px-6 text-center text-slate-200">
      <h1 className="text-xl font-semibold tracking-tight text-slate-100">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-slate-400">
        The requested route does not exist in Zip Upgrader.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-800 whitespace-nowrap"
      >
        Return to Zip Upgrader
      </Link>
    </div>
  );
}

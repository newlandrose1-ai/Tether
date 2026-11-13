import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0B0D0E] text-zinc-300 font-mono p-4 text-center">
      <h1 className="text-xl font-bold text-zinc-100 mb-2">404 - Page Not Found</h1>
      <p className="text-sm text-zinc-400 mb-4">The requested page or resource could not be found.</p>
      <Link
        href="/"
        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs rounded transition"
      >
        Return to Workspace
      </Link>
    </div>
  );
}

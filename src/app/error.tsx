"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  // Contract 48.2 — generic message, no stack trace / no internals shown.
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-neutral-600">
        FocusGrid hit an unexpected error. Your saved tasks are untouched.
      </p>
      <button onClick={reset} className="btn">
        Try again
      </button>
    </main>
  );
}

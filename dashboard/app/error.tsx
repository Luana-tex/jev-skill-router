"use client";

import { Card } from "@/components/ui/card";

export default function ErrorState({ reset }: { reset: () => void }) {
  return <Card className="grid gap-3" role="alert"><h1 className="text-xl font-semibold">Analytics unavailable</h1>
    <p>Check that the local SQLite database is readable, then try again.</p>
    <button type="button" className="icon-button !w-auto justify-self-start px-4" onClick={reset}>Try again</button>
  </Card>;
}

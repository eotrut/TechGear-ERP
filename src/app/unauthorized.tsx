import { LogIn } from "lucide-react";
import Link from "next/link";

import { StatusScreen } from "@/components/feedback/status-screen";
import { Button } from "@/components/ui/button";

/** 401. Rendered when `unauthorized()` is called without a valid session. */
export default function Unauthorized() {
  return (
    <StatusScreen
      icon={LogIn}
      title="Your session has ended"
      description="Sign in again to continue where you left off."
      actions={
        <Button asChild variant="primary">
          <Link href="/login">Sign in</Link>
        </Button>
      }
    />
  );
}

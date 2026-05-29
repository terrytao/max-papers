// Post-signup landing — sends users to the dashboard for their
// role. Keeping this as a thin redirect rather than a multi-step
// wizard for v1; structured onboarding is a follow-up if drop-off
// becomes a real problem.

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/signin");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const role = (session.user as any).role;
  if (role === "employer") redirect("/dashboard/employer");
  redirect("/dashboard/candidate");
}

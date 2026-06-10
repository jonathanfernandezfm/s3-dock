import { SignIn } from "@clerk/nextjs";
import { landingClerkAppearance } from "@/lib/auth/clerk-appearance";

export default function SignInPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Welcome back
        </h1>
        <p className="text-sm text-[var(--landing-muted)]">
          Sign in to your account to continue
        </p>
      </div>
      <div className="flex justify-center">
        <SignIn appearance={landingClerkAppearance} />
      </div>
    </div>
  );
}

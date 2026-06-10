import { SignUp } from "@clerk/nextjs";
import { landingClerkAppearance } from "@/lib/auth/clerk-appearance";

export default function SignUpPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Create an account
        </h1>
        <p className="text-sm text-[var(--landing-muted)]">
          Get started with S3 Dock today
        </p>
      </div>
      <SignUp appearance={landingClerkAppearance} />
    </div>
  );
}

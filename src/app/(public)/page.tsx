import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  title: "S3 Dock — S3, finally usable.",
  description:
    "A modern web UI for S3, R2, MinIO, and anything else that speaks the protocol. Browse, search, and move files like it's a drive.",
  openGraph: {
    title: "S3 Dock — S3, finally usable.",
    description:
      "A modern web UI for S3-compatible storage. Browse, search, and move files like it's a drive.",
    type: "website",
  },
};

export default function Home() {
  return <LandingPage />;
}

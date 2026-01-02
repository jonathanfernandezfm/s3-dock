"use client";

import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";

interface BreadcrumbProps {
  connectionId: string;
  bucket: string;
  path: string;
  onNavigate?: (path: string) => void;
  onGoHome?: () => void;
}

export function Breadcrumb({ connectionId, bucket, path, onNavigate, onGoHome }: BreadcrumbProps) {
  const parts = path.split("/").filter(Boolean);

  const buildPath = (index: number) => {
    const pathParts = parts.slice(0, index + 1);
    return pathParts.join("/") + "/";
  };

  const buildHref = (index: number) => {
    const pathParts = parts.slice(0, index + 1);
    return `/browser/${connectionId}/${bucket}/${pathParts.join("/")}`;
  };

  const handleClick = (e: React.MouseEvent, targetPath: string) => {
    if (onNavigate) {
      e.preventDefault();
      onNavigate(targetPath);
    }
  };

  const handleHomeClick = (e: React.MouseEvent) => {
    if (onGoHome) {
      e.preventDefault();
      onGoHome();
    }
  };

  return (
    <nav className="flex items-center space-x-1 text-sm">
      <Link
        href="/buckets"
        className="flex items-center hover:text-foreground text-muted-foreground"
        onClick={handleHomeClick}
        title="Back to buckets"
      >
        <Home className="h-4 w-4" />
      </Link>

      <ChevronRight className="h-4 w-4 text-muted-foreground" />

      <Link
        href={`/browser/${connectionId}/${bucket}`}
        className={`hover:text-foreground ${
          parts.length === 0 ? "font-medium" : "text-muted-foreground"
        }`}
        onClick={(e) => handleClick(e, "")}
      >
        {bucket}
      </Link>

      {parts.map((part, index) => (
        <div key={index} className="flex items-center space-x-1">
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <Link
            href={buildHref(index)}
            className={`hover:text-foreground ${
              index === parts.length - 1 ? "font-medium" : "text-muted-foreground"
            }`}
            onClick={(e) => handleClick(e, buildPath(index))}
          >
            {part}
          </Link>
        </div>
      ))}
    </nav>
  );
}

import type { ReactNode } from "react";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/*
       * Inline script runs synchronously before the first paint so there is
       * no flash-of-wrong-theme. Reads the OS preference and applies the
       * `dark` class used by Tailwind's dark variant.
       */}
      <script
        dangerouslySetInnerHTML={{
          __html: `try{if(window.matchMedia('(prefers-color-scheme:dark)').matches)document.documentElement.classList.add('dark')}catch(e){}`,
        }}
      />
      {children}
    </>
  );
}

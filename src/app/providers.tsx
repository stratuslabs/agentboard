'use client';

import { PreferencesProvider } from '@/contexts/PreferencesContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PreferencesProvider>
      {children}
    </PreferencesProvider>
  );
}

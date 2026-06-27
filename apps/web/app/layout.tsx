import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles/tokens.css";
import "./styles/globals.css";
import { ThemeProvider } from "./components/ThemeProvider";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { Footer } from "./components/Footer";

export const metadata: Metadata = {
  title: "Clasher",
  description:
    "Clash of Clans clan-management toolkit: registration, war/CWL tracking, giveaways, ranking.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning: next-themes sets data-theme on <html> before React
  // hydrates, which would otherwise be flagged as a mismatch.
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {children}
          <Footer />
          <ThemeSwitcher />
        </ThemeProvider>
      </body>
    </html>
  );
}

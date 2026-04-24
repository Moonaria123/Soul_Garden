import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { LangSync } from "@/components/layout/lang-sync";
import "./globals.css";

export const metadata: Metadata = {
  title: "想你 · Missing You",
  description: "在这里和你想念的人相遇。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <LangSync />
        {children}
        <Toaster />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Juniper Knowledge Assistant",
  description: "RAG assistant for Juniper Booking Engine knowledge"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

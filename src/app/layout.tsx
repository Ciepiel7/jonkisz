import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const ibm = IBM_Plex_Sans({
  variable: "--font-ibm",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
});

const jet = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Jonkisz — giełda offline",
  description: "Lokalna symulacja giełdy: konta, pozycje, dźwignia, programowany rynek",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl" className={`${ibm.variable} ${jet.variable} h-full`}>
      <body className="h-full bg-black">{children}</body>
    </html>
  );
}

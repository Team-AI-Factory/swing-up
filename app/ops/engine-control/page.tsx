import type { Metadata } from "next";
import EngineControlPanel from "./EngineControlPanel";

export const metadata: Metadata = {
  title: "Engine Control · Swing Up Ops",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function EngineControlPage() {
  return <EngineControlPanel />;
}

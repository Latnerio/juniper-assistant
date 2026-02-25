import { Chat } from "@/components/chat";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col items-center px-4 py-3 sm:px-6">
      <Chat />
      <p className="mt-2 text-xs text-muted-foreground">Powered by Juniper Knowledge Base</p>
    </main>
  );
}

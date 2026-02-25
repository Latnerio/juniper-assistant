import { Chat } from "@/components/chat";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center px-4 py-4 sm:px-6 lg:py-6">
      <Chat />
      <p className="mt-4 text-xs text-muted-foreground">Powered by Juniper Knowledge Base</p>
    </main>
  );
}

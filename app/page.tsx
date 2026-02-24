import { Chat } from "@/components/chat";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center px-4 py-8 sm:px-6 lg:py-10">
      <Chat />
      <p className="mt-4 text-xs text-muted-foreground">Powered by Juniper Knowledge Base</p>
    </main>
  );
}

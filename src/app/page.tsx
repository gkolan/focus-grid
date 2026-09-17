import { agentAvailable, currentAiCapability } from "@/ai/config";
import { AppShell } from "./_components/AppShell";

export const dynamic = "force-dynamic";

export default function Home() {
  const ai = currentAiCapability();
  return <AppShell aiCapability={ai} agent={agentAvailable()} />;
}

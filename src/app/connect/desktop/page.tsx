import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import DesktopConnectClient from "./DesktopConnectClient";

export default async function ConnectDesktopPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent("/connect/desktop")}`);
  }

  return <DesktopConnectClient />;
}

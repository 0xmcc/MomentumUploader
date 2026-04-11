import { clerkClient } from "@clerk/nextjs/server";

export type OwnerIdentity = {
  displayName: string;
  avatarUrl: string | null;
};

export async function resolveOwnerIdentity(ownerUserId: string | null): Promise<OwnerIdentity | null> {
  if (!ownerUserId) {
    return null;
  }

  try {
    const client = await clerkClient();
    const owner = await client.users.getUser(ownerUserId);
    const displayName =
      owner.fullName?.trim() ||
      [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim() ||
      owner.username?.trim() ||
      "Memo owner";

    return {
      displayName,
      avatarUrl: owner.imageUrl ?? null,
    };
  } catch {
    return null;
  }
}

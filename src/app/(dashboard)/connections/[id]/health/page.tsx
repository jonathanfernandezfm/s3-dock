import { redirect } from "next/navigation";

export default async function ConnectionHealthRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/connections/${id}?tab=permissions`);
}

import { redirect } from "next/navigation";

export default async function ConnectionHealthRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/app/connections/${id}?tab=permissions`);
}

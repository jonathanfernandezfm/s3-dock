import { redirect } from "next/navigation";

export default function DeprecatedConnectionsSettingsPage() {
  redirect("/app/connections");
}

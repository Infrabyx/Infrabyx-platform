// The console's home: the approvals queue, or the sign-in page.
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/studio/approvals");
}

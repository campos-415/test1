import { redirect } from "next/navigation";

// Moved onto /requests — see app/enrollments/page.tsx.
export default function BoardingRequestsRedirect() {
  redirect("/requests?tab=boarding");
}

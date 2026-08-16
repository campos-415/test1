import { redirect } from "next/navigation";

// Both queues moved onto /requests. Kept as a redirect so bookmarks, and
// the links printed in earlier versions of the README, still land somewhere
// useful.
export default function EnrollmentsRedirect() {
  redirect("/requests?tab=enrollments");
}

import KioskForm from "@/components/KioskForm";
import KioskGate from "@/components/KioskGate";

// The lobby tablet. Behind a one-time device sign-in, because the kiosk
// reads and writes real client data and the database no longer trusts
// anonymous callers — see rls-lockdown.sql.
export default function KioskPage() {
  return (
    <KioskGate>
      <KioskForm />
    </KioskGate>
  );
}

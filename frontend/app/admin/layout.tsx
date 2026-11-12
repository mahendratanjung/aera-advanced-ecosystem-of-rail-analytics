import { AdminNav } from "@/features/admin/AdminNav";

/** Admin (ADM-02..05): staff settings, apart from both the rider app and Operations (OPS-01). */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--ops-soft)]">
      <AdminNav />
      {children}
    </div>
  );
}
